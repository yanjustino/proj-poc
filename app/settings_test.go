package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSettingsRoundTrips(t *testing.T) {
	t.Setenv("SENPAI_APPDATA_DIR", t.TempDir())

	if got := loadSettings(); got != (appSettings{}) {
		t.Fatalf("loadSettings() before any save = %+v, want zero value", got)
	}

	want := appSettings{
		Agent: "devin", DevinModel: "swe-1-6",
		DevinCostSummary: "$0.5 / 1M Input · $0.2 / 1M Cached input · $2.5 / 1M Output",
	}
	if err := saveSettings(want); err != nil {
		t.Fatalf("saveSettings: %v", err)
	}
	if got := loadSettings(); got != want {
		t.Errorf("loadSettings() = %+v, want agent and Devin model preserved", got)
	}
}

func TestParseDevinModelsFlattensFamilies(t *testing.T) {
	models, err := parseDevinModels([]byte(`{
		"families": [{
			"family_label": "SWE-1.6",
			"variants": [
				{"model_uid": "swe-1-6", "label": "SWE-1.6", "cost_summary": "$0.5 / 1M Input · $0.2 / 1M Cached input · $2.5 / 1M Output"},
				{"model_uid": "swe-1-6-fast", "label": "SWE-1.6 Fast"}
			]
		}]
	}`))
	if err != nil {
		t.Fatalf("parseDevinModels: %v", err)
	}
	if len(models) != 2 || models[1].ID != "swe-1-6-fast" || models[1].FamilyLabel != "SWE-1.6" {
		t.Fatalf("parseDevinModels() = %+v, want flattened variants with family labels", models)
	}
	if models[0].CostSummary != "$0.5 / 1M Input · $0.2 / 1M Cached input · $2.5 / 1M Output" {
		t.Errorf("parseDevinModels() dropped cost_summary: %+v", models[0])
	}
}

func TestParseDevinPricingAcceptsTheCLIPriceShape(t *testing.T) {
	pricing, ok := parseDevinPricing(
		"swe-1-6",
		"$0.5 / 1M Input · $0.2 / 1M Cached input · $2.5 / 1M Output",
	)
	if !ok {
		t.Fatal("parseDevinPricing rejected the shape returned by devin models list")
	}
	if pricing.ModelID != "swe-1-6" || pricing.InputUSDPerMillion != 0.5 || pricing.CachedInputUSDPerMillion != 0.2 || pricing.OutputUSDPerMillion != 2.5 {
		t.Fatalf("parseDevinPricing() = %+v", pricing)
	}
}

// Windows: the CLI output may arrive in the console's ANSI code page, so the
// "·" separator shows up as U+FFFD (or "|", or NBSP-padded) — the rates must
// still be read by their labels.
func TestParseDevinPricingIgnoresTheSeparatorBetweenRates(t *testing.T) {
	for _, summary := range []string{
		"$0.5 / 1M Input \uFFFD $0.2 / 1M Cached input \uFFFD $2.5 / 1M Output",
		"$0.5 / 1M Input | $0.2 / 1M Cached input | $2.5 / 1M Output",
		"$0.5\u00a0/\u00a01M\u00a0Input\u00a0·\u00a0$0.2 / 1M Cached\u00a0input · $2.5 / 1M Output",
		"$2.5 / 1M Output · $0.5 / 1M Input · $0.2 / 1M Cached input",
	} {
		pricing, ok := parseDevinPricing("swe-1-6", summary)
		if !ok {
			t.Errorf("parseDevinPricing(%q) rejected a complete price summary", summary)
			continue
		}
		if pricing.InputUSDPerMillion != 0.5 || pricing.CachedInputUSDPerMillion != 0.2 || pricing.OutputUSDPerMillion != 2.5 {
			t.Errorf("parseDevinPricing(%q) = %+v", summary, pricing)
		}
	}
}

// The Devin CLI build seen on Windows lists "MTok" and "In"/"Out", with no
// cached input rate — cached tokens then fall back to the input rate.
func TestParseDevinPricingAcceptsTheMTokShapeWithoutACachedRate(t *testing.T) {
	for _, summary := range []string{
		"$0.5 / MTok In · $2.5 / MTok Out",
		"$0.5 / MTok In \uFFFD $2.5 / MTok Out",
		"$0.5 / MTok In · $0.2 / MTok Cached In · $2.5 / MTok Out",
	} {
		pricing, ok := parseDevinPricing("swe-1-6-fast", summary)
		if !ok {
			t.Errorf("parseDevinPricing(%q) rejected the MTok price shape", summary)
			continue
		}
		wantCached := 0.5
		if strings.Contains(summary, "Cached") {
			wantCached = 0.2
		}
		if pricing.InputUSDPerMillion != 0.5 || pricing.OutputUSDPerMillion != 2.5 || pricing.CachedInputUSDPerMillion != wantCached {
			t.Errorf("parseDevinPricing(%q) = %+v", summary, pricing)
		}
	}
}

func TestParseDevinPricingRejectsPartialOrUnknownPricing(t *testing.T) {
	for _, summary := range []string{
		"", "$0.5 / 1M Input", "$2.5 / MTok Out", "Included in plan",
		"$0.5 / 1M Input · $0.5 / 1M Input · $2.5 / 1M Output",
		"$0.5 / 1M Input · $0.2 / 1M Cached input · $2.5 / 1M Output · $1 / request",
	} {
		if _, ok := parseDevinPricing("swe-1-6", summary); ok {
			t.Errorf("parseDevinPricing(%q) succeeded; want no estimate", summary)
		}
	}
}

func TestParseDevinModelsRejectsAnEmptyResponse(t *testing.T) {
	if _, err := parseDevinModels([]byte(`{"families":[]}`)); err == nil {
		t.Fatal("parseDevinModels accepted a response without models")
	}
}

// TestParseCodexModelsFiltersHiddenSlugs mirrors `codex debug models`'s own
// shape — a flat catalog, not grouped like Devin's — and its "hide"
// visibility, used for internal/reserved slugs (gpt-reserve,
// codex-auto-review in a real listing) that a user should never pick
// directly.
func TestParseCodexModelsFiltersHiddenSlugs(t *testing.T) {
	models, err := parseCodexModels([]byte(`{
		"models": [
			{"slug": "gpt-reserve", "display_name": "GPT-Reserve", "visibility": "hide"},
			{"slug": "gpt-5.6-luna", "display_name": "GPT-5.6-Luna", "description": "balanced", "visibility": "list"},
			{"slug": "gpt-5.5", "display_name": "GPT-5.5", "visibility": "list"}
		]
	}`))
	if err != nil {
		t.Fatalf("parseCodexModels: %v", err)
	}
	if len(models) != 2 || models[0].ID != "gpt-5.6-luna" || models[1].ID != "gpt-5.5" {
		t.Fatalf("parseCodexModels() = %+v, want only the 2 \"list\"-visibility models", models)
	}
	if models[0].Description != "balanced" {
		t.Errorf("parseCodexModels() dropped description: %+v", models[0])
	}
}

func TestParseCodexModelsRejectsAResponseWithNoListedModels(t *testing.T) {
	if _, err := parseCodexModels([]byte(`{"models":[{"slug":"gpt-reserve","visibility":"hide"}]}`)); err == nil {
		t.Fatal("parseCodexModels accepted a response with no \"list\"-visibility models")
	}
	if _, err := parseCodexModels([]byte(`{"models":[]}`)); err == nil {
		t.Fatal("parseCodexModels accepted an empty response")
	}
}

// TestListClaudeModelsIsAFixedNonEmptyCatalog is the doc'd reason
// listClaudeModels exists at all: the Claude Code CLI has no runtime "list
// models" command, so unlike Devin/Codex this never calls out to a CLI.
func TestListClaudeModelsIsAFixedNonEmptyCatalog(t *testing.T) {
	models := listClaudeModels()
	if len(models) == 0 {
		t.Fatal("listClaudeModels() returned no models")
	}
	for _, model := range models {
		if model.ID == "" || model.Label == "" {
			t.Errorf("listClaudeModels() has a model with an empty id or label: %+v", model)
		}
	}
}

func TestLoadSettingsIgnoresAMalformedFileRatherThanFailing(t *testing.T) {
	t.Setenv("SENPAI_APPDATA_DIR", t.TempDir())
	path, err := settingsFilePath()
	if err != nil {
		t.Fatalf("settingsFilePath: %v", err)
	}
	if err := os.WriteFile(path, []byte("not json"), 0o644); err != nil {
		t.Fatalf("write malformed settings.json: %v", err)
	}

	if got := loadSettings(); got != (appSettings{}) {
		t.Errorf("loadSettings() over a malformed file = %+v, want zero value", got)
	}
}

// TestApp_SetAgent exercises the real path an agent switch takes: persist
// to settings.json and to the .senpai-agent.json the workflows read on every
// LLM call — without restarting mhl (the same bridge client keeps serving).
// newTestApp starts a real bridge, so this proves the status still comes
// back ready, not just the file writes.
func TestApp_SetAgent(t *testing.T) {
	app, _ := newTestApp(t)

	if got := app.GetAgent(); got != "" {
		t.Fatalf("GetAgent() before any SetAgent = %q, want \"\" (nothing chosen yet)", got)
	}
	bridgeBefore := app.bridge()

	statusJSON, err := app.SetAgent("claude")
	if err != nil {
		t.Fatalf("SetAgent(claude): %v", err)
	}
	var status struct {
		Ready bool `json:"ready"`
	}
	if err := json.Unmarshal([]byte(statusJSON), &status); err != nil {
		t.Fatalf("decode SetAgent result %q: %v", statusJSON, err)
	}
	if !status.Ready {
		t.Errorf("SetAgent(claude) but bridge reports ready=false: %s", statusJSON)
	}
	if app.bridge() != bridgeBefore {
		t.Error("SetAgent restarted the mhl bridge — the switch must only rewrite the agent config file")
	}
	if got := app.GetAgent(); got != "claude" {
		t.Errorf("GetAgent() after SetAgent(claude) = %q, want %q", got, "claude")
	}
	if got := loadSettings().Agent; got != "claude" {
		t.Errorf("loadSettings().Agent after SetAgent(claude) = %q, want %q (not persisted)", got, "claude")
	}
	if got := readAgentConfig(t, app.DataDir()).Agent; got != "claude" {
		t.Errorf("%s agent after SetAgent(claude) = %q, want %q", agentConfigFile, got, "claude")
	}

	if _, err := app.SetCodexModel("gpt-teste"); err != nil {
		t.Fatalf("SetCodexModel: %v", err)
	}
	if _, err := app.SetAgent("codex"); err != nil {
		t.Fatalf("SetAgent(codex): %v", err)
	}
	cfg := readAgentConfig(t, app.DataDir())
	if cfg.Agent != "codex" || cfg.CodexModel != "gpt-teste" {
		t.Errorf("%s after SetCodexModel+SetAgent = %+v, want agent codex and codex_model gpt-teste", agentConfigFile, cfg)
	}
	if app.bridge() != bridgeBefore {
		t.Error("a model switch restarted the mhl bridge")
	}
}

func readAgentConfig(t *testing.T, dataDir string) agentConfig {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(dataDir, agentConfigFile))
	if err != nil {
		t.Fatalf("read %s: %v", agentConfigFile, err)
	}
	var cfg agentConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("decode %s: %v", agentConfigFile, err)
	}
	return cfg
}

func TestWriteAgentConfig_ReplacesTheFileWithoutLeavingTempFiles(t *testing.T) {
	dir := t.TempDir()
	if err := writeAgentConfig(dir, agentConfig{Agent: "devin", DevinModel: "swe-1"}); err != nil {
		t.Fatalf("first write: %v", err)
	}
	if err := writeAgentConfig(dir, agentConfig{Agent: "devin", DevinModel: "swe-2", DevinPricing: `{"input":1}`}); err != nil {
		t.Fatalf("second write: %v", err)
	}
	cfg := readAgentConfig(t, dir)
	if cfg.DevinModel != "swe-2" || cfg.DevinPricing != `{"input":1}` {
		t.Errorf("config = %+v, want the second write", cfg)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read dir: %v", err)
	}
	if len(entries) != 1 {
		t.Errorf("expected only %s in the dir, got %d entries", agentConfigFile, len(entries))
	}
}

func TestApp_SetAgent_RejectsAnUnknownAgentWithoutPersisting(t *testing.T) {
	app, _ := newTestApp(t)
	if _, err := app.SetAgent("claude"); err != nil {
		t.Fatalf("SetAgent(claude): %v", err)
	}
	previousMHL := app.mhl

	if _, err := app.SetAgent("gpt5"); err == nil {
		t.Fatal("SetAgent(gpt5) succeeded, want an error for an unknown agent")
	}

	if got := app.GetAgent(); got != "claude" {
		t.Errorf("GetAgent() after a rejected SetAgent = %q, want the previous value %q unchanged", got, "claude")
	}
	if got := loadSettings().Agent; got != "claude" {
		t.Errorf("loadSettings().Agent after a rejected SetAgent = %q, want %q unchanged", got, "claude")
	}
	if app.mhl != previousMHL {
		t.Error("a rejected SetAgent touched the bridge — it should have failed before anything")
	}
}

// TestApp_SetAgent_RefusesWhileARunIsActive covers the guard SetAgent keeps
// even without restarting mhl: switching backends while a work-item
// generation is executing (state "working"/"queued") would make its
// remaining LLM calls on a different agent than its first ones. Starts a real run via app.mhl.RunStart (not
// StartRun/WatchRun — this needs the raw pre-poll status, the instant after
// mhl_run_start answers and before the step executor has necessarily
// finished) and asserts SetAgent refuses it in exactly that window.
func TestApp_SetAgent_RefusesWhileARunIsActive(t *testing.T) {
	app, _ := newTestApp(t)
	ctx := context.Background()

	status, err := app.mhl.RunStart(ctx, "WorkItem", map[string]any{"action": "list"})
	if err != nil {
		t.Fatalf("RunStart: %v", err)
	}
	if status.Terminal() {
		t.Skipf("run %s was already terminal (%q) by the time RunStart returned — nothing to assert, this workflow finished too fast to catch mid-flight", status.RunID, status.State)
	}
	previousMHL := app.mhl

	if _, err := app.SetAgent("claude"); err == nil {
		t.Fatalf("SetAgent(claude) succeeded while run %s was still %q, want it refused", status.RunID, status.State)
	}
	if app.mhl != previousMHL {
		t.Error("SetAgent reconnected the bridge anyway while a run was active — it should have refused before touching it")
	}

	// Drain the run so it doesn't leak past the test, then confirm the all-
	// clear: once nothing is active, switching must work again.
	if _, err := app.mhl.PollRunStatus(ctx, status.RunID, 50*time.Millisecond, nil); err != nil {
		t.Fatalf("PollRunStatus (draining %s): %v", status.RunID, err)
	}
	if _, err := app.SetAgent("claude"); err != nil {
		t.Fatalf("SetAgent(claude) after the run finished: %v", err)
	}
}

func TestApp_SetDevinModelPersistsWithoutReconnecting(t *testing.T) {
	app, _ := newTestApp(t)
	previousMHL := app.mhl

	costSummary := "$0.5 / 1M Input · $0.2 / 1M Cached input · $2.5 / 1M Output"
	statusJSON, err := app.SetDevinModel("swe-1-6-fast", costSummary)
	if err != nil {
		t.Fatalf("SetDevinModel: %v", err)
	}
	if app.GetDevinModel() != "swe-1-6-fast" {
		t.Errorf("GetDevinModel() = %q, want swe-1-6-fast", app.GetDevinModel())
	}
	if app.GetDevinCostSummary() != costSummary {
		t.Errorf("GetDevinCostSummary() = %q, want %q", app.GetDevinCostSummary(), costSummary)
	}
	if got := loadSettings().DevinModel; got != "swe-1-6-fast" {
		t.Errorf("persisted DevinModel = %q, want swe-1-6-fast", got)
	}
	if got := loadSettings().DevinCostSummary; got != costSummary {
		t.Errorf("persisted DevinCostSummary = %q, want %q", got, costSummary)
	}
	if got := readAgentConfig(t, app.DataDir()).DevinPricing; got != devinPricingJSON("swe-1-6-fast", costSummary) || got == "" {
		t.Errorf("%s devin_pricing = %q, want the parsed pricing of the cost summary", agentConfigFile, got)
	}
	if app.mhl != previousMHL {
		t.Error("SetDevinModel restarted the mhl bridge — the switch must only rewrite the agent config file")
	}
	if got := readAgentConfig(t, app.DataDir()).DevinModel; got != "swe-1-6-fast" {
		t.Errorf("%s DevinModel = %q, want swe-1-6-fast", agentConfigFile, got)
	}
	var status struct {
		Ready bool `json:"ready"`
	}
	if err := json.Unmarshal([]byte(statusJSON), &status); err != nil || !status.Ready {
		t.Errorf("SetDevinModel status = %q, want ready bridge (decode error: %v)", statusJSON, err)
	}
}

func TestApp_SetCodexModelPersistsWithoutReconnecting(t *testing.T) {
	app, _ := newTestApp(t)
	previousMHL := app.mhl

	statusJSON, err := app.SetCodexModel("gpt-5.5")
	if err != nil {
		t.Fatalf("SetCodexModel: %v", err)
	}
	if app.GetCodexModel() != "gpt-5.5" {
		t.Errorf("GetCodexModel() = %q, want gpt-5.5", app.GetCodexModel())
	}
	if got := loadSettings().CodexModel; got != "gpt-5.5" {
		t.Errorf("persisted CodexModel = %q, want gpt-5.5", got)
	}
	if app.mhl != previousMHL {
		t.Error("SetCodexModel restarted the mhl bridge — the switch must only rewrite the agent config file")
	}
	if got := readAgentConfig(t, app.DataDir()).CodexModel; got != "gpt-5.5" {
		t.Errorf("%s CodexModel = %q, want gpt-5.5", agentConfigFile, got)
	}
	var status struct {
		Ready bool `json:"ready"`
	}
	if err := json.Unmarshal([]byte(statusJSON), &status); err != nil || !status.Ready {
		t.Errorf("SetCodexModel status = %q, want ready bridge (decode error: %v)", statusJSON, err)
	}
}

func TestApp_SetCodexModelRejectsAnEmptyValue(t *testing.T) {
	app, _ := newTestApp(t)
	if _, err := app.SetCodexModel("  "); err == nil {
		t.Fatal("SetCodexModel(\"  \") succeeded, want an error for an empty model")
	}
}

func TestApp_SetClaudeModelPersistsWithoutReconnecting(t *testing.T) {
	app, _ := newTestApp(t)
	previousMHL := app.mhl

	statusJSON, err := app.SetClaudeModel("opus")
	if err != nil {
		t.Fatalf("SetClaudeModel: %v", err)
	}
	if app.GetClaudeModel() != "opus" {
		t.Errorf("GetClaudeModel() = %q, want opus", app.GetClaudeModel())
	}
	if got := loadSettings().ClaudeModel; got != "opus" {
		t.Errorf("persisted ClaudeModel = %q, want opus", got)
	}
	if app.mhl != previousMHL {
		t.Error("SetClaudeModel restarted the mhl bridge — the switch must only rewrite the agent config file")
	}
	if got := readAgentConfig(t, app.DataDir()).ClaudeModel; got != "opus" {
		t.Errorf("%s ClaudeModel = %q, want opus", agentConfigFile, got)
	}
	var status struct {
		Ready bool `json:"ready"`
	}
	if err := json.Unmarshal([]byte(statusJSON), &status); err != nil || !status.Ready {
		t.Errorf("SetClaudeModel status = %q, want ready bridge (decode error: %v)", statusJSON, err)
	}
}

func TestApp_SetClaudeModelRejectsAnEmptyValue(t *testing.T) {
	app, _ := newTestApp(t)
	if _, err := app.SetClaudeModel(""); err == nil {
		t.Fatal("SetClaudeModel(\"\") succeeded, want an error for an empty model")
	}
}

// TestApp_ListClaudeModelsNeverCallsOutToACLI is the behavioral contract
// that matters here: unlike ListDevinModels/ListCodexModels, this must
// succeed even with no `claude` binary on PATH and no network — it's a
// fixed catalog (see listClaudeModels).
func TestApp_ListClaudeModelsNeverCallsOutToACLI(t *testing.T) {
	app, _ := newTestApp(t)
	body, err := app.ListClaudeModels()
	if err != nil {
		t.Fatalf("ListClaudeModels: %v", err)
	}
	var models []cliModel
	if err := json.Unmarshal([]byte(body), &models); err != nil {
		t.Fatalf("decode ListClaudeModels() = %q: %v", body, err)
	}
	if len(models) == 0 {
		t.Fatal("ListClaudeModels() returned no models")
	}
}

// TestApp_TailRunLogsSurvivesTheBridgeBeingReplaced is the regression test
// for the crash on "Reconectar": tailRunLogs used to re-read a.mhl on every
// tick, ReconnectMCP set it to nil while the new mhl started, and the next
// RunLogs call on that nil client panicked inside a background goroutine —
// taking the whole app down. The tail now keeps the client it started with
// (here already stopped, as after a reconnect) and must simply log the failed
// fetch and return.
func TestApp_TailRunLogsSurvivesTheBridgeBeingReplaced(t *testing.T) {
	app, _ := newTestApp(t)
	previous := app.mhl
	app.setBridge(nil)
	if err := previous.Stop(); err != nil {
		t.Fatalf("Stop: %v", err)
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		// pollingRuns has no entry for this run: one final fetch, then return.
		app.tailRunLogs(previous, "0123456789abcdef0123456789abcdef", "spec-tail-after-reconnect")
	}()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("tailRunLogs did not return after its client was stopped")
	}

	// A nil client (the exact state the old code read mid-reconnect) must
	// not crash either: recoverBackground catches the panic.
	app.tailRunLogs(nil, "0123456789abcdef0123456789abcdef", "spec-tail-after-reconnect")
}
