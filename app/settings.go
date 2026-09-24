package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// validAgents mirrors workflows/shared/agents/agents.mh's AgentSelector —
// "" (unset) lets mhl fall back to its own default (currently "codex", see
// AgentSelector.pick's env("SENPAI_AGENT", "codex")) rather than this app
// hard-coding what that default is, so the two never drift apart.
var validAgents = map[string]bool{"": true, "codex": true, "claude": true, "devin": true}

// appSettings is this app's own (not mhl's) persisted preferences: the LLM
// backend, the selected Devin model and the pricing snapshot published for
// that selection.
type appSettings struct {
	Agent            string `json:"agent,omitempty"`
	DevinModel       string `json:"devin_model,omitempty"`
	DevinCostSummary string `json:"devin_cost_summary,omitempty"`
}

// settingsFilePath is <senpaiBaseDir>/settings.json — a sibling of state/,
// data/, logs/, codex-cwd/, embedded/ (see senpaiSubdir), but not itself
// one of those subdirectories: it's this app's own preference, not
// something mhl reads or writes.
func settingsFilePath() (string, error) {
	base, err := senpaiBaseDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "settings.json"), nil
}

// loadSettings reads settingsFilePath(), defaulting to the zero value
// (appSettings{}, i.e. every setting unset) when the file is missing,
// unreadable, or malformed — a fresh install, or a settings.json from a
// future version this one doesn't fully understand, should never fail
// startup over a preferences file.
func loadSettings() appSettings {
	path, err := settingsFilePath()
	if err != nil {
		return appSettings{}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return appSettings{}
	}
	var s appSettings
	if json.Unmarshal(data, &s) != nil {
		return appSettings{}
	}
	return s
}

func saveSettings(s appSettings) error {
	path, err := settingsFilePath()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}
