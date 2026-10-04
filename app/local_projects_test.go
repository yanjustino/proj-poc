package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func writeProjectFile(t *testing.T, dataDir, id, body string) {
	t.Helper()
	dir := filepath.Join(dataDir, "projects", id)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if body != "" {
		if err := os.WriteFile(filepath.Join(dir, "project.json"), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

// Same records and order as WorkItem's list: valid ids with a parseable
// project.json, oldest created_at first.
func TestReadLocalProjects_MirrorsWorkItemList(t *testing.T) {
	dataDir := t.TempDir()
	writeProjectFile(t, dataDir, "wi_b", `{"id":"wi_b","name":"B","created_at":"2026-02-01T10:00:00Z"}`)
	writeProjectFile(t, dataDir, "wi_a", `{"id":"wi_a","name":"A","created_at":"2026-01-01T10:00:00Z","archived":true}`)
	writeProjectFile(t, dataDir, "wi_empty", "")
	writeProjectFile(t, dataDir, "wi_broken", `{not json`)
	writeProjectFile(t, dataDir, "bad id", `{"id":"bad id"}`)

	projects, err := readLocalProjects(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(projects) != 2 || projects[0]["id"] != "wi_a" || projects[1]["id"] != "wi_b" {
		t.Fatalf("unexpected projects: %v", projects)
	}
	if projects[0]["archived"] != true {
		t.Fatalf("archived flag lost: %v", projects[0])
	}
}

func TestReadLocalProjects_NoProjectsDir(t *testing.T) {
	projects, err := readLocalProjects(t.TempDir())
	if err != nil || len(projects) != 0 {
		t.Fatalf("expected empty list, got %v (err %v)", projects, err)
	}
}

// Callable before startup() resolved a.dataDir — it falls back to the same
// <appdata>/data directory.
func TestLocalProjects_BeforeStartup(t *testing.T) {
	t.Setenv("SENPAI_APPDATA_DIR", t.TempDir())
	dataDir, err := senpaiSubdir("data")
	if err != nil {
		t.Fatal(err)
	}
	writeProjectFile(t, dataDir, "wi_1", `{"id":"wi_1","name":"Um","created_at":"2026-01-01T00:00:00Z"}`)

	body, err := (&App{}).LocalProjects()
	if err != nil {
		t.Fatal(err)
	}
	var projects []map[string]any
	if err := json.Unmarshal([]byte(body), &projects); err != nil || len(projects) != 1 || projects[0]["name"] != "Um" {
		t.Fatalf("unexpected body %s (err %v)", body, err)
	}
}

// Last activity is the newest mtime anywhere under the project; pending
// sources are raw/ files (dotfiles excluded) missing from .ingested.json.
func TestReadProjectActivity_LastChangeAndPendingSources(t *testing.T) {
	dataDir := t.TempDir()
	writeProjectFile(t, dataDir, "wi_a", `{"id":"wi_a"}`)
	projectDir := filepath.Join(dataDir, "projects", "wi_a")
	rawDir := filepath.Join(projectDir, "raw")
	if err := os.MkdirAll(rawDir, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"a.md", "b.pdf", "c.md"} {
		if err := os.WriteFile(filepath.Join(rawDir, name), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := writeIngestedRaw(rawDir, []string{"a.md"}); err != nil {
		t.Fatal(err)
	}
	old := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	recent := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	_ = filepath.Walk(projectDir, func(path string, _ os.FileInfo, _ error) error {
		return os.Chtimes(path, old, old)
	})
	if err := os.Chtimes(filepath.Join(rawDir, "c.md"), recent, recent); err != nil {
		t.Fatal(err)
	}

	activity := readProjectActivity(projectDir)
	if activity.PendingSources != 2 {
		t.Fatalf("pending = %d, want 2", activity.PendingSources)
	}
	if activity.LastActivity != recent.Format(time.RFC3339) {
		t.Fatalf("lastActivity = %q, want %q", activity.LastActivity, recent.Format(time.RFC3339))
	}
}
