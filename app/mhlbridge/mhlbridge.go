// Package mhlbridge spawns `mhl serve mcp --http` as a child process bound to
// loopback and talks MCP (JSON-RPC 2.0 over HTTP) to it. This is the Go-side
// half of the Senpai shell described in PLANO-MACRO-MHL-SENPAI.md §6 — the
// UI never talks to mhl directly, it calls bound App methods that go through
// this package.
//
// Why --http and not plain stdio: a Fase 0 spike found that mhl_run_start/
// status/resume/cancel/list/logs — the tools the UI needs for progress and
// Modo Buddy — only exist under `mhl serve mcp --http`; plain stdio only
// publishes the workflows themselves as synchronous tools. See
// FASE0-ACHADOS.md §2. --addr stays on 127.0.0.1, so this never leaves the
// machine and needs no --token.
package mhlbridge

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"sync/atomic"
	"time"
)

// Client owns the mhl child process and the MCP session opened against it.
type Client struct {
	cmd       *exec.Cmd
	baseURL   string
	sessionID string
	http      *http.Client
	nextID    atomic.Int64
	stderr    *bytes.Buffer
}

// rpcRequest/rpcResponse are the bare JSON-RPC 2.0 envelope mhl speaks.
type rpcRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      int64  `json:"id"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      int64           `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// Start resolves a free loopback port, spawns `mhl serve mcp --http` against
// workflowsDir, waits for it to answer /healthz, and completes the MCP
// initialize handshake. mhlPath is the mhl binary to run — pass a bare "mhl"
// to resolve it from PATH (fine for this spike; Fase 7 vendors a per-platform
// binary and passes its absolute path instead, per §6.1/C6 of the plan).
func Start(ctx context.Context, mhlPath, workflowsDir string) (*Client, error) {
	addr, err := freeLoopbackAddr()
	if err != nil {
		return nil, fmt.Errorf("mhlbridge: pick free port: %w", err)
	}

	cmd := exec.CommandContext(ctx, mhlPath, "serve", "mcp", "--http", "--addr", addr, workflowsDir)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	cmd.Stdout = io.Discard
	// New process group so the child (and anything it spawns) is not left
	// behind if this process is killed abruptly rather than shut down
	// cleanly via Stop().
	setProcessGroup(cmd)

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("mhlbridge: start mhl: %w", err)
	}

	c := &Client{
		cmd:     cmd,
		baseURL: "http://" + addr,
		http:    &http.Client{Timeout: 30 * time.Second},
		stderr:  &stderr,
	}

	if err := c.waitReady(ctx, 10*time.Second); err != nil {
		c.killQuietly()
		return nil, fmt.Errorf("mhlbridge: mhl did not become ready: %w (stderr: %s)", err, stderr.String())
	}

	if err := c.initialize(ctx); err != nil {
		c.killQuietly()
		return nil, fmt.Errorf("mhlbridge: initialize handshake: %w", err)
	}

	return c, nil
}

// freeLoopbackAddr asks the OS for an ephemeral port on 127.0.0.1, then
// releases it immediately — mhl binds its own listener a moment later.
// Narrow race in principle (another process could grab the port first);
// acceptable for a local dev tool with no adversarial neighbor process.
func freeLoopbackAddr() (string, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", err
	}
	defer l.Close()
	return l.Addr().String(), nil
}

func (c *Client) waitReady(ctx context.Context, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/healthz", nil)
		if err == nil {
			if resp, err := c.http.Do(req); err == nil {
				resp.Body.Close()
				if resp.StatusCode == http.StatusOK {
					return nil
				}
			}
		}
		if c.cmd.ProcessState != nil {
			return fmt.Errorf("mhl exited early: %s", c.cmd.ProcessState.String())
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("timed out after %s", timeout)
}

func (c *Client) initialize(ctx context.Context) error {
	params := map[string]any{
		"protocolVersion": "2025-06-18",
		"capabilities":    map[string]any{},
	}
	_, header, err := c.postRPC(ctx, "initialize", params, false)
	if err != nil {
		return err
	}
	sid := header.Get("Mcp-Session-Id")
	if sid == "" {
		return fmt.Errorf("server did not return Mcp-Session-Id")
	}
	c.sessionID = sid
	return nil
}

// ToolsList calls the standard MCP tools/list method.
func (c *Client) ToolsList(ctx context.Context) (json.RawMessage, error) {
	result, _, err := c.postRPC(ctx, "tools/list", nil, true)
	return result, err
}

// ToolsCall invokes a named tool (a workflow, or one of the mhl_run_* tools)
// synchronously, mirroring a plain `tools/call`.
func (c *Client) ToolsCall(ctx context.Context, name string, arguments map[string]any) (json.RawMessage, error) {
	params := map[string]any{
		"name":      name,
		"arguments": arguments,
	}
	result, _, err := c.postRPC(ctx, "tools/call", params, true)
	return result, err
}

func (c *Client) postRPC(ctx context.Context, method string, params any, withSession bool) (json.RawMessage, http.Header, error) {
	reqBody := rpcRequest{
		JSONRPC: "2.0",
		ID:      c.nextID.Add(1),
		Method:  method,
		Params:  params,
	}
	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/mcp", bytes.NewReader(body))
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if withSession {
		if c.sessionID == "" {
			return nil, nil, fmt.Errorf("no active session — call initialize first")
		}
		req.Header.Set("Mcp-Session-Id", c.sessionID)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()

	var rpcResp rpcResponse
	if err := json.NewDecoder(resp.Body).Decode(&rpcResp); err != nil {
		return nil, resp.Header, fmt.Errorf("decode response: %w", err)
	}
	if rpcResp.Error != nil {
		return nil, resp.Header, fmt.Errorf("mhl rpc error %d: %s", rpcResp.Error.Code, rpcResp.Error.Message)
	}
	return rpcResp.Result, resp.Header, nil
}

// Stop ends the MCP session and terminates the mhl child process. Safe to
// call once during app shutdown; a nil Client is a no-op so callers don't
// need to guard a failed Start().
func (c *Client) Stop() error {
	if c == nil {
		return nil
	}
	if c.sessionID != "" {
		req, err := http.NewRequest(http.MethodDelete, c.baseURL+"/mcp", nil)
		if err == nil {
			req.Header.Set("Mcp-Session-Id", c.sessionID)
			if resp, err := c.http.Do(req); err == nil {
				resp.Body.Close()
			}
		}
	}
	return c.terminate()
}

func (c *Client) killQuietly() {
	_ = c.terminate()
}

func (c *Client) terminate() error {
	if c.cmd.Process == nil {
		return nil
	}
	// os.Interrupt asks mhl to shut down cleanly; Windows doesn't support
	// signaling an arbitrary process this way (Signal returns an error
	// there), so this falls straight through to Kill() on that platform —
	// correct, just not graceful. Fine for a local dev tool (C6).
	if err := c.cmd.Process.Signal(os.Interrupt); err != nil {
		return c.cmd.Process.Kill()
	}
	done := make(chan error, 1)
	go func() { done <- c.cmd.Wait() }()
	select {
	case <-done:
		return nil
	case <-time.After(3 * time.Second):
		return c.cmd.Process.Kill()
	}
}
