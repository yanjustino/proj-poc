package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"senpai-app/mhlbridge"
)

// runPollInterval is how often WatchRun polls mhl_run_status while a run is
// still working/queued. 500ms keeps the UI feeling live without hammering a
// loopback process that's doing real work (an LLM call can take 10s-60s+).
const runPollInterval = 500 * time.Millisecond

// App struct
type App struct {
	ctx context.Context
	mhl *mhlbridge.Client

	// dataDir is mhl's own working directory (see mhlbridge.Start) — every
	// `projects/<id>/...` path a workflow builds is relative to it. Exported
	// via DataDir() so a caller that needs to place a raw file for Wiki
	// ingest (the UI's upload flow in Fase 6; app_test.go today) knows where
	// `projects/` actually is instead of guessing.
	dataDir string

	// emit sends one event to the frontend. Defaults to a real
	// runtime.EventsEmit(a.ctx, ...) call in startup(), but stays a field
	// (not a direct call) so a test can swap in a recorder — calling
	// runtime.EventsEmit with a context that isn't the real one Wails hands
	// startup() is a hard log.Fatalf inside Wails itself, not a safe no-op
	// (confirmed by reading wails/v2/pkg/runtime, getEvents; see
	// FASE5-ACHADOS.md), so app_test.go cannot exercise the real emitter at
	// all — this indirection is what makes WatchRun testable headlessly.
	emit func(eventName string, data any)
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.emit = func(eventName string, data any) {
		runtime.EventsEmit(a.ctx, eventName, data)
	}

	// Spike-only path resolution: reach into the sibling workflows/ directory
	// checked out next to app/. Fase 7 replaces this with a vendored/embedded
	// copy resolved relative to the packaged executable (C6) — this is only
	// meant to prove the spawn+MCP-over-HTTP mechanism from Go, not the final
	// packaging story.
	workflowsDir, err := filepath.Abs("../workflows")
	if err != nil {
		log.Printf("mhl bridge: resolve workflows dir: %v", err)
		return
	}

	stateDir, err := senpaiSubdir("state")
	if err != nil {
		// Not fatal — mhl just keeps run/session state in-memory for this
		// process's lifetime instead of surviving a restart (Docs-Servers
		// §05 "ACROSS A RESTART"). Worth logging, not worth failing startup
		// over.
		log.Printf("mhl bridge: resolve state dir (state will be in-memory only): %v", err)
	}

	// mhl's own CWD, not this app's — every workflow path (`projects/<id>/
	// ...`) is relative to it (see mhlbridge.Start's doc comment). Falls back
	// to inheriting this process's CWD (dataDir == "") if it can't be
	// resolved, same as before this existed.
	dataDir, err := senpaiSubdir("data")
	if err != nil {
		log.Printf("mhl bridge: resolve data dir (work-items may land in an unexpected place): %v", err)
	}

	// Empty on purpose — Codex's own --cd (see agents.mh, tool CodexCwd)
	// must never contain any work-item data, so it stays a sibling of
	// dataDir, never dataDir itself or anything under it.
	codexCwdDir, err := senpaiSubdir("codex-cwd")
	if err != nil {
		log.Printf("mhl bridge: resolve codex cwd (Codex may see more of the filesystem than intended): %v", err)
	}

	client, err := mhlbridge.Start(ctx, "mhl", workflowsDir, stateDir, dataDir, codexCwdDir)
	if err != nil {
		log.Printf("mhl bridge: failed to start: %v", err)
		return
	}
	a.mhl = client
	a.dataDir = dataDir
	log.Printf(
		"mhl bridge: ready, serving %s (state-dir: %s, data-dir: %s, codex-cwd: %s)",
		workflowsDir, stateDir, dataDir, codexCwdDir,
	)
}

// DataDir returns mhl's own working directory — where `projects/<id>/...`
// actually lives on disk for every work-item this app manages (empty if it
// could not be resolved at startup, in which case mhl inherited this
// process's own CWD instead; see mhlbridge.Start).
func (a *App) DataDir() string {
	return a.dataDir
}

// senpaiSubdir resolves <user config dir>/senpai/<name>, creating it if
// needed. os.UserConfigDir() is already cross-platform (C6): %AppData% on
// Windows, ~/Library/Application Support on macOS, $XDG_CONFIG_HOME or
// ~/.config on Linux — matches the plan's "<appdata>/state" (and, by the
// same logic, where work-item data itself should live) without any per-OS
// branching of our own.
func senpaiSubdir(name string) (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "senpai", name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

// shutdown is called when the app is closing. Ends the MCP session and
// terminates the mhl child process — it must not outlive this app.
func (a *App) shutdown(ctx context.Context) {
	if err := a.mhl.Stop(); err != nil {
		log.Printf("mhl bridge: shutdown: %v", err)
	}
}

func (a *App) requireBridge() error {
	if a.mhl == nil {
		return fmt.Errorf("mhl bridge is not running (see the app log for why startup failed)")
	}
	return nil
}

// ListWorkflows returns the raw tools/list result — every published tool,
// the 4 workflows (WorkItem/Wiki/Discovery/Delivery) and the mhl_run_*
// control tools alike, each already carrying its `inputSchema` (compact form
// — enough to render a basic form; GetWorkflowManifest below gives the
// fuller picture). Frontend decides what to filter/display (Fase 6).
func (a *App) ListWorkflows() (string, error) {
	if err := a.requireBridge(); err != nil {
		return "", err
	}
	result, err := a.mhl.ToolsList(a.ctx)
	if err != nil {
		return "", err
	}
	return string(result), nil
}

// GetWorkflowManifest reads mhl://workflow/<name> — the full manifest behind
// a tools/list entry's compact inputSchema (ordered steps, checkpoint,
// declared agents/tools/memory/prompts). Returned as raw JSON text.
func (a *App) GetWorkflowManifest(name string) (string, error) {
	if err := a.requireBridge(); err != nil {
		return "", err
	}
	return a.mhl.ResourceRead(a.ctx, "mhl://workflow/"+name)
}

// StartRun starts a workflow asynchronously (mhl_run_start) and returns
// right away with {runId, state:"working", ...} — call WatchRun with the
// returned runId to receive progress pushes instead of polling from the
// frontend. argumentsJSON is the workflow's own `input`s as a JSON object
// string (e.g. `{"action":"create","name":"...","item_type":"feature"}`).
func (a *App) StartRun(workflow string, argumentsJSON string) (string, error) {
	if err := a.requireBridge(); err != nil {
		return "", err
	}
	arguments, err := decodeArguments(argumentsJSON)
	if err != nil {
		return "", err
	}
	status, err := a.mhl.RunStart(a.ctx, workflow, arguments)
	if err != nil {
		return "", err
	}
	return encodeStatus(status)
}

// GetRunStatus takes one mhl_run_status snapshot — current step, steps
// reached so far, and (once terminal) the final vars. Prefer WatchRun for a
// run you just started; this is for a one-off check (e.g. reattaching to a
// runId from a previous app session, now that --state-dir makes that
// possible).
func (a *App) GetRunStatus(runID string) (string, error) {
	if err := a.requireBridge(); err != nil {
		return "", err
	}
	status, err := a.mhl.RunStatusGet(a.ctx, runID)
	if err != nil {
		return "", err
	}
	return encodeStatus(status)
}

// ResumeRun re-enters a paused run (Modo Buddy) — argumentsJSON is merged
// over the run's original arguments, e.g. `{"approved":"yes"}`. Pass "{}"
// for no additional arguments. Re-arms WatchRun-style polling itself (via
// the caller calling WatchRun again with the same runId) — resuming doesn't
// automatically restart a background watch, since the run may have been
// watched by a UI that's no longer even open.
func (a *App) ResumeRun(runID string, argumentsJSON string) (string, error) {
	if err := a.requireBridge(); err != nil {
		return "", err
	}
	arguments, err := decodeArguments(argumentsJSON)
	if err != nil {
		return "", err
	}
	status, err := a.mhl.RunResume(a.ctx, runID, arguments)
	if err != nil {
		return "", err
	}
	return encodeStatus(status)
}

// CancelRun stops a run in place (mhl_run_cancel).
func (a *App) CancelRun(runID string) (string, error) {
	if err := a.requireBridge(); err != nil {
		return "", err
	}
	status, err := a.mhl.RunCancel(a.ctx, runID)
	if err != nil {
		return "", err
	}
	return encodeStatus(status)
}

// ListRuns returns the calling session's own runs (mhl_run_list) — every
// run this app instance has started, ownership-scoped by the one MCP
// session mhlbridge.Client keeps for its whole lifetime.
func (a *App) ListRuns() (string, error) {
	if err := a.requireBridge(); err != nil {
		return "", err
	}
	result, err := a.mhl.RunList(a.ctx)
	if err != nil {
		return "", err
	}
	return string(result), nil
}

// GetRunLogs returns retained step/log() output for a run since the given
// cursor (pass "" for the start; feed back the response's own `nextSince`
// to continue reading from where you left off).
func (a *App) GetRunLogs(runID string, since string) (string, error) {
	if err := a.requireBridge(); err != nil {
		return "", err
	}
	result, err := a.mhl.RunLogs(a.ctx, runID, since)
	if err != nil {
		return "", err
	}
	return string(result), nil
}

// WatchRun polls mhl_run_status on the Go side (not the frontend — §6.2 of
// the plan) and pushes every snapshot to the frontend as a
// "run:<runId>" event, until the run reaches a terminal state (completed/
// failed/canceled) or parks waiting on a human (paused, Modo Buddy) — either
// way, the last event pushed is the one the frontend should render as final
// for now. Fire-and-forget: returns once the *first* snapshot is in hand
// (surfacing an immediately-wrong runId as an error instead of only ever
// showing up as a silent watch that emits nothing), then continues polling
// in the background.
func (a *App) WatchRun(runID string) error {
	if err := a.requireBridge(); err != nil {
		return err
	}
	first, err := a.mhl.RunStatusGet(a.ctx, runID)
	if err != nil {
		return err
	}
	a.publishRunStatus(runID, first)
	if first.Terminal() {
		return nil
	}

	go func() {
		_, err := a.mhl.PollRunStatus(a.ctx, runID, runPollInterval, func(status *mhlbridge.RunStatus) {
			a.publishRunStatus(runID, status)
		})
		if err != nil {
			log.Printf("mhl bridge: WatchRun(%s): poll ended: %v", runID, err)
		}
	}()
	return nil
}

func (a *App) publishRunStatus(runID string, status *mhlbridge.RunStatus) {
	body, err := encodeStatus(status)
	if err != nil {
		log.Printf("mhl bridge: WatchRun(%s): encode status: %v", runID, err)
		return
	}
	a.emit("run:"+runID, body)
}

func decodeArguments(argumentsJSON string) (map[string]any, error) {
	if argumentsJSON == "" {
		return map[string]any{}, nil
	}
	var arguments map[string]any
	if err := json.Unmarshal([]byte(argumentsJSON), &arguments); err != nil {
		return nil, fmt.Errorf("invalid arguments JSON: %w", err)
	}
	return arguments, nil
}

func encodeStatus(status *mhlbridge.RunStatus) (string, error) {
	body, err := json.Marshal(status)
	if err != nil {
		return "", fmt.Errorf("encode run status: %w", err)
	}
	return string(body), nil
}
