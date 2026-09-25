package main

import (
	"context"
	"encoding/json"
	"os"
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

func TestParseDevinPricingRejectsPartialOrUnknownPricing(t *testing.T) {
	for _, summary := range []string{
		"", "$0.5 / 1M Input", "Included in plan",
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
// to settings.json, then actually reconnect the mhl bridge (a fresh process
// is the only way SENPAI_AGENT — read once at mhl's own startup — can pick
// up a new value). newTestApp starts a real bridge, so this proves the
// whole round trip, not just the file write.
func TestApp_SetAgent(t *testing.T) {
	app, _ := newTestApp(t)

	if got := app.GetAgent(); got != "" {
		t.Fatalf("GetAgent() before any SetAgent = %q, want \"\" (nothing chosen yet)", got)
	}

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
		t.Errorf("SetAgent(claude) reconnected but bridge reports ready=false: %s", statusJSON)
	}
	if got := app.GetAgent(); got != "claude" {
		t.Errorf("GetAgent() after SetAgent(claude) = %q, want %q", got, "claude")
	}
	if got := loadSettings().Agent; got != "claude" {
		t.Errorf("loadSettings().Agent after SetAgent(claude) = %q, want %q (not persisted)", got, "claude")
	}

	// Switching again reconnects a second time — the bridge must still come
	// back up, not just the first switch.
	if _, err := app.SetAgent("codex"); err != nil {
		t.Fatalf("SetAgent(codex): %v", err)
	}
	if got := app.GetAgent(); got != "codex" {
		t.Errorf("GetAgent() after SetAgent(codex) = %q, want %q", got, "codex")
	}
}

func TestApp_SetAgent_RejectsAnUnknownAgentWithoutPersistingOrReconnecting(t *testing.T) {
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
		t.Error("a rejected SetAgent reconnected the bridge anyway — it should have failed before touching it")
	}
}

// TestApp_SetAgent_RefusesWhileARunIsActive is the regression test for the
// fragility this guard exists to close: SetAgent used to reconnect
// unconditionally, and reconnecting kills the mhl child process outright
// (mhlbridge.Client.Stop -> terminate, no graceful drain) — so switching
// backends while a work-item generation was actually executing (state
// "working"/"queued") killed that in-flight LLM call with nothing to
// recover it automatically. Starts a real run via app.mhl.RunStart (not
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

func TestApp_SetDevinModelPersistsAndReconnects(t *testing.T) {
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
	if app.mhl == previousMHL {
		t.Error("SetDevinModel did not reconnect the bridge")
	}
	var status struct {
		Ready bool `json:"ready"`
	}
	if err := json.Unmarshal([]byte(statusJSON), &status); err != nil || !status.Ready {
		t.Errorf("SetDevinModel status = %q, want ready bridge (decode error: %v)", statusJSON, err)
	}
}
