package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

// rebuildTestApp is an App over a temp data dir with one work-item whose raw/
// holds `files`, `ingested` of them marked as ingested (in that order).
func rebuildTestApp(t *testing.T, files []string, ingested []string) (*App, string) {
	t.Helper()
	app := &App{dataDir: t.TempDir()}
	rawDir := filepath.Join(app.dataDir, "projects", "wi_1", "raw")
	if err := os.MkdirAll(rawDir, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range files {
		if err := os.WriteFile(filepath.Join(rawDir, name), []byte("# "+name), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := writeIngestedRaw(rawDir, ingested); err != nil {
		t.Fatal(err)
	}
	return app, rawDir
}

func decodeStrings(t *testing.T, body string) []string {
	t.Helper()
	var names []string
	if err := json.Unmarshal([]byte(body), &names); err != nil {
		t.Fatalf("decode %q: %v", body, err)
	}
	return names
}

func TestMarkRawIngestedKeepsIngestOrder(t *testing.T) {
	app, _ := rebuildTestApp(t, []string{"b.md", "a.md"}, nil)
	if _, err := app.MarkRawIngested("wi_1", "b.md"); err != nil {
		t.Fatal(err)
	}
	body, err := app.MarkRawIngested("wi_1", "a.md")
	if err != nil {
		t.Fatal(err)
	}
	if got := decodeStrings(t, body); !slices.Equal(got, []string{"b.md", "a.md"}) {
		t.Fatalf("expected ingest order [b.md a.md], got %v", got)
	}
}

func TestRemoveRawSourceOfAPendingSourceLeavesTheWikiAlone(t *testing.T) {
	app, rawDir := rebuildTestApp(t, []string{"a.md", "b.md"}, []string{"a.md"})
	body, err := app.RemoveRawSource("wi_1", "b.md")
	if err != nil {
		t.Fatal(err)
	}
	var result removeRawResult
	if err := json.Unmarshal([]byte(body), &result); err != nil {
		t.Fatal(err)
	}
	if result.WasIngested || len(result.StaleSources) != 0 {
		t.Fatalf("a pending source must not flag the wiki: %+v", result)
	}
	if _, err := os.Stat(filepath.Join(rawDir, "b.md")); !os.IsNotExist(err) {
		t.Fatalf("b.md should be gone, stat err = %v", err)
	}
}

func TestRemoveRawSourceOfAnIngestedSourceFlagsTheWiki(t *testing.T) {
	app, rawDir := rebuildTestApp(t, []string{"a.md", "b.md"}, []string{"a.md", "b.md"})
	body, err := app.RemoveRawSource("wi_1", "a.md")
	if err != nil {
		t.Fatal(err)
	}
	var result removeRawResult
	if err := json.Unmarshal([]byte(body), &result); err != nil {
		t.Fatal(err)
	}
	if !result.WasIngested || !slices.Equal(result.StaleSources, []string{"a.md"}) {
		t.Fatalf("expected a.md flagged as stale, got %+v", result)
	}
	if ingested, _ := readIngestedRaw(rawDir); !slices.Equal(ingested, []string{"b.md"}) {
		t.Fatalf("a.md should leave the ingested list, got %v", ingested)
	}
	stale, err := app.WikiStaleSources("wi_1")
	if err != nil {
		t.Fatal(err)
	}
	if got := decodeStrings(t, stale); !slices.Equal(got, []string{"a.md"}) {
		t.Fatalf("WikiStaleSources = %v", got)
	}
}

func TestRemoveRawSourceRejectsBookkeepingAndTraversal(t *testing.T) {
	app, _ := rebuildTestApp(t, []string{"a.md"}, nil)
	for _, name := range []string{"", ".ingested.json", "../a.md", "x/a.md", "nao-existe.md"} {
		if _, err := app.RemoveRawSource("wi_1", name); err == nil {
			t.Fatalf("RemoveRawSource(%q) should fail", name)
		}
	}
	if _, err := app.RemoveRawSource("../wi_1", "a.md"); err == nil {
		t.Fatal("an invalid project id should fail")
	}
}

func TestResetIngestedRawReturnsTheSurvivingSourcesInIngestOrder(t *testing.T) {
	app, rawDir := rebuildTestApp(t, []string{"c.md", "a.md", "b.md", "nova.md"}, []string{"c.md", "a.md", "b.md"})
	if _, err := app.RemoveRawSource("wi_1", "a.md"); err != nil {
		t.Fatal(err)
	}
	body, err := app.ResetIngestedRaw("wi_1")
	if err != nil {
		t.Fatal(err)
	}
	if got := decodeStrings(t, body); !slices.Equal(got, []string{"c.md", "b.md"}) {
		t.Fatalf("expected [c.md b.md] (ingest order, removed and never-ingested left out), got %v", got)
	}
	if ingested, _ := readIngestedRaw(rawDir); len(ingested) != 0 {
		t.Fatalf("every source should be pending again, got %v", ingested)
	}
	if stale, _ := readWikiStale(rawDir); len(stale) != 0 {
		t.Fatalf("the stale list should be cleared, got %v", stale)
	}
}
