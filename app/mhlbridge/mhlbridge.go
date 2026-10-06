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
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// maxConcurrentRuns caps how many mhl_run_start executions run at once —
// passed as --max-concurrent-runs (default 0 = unlimited, if we didn't set
// it). This bounds actual step execution (mcpserver's own launch()/
// tryAcquireSlot — a real queue past the limit, not a rejection), a
// reasonable general safety net against unbounded resource use if this app
// ever fires many genuinely-heavy runs at once.
//
// What it does NOT fix, measured rather than assumed: several concurrent
// sessions of the SAME pipeline (tab-artefatos.js's appendPausedPreview
// firing one ArtifactPreview call per pending item — several ADRs/
// histórias/diagramas/features at once) crashing mhl's own HTTP handler
// ("decode response: EOF", a "404 Not Found" polling status, the server
// failing before any body — see appendPausedPreview's own comment). Tried
// this flag as the fix first; an isolated repro (N concurrent
// ArtifactPreview sessions against a bare `mhl serve`, no Senpai UI
// involved) still failed 2/8 at 4 and got WORSE — 4/8 — at 1. That rules out
// "too many executing at once" as the cause: this flag only gates
// execution, and the failures happen earlier, in request/session handling
// triggered the instant several requests for the same pipeline arrive
// together, independent of the execution cap. The actual fix for that is
// appendPausedPreview never sending more than one such request at a time —
// this constant stays for the execution-concurrency case it does bound
// correctly, but don't reach for it to fix a same-pipeline concurrency
// crash; that needs to not happen at the call site instead.
//
// This is a global cap on the whole mhl process, not scoped to one
// pipeline — every mhl_run_start (including quick ones like WorkItem
// action:list, previews, or approving a draft) competes for the same slots,
// and a run past the cap waits in mhl's queue (measured: a trivial run sat
// behind a long one until its slot freed up). LLM-backed runs are therefore
// capped separately and lower in the frontend (llm-queue.js's
// MAX_CONCURRENT_LLM_RUNS); this cap keeps enough headroom above that for
// the quick runs the UI blocks on — with it at 4 and every slot held by a
// multi-minute generation, approving an item sat in this queue until the
// approval timed out, which read as a frozen screen.
const maxConcurrentRuns = 8

// sessionTTL is passed as MHL_SERVE_SESSION_TTL — see Start.
const sessionTTL = "720h"

// errSessionExpired: mhl answered 404 to a request carrying our
// Mcp-Session-Id — the session was swept as idle (or the process was
// replaced). callWithSession re-establishes it once.
var errSessionExpired = errors.New("mhl: sessao MCP expirada")

// Client owns the mhl child process and the MCP session opened against it.
type Client struct {
	cmd       *exec.Cmd
	baseURL   string
	sessionID string
	http      *http.Client
	nextID    atomic.Int64
	stderr    *bytes.Buffer
	// exited is closed once the mhl process has exited (exitErr then holds
	// Wait's result); stopping marks an exit this Client asked for, so only
	// an unexpected one gets logged as such.
	exited   chan struct{}
	exitErr  error
	stopping atomic.Bool
	// executing holds every runID this mhl process started or resumed —
	// the only runs that can genuinely be executing in it (RunStatusGet).
	executing sync.Map
	// pidFile, when non-empty, is removed by terminate() on a clean Stop() —
	// see cleanupStaleMHL (orphan.go) for what it's for.
	pidFile string
	// closeJob ends the Windows Job Object holding mhl and everything it
	// spawned (job_windows.go); a no-op elsewhere.
	closeJob func()

	// rpcMu serializes every JSON-RPC round trip on this session — see
	// postRPC's own comment for the measured reason this exists: mhl itself
	// isn't safe against several concurrent requests carrying the same
	// Mcp-Session-Id, and this Client hands out exactly one session for its
	// entire lifetime (every caller — run polling, a preview batch, a usage
	// lookup — shares it), so without this, any two callers racing here is
	// a live crash risk, not a hypothetical one.
	rpcMu sync.Mutex

	// serverName/serverVersion come from the initialize handshake's
	// serverInfo — captured once in initialize() and never re-fetched, since
	// mhl's version can't change mid-process.
	serverName    string
	serverVersion string
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
//
// stateDir, when non-empty, is passed as `--state-dir` so run/session state
// survives an app restart (Docs-Servers §05 "ACROSS A RESTART" — without it,
// run state is per-process and a `mhl_run_status` after a restart just sees
// "unknown runId"). Pass "" to skip it (state is then purely in-memory, fine
// for a spike or a short-lived test run).
//
// dataDir, when non-empty, becomes the mhl child process's working
// directory — every path a workflow builds (`projects/<id>/...`, via `tool
// Paths` — see PLANO-MACRO-MHL-SENPAI.md §3) is relative to *mhl's* CWD, not
// to workflowsDir or to whatever directory happened to launch this app. Left
// unset (inherits this process's own CWD), a double-clicked packaged app can
// land work-item data somewhere unwritable or surprising (e.g. `/` on
// macOS) — pass a stable, writable, per-user directory here so `projects/`
// always lands in the same predictable place regardless of launch method.
// Pass "" only for a spike/test that doesn't care where `projects/` ends up.
//
// codexCwdDir, when non-empty, is exported as SENPAI_CODEX_CWD — the Codex
// backend agent (workflows/shared/agents/agents.mh, tool CodexCwd) passes it to
// `codex exec --cd`, its OWN working root, independent of dataDir/cmd.Dir
// above. Without this, Codex would inherit mhl's CWD (dataDir) as its
// workspace and — sandboxed to read-only, but still able to read — could
// see every work-item's `projects/<id>/...`, not just the one a given call
// is about, breaking C1/C2 in practice even though nothing was asked to
// cross that boundary (confirmed by spike; see FASE5-ACHADOS.md). Pass a
// directory with nothing in it (this package doesn't write anything there
// itself — the caller owns creating an empty one). Pass "" to fall back to
// "." (Codex sees dataDir/cmd.Dir like before this existed — fine for a
// spike/test, not for the packaged app).
// agent, when non-empty, is exported as SENPAI_AGENT — the LLM backend
// workflows/shared/agents/agents.mh's AgentSelector picks (env("SENPAI_AGENT",
// "codex")), overriding its own "codex" default. Pass "" to leave that
// default alone. Read fresh by every AgentSelector.pick() call but only
// ever set here, at spawn time — changing it takes a fresh mhl process
// (App.SetAgent's job: save the new value, then call ReconnectMCP).
// devinModel, when non-empty, is exported as SENPAI_DEVIN_MODEL and becomes
// the value passed to `devin --model` by workflows/shared/agents/agents.mh.
// devinPricingJSON is a validated snapshot of that model's token rates from
// `devin models list`; the workflow uses it only when the execution itself
// does not report total_cost_usd.
// codexModel/claudeModel, when non-empty, are exported as SENPAI_CODEX_MODEL/
// SENPAI_CLAUDE_MODEL and become the values passed to `codex exec --model`/
// `claude --model` — same "empty leaves agents.mh's own default alone, only
// takes effect on the next spawned process" rule as agent/devinModel above.
func Start(ctx context.Context, mhlPath, workflowsDir, stateDir, dataDir, codexCwdDir, agent, devinModel, devinPricingJSON, codexModel, claudeModel string) (*Client, error) {
	// A previous mhl child can still be running here, left behind when an
	// earlier run of the app ended abruptly (a killed debug session, a
	// force-quit, a crash) and never got to call Stop(). setProcessGroup
	// below puts mhl in its own process group so a signal aimed at the app
	// doesn't also hit it — which is exactly what leaves it orphaned.
	// cleanupStaleMHL reaps those, but only those: never the mhl of another
	// Senpai instance still open (e.g. the old version while a new one
	// starts), nor a process that merely reused a recorded pid — see
	// orphan.go.
	var pidFile string
	if stateDir != "" {
		cleanupStaleMHL(stateDir, mhlPath)
		pidFile = instancePidFile(stateDir)
	}

	addr, err := freeLoopbackAddr()
	if err != nil {
		return nil, fmt.Errorf("mhlbridge: pick free port: %w", err)
	}

	args := []string{"serve", "mcp", "--http", "--addr", addr, "--max-concurrent-runs", strconv.Itoa(maxConcurrentRuns)}
	if stateDir != "" {
		args = append(args, "--state-dir", stateDir)
	}
	args = append(args, workflowsDir)
	cmd := exec.CommandContext(ctx, mhlPath, args...)
	cmd.Dir = dataDir
	env := append(os.Environ(),
		// SENPAI_WORKFLOWS_ROOT: lets workflow-side code (tool WorkflowsRoot,
		// workflows/shared/core/workflows_root.mh) build an absolute path for
		// anything a CHILD process of mhl (Codex, via --output-schema) needs
		// to resolve itself — that child inherits mhl's CWD (cmd.Dir, above,
		// now a writable per-user data dir, not workflowsDir), so a bare
		// relative "workflows/..." string stops resolving the moment cmd.Dir
		// isn't the repo root anymore. See FASE5-ACHADOS.md.
		"SENPAI_WORKFLOWS_ROOT="+workflowsDir,
	)
	if codexCwdDir != "" {
		env = append(env, "SENPAI_CODEX_CWD="+codexCwdDir)
	}
	// MCP sessions expire after a period of inactivity inside mhl
	// (MHL_SERVE_SESSION_TTL; measured: an idle session answers 404 with an
	// empty body once swept). Every run this app starts is scoped to its
	// session — a new session can't even see an old run's status ("unknown
	// runId") —, so an expired session silently orphans paused drafts
	// waiting for review. Sessions here live as long as the mhl process
	// (which dies with the app), so the TTL is set far beyond any real idle
	// time; an explicit value in the environment still wins.
	if os.Getenv("MHL_SERVE_SESSION_TTL") == "" {
		env = append(env, "MHL_SERVE_SESSION_TTL="+sessionTTL)
	}
	if agent != "" {
		env = append(env, "SENPAI_AGENT="+agent)
	}
	if devinModel != "" {
		env = append(env, "SENPAI_DEVIN_MODEL="+devinModel)
	}
	if devinPricingJSON != "" {
		env = append(env, "SENPAI_DEVIN_PRICING="+devinPricingJSON)
	}
	if codexModel != "" {
		env = append(env, "SENPAI_CODEX_MODEL="+codexModel)
	}
	if claudeModel != "" {
		env = append(env, "SENPAI_CLAUDE_MODEL="+claudeModel)
	}
	cmd.Env = enrichedEnv(ctx, env)
	logAgentBinaries(cmd.Env)
	// stderr is kept in memory for Start's own "did not become ready" error
	// AND mirrored line by line into the app log for the whole session —
	// previously it only ever surfaced if startup failed, so when mhl hit an
	// error or died mid-session (a real incident during an ingest) nothing
	// recorded why.
	var stderr bytes.Buffer
	cmd.Stderr = io.MultiWriter(&stderr, &logLineWriter{prefix: "mhl stderr: "})
	cmd.Stdout = io.Discard
	// New process group so the child (and anything it spawns) is not left
	// behind if this process is killed abruptly rather than shut down
	// cleanly via Stop().
	setProcessGroup(cmd)

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("mhlbridge: start mhl: %w", err)
	}
	// Windows: mhl (and every agent it spawns from now on) goes into a Job
	// Object killed when this app's handle to it closes — on Stop(), but
	// also when the app crashes or is force-closed, which the pid file below
	// can only clean up on the next launch.
	closeJob := attachKillOnCloseJob(cmd)
	if pidFile != "" {
		// Best-effort: a failed write here just means the *next* Start()
		// won't find anything to reap for *this* run if it also dies
		// abruptly — not fatal to this run itself.
		writePidRecord(pidFile, pidRecord{MhlPID: cmd.Process.Pid, OwnerPID: os.Getpid(), Exe: mhlPath})
	}

	c := &Client{
		cmd:     cmd,
		baseURL: "http://" + addr,
		// DisableKeepAlives: re-dialing per request costs a fraction of a
		// millisecond on loopback, and removes stale pooled connections
		// from the picture. It did NOT fix the "decode response: EOF" after
		// a long idle period, originally blamed on them: measured against
		// an isolated `mhl serve`, the real cause is mhl sweeping the idle
		// MCP session (404 with an empty body) — see sessionTTL and
		// callWithSession.
		http:     &http.Client{Timeout: 30 * time.Second, Transport: &http.Transport{DisableKeepAlives: true}},
		pidFile:  pidFile,
		closeJob: closeJob,
		stderr:   &stderr,
		exited:   make(chan struct{}),
	}
	// The one Wait() on this process: records how it exited and logs it when
	// nobody asked it to stop — an mhl crash mid-session used to be silent,
	// noticed only as every later call failing.
	go func() {
		c.exitErr = cmd.Wait()
		close(c.exited)
		if !c.stopping.Load() {
			log.Printf("mhl bridge: mhl exited unexpectedly (pid %d): %v", cmd.Process.Pid, c.exitErr)
		}
	}()

	// Ver readyTimeout: o mhl só responde depois de validar todos os
	// workflows, e um mhl vivo que ainda está carregando não é derrubado cedo.
	if err := c.waitReady(ctx, readyTimeout); err != nil {
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

// readyTimeout: o mhl só passa a responder (e só escreve algo no stderr)
// depois de validar todos os workflows — ~5s num Mac, e várias vezes isso
// numa máquina Windows mais lenta ou com o antivírus examinando o mhl.exe
// recém-extraído e cada arquivo que ele lê. Com 30s, um mhl vivo e ainda
// carregando era morto no Windows ("timed out after 30s (stderr: )") e o
// "Tentar novamente" repetia a mesma espera curta. Um mhl que morre é
// detectado na hora (c.exited), então o prazo longo só pesa num mhl
// travado de verdade. Mantenha api.js READY_TIMEOUT_MS acima deste valor.
const readyTimeout = 120 * time.Second

// readySlowLogAfter: a partir daqui cada espera vai para o app.log, para que
// uma inicialização lenta deixe o tempo real registrado.
const readySlowLogAfter = 10 * time.Second

func (c *Client) waitReady(ctx context.Context, timeout time.Duration) error {
	began := time.Now()
	deadline := began.Add(timeout)
	// Short per-probe timeout: c.http's 30s would let a single probe to a
	// listener that accepts but doesn't answer yet eat most of the wait.
	probe := &http.Client{Timeout: 2 * time.Second, Transport: &http.Transport{DisableKeepAlives: true}}
	nextLog := began.Add(readySlowLogAfter)
	for time.Now().Before(deadline) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/healthz", nil)
		if err == nil {
			if resp, err := probe.Do(req); err == nil {
				resp.Body.Close()
				if resp.StatusCode == http.StatusOK {
					if waited := time.Since(began); waited >= readySlowLogAfter {
						log.Printf("mhl bridge: mhl respondeu depois de %s (inicialização lenta)", waited.Round(time.Second))
					}
					return nil
				}
			}
		}
		select {
		case <-c.exited:
			return fmt.Errorf("mhl exited early: %v", c.exitErr)
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		if time.Now().After(nextLog) {
			log.Printf("mhl bridge: aguardando o mhl ficar pronto há %s (pid %d)", time.Since(began).Round(time.Second), c.cmd.Process.Pid)
			nextLog = nextLog.Add(readySlowLogAfter)
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
	result, header, err := c.postRPC(ctx, "initialize", params, false)
	if err != nil {
		return err
	}
	sid := header.Get("Mcp-Session-Id")
	if sid == "" {
		return fmt.Errorf("server did not return Mcp-Session-Id")
	}
	c.sessionID = sid

	// Best-effort: a missing/malformed serverInfo shouldn't fail the whole
	// handshake, it just leaves the name/version blank for Info() to report.
	var initResult struct {
		ServerInfo struct {
			Name    string `json:"name"`
			Version string `json:"version"`
		} `json:"serverInfo"`
	}
	if err := json.Unmarshal(result, &initResult); err == nil {
		c.serverName = initResult.ServerInfo.Name
		c.serverVersion = initResult.ServerInfo.Version
	}
	return nil
}

// Info reports the mhl server's identity (from the initialize handshake) and
// whether it's answering /healthz right now — a live probe, not just "did
// Start() succeed at some point in the past". This matters because the mhl
// child process can die mid-session (see WatchRun's doc comment in app.go
// for a real crash this project already hit) without this Client itself
// ever hearing about it — there's no persistent connection to notice a
// dropped process, only individual RPCs that would start failing one by
// one. Cheap on purpose (a loopback GET, ~ms), safe to call on every render
// of a status indicator.
func (c *Client) Info(ctx context.Context) (name, version string, healthy bool) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/healthz", nil)
	if err == nil {
		if resp, err := c.http.Do(req); err == nil {
			resp.Body.Close()
			healthy = resp.StatusCode == http.StatusOK
		}
	}
	return c.serverName, c.serverVersion, healthy
}

// ToolsList calls the standard MCP tools/list method.
// callWithSession is postRPC for session-scoped methods, re-establishing an
// expired session once (errSessionExpired) and retrying. With sessionTTL
// this should only ever happen if something outside this app swept the
// session; runs from the old session stay unreachable either way (mhl
// scopes runs to their session), so the re-initialization is logged.
func (c *Client) callWithSession(ctx context.Context, method string, params any) (json.RawMessage, error) {
	result, _, err := c.postRPC(ctx, method, params, true)
	if !errors.Is(err, errSessionExpired) {
		return result, err
	}
	log.Printf("mhl bridge: sessao MCP expirada — abrindo uma nova (execucoes da sessao anterior ficam inacessiveis)")
	if initErr := c.initialize(ctx); initErr != nil {
		return nil, fmt.Errorf("reabrir sessao MCP expirada: %w", initErr)
	}
	result, _, err = c.postRPC(ctx, method, params, true)
	return result, err
}

func (c *Client) ToolsList(ctx context.Context) (json.RawMessage, error) {
	result, err := c.callWithSession(ctx, "tools/list", nil)
	return result, err
}

// ToolsCall invokes a named tool (a workflow, or one of the mhl_run_* tools)
// synchronously, mirroring a plain `tools/call`. Returns the raw
// `{content, isError, structuredContent}` envelope — use structuredContentOf
// (or one of the RunStart/RunStatusGet/... helpers below) to pull out just
// the typed result.
func (c *Client) ToolsCall(ctx context.Context, name string, arguments map[string]any) (json.RawMessage, error) {
	params := map[string]any{
		"name":      name,
		"arguments": arguments,
	}
	result, err := c.callWithSession(ctx, "tools/call", params)
	return result, err
}

// ResourceRead fetches one `mhl://...` resource (Docs-Servers §"resources") —
// e.g. `mhl://workflow/<name>` for the full manifest (steps, inputs,
// checkpoint, declared agents/tools/...) behind the compact `inputSchema`
// tools/list already carries per-tool. Returns the resource's raw text
// content (its mimeType is almost always application/json for our use, but
// this doesn't assume that — callers decide how to parse it).
func (c *Client) ResourceRead(ctx context.Context, uri string) (string, error) {
	result, err := c.callWithSession(ctx, "resources/read", map[string]any{"uri": uri})
	if err != nil {
		return "", err
	}
	var parsed struct {
		Contents []struct {
			URI      string `json:"uri"`
			MimeType string `json:"mimeType"`
			Text     string `json:"text"`
		} `json:"contents"`
	}
	if err := json.Unmarshal(result, &parsed); err != nil {
		return "", fmt.Errorf("mhlbridge: decode resources/read response: %w", err)
	}
	if len(parsed.Contents) == 0 {
		return "", fmt.Errorf("mhlbridge: resources/read %q returned no contents", uri)
	}
	return parsed.Contents[0].Text, nil
}

// RunStatus is the shape every mhl_run_* tool returns as `structuredContent`
// (confirmed by spike against a real `mhl serve mcp --http` — see
// FASE5-ACHADOS.md), a superset covering mhl_run_start's leaner reply
// ({runId, startedAt, state, tool}) and mhl_run_status's fuller one (adds
// step/stepIndex/stepTotal/reached/vars/error/resumable once the run has
// progressed).
type RunStatus struct {
	RunID     string          `json:"runId"`
	State     string          `json:"state"`
	Tool      string          `json:"tool,omitempty"`
	StartedAt string          `json:"startedAt,omitempty"`
	Step      string          `json:"step,omitempty"`
	StepIndex int             `json:"stepIndex,omitempty"`
	StepTotal int             `json:"stepTotal,omitempty"`
	Reached   []string        `json:"reached,omitempty"`
	Vars      json.RawMessage `json:"vars,omitempty"`
	Error     string          `json:"error,omitempty"`
	Resumable bool            `json:"resumable,omitempty"`

	// Reason is the message passed to pause() (Docs-Servers §06) — e.g.
	// "revise o conteudo de 'brief' antes de gravar em artifacts/". Was
	// missing from this struct entirely until now: json.Unmarshal into a
	// typed struct silently drops any field the struct doesn't declare, so
	// every "paused" status this Client ever decoded had mhl's own reason
	// text thrown away before the frontend could ever see it — confirmed by
	// a live spike against `mhl serve mcp --http` (mhl_run_status really
	// does return "reason" alongside "state":"paused").
	Reason string `json:"reason,omitempty"`
}

// Terminal reports whether this state is one PollRunStatus stops on: the run
// finished (completed/failed/canceled) or parked waiting on a human
// (paused, Modo Buddy) — as opposed to still progressing (working/queued).
func (s *RunStatus) Terminal() bool {
	return s.State != "working" && s.State != "queued"
}

// RunStart calls mhl_run_start — same workflow a synchronous ToolsCall would
// run, but returns a runId right away instead of blocking (Docs-Servers §05).
func (c *Client) RunStart(ctx context.Context, workflow string, arguments map[string]any) (*RunStatus, error) {
	status, err := c.runCall(ctx, "mhl_run_start", map[string]any{
		"workflow":  workflow,
		"arguments": arguments,
	})
	if err == nil {
		c.executing.Store(status.RunID, struct{}{})
	}
	return status, err
}

// OrphanedRunError is what an orphaned run reports instead of "working" —
// see RunStatusGet.
const OrphanedRunError = "execução interrompida: o servidor mhl foi reiniciado (ou caiu) enquanto ela rodava — gere novamente"

// RunStatusGet calls mhl_run_status for a poll snapshot: current step,
// steps reached so far, and — once terminal — the final vars.
//
// A run that the mhl process behind THIS client never started or resumed,
// yet reports as working/queued, is an orphan: it was executing in an mhl
// process that has since died (a crash, "Reconectar", an app restart), and
// --state-dir keeps its last "working" snapshot forever — measured: kill
// mhl mid-run, restart it on the same state dir, and that run answers
// "working" indefinitely. The UI reattached to such runs and showed
// "Processando…" forever, while also refusing to start the item again.
// Reported as failed instead (and canceled in mhl, best-effort, so it stops
// counting as active). Paused runs are unaffected: they're a real,
// resumable checkpoint, not an execution in progress.
func (c *Client) RunStatusGet(ctx context.Context, runID string) (*RunStatus, error) {
	status, err := c.runCall(ctx, "mhl_run_status", map[string]any{"runId": runID})
	if err != nil || status.Terminal() {
		return status, err
	}
	if _, ours := c.executing.Load(runID); ours {
		return status, nil
	}
	_, _ = c.RunCancel(ctx, runID)
	status.State = "failed"
	status.Error = OrphanedRunError
	return status, nil
}

// RunResume calls mhl_run_resume, re-entering the step a pause() parked in —
// `arguments` is merged over the run's original arguments (Docs-Servers §06);
// this is where a Modo Buddy approval decision (e.g. {"approved": "yes"})
// goes.
func (c *Client) RunResume(ctx context.Context, runID string, arguments map[string]any) (*RunStatus, error) {
	params := map[string]any{"runId": runID}
	if arguments != nil {
		params["arguments"] = arguments
	}
	status, err := c.runCall(ctx, "mhl_run_resume", params)
	if err == nil {
		c.executing.Store(runID, struct{}{})
	}
	return status, err
}

// RunCancel calls mhl_run_cancel, stopping a run in place.
func (c *Client) RunCancel(ctx context.Context, runID string) (*RunStatus, error) {
	return c.runCall(ctx, "mhl_run_cancel", map[string]any{"runId": runID})
}

// RunList calls mhl_run_list — the calling session's own runs (ownership is
// per Mcp-Session-Id, Docs-Servers §05 "OWNERSHIP"; this Client holds one
// session for its whole lifetime, so every run it starts is visible here).
// Shape isn't pinned to a Go type here (list of RunStatus-like entries,
// exact field set not yet needed by any caller) — returned as raw JSON.
func (c *Client) RunList(ctx context.Context) (json.RawMessage, error) {
	result, err := c.ToolsCall(ctx, "mhl_run_list", map[string]any{})
	if err != nil {
		return nil, err
	}
	return structuredContentOf(result)
}

// ActiveRuns calls RunList and decodes it (confirmed shape, live spike
// against `mhl serve mcp --http`: {"runs": [...]}, each entry the same
// fields RunStatus already models) down to just the runs that are actually
// executing right now — !Terminal(), i.e. state "working" or "queued". A
// "paused" run (Modo Buddy, or the ordinary pause-for-review between
// Discovery/Delivery artifacts) is deliberately excluded: nothing is
// running for it, so it's safe to kill and respawn the mhl process under
// it. This is what SetAgent calls to refuse switching backends out from
// under a run whose in-flight LLM call would otherwise just be killed —
// see SetAgent's own comment.
func (c *Client) ActiveRuns(ctx context.Context) ([]RunStatus, error) {
	raw, err := c.RunList(ctx)
	if err != nil {
		return nil, err
	}
	var parsed struct {
		Runs []RunStatus `json:"runs"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("mhlbridge: decode mhl_run_list: %w", err)
	}
	var active []RunStatus
	for _, run := range parsed.Runs {
		if !run.Terminal() {
			active = append(active, run)
		}
	}
	return active, nil
}

// RunLogs calls mhl_run_logs, returning the run's retained step/log() output
// since the given cursor (`since` — pass "" for the start; feed back the
// response's own `nextSince` to continue). Shape ({text, nextSince,
// dropped?}) returned as raw JSON — no caller needs it typed yet.
//
// `since` crosses the App/JS boundary as a string (Wails-bound methods only
// take/return strings and JSON blobs cleanly), but mhl_run_logs's own
// `since` parameter unmarshals into an int64 on the mhl side — sending it
// through as a JSON string here fails with "invalid params: json: cannot
// unmarshal string into Go struct field .since of type int64". Parsed back
// into a number before it goes in the args map, so what mhl receives always
// matches what it returned as `nextSince` in the first place.
func (c *Client) RunLogs(ctx context.Context, runID, since string) (json.RawMessage, error) {
	args := map[string]any{"runId": runID}
	if since != "" {
		n, err := strconv.ParseInt(since, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("mhlbridge: RunLogs: invalid since cursor %q: %w", since, err)
		}
		args["since"] = n
	}
	result, err := c.ToolsCall(ctx, "mhl_run_logs", args)
	if err != nil {
		return nil, err
	}
	return structuredContentOf(result)
}

// runCall is the shared plumbing behind every RunXxx method: call the named
// mhl_run_* tool, unwrap structuredContent, decode into RunStatus.
func (c *Client) runCall(ctx context.Context, tool string, arguments map[string]any) (*RunStatus, error) {
	result, err := c.ToolsCall(ctx, tool, arguments)
	if err != nil {
		return nil, err
	}
	structured, err := structuredContentOf(result)
	if err != nil {
		return nil, err
	}
	var status RunStatus
	if err := json.Unmarshal(structured, &status); err != nil {
		return nil, fmt.Errorf("mhlbridge: %s: decode structuredContent: %w", tool, err)
	}
	return &status, nil
}

// structuredContentOf pulls `result.structuredContent` out of a tools/call
// envelope — the typed payload every mhl-native tool (mhl_run_*, and any
// workflow with an `output:` block) carries alongside the human-readable
// `content` array (confirmed by spike; see FASE5-ACHADOS.md).
func structuredContentOf(result json.RawMessage) (json.RawMessage, error) {
	var envelope struct {
		IsError           bool            `json:"isError"`
		StructuredContent json.RawMessage `json:"structuredContent"`
	}
	if err := json.Unmarshal(result, &envelope); err != nil {
		return nil, fmt.Errorf("mhlbridge: decode tools/call envelope: %w", err)
	}
	if envelope.IsError {
		return nil, fmt.Errorf("mhlbridge: tool call reported an error: %s", string(result))
	}
	if len(envelope.StructuredContent) == 0 {
		return nil, fmt.Errorf("mhlbridge: tool call returned no structuredContent: %s", string(result))
	}
	return envelope.StructuredContent, nil
}

// PollRunStatus polls mhl_run_status every interval, calling onUpdate (when
// non-nil) with each snapshot — including the first, taken immediately, no
// initial sleep — until the run reaches a Terminal() state or ctx is
// canceled. This is the Go-side polling loop §6.2/Fase 5 of the plan calls
// for ("roda do lado Go... empurrado ao frontend via runtime.EventsEmit, em
// vez do frontend fazer polling duplicado") — deliberately Wails-agnostic
// (no runtime.EventsEmit call in this package, no Wails import at all): the
// caller's onUpdate decides where a snapshot goes, so this stays testable
// headlessly (a real Wails ctx is a hard runtime.Fatal outside a running
// app — see FASE5-ACHADOS.md) and reusable from a plain CLI/test harness.
func (c *Client) PollRunStatus(ctx context.Context, runID string, interval time.Duration, onUpdate func(*RunStatus)) (*RunStatus, error) {
	for {
		status, err := c.RunStatusGet(ctx, runID)
		if err != nil {
			return nil, err
		}
		if onUpdate != nil {
			onUpdate(status)
		}
		if status.Terminal() {
			return status, nil
		}
		select {
		case <-ctx.Done():
			return status, ctx.Err()
		case <-time.After(interval):
		}
	}
}

// postRPC serializes on rpcMu for the whole round trip (request out through
// response fully read), not just the send — measured, not theoretical: mhl
// itself isn't safe against several requests in flight at once under the
// SAME Mcp-Session-Id. An isolated repro (N concurrent ArtifactPreview
// calls against a bare `mhl serve`, no Senpai UI involved) failed 9/40
// times sharing one session — "decode response: EOF", a "404 Not Found"
// polling status — and 0/40 times giving each concurrent call its OWN
// session instead; going per-call-session isn't practical here (this
// Client hands out exactly one session for its whole lifetime, reused by
// every caller — run polling, a preview batch, a usage lookup), so this
// Client-side mutex is what actually gets every caller the same guarantee:
// never two requests in flight on this session at once. Held for the full
// call, not just enqueueing it, because the crash is in mhl handling two
// requests concurrently, not in this process sending them close together.
func (c *Client) postRPC(ctx context.Context, method string, params any, withSession bool) (json.RawMessage, http.Header, error) {
	c.rpcMu.Lock()
	defer c.rpcMu.Unlock()

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

	// Status before body: an expired session is a 404 with an EMPTY body,
	// which used to surface as the opaque "decode response: EOF".
	if resp.StatusCode == http.StatusNotFound && withSession {
		return nil, resp.Header, errSessionExpired
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, resp.Header, fmt.Errorf("mhl respondeu HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(snippet)))
	}

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
	// A clean stop means cleanupStaleMHL has nothing to do next run —
	// remove the record now rather than leaving it for the next Start() to
	// find (and redundantly, harmlessly, try to kill an already-gone pid).
	if c.pidFile != "" {
		_ = os.Remove(c.pidFile)
	}
	// Whatever path mhl itself goes down below, the agents it spawned
	// (devin/claude/codex) go with the job on Windows — Kill() alone only
	// ever ended mhl.exe and left them running.
	if c.closeJob != nil {
		defer c.closeJob()
	}
	if c.cmd.Process == nil {
		return nil
	}
	// os.Interrupt asks mhl to shut down cleanly; Windows doesn't support
	// signaling an arbitrary process this way (Signal returns an error
	// there), so this falls straight through to Kill() on that platform —
	// correct, just not graceful. Fine for a local dev tool (C6).
	c.stopping.Store(true)
	if err := c.cmd.Process.Signal(os.Interrupt); err != nil {
		return c.cmd.Process.Kill()
	}
	select {
	case <-c.exited:
		return nil
	case <-time.After(3 * time.Second):
		return c.cmd.Process.Kill()
	}
}

// logLineWriter forwards whatever mhl writes to stderr into the standard
// logger, one log line per output line (partial lines are held until their
// newline arrives).
type logLineWriter struct {
	prefix string
	mu     sync.Mutex
	buf    []byte
}

func (w *logLineWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.buf = append(w.buf, p...)
	for {
		i := bytes.IndexByte(w.buf, '\n')
		if i < 0 {
			break
		}
		line := strings.TrimRight(string(w.buf[:i]), "\r")
		w.buf = w.buf[i+1:]
		if strings.TrimSpace(line) != "" {
			log.Print(w.prefix + line)
		}
	}
	return len(p), nil
}
