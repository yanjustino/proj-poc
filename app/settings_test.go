package main

import (
	"encoding/json"
	"os"
	"testing"
)

func TestSettingsRoundTrips(t *testing.T) {
	t.Setenv("SENPAI_APPDATA_DIR", t.TempDir())

	if got := loadSettings(); got != (appSettings{}) {
		t.Fatalf("loadSettings() before any save = %+v, want zero value", got)
	}

	if err := saveSettings(appSettings{Agent: "claude"}); err != nil {
		t.Fatalf("saveSettings: %v", err)
	}
	if got := loadSettings(); got.Agent != "claude" {
		t.Errorf("loadSettings().Agent = %q, want %q", got.Agent, "claude")
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
