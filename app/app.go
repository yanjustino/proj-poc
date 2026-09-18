package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
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

	// mhlPath/workflowsDir/stateDir/codexCwdDir are the paths startup()
	// resolves once and passes to mhlbridge.Start — kept on the struct (not
	// just local vars in startup()) so connectBridge() can spawn a fresh mhl
	// process with the exact same arguments later, from ReconnectMCP(),
	// without re-running discovery (re-extracting the vendored binary,
	// re-resolving XDG-ish dirs) a second time.
	mhlPath      string
	workflowsDir string
	stateDir     string
	codexCwdDir  string

	// agent is the LLM backend Writer.generate uses (workflows/shared/
	// agents/agents.mh's AgentSelector) — "" | "codex" | "claude" | "devin",
	// "" meaning "mhl's own default" (currently codex). Loaded from
	// settings.json at startup, updated by SetAgent, and passed to every
	// connectBridge() call as mhlbridge.Start's agent argument — kept on the
	// struct for the same reason mhlPath/workflowsDir/... are: so
	// ReconnectMCP (and SetAgent, which just changes this then calls it)
	// can respawn mhl with the current value without re-deriving it.
	agent string
	// devinModel is passed to the workflow as SENPAI_DEVIN_MODEL. It is kept
	// independently from agent so a user's choice survives switching away
	// from Devin and back.
	devinModel string

	// emit sends one event to the frontend. Defaults to a real
	// runtime.EventsEmit(a.ctx, ...) call in startup(), but stays a field
	// (not a direct call) so a test can swap in a recorder — calling
	// runtime.EventsEmit with a context that isn't the real one Wails hands
	// startup() is a hard log.Fatalf inside Wails itself, not a safe no-op
	// (confirmed by reading wails/v2/pkg/runtime, getEvents; see
	// FASE5-ACHADOS.md), so app_test.go cannot exercise the real emitter at
	// all — this indirection is what makes WatchRun testable headlessly.
	emit func(eventName string, data any)

	// pollingRuns guards WatchRun against spawning more than one poll
	// goroutine for the same runID — see WatchRun's own comment for the
	// real-world crash this fixes.
	pollingRuns   map[string]bool
	pollingRunsMu sync.Mutex
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{pollingRuns: make(map[string]bool)}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.emit = func(eventName string, data any) {
		runtime.EventsEmit(a.ctx, eventName, data)
	}

	mhlPath, err := ensureVendoredMHL()
	if err != nil {
		log.Printf("mhl bridge: %v", err)
		return
	}
	a.mhlPath = mhlPath

	workflowsDir, err := resolveWorkflowsDir()
	if err != nil {
		log.Printf("mhl bridge: resolve workflows dir: %v", err)
		return
	}
	a.workflowsDir = workflowsDir

	stateDir, err := senpaiSubdir("state")
	if err != nil {
		// Not fatal — mhl just keeps run/session state in-memory for this
		// process's lifetime instead of surviving a restart (Docs-Servers
		// §05 "ACROSS A RESTART"). Worth logging, not worth failing startup
		// over.
		log.Printf("mhl bridge: resolve state dir (state will be in-memory only): %v", err)
	}
	a.stateDir = stateDir

	// mhl's own CWD, not this app's — every workflow path (`projects/<id>/
	// ...`) is relative to it (see mhlbridge.Start's doc comment). Falls back
	// to inheriting this process's CWD (dataDir == "") if it can't be
	// resolved, same as before this existed.
	dataDir, err := senpaiSubdir("data")
	if err != nil {
		log.Printf("mhl bridge: resolve data dir (work-items may land in an unexpected place): %v", err)
	}
	a.dataDir = dataDir

	// Empty on purpose — Codex's own --cd (see agents.mh, tool CodexCwd)
	// must never contain any work-item data, so it stays a sibling of
	// dataDir, never dataDir itself or anything under it.
	codexCwdDir, err := senpaiSubdir("codex-cwd")
	if err != nil {
		log.Printf("mhl bridge: resolve codex cwd (Codex may see more of the filesystem than intended): %v", err)
	}
	a.codexCwdDir = codexCwdDir
	settings := loadSettings()
	a.agent = settings.Agent
	a.devinModel = settings.DevinModel

	if err := a.connectBridge(); err != nil {
		log.Printf("mhl bridge: failed to start: %v", err)
		return
	}
	log.Printf(
		"mhl bridge: ready, serving %s (state-dir: %s, data-dir: %s, codex-cwd: %s)",
		workflowsDir, stateDir, dataDir, codexCwdDir,
	)
}

// connectBridge spawns an mhl child process using whatever startup() last
// resolved into a.mhlPath/workflowsDir/stateDir/dataDir/codexCwdDir and, on
// success, replaces a.mhl with the new Client — the one place both
// startup() and ReconnectMCP() spawn a bridge from, so the two can't drift
// into starting it with different arguments.
func (a *App) connectBridge() error {
	client, err := mhlbridge.Start(a.ctx, a.mhlPath, a.workflowsDir, a.stateDir, a.dataDir, a.codexCwdDir, a.agent, a.devinModel)
	if err != nil {
		return err
	}
	a.mhl = client
	return nil
}

// IsReady reports whether startup() has finished spawning and connecting to
// the mhl bridge. Real incident this fixes: Wails does NOT guarantee
// OnStartup finishes before the frontend's own JS starts running — the
// frontend's very first call (Work-items list on load) could race
// startup()'s async work (extracting the vendored binary/workflows tree,
// spawning mhl, waiting for /healthz, the MCP handshake) and hit
// requireBridge()'s error before a.mhl was ever set. Fase 7's extraction
// step made this window long enough to lose reliably where it previously
// only occasionally raced. The frontend calls this (see
// frontend/src/api.js's waitUntilReady) before its first bound-method call
// instead of assuming startup already finished.
func (a *App) IsReady() bool {
	return a.mhl != nil
}

// MCPStatus reports whether the mhl MCP server is answering right now (a
// live /healthz probe via mhlbridge.Client.Info, not just "did startup
// succeed at some point") plus its name/version from the MCP initialize
// handshake — feeds the sidebar's status panel. ready:false with no error
// (not requireBridge's usual error) when the bridge never started at all —
// that's a normal, displayable state for the panel, not a call failure.
func (a *App) MCPStatus() (string, error) {
	if a.mhl == nil {
		return `{"ready":false}`, nil
	}
	name, version, healthy := a.mhl.Info(a.ctx)
	body, err := json.Marshal(map[string]any{
		"ready":   healthy,
		"name":    name,
		"version": version,
	})
	if err != nil {
		return "", err
	}
	return string(body), nil
}

// ReconnectMCP tears down the current mhl bridge connection (Client.Stop()
// is safe to call even against an already-dead process — see its own doc
// comment) and spawns a fresh one via connectBridge(), reusing the exact
// paths startup() resolved once at launch. Lets the sidebar's status panel
// recover from mhl crashing mid-session without forcing the user to quit
// and reopen the whole app. a.mhl is nilled out before the attempt so a
// call that races IsReady()/requireBridge() sees "not ready" rather than a
// stale Client pointing at a process that's either dead or about to be
// replaced.
//
// Returns the same shape as MCPStatus and, like it, never a Go error for a
// failed *attempt* — that's a normal, displayable panel state — only for
// the json.Marshal failure this fixed shape can't actually produce.
func (a *App) ReconnectMCP() (string, error) {
	if a.mhl != nil {
		if err := a.mhl.Stop(); err != nil {
			log.Printf("mhl bridge: reconnect: stop previous client: %v", err)
		}
	}
	a.mhl = nil

	if err := a.connectBridge(); err != nil {
		log.Printf("mhl bridge: reconnect: failed to start: %v", err)
		body, marshalErr := json.Marshal(map[string]any{"ready": false, "error": err.Error()})
		if marshalErr != nil {
			return "", marshalErr
		}
		return string(body), nil
	}
	log.Printf("mhl bridge: reconnected, serving %s", a.workflowsDir)
	return a.MCPStatus()
}

// GetAgent returns the persisted agent setting ("" | "codex" | "claude" |
// "devin") — "" means "mhl's own default", not "unknown"; the frontend
// shows that as whatever AgentSelector.pick's own default is (codex), kept
// in exactly one place (agents.mh) rather than duplicated here.
func (a *App) GetAgent() string {
	return a.agent
}

// SetAgent persists agent to settings.json, then reconnects the mhl bridge
// so the change actually takes effect — SENPAI_AGENT is only read at mhl's
// own startup (see mhlbridge.Start), so a running process never picks up a
// change to it on its own. Returns the same shape as MCPStatus/ReconnectMCP
// (the panel's normal "is mhl up" state), since switching agents always
// reconnects; a bad agent value is the one real error case, returned before
// anything is persisted or reconnected.
func (a *App) SetAgent(agent string) (string, error) {
	agent = strings.ToLower(strings.TrimSpace(agent))
	if !validAgents[agent] {
		return "", fmt.Errorf("agente desconhecido: %q (use codex | claude | devin)", agent)
	}
	if err := saveSettings(appSettings{Agent: agent, DevinModel: a.devinModel}); err != nil {
		log.Printf("mhl bridge: save agent setting: %v", err)
	}
	a.agent = agent
	return a.ReconnectMCP()
}

type devinModel struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	FamilyLabel string `json:"familyLabel"`
}

type devinModelsResponse struct {
	Families []struct {
		FamilyLabel string `json:"family_label"`
		Variants    []struct {
			ModelUID string `json:"model_uid"`
			Label    string `json:"label"`
		} `json:"variants"`
	} `json:"families"`
}

// ListDevinModels asks the authenticated Devin CLI which models are available
// to this user. Only the fields needed by the picker are returned to the UI.
func (a *App) ListDevinModels() (string, error) {
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	cmd := mhlbridge.CommandContext(ctx, "devin", "models", "list", "--format", "json")
	out, err := cmd.Output()
	if err != nil {
		if ctx.Err() != nil {
			return "", fmt.Errorf("listar modelos do Devin: %w", ctx.Err())
		}
		if exitErr, ok := err.(*exec.ExitError); ok {
			if detail := strings.TrimSpace(string(exitErr.Stderr)); detail != "" {
				return "", fmt.Errorf("listar modelos do Devin: %s", detail)
			}
		}
		return "", fmt.Errorf("listar modelos do Devin: %w", err)
	}
	models, err := parseDevinModels(out)
	if err != nil {
		return "", err
	}
	body, err := json.Marshal(models)
	if err != nil {
		return "", err
	}
	return string(body), nil
}

func parseDevinModels(data []byte) ([]devinModel, error) {
	var response devinModelsResponse
	if err := json.Unmarshal(data, &response); err != nil {
		return nil, fmt.Errorf("decodificar modelos do Devin: %w", err)
	}
	models := make([]devinModel, 0)
	for _, family := range response.Families {
		for _, variant := range family.Variants {
			if variant.ModelUID == "" {
				continue
			}
			label := variant.Label
			if label == "" {
				label = variant.ModelUID
			}
			models = append(models, devinModel{ID: variant.ModelUID, Label: label, FamilyLabel: family.FamilyLabel})
		}
	}
	if len(models) == 0 {
		return nil, fmt.Errorf("o Devin não retornou nenhum modelo disponível")
	}
	return models, nil
}

func (a *App) GetDevinModel() string {
	return a.devinModel
}

// SetDevinModel persists the exact model_uid returned by ListDevinModels and
// restarts mhl because its environment is fixed when the process starts.
func (a *App) SetDevinModel(model string) (string, error) {
	model = strings.TrimSpace(model)
	if model == "" {
		return "", fmt.Errorf("modelo do Devin não pode ser vazio")
	}
	if strings.ContainsAny(model, "\x00\r\n") {
		return "", fmt.Errorf("modelo do Devin inválido")
	}
	if err := saveSettings(appSettings{Agent: a.agent, DevinModel: model}); err != nil {
		return "", fmt.Errorf("salvar modelo do Devin: %w", err)
	}
	a.devinModel = model
	return a.ReconnectMCP()
}

// LogFrontendError forwards an uncaught JS error/rejection (see
// frontend/src/main.js's window.onerror/unhandledrejection hooks) into this
// process's own log — the only way to see a frontend bug in a packaged
// production build, where the webview inspector is normally unavailable.
func (a *App) LogFrontendError(message string) {
	log.Printf("frontend error: %s", message)
}

// DataDir returns mhl's own working directory — where `projects/<id>/...`
// actually lives on disk for every work-item this app manages (empty if it
// could not be resolved at startup, in which case mhl inherited this
// process's own CWD instead; see mhlbridge.Start).
func (a *App) DataDir() string {
	return a.dataDir
}

// ToggleMaximise switches the window between maximised and its previous
// size — bound to a rail button in the frontend rather than relying only on
// the native title bar control, since that control's exact maximize
// behavior (vs. macOS's own "zoom to fit content" semantics) isn't
// guaranteed the same across platforms/window managers.
func (a *App) ToggleMaximise() {
	runtime.WindowToggleMaximise(a.ctx)
}

// senpaiSubdir resolves <user config dir>/senpai/<name>, creating it if
// needed. os.UserConfigDir() is already cross-platform (C6): %AppData% on
// Windows, ~/Library/Application Support on macOS, $XDG_CONFIG_HOME or
// ~/.config on Linux — matches the plan's "<appdata>/state" (and, by the
// same logic, where work-item data itself should live) without any per-OS
// branching of our own.
// setupFileLogging points the standard log package at
// <senpaiBaseDir>/logs/app.log, in addition to (not instead of) its default
// stderr — so a run started from a Terminal keeps behaving exactly as
// before (visible there, e.g. every "mhl bridge: ..." line this session's
// own testing already relies on), while a double-clicked .app — the normal
// way a real user opens this — finally has a file to look at when something
// goes wrong. Truncated on every start: this is a debug aid for "what
// happened on the last run", not a retained audit log (see Fase 8 for that
// kind of policy).
func setupFileLogging() (*os.File, error) {
	dir, err := senpaiSubdir("logs")
	if err != nil {
		return nil, err
	}
	path := filepath.Join(dir, "app.log")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return nil, err
	}
	log.SetOutput(io.MultiWriter(os.Stderr, f))
	log.Printf("logging to %s", path)
	return f, nil
}

func senpaiSubdir(name string) (string, error) {
	base, err := senpaiBaseDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

// senpaiBaseDir is <UserConfigDir>/senpai, unless SENPAI_APPDATA_DIR
// overrides it. The override exists so go test — which calls app.startup()
// directly against a real mhl bridge — never writes its throwaway
// work-items into the same directory the real packaged app uses; app_test.go
// and app_files_test.go set it to a fresh t.TempDir() per test. Without
// this, every test run for real (not simulated) leaves "Fase5 bridge smoke
// test"/"Fase6 ..."/"Fase7 ..." work-items sitting in the user's actual
// project list — exactly what happened before this existed.
func senpaiBaseDir() (string, error) {
	if override := os.Getenv("SENPAI_APPDATA_DIR"); override != "" {
		return override, nil
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "senpai"), nil
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
// WatchRun starts (or re-attaches to) live progress for runID, publishing
// each snapshot as a "run:<runID>" event. Idempotent per runID: a run still
// being polled from an earlier call is never polled a second time — only
// re-published from the snapshot the existing poll loop already has.
//
// This matters because more than one caller can legitimately ask to watch
// the same still-running runID: both tab-artefatos.js and tab-fontes.js
// reattach to whatever's in active-runs.js on every mount (switching tabs,
// or away from a work-item and back), and mhl keeps a run going regardless
// of how many times the UI remounts around it. Real incident this fixes:
// without the dedupe, each remount of a tab with an ingest/generation still
// "working" spawned another goroutine polling mhl_run_status for the exact
// same runID every 500ms — a handful of tab switches was enough concurrent
// polling against the single mhl child process to crash it outright,
// surfacing as every subsequent call (including starting a brand new
// work-item) failing with EOF.
func (a *App) WatchRun(runID string) error {
	if err := a.requireBridge(); err != nil {
		return err
	}

	a.pollingRunsMu.Lock()
	alreadyPolling := a.pollingRuns[runID]
	if !alreadyPolling {
		a.pollingRuns[runID] = true
	}
	a.pollingRunsMu.Unlock()

	first, err := a.mhl.RunStatusGet(a.ctx, runID)
	if err != nil {
		if !alreadyPolling {
			a.pollingRunsMu.Lock()
			delete(a.pollingRuns, runID)
			a.pollingRunsMu.Unlock()
		}
		return err
	}
	a.publishRunStatus(runID, first)
	if alreadyPolling || first.Terminal() {
		if first.Terminal() {
			a.pollingRunsMu.Lock()
			delete(a.pollingRuns, runID)
			a.pollingRunsMu.Unlock()
		}
		return nil
	}

	go func() {
		defer func() {
			a.pollingRunsMu.Lock()
			delete(a.pollingRuns, runID)
			a.pollingRunsMu.Unlock()
		}()
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

// --- Fase 6: shell-owned file access (upload, wiki/artifact browsing) ---
//
// None of this goes through the mhl bridge — it's the shell's own
// responsibility per the plan (Docs-Servers: "pass large payloads by
// reference... the shell writes the file to disk and passes paths, not
// bytes"). mhl has no MCP tool for "let the UI browse project files"; these
// bindings are that missing piece, reading/writing directly under a.dataDir.
//
// Go never calls into the MHL-side `tool Paths` (different runtimes) — the
// same C1 discipline (never resolve a path outside projects/<id>/...) is
// reimplemented here, in Go, with its own tests (see app_files_test.go).

// projectIDPattern mirrors Paths.is_valid_id (workflows/shared/core/paths.mh):
// slug/UUID-safe characters only, no "..", no "/".
var projectIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

func validateProjectID(projectID string) error {
	if !projectIDPattern.MatchString(projectID) {
		return fmt.Errorf("project_id invalido: %q", projectID)
	}
	return nil
}

// projectRootDir resolves projects/<projectID>/<root> under a.dataDir, with
// root restricted to an explicit allowlist passed by the caller — never a
// free-form string from the frontend.
func (a *App) projectRootDir(projectID string, root string, allowed []string) (string, error) {
	if err := validateProjectID(projectID); err != nil {
		return "", err
	}
	ok := false
	for _, candidate := range allowed {
		if root == candidate {
			ok = true
			break
		}
	}
	if !ok {
		return "", fmt.Errorf("root invalido: %q", root)
	}
	if a.dataDir == "" {
		return "", fmt.Errorf("data dir nao resolvido — veja o log de startup")
	}
	dir := filepath.Join(a.dataDir, "projects", projectID, root)
	if root == "artifacts" {
		// Best-effort (§3.5 of the plan): every caller that touches a
		// project's artifacts/ — list or read alike — gets a chance to have
		// assets/mermaid.min.js already sitting there, covering both new
		// and pre-existing projects the first time their artifacts are
		// browsed. A failure here must never block the actual list/read the
		// caller asked for.
		if err := ensureArtifactMermaidAsset(dir); err != nil {
			log.Printf("mhl bridge: ensure mermaid asset for project %s: %v", projectID, err)
		}
	}
	return dir, nil
}

// resolveSafeRelative joins base with relative, rejecting anything that
// would escape base — a ".." segment, an absolute path, or (defense in
// depth, in case filepath.Clean's own normalization is somehow bypassed) a
// final path that no longer has base as a prefix.
func resolveSafeRelative(base string, relative string) (string, error) {
	cleaned := filepath.Clean(relative)
	if cleaned == "." {
		cleaned = ""
	}
	if filepath.IsAbs(relative) || cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("caminho invalido: %q", relative)
	}
	full := filepath.Join(base, cleaned)
	baseWithSep := base
	if !strings.HasSuffix(baseWithSep, string(filepath.Separator)) {
		baseWithSep += string(filepath.Separator)
	}
	if full != base && !strings.HasPrefix(full, baseWithSep) {
		return "", fmt.Errorf("caminho escapa do diretorio esperado: %q", relative)
	}
	return full, nil
}

// SelectRawFiles opens the native multi-file picker and returns the chosen
// absolute paths as a JSON array (empty if the user cancels).
func (a *App) SelectRawFiles() (string, error) {
	if err := a.requireBridge(); err != nil {
		return "", err
	}
	paths, err := runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Selecionar fontes",
	})
	if err != nil {
		return "", fmt.Errorf("select raw files: %w", err)
	}
	if paths == nil {
		paths = []string{}
	}
	body, err := json.Marshal(paths)
	if err != nil {
		return "", fmt.Errorf("encode selected paths: %w", err)
	}
	return string(body), nil
}

// AddRawFile copies sourcePath into projects/<projectID>/raw/, under its own
// basename (de-duplicated if a file with that name already exists), and
// returns the resulting basename — exactly the value a caller should put in
// Wiki's `raw_paths: [...]` (Paths.raw only ever concatenates "raw/" + this
// name; see workflows/shared/core/paths.mh).
func (a *App) AddRawFile(projectID string, sourcePath string) (string, error) {
	rawDir, err := a.projectRootDir(projectID, "raw", []string{"raw"})
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(rawDir, 0o755); err != nil {
		return "", fmt.Errorf("create raw dir: %w", err)
	}

	base := filepath.Base(sourcePath)
	if base == "." || base == string(filepath.Separator) || base == "" {
		return "", fmt.Errorf("caminho de origem invalido: %q", sourcePath)
	}
	dest := uniqueDestination(rawDir, base)

	src, err := os.Open(sourcePath)
	if err != nil {
		return "", fmt.Errorf("open source file: %w", err)
	}
	defer src.Close()

	out, err := os.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return "", fmt.Errorf("create destination file: %w", err)
	}
	defer out.Close()

	if _, err := io.Copy(out, src); err != nil {
		return "", fmt.Errorf("copy raw file: %w", err)
	}
	return filepath.Base(dest), nil
}

// uniqueDestination returns dir/name, or dir/name (2), (3), ... the first of
// those that doesn't already exist — never overwrites a previously uploaded
// source with the same filename.
func uniqueDestination(dir string, name string) string {
	candidate := filepath.Join(dir, name)
	if _, err := os.Stat(candidate); os.IsNotExist(err) {
		return candidate
	}
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	for i := 2; ; i++ {
		candidate = filepath.Join(dir, stem+" ("+strconv.Itoa(i)+")"+ext)
		if _, err := os.Stat(candidate); os.IsNotExist(err) {
			return candidate
		}
	}
}

// ingestedMarkerFile bookkeeps, per project, which raw/ files have already
// completed the Wiki ingest workflow — the Fontes tab writes it (via
// MarkRawIngested) right after a run finishes and reads it back (via
// ListIngestedRaw) so the checkmark survives a tab remount or app restart,
// which a plain ListProjectDir listing can't tell on its own (a raw file's
// name never changes just because it got ingested). Lives as a dotfile
// inside raw/ so listDirTree's existing "skip dotfiles" rule keeps it out
// of the Fontes tab's own file listing for free — same convention as
// paths.mh's ".index-state.json", but this one is app-only bookkeeping,
// never read by any workflow or the LLM.
const ingestedMarkerFile = ".ingested.json"

func readIngestedRaw(rawDir string) ([]string, error) {
	data, err := os.ReadFile(filepath.Join(rawDir, ingestedMarkerFile))
	if os.IsNotExist(err) {
		return []string{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read ingested marker: %w", err)
	}
	var names []string
	if err := json.Unmarshal(data, &names); err != nil {
		return nil, fmt.Errorf("parse ingested marker: %w", err)
	}
	return names, nil
}

func writeIngestedRaw(rawDir string, names []string) error {
	sort.Strings(names)
	body, err := json.Marshal(names)
	if err != nil {
		return fmt.Errorf("encode ingested marker: %w", err)
	}
	if err := os.MkdirAll(rawDir, 0o755); err != nil {
		return fmt.Errorf("create raw dir: %w", err)
	}
	return os.WriteFile(filepath.Join(rawDir, ingestedMarkerFile), body, 0o644)
}

// MarkRawIngested records that raw/<filename> has completed Wiki's ingest
// action. Returns the full updated list of ingested basenames as JSON.
func (a *App) MarkRawIngested(projectID string, filename string) (string, error) {
	if filename == "" || filename != filepath.Base(filename) {
		return "", fmt.Errorf("nome de arquivo invalido: %q", filename)
	}
	rawDir, err := a.projectRootDir(projectID, "raw", []string{"raw"})
	if err != nil {
		return "", err
	}
	names, err := readIngestedRaw(rawDir)
	if err != nil {
		return "", err
	}
	if !slices.Contains(names, filename) {
		names = append(names, filename)
	}
	if err := writeIngestedRaw(rawDir, names); err != nil {
		return "", err
	}
	body, err := json.Marshal(names)
	if err != nil {
		return "", fmt.Errorf("encode ingested marker: %w", err)
	}
	return string(body), nil
}

// ListIngestedRaw returns the basenames (under raw/) already marked
// ingested via MarkRawIngested, as a JSON array — empty if none yet.
func (a *App) ListIngestedRaw(projectID string) (string, error) {
	rawDir, err := a.projectRootDir(projectID, "raw", []string{"raw"})
	if err != nil {
		return "", err
	}
	names, err := readIngestedRaw(rawDir)
	if err != nil {
		return "", err
	}
	body, err := json.Marshal(names)
	if err != nil {
		return "", fmt.Errorf("encode ingested marker: %w", err)
	}
	return string(body), nil
}

// projectFileNode is one entry of the tree ListProjectDir returns.
type projectFileNode struct {
	Name     string             `json:"name"`
	Path     string             `json:"path"`
	IsDir    bool               `json:"isDir"`
	Children []*projectFileNode `json:"children,omitempty"`
}

// ListProjectDir lists projects/<projectID>/<root>/<relative> recursively as
// a JSON tree — directories sorted before files, both alphabetically. root
// is restricted to "raw"|"wiki"|"artifacts" (never anything outside
// projects/<projectID>/). Returns an empty array if the directory doesn't
// exist yet (e.g. a work-item with no sources uploaded yet), not an error.
func (a *App) ListProjectDir(projectID string, root string, relative string) (string, error) {
	rootDir, err := a.projectRootDir(projectID, root, []string{"raw", "wiki", "artifacts"})
	if err != nil {
		return "", err
	}
	dir, err := resolveSafeRelative(rootDir, relative)
	if err != nil {
		return "", err
	}

	nodes, err := listDirTree(dir, "")
	if err != nil {
		if os.IsNotExist(err) {
			return "[]", nil
		}
		return "", fmt.Errorf("list project dir: %w", err)
	}
	body, err := json.Marshal(nodes)
	if err != nil {
		return "", fmt.Errorf("encode dir listing: %w", err)
	}
	return string(body), nil
}

func listDirTree(dir string, relPrefix string) ([]*projectFileNode, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir() != entries[j].IsDir() {
			return entries[i].IsDir()
		}
		return entries[i].Name() < entries[j].Name()
	})

	nodes := make([]*projectFileNode, 0, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, ".") {
			continue // skip dotfiles (e.g. .index-state.json bookkeeping)
		}
		relPath := name
		if relPrefix != "" {
			relPath = relPrefix + "/" + name
		}
		node := &projectFileNode{Name: name, Path: relPath, IsDir: entry.IsDir()}
		if entry.IsDir() {
			children, err := listDirTree(filepath.Join(dir, name), relPath)
			if err != nil {
				return nil, err
			}
			node.Children = children
		}
		nodes = append(nodes, node)
	}
	return nodes, nil
}

// maxProjectFileBytes guards ReadProjectFile against being pointed at
// something that isn't a generated artifact/wiki page. 8MiB comfortably
// fits the largest legitimate file under artifacts/ — the vendored
// artifacts/assets/mermaid.min.js (Fase 7, ~5.5MB, seeded by
// ensureArtifactMermaidAsset) — while still rejecting anything wildly
// larger than a real generated page.
const maxProjectFileBytes = 8 * 1024 * 1024

// DeleteProject permanently removes projects/<projectID> (project.json,
// usage.jsonl, raw/, wiki/, artifacts/ — everything) from disk. There is no
// mhl-side delete action (WorkItem's own actions.mh only supports archiving,
// which just flips a flag and keeps the files) — this is the shell's own
// direct-filesystem responsibility, same as AddRawFile/ListProjectDir above.
// Irreversible: the frontend must confirm with the user before calling this.
func (a *App) DeleteProject(projectID string) error {
	if err := validateProjectID(projectID); err != nil {
		return err
	}
	if a.dataDir == "" {
		return fmt.Errorf("data dir nao resolvido — veja o log de startup")
	}
	dir := filepath.Join(a.dataDir, "projects", projectID)
	if _, err := os.Stat(dir); err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("work-item nao encontrado: %q", projectID)
		}
		return fmt.Errorf("delete project: %w", err)
	}
	if err := os.RemoveAll(dir); err != nil {
		return fmt.Errorf("delete project: %w", err)
	}
	return nil
}

// ReadProjectFile reads a file under projects/<projectID>/<root>/<relative>
// and returns its content as a string. root is restricted to "wiki"|
// "artifacts" — never "raw": the UI never needs to re-open an uploaded raw
// source, only what was derived from it (same discipline as C2, applied to
// the shell).
func (a *App) ReadProjectFile(projectID string, root string, relative string) (string, error) {
	rootDir, err := a.projectRootDir(projectID, root, []string{"wiki", "artifacts"})
	if err != nil {
		return "", err
	}
	path, err := resolveSafeRelative(rootDir, relative)
	if err != nil {
		return "", err
	}

	info, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("read project file: %w", err)
	}
	if info.IsDir() {
		return "", fmt.Errorf("caminho e um diretorio, nao um arquivo: %q", relative)
	}
	if info.Size() > maxProjectFileBytes {
		return "", fmt.Errorf("arquivo maior que o limite de %d bytes: %q", maxProjectFileBytes, relative)
	}

	content, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read project file: %w", err)
	}
	return string(content), nil
}
