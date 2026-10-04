package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestNewRunLogMeta_KeepsIdentifyingArgsOnly(t *testing.T) {
	meta := newRunLogMeta("Discovery", map[string]any{
		"project_id": "wi_1", "artifact": "historias", "feature_id": "FT001",
		"feedback": "segredo do revisor", "approved": true, "buddy": true,
		"question": strings.Repeat("a", 200), "raw_paths": []any{"ata.pdf"},
	}, time.Date(2026, 10, 3, 12, 0, 0, 0, time.UTC))
	if meta.Workflow != "Discovery" || meta.Artifact != "historias" || meta.FeatureID != "FT001" || !meta.Approved {
		t.Fatalf("unexpected meta: %+v", meta)
	}
	if !meta.Feedback {
		t.Fatal("feedback presence lost")
	}
	body, _ := json.Marshal(meta)
	if strings.Contains(string(body), "segredo") {
		t.Fatalf("feedback text must not be persisted: %s", body)
	}
	if len([]rune(meta.Question)) != runLogMetaQuestionMax+1 {
		t.Fatalf("question not clipped: %d runes", len([]rune(meta.Question)))
	}
	if len(meta.RawPaths) != 1 || meta.StartedAt != "2026-10-03T12:00:00Z" {
		t.Fatalf("unexpected meta: %+v", meta)
	}
}

// A listed run carries its meta when there is one, else the step names
// read from its log.
func TestListProjectRunLogs_TitlesFromMetaOrSteps(t *testing.T) {
	t.Setenv("SENPAI_APPDATA_DIR", t.TempDir())
	app := &App{}
	app.writeRunLogMeta("wi_1", "run_new", "Wiki", map[string]any{"action": "lint"})
	dataDir, _ := app.resolvedDataDir()
	newLog, _ := runLogFilePath(dataDir, "wi_1", "run_new")
	oldLog, _ := runLogFilePath(dataDir, "wi_1", "run_old")
	if err := appendToFile(newLog, "session: x\nstep: Lint\n"); err != nil {
		t.Fatal(err)
	}
	if err := appendToFile(oldLog, "session: y\nstep: Dispatch\nstep: SyncHtml\nstep: Done\nstep: Done\n"); err != nil {
		t.Fatal(err)
	}
	app.dataDir = dataDir
	body, err := app.ListProjectRunLogs("wi_1")
	if err != nil {
		t.Fatal(err)
	}
	var entries []projectRunLogEntry
	if err := json.Unmarshal([]byte(body), &entries); err != nil {
		t.Fatal(err)
	}
	byID := map[string]projectRunLogEntry{}
	for _, e := range entries {
		byID[e.RunID] = e
	}
	if len(entries) != 2 {
		t.Fatalf("meta file listed as a run: %s", body)
	}
	if m := byID["run_new"].Meta; m == nil || m.Workflow != "Wiki" || m.Action != "lint" {
		t.Fatalf("meta missing: %s", body)
	}
	if got := strings.Join(byID["run_old"].Steps, ","); got != "Dispatch,SyncHtml,Done" {
		t.Fatalf("steps = %q", got)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "projects", "wi_1", "run_logs", "run_new.meta.json")); err != nil {
		t.Fatal(err)
	}
}
