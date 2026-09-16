package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// newTestApp starts the real mhl bridge (no mocks — see the Fase 0 test this
// replaces/extends) and swaps in a recording emit func, since the real one
// (runtime.EventsEmit) hard-crashes outside an actual running Wails app —
// see the doc comment on App.emit. SENPAI_APPDATA_DIR is pinned to a fresh
// t.TempDir() so every test's work-items/state/embedded-binary-extraction
// land in an isolated, auto-cleaned directory — never the real
// <UserConfigDir>/senpai a packaged app uses (see senpaiBaseDir's doc
// comment for the incident this fixed: real "Fase5/6/7 ..." test fixtures
// were showing up in the actual app's work-item list).
func newTestApp(t *testing.T) (*App, *eventRecorder) {
	t.Helper()
	t.Setenv("SENPAI_APPDATA_DIR", t.TempDir())
	app := NewApp()
	app.startup(context.Background())
	if app.mhl == nil {
		t.Fatal("mhl bridge did not start — see stderr above for why")
	}
	t.Cleanup(func() { app.shutdown(context.Background()) })

	rec := &eventRecorder{}
	app.emit = rec.record
	return app, rec
}

type eventRecorder struct {
	mu     sync.Mutex
	events []recordedEvent
}

type recordedEvent struct {
	name string
	data string
}

func (r *eventRecorder) record(eventName string, data any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, recordedEvent{name: eventName, data: fmt.Sprint(data)})
}

func (r *eventRecorder) snapshot() []recordedEvent {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]recordedEvent, len(r.events))
	copy(out, r.events)
	return out
}

// TestIsReady_FalseBeforeStartupTrueAfter is a regression guard for the
// real startup race this binding exists to fix: Wails doesn't guarantee
// OnStartup finishes before the frontend's own JS starts running, so the
// frontend polls IsReady() (see frontend/src/api.js's waitUntilReady)
// before its first real call instead of assuming the bridge is already up.
func TestIsReady_FalseBeforeStartupTrueAfter(t *testing.T) {
	app := NewApp()
	if app.IsReady() {
		t.Fatal("expected IsReady() to be false before startup() runs")
	}
	app, _ = newTestApp(t)
	if !app.IsReady() {
		t.Fatal("expected IsReady() to be true once newTestApp's startup() has returned")
	}
}

// TestListWorkflowsAndManifest proves tools/list and resources/read both
// reach the real mhl process through the bridge and come back parseable.
func TestListWorkflowsAndManifest(t *testing.T) {
	app, _ := newTestApp(t)

	list, err := app.ListWorkflows()
	if err != nil {
		t.Fatalf("ListWorkflows: %v", err)
	}
	if !strings.Contains(list, `"name":"WorkItem"`) {
		t.Fatalf("expected WorkItem in tools/list, got: %s", list)
	}
	if !strings.Contains(list, `"name":"mhl_run_start"`) {
		t.Fatalf("expected mhl_run_start (async control tool) in tools/list, got: %s", list)
	}

	manifest, err := app.GetWorkflowManifest("WorkItem")
	if err != nil {
		t.Fatalf("GetWorkflowManifest: %v", err)
	}
	var parsed map[string]any
	if err := json.Unmarshal([]byte(manifest), &parsed); err != nil {
		t.Fatalf("manifest is not valid JSON: %v\n%s", err, manifest)
	}
	if _, ok := parsed["inputSchema"]; !ok {
		t.Fatalf("expected manifest to carry inputSchema, got keys: %v", keysOf(parsed))
	}
	if _, ok := parsed["steps"]; !ok {
		t.Fatalf("expected manifest to carry steps (the detail tools/list doesn't have), got keys: %v", keysOf(parsed))
	}
}

// TestRunLifecycle_WorkItem drives StartRun -> WatchRun -> (event pushes) ->
// terminal state through a deterministic, free workflow (WorkItem has no
// LLM call), then cross-checks GetRunStatus and ListRuns see the same run.
// This is the mechanism this whole phase is about — Fase 3/4 already proved
// Modo Buddy/async progress at the MHL-language level; what's new here is
// that the Go bridge (StartRun/WatchRun/RunStatusGet, real HTTP+JSON-RPC,
// not `mhl run` directly) carries it correctly end to end.
func TestRunLifecycle_WorkItem(t *testing.T) {
	app, rec := newTestApp(t)

	startBody, err := app.StartRun("WorkItem", `{"action":"list"}`)
	if err != nil {
		t.Fatalf("StartRun: %v", err)
	}
	runID := requireField(t, startBody, "runId")
	if runID == "" {
		t.Fatalf("StartRun returned no runId: %s", startBody)
	}

	if err := app.WatchRun(runID); err != nil {
		t.Fatalf("WatchRun: %v", err)
	}

	final := waitForTerminalEvent(t, rec, runID, 10*time.Second)
	if state := requireField(t, final, "state"); state != "completed" {
		t.Fatalf("expected final state \"completed\", got %q (event: %s)", state, final)
	}
	if !strings.Contains(final, `"Done"`) {
		t.Fatalf("expected reached to include \"Done\", got: %s", final)
	}

	// GetRunStatus (a one-off poll, no watch) must agree with what WatchRun
	// already pushed.
	statusBody, err := app.GetRunStatus(runID)
	if err != nil {
		t.Fatalf("GetRunStatus: %v", err)
	}
	if state := requireField(t, statusBody, "state"); state != "completed" {
		t.Fatalf("GetRunStatus: expected \"completed\", got %q", state)
	}

	runs, err := app.ListRuns()
	if err != nil {
		t.Fatalf("ListRuns: %v", err)
	}
	if !strings.Contains(runs, runID) {
		t.Fatalf("expected ListRuns to include this session's own run %s, got: %s", runID, runs)
	}

	// CancelRun on an already-terminal run must not crash the bridge —
	// mhl's own answer (idempotent no-op vs. a clear error) is its call, not
	// ours to assert on; only that the round-trip itself works.
	if _, err := app.CancelRun(runID); err != nil {
		t.Logf("CancelRun on a completed run returned an error (acceptable, mhl's call): %v", err)
	}

	if _, err := app.GetRunLogs(runID, ""); err != nil {
		t.Fatalf("GetRunLogs: %v", err)
	}
}

// TestModoBuddyPauseResume_WikiIngest exercises the one path Fase 5 exists
// for that TestRunLifecycle_WorkItem's free workflow can't reach: a real
// pause()/mhl_run_resume round trip, through the bridge, with a real `devin`
// call in between (not simulated — same bar as every other phase). Costs a
// small amount of real LLM usage; kept to one short source on a disposable
// work-item.
func TestModoBuddyPauseResume_WikiIngest(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping real-LLM test in -short mode")
	}
	app, rec := newTestApp(t)

	createBody, err := app.StartRun("WorkItem", `{"action":"create","name":"Fase5 bridge smoke test","item_type":"historia"}`)
	if err != nil {
		t.Fatalf("StartRun(WorkItem create): %v", err)
	}
	createRunID := requireField(t, createBody, "runId")
	created := waitForTerminalEventDirect(t, app, createRunID, 10*time.Second)
	projectID := requireNestedField(t, created, "vars", "project", "id")
	if projectID == "" {
		t.Fatalf("could not read the new work-item's id from: %s", created)
	}

	if app.DataDir() == "" {
		t.Fatal("app.DataDir() is empty — mhl bridge started without a resolved data dir")
	}
	rawDir := filepath.Join(app.DataDir(), "projects", projectID, "raw")
	if err := os.MkdirAll(rawDir, 0o755); err != nil {
		t.Fatalf("mkdir raw dir: %v", err)
	}
	sourcePath := filepath.Join(rawDir, "fonte-minima.md")
	source := "# Nota rapida\n\nEste projeto existe so para validar, com uma chamada real de LLM, " +
		"que StartRun/WatchRun/ResumeRun do bridge Go conseguem pausar e retomar um ingest via Modo Buddy.\n"
	if err := os.WriteFile(sourcePath, []byte(source), 0o644); err != nil {
		t.Fatalf("write raw source: %v", err)
	}

	ingestArgs := fmt.Sprintf(`{"action":"ingest","project_id":%q,"raw_paths":["fonte-minima.md"],"buddy":true}`, projectID)
	ingestBody, err := app.StartRun("Wiki", ingestArgs)
	if err != nil {
		t.Fatalf("StartRun(Wiki ingest): %v", err)
	}
	ingestRunID := requireField(t, ingestBody, "runId")

	if err := app.WatchRun(ingestRunID); err != nil {
		t.Fatalf("WatchRun(ingest): %v", err)
	}
	paused := waitForTerminalEvent(t, rec, ingestRunID, 120*time.Second)
	if state := requireField(t, paused, "state"); state != "paused" {
		t.Fatalf("expected the ingest run to pause for Modo Buddy review, got state %q: %s", state, paused)
	}

	resumeBody, err := app.ResumeRun(ingestRunID, `{"approved":true}`)
	if err != nil {
		t.Fatalf("ResumeRun: %v", err)
	}
	// mhl_run_resume's own reply already reflects the re-entered run — poll
	// straight from here rather than re-arming WatchRun, to prove
	// GetRunStatus alone is enough to finish tracking a resumed run.
	t.Logf("ResumeRun immediate reply: %s", resumeBody)

	final := pollUntilTerminal(t, app, ingestRunID, 60*time.Second)
	if state := requireField(t, final, "state"); state != "completed" {
		t.Fatalf("expected the resumed ingest to complete, got state %q: %s", state, final)
	}
}

func waitForTerminalEvent(t *testing.T, rec *eventRecorder, runID string, timeout time.Duration) string {
	t.Helper()
	eventName := "run:" + runID
	deadline := time.Now().Add(timeout)
	var last string
	for time.Now().Before(deadline) {
		for _, e := range rec.snapshot() {
			if e.name != eventName {
				continue
			}
			last = e.data
			if state := requireField(t, e.data, "state"); state != "working" && state != "queued" {
				return e.data
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("timed out after %s waiting for a terminal %q event; last seen: %s", timeout, eventName, last)
	return ""
}

// waitForTerminalEventDirect is waitForTerminalEvent for a run started
// without going through WatchRun/the emit recorder — it polls GetRunStatus
// directly instead.
func waitForTerminalEventDirect(t *testing.T, app *App, runID string, timeout time.Duration) string {
	t.Helper()
	return pollUntilTerminal(t, app, runID, timeout)
}

func pollUntilTerminal(t *testing.T, app *App, runID string, timeout time.Duration) string {
	t.Helper()
	deadline := time.Now().Add(timeout)
	var last string
	for time.Now().Before(deadline) {
		body, err := app.GetRunStatus(runID)
		if err != nil {
			t.Fatalf("GetRunStatus(%s): %v", runID, err)
		}
		last = body
		if state := requireField(t, body, "state"); state != "working" && state != "queued" {
			return body
		}
		time.Sleep(200 * time.Millisecond)
	}
	t.Fatalf("timed out after %s waiting for run %s to reach a terminal state; last seen: %s", timeout, runID, last)
	return ""
}

func requireField(t *testing.T, jsonBody, field string) string {
	t.Helper()
	var parsed map[string]any
	if err := json.Unmarshal([]byte(jsonBody), &parsed); err != nil {
		t.Fatalf("not valid JSON: %v\n%s", err, jsonBody)
	}
	value, ok := parsed[field]
	if !ok {
		return ""
	}
	return fmt.Sprint(value)
}

func requireNestedField(t *testing.T, jsonBody string, path ...string) string {
	t.Helper()
	var parsed map[string]any
	if err := json.Unmarshal([]byte(jsonBody), &parsed); err != nil {
		t.Fatalf("not valid JSON: %v\n%s", err, jsonBody)
	}
	var cur any = parsed
	for _, key := range path {
		m, ok := cur.(map[string]any)
		if !ok {
			return ""
		}
		cur, ok = m[key]
		if !ok {
			return ""
		}
	}
	return fmt.Sprint(cur)
}

func keysOf(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
