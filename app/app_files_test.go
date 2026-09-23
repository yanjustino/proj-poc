package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// createTestProject creates a disposable work-item through the real
// WorkItem workflow (same mechanism app_test.go already uses) and returns
// its project_id — the file-access bindings below only ever operate under
// projects/<that id>/..., never a hand-rolled path.
func createTestProject(t *testing.T, app *App, name string, itemType string) string {
	t.Helper()
	args, err := json.Marshal(map[string]any{
		"action":    "create",
		"name":      name,
		"item_type": itemType,
	})
	if err != nil {
		t.Fatalf("marshal create args: %v", err)
	}
	body, err := app.StartRun("WorkItem", string(args))
	if err != nil {
		t.Fatalf("StartRun(WorkItem create): %v", err)
	}
	runID := requireField(t, body, "runId")
	final := pollUntilTerminal(t, app, runID, 10*time.Second)
	projectID := requireNestedField(t, final, "vars", "project", "id")
	if projectID == "" {
		t.Fatalf("could not read the new work-item's id from: %s", final)
	}
	return projectID
}

// TestAddRawFile_HappyPathAndDedup proves a real file lands under
// projects/<id>/raw/<basename>, and that a second upload with the same
// basename is renamed instead of overwriting the first.
func TestAddRawFile_HappyPathAndDedup(t *testing.T) {
	app, _ := newTestApp(t)
	projectID := createTestProject(t, app, "Fase6 AddRawFile happy path", "historia")

	src := writeTempFile(t, "nota.md", "# Nota\n\nconteudo original\n")
	name, err := app.AddRawFile(projectID, src)
	if err != nil {
		t.Fatalf("AddRawFile: %v", err)
	}
	if name != "nota.md" {
		t.Fatalf("expected basename \"nota.md\", got %q", name)
	}
	got, err := os.ReadFile(filepath.Join(app.DataDir(), "projects", projectID, "raw", "nota.md"))
	if err != nil {
		t.Fatalf("read copied file: %v", err)
	}
	if string(got) != "# Nota\n\nconteudo original\n" {
		t.Fatalf("copied content mismatch: %q", got)
	}

	src2 := writeTempFile(t, "nota.md", "# Nota\n\nconteudo diferente\n")
	name2, err := app.AddRawFile(projectID, src2)
	if err != nil {
		t.Fatalf("AddRawFile (dedup): %v", err)
	}
	if name2 == "nota.md" {
		t.Fatalf("expected a de-duplicated name, got the same %q — first file may have been overwritten", name2)
	}
	if !strings.HasPrefix(name2, "nota (") {
		t.Fatalf("expected a \"nota (N).md\"-shaped name, got %q", name2)
	}
	original, err := os.ReadFile(filepath.Join(app.DataDir(), "projects", projectID, "raw", "nota.md"))
	if err != nil {
		t.Fatalf("re-read original file: %v", err)
	}
	if string(original) != "# Nota\n\nconteudo original\n" {
		t.Fatalf("original file was overwritten by the second upload: %q", original)
	}
}

// TestAddRawFile_RejectsInvalidProjectID proves the same project_id
// validation Paths.is_valid_id enforces on the MHL side is also enforced
// here in Go, independently — AddRawFile must never write outside
// projects/<valid-id>/raw/.
func TestAddRawFile_RejectsInvalidProjectID(t *testing.T) {
	app, _ := newTestApp(t)
	src := writeTempFile(t, "nota.md", "conteudo")

	for _, badID := range []string{"../escape", "a/b", "", strings.Repeat("x", 200)} {
		if _, err := app.AddRawFile(badID, src); err == nil {
			t.Fatalf("AddRawFile(%q, ...): expected error, got none", badID)
		}
	}
}

func TestListAndReadProjectDir_HappyPath(t *testing.T) {
	app, _ := newTestApp(t)
	projectID := createTestProject(t, app, "Fase6 list/read happy path", "historia")

	wikiDir := filepath.Join(app.DataDir(), "projects", projectID, "wiki", "entities")
	if err := os.MkdirAll(wikiDir, 0o755); err != nil {
		t.Fatalf("mkdir wiki/entities: %v", err)
	}
	if err := os.WriteFile(filepath.Join(app.DataDir(), "projects", projectID, "wiki", "index.md"), []byte("# Indice\n"), 0o644); err != nil {
		t.Fatalf("write index.md: %v", err)
	}
	if err := os.WriteFile(filepath.Join(wikiDir, "time-x.md"), []byte("# Time X\n"), 0o644); err != nil {
		t.Fatalf("write entity page: %v", err)
	}

	listing, err := app.ListProjectDir(projectID, "wiki", "")
	if err != nil {
		t.Fatalf("ListProjectDir: %v", err)
	}
	var nodes []map[string]any
	if err := json.Unmarshal([]byte(listing), &nodes); err != nil {
		t.Fatalf("listing is not valid JSON: %v\n%s", err, listing)
	}
	if len(nodes) == 0 {
		t.Fatalf("expected at least index.md and entities/, got empty listing")
	}
	foundEntitiesDir := false
	for _, n := range nodes {
		if n["name"] == "entities" && n["isDir"] == true {
			foundEntitiesDir = true
		}
	}
	if !foundEntitiesDir {
		t.Fatalf("expected an \"entities\" directory node in listing: %s", listing)
	}

	content, err := app.ReadProjectFile(projectID, "wiki", "index.md")
	if err != nil {
		t.Fatalf("ReadProjectFile: %v", err)
	}
	if content != "# Indice\n" {
		t.Fatalf("unexpected content: %q", content)
	}

	nested, err := app.ReadProjectFile(projectID, "wiki", "entities/time-x.md")
	if err != nil {
		t.Fatalf("ReadProjectFile (nested): %v", err)
	}
	if nested != "# Time X\n" {
		t.Fatalf("unexpected nested content: %q", nested)
	}
}

func TestListProjectDir_MissingDirReturnsEmptyArray(t *testing.T) {
	app, _ := newTestApp(t)
	projectID := createTestProject(t, app, "Fase6 empty listing", "historia")

	// "raw" isn't touched by the Fase 7 mermaid-asset seeding (that's
	// artifacts-only, see below) — still genuinely empty until something
	// writes to it.
	listing, err := app.ListProjectDir(projectID, "raw", "")
	if err != nil {
		t.Fatalf("ListProjectDir on a not-yet-created raw/: %v", err)
	}
	if strings.TrimSpace(listing) != "[]" {
		t.Fatalf("expected \"[]\" for a missing directory, got: %s", listing)
	}
}

// TestListProjectDir_SeedsMermaidAssetOnFirstArtifactsTouch is Fase 7
// behavior: the first time anything lists/reads under a project's
// artifacts/ — even before a single artifact has been generated —
// ensureArtifactMermaidAsset (embedded_extract.go) writes
// artifacts/assets/mermaid.min.js, so a diagram/DER artifact generated
// later still renders when the .html is opened outside the app (§3.5 of
// the plan). This deliberately supersedes the old "artifacts/ lists empty
// before anything is generated" expectation.
func TestListProjectDir_SeedsMermaidAssetOnFirstArtifactsTouch(t *testing.T) {
	app, _ := newTestApp(t)
	projectID := createTestProject(t, app, "Fase7 mermaid asset seeding", "historia")

	listing, err := app.ListProjectDir(projectID, "artifacts", "")
	if err != nil {
		t.Fatalf("ListProjectDir(artifacts): %v", err)
	}
	var nodes []map[string]any
	if err := json.Unmarshal([]byte(listing), &nodes); err != nil {
		t.Fatalf("listing is not valid JSON: %v\n%s", err, listing)
	}
	if len(nodes) != 1 || nodes[0]["name"] != "assets" {
		t.Fatalf("expected only an \"assets\" node before any artifact is generated, got: %s", listing)
	}

	content, err := app.ReadProjectFile(projectID, "artifacts", "assets/mermaid.min.js")
	if err != nil {
		t.Fatalf("ReadProjectFile(assets/mermaid.min.js): %v", err)
	}
	if len(content) == 0 {
		t.Fatal("expected non-empty vendored mermaid.min.js content")
	}

	// Idempotent: touching artifacts/ again must not error or duplicate
	// anything (extractIfChanged skips the rewrite once content matches).
	if _, err := app.ListProjectDir(projectID, "artifacts", ""); err != nil {
		t.Fatalf("second ListProjectDir(artifacts): %v", err)
	}
}

// TestListProjectRunLogs_MissingDirReturnsEmptyArray mirrors
// TestListProjectDir_MissingDirReturnsEmptyArray above — a work-item that
// has never had a run's log persisted yet (no run_logs/ directory at all)
// must list as "[]", not error.
func TestListProjectRunLogs_MissingDirReturnsEmptyArray(t *testing.T) {
	app, _ := newTestApp(t)
	projectID := createTestProject(t, app, "Logs tab empty listing", "historia")

	listing, err := app.ListProjectRunLogs(projectID)
	if err != nil {
		t.Fatalf("ListProjectRunLogs on a not-yet-created run_logs/: %v", err)
	}
	if strings.TrimSpace(listing) != "[]" {
		t.Fatalf("expected \"[]\" for a missing directory, got: %s", listing)
	}
}

// TestListProjectRunLogs_ListsPersistedRunsNewestFirst seeds two persisted
// run logs the same way tailRunLogs itself writes them (runLogFilePath +
// appendToFile) rather than orchestrating two real long-running generations
// just to get files on disk, then proves ListProjectRunLogs finds both,
// newest-modified first, with sizes that actually match what was written —
// and that ReadPersistedRunLogs (the pair this listing exists to make
// discoverable) reads the exact content back.
func TestListProjectRunLogs_ListsPersistedRunsNewestFirst(t *testing.T) {
	app, _ := newTestApp(t)
	projectID := createTestProject(t, app, "Logs tab listing", "historia")

	older, err := runLogFilePath(app.dataDir, projectID, "run-older")
	if err != nil {
		t.Fatalf("runLogFilePath(run-older): %v", err)
	}
	if err := appendToFile(older, "passo 1\n"); err != nil {
		t.Fatalf("seed older log: %v", err)
	}
	time.Sleep(10 * time.Millisecond) // garante um mtime distinto do próximo
	newer, err := runLogFilePath(app.dataDir, projectID, "run-newer")
	if err != nil {
		t.Fatalf("runLogFilePath(run-newer): %v", err)
	}
	if err := appendToFile(newer, "passo 1\npasso 2\n"); err != nil {
		t.Fatalf("seed newer log: %v", err)
	}

	listing, err := app.ListProjectRunLogs(projectID)
	if err != nil {
		t.Fatalf("ListProjectRunLogs: %v", err)
	}
	var entries []struct {
		RunID      string `json:"runId"`
		SizeBytes  int64  `json:"sizeBytes"`
		ModifiedAt string `json:"modifiedAt"`
	}
	if err := json.Unmarshal([]byte(listing), &entries); err != nil {
		t.Fatalf("listing is not valid JSON: %v\n%s", err, listing)
	}
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %d: %s", len(entries), listing)
	}
	if entries[0].RunID != "run-newer" || entries[1].RunID != "run-older" {
		t.Fatalf("expected newest-first order [run-newer, run-older], got [%s, %s]", entries[0].RunID, entries[1].RunID)
	}
	if entries[0].SizeBytes == 0 || entries[1].SizeBytes == 0 {
		t.Fatalf("expected non-zero sizes, got: %s", listing)
	}
	for _, e := range entries {
		if _, err := time.Parse(time.RFC3339, e.ModifiedAt); err != nil {
			t.Errorf("modifiedAt %q is not RFC3339: %v", e.ModifiedAt, err)
		}
	}

	content, err := app.ReadPersistedRunLogs(projectID, "run-newer")
	if err != nil {
		t.Fatalf("ReadPersistedRunLogs(run-newer): %v", err)
	}
	if content != "passo 1\npasso 2\n" {
		t.Fatalf("ReadPersistedRunLogs(run-newer) = %q, want the seeded content", content)
	}
}

// TestListProjectRunLogs_RejectsInvalidProjectID is the same malicious-input
// discipline TestProjectFileAccess_RejectsPathTraversal below requires of
// every project-scoped file accessor.
func TestListProjectRunLogs_RejectsInvalidProjectID(t *testing.T) {
	app, _ := newTestApp(t)
	if _, err := app.ListProjectRunLogs("../escape"); err == nil {
		t.Fatal(`ListProjectRunLogs("../escape") succeeded, want a rejection`)
	}
}

// TestProjectFileAccess_RejectsPathTraversal is the malicious-input
// counterpart required by this project's own testing convention (see
// workflows/shared/core/paths.mh) — every one of these must fail closed, never
// silently resolve outside projects/<projectID>/.
func TestProjectFileAccess_RejectsPathTraversal(t *testing.T) {
	app, _ := newTestApp(t)
	projectID := createTestProject(t, app, "Fase6 traversal attacks", "historia")

	attacks := []string{
		"../../../../etc/passwd",
		"../raw/segredo.md",
		"/etc/passwd",
		"..",
	}

	for _, attack := range attacks {
		if _, err := app.ReadProjectFile(projectID, "wiki", attack); err == nil {
			t.Fatalf("ReadProjectFile(wiki, %q): expected error, got none", attack)
		}
		if _, err := app.ListProjectDir(projectID, "wiki", attack); err == nil {
			t.Fatalf("ListProjectDir(wiki, %q): expected error, got none", attack)
		}
	}

	// root outside the allowlist for each method.
	if _, err := app.ReadProjectFile(projectID, "raw", "qualquer.md"); err == nil {
		t.Fatal("ReadProjectFile(root=\"raw\", ...): expected error (raw is list-only), got none")
	}
	if _, err := app.ListProjectDir(projectID, "../projects", ""); err == nil {
		t.Fatal("ListProjectDir(root=\"../projects\", ...): expected error, got none")
	}

	// escaping via project_id itself, not just the relative path.
	if _, err := app.ListProjectDir("../"+projectID, "wiki", ""); err == nil {
		t.Fatal("ListProjectDir with a traversal project_id: expected error, got none")
	}
	if _, err := app.ReadProjectFile("../"+projectID, "wiki", "index.md"); err == nil {
		t.Fatal("ReadProjectFile with a traversal project_id: expected error, got none")
	}
}

func TestExportProjectToCopiesWikiAndArtifacts(t *testing.T) {
	dataDir := t.TempDir()
	app := &App{dataDir: dataDir}
	projectID := "export-test"
	projectDir := filepath.Join(dataDir, "projects", projectID)
	if err := os.MkdirAll(filepath.Join(projectDir, "wiki", "entities"), 0o755); err != nil {
		t.Fatalf("mkdir wiki: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(projectDir, "artifacts", "features"), 0o755); err != nil {
		t.Fatalf("mkdir artifacts: %v", err)
	}
	if err := os.WriteFile(filepath.Join(projectDir, "wiki", "entities", "cliente.md"), []byte("# Cliente\n"), 0o644); err != nil {
		t.Fatalf("write wiki page: %v", err)
	}
	if err := os.WriteFile(filepath.Join(projectDir, "artifacts", "features", "checkout.html"), []byte("<h1>Checkout</h1>"), 0o644); err != nil {
		t.Fatalf("write artifact: %v", err)
	}

	destinationParent := t.TempDir()
	exported, err := app.exportProjectTo(projectID, destinationParent)
	if err != nil {
		t.Fatalf("exportProjectTo: %v", err)
	}
	if filepath.Base(exported) != "senpai-"+projectID {
		t.Fatalf("unexpected export directory: %s", exported)
	}

	assertExported := func(relative string, want string) {
		t.Helper()
		got, err := os.ReadFile(filepath.Join(exported, relative))
		if err != nil {
			t.Fatalf("read exported %s: %v", relative, err)
		}
		if string(got) != want {
			t.Fatalf("exported %s = %q, want %q", relative, got, want)
		}
	}
	assertExported(filepath.Join("wiki", "entities", "cliente.md"), "# Cliente\n")
	assertExported(filepath.Join("artifacts", "features", "checkout.html"), "<h1>Checkout</h1>")

	second, err := app.exportProjectTo(projectID, destinationParent)
	if err != nil {
		t.Fatalf("second exportProjectTo: %v", err)
	}
	if filepath.Base(second) != "senpai-"+projectID+" (2)" {
		t.Fatalf("second export should not overwrite the first: %s", second)
	}
}

func TestExportProjectToRejectsDestinationInsideArtifacts(t *testing.T) {
	dataDir := t.TempDir()
	app := &App{dataDir: dataDir}
	projectID := "export-recursion-test"
	artifactsDir := filepath.Join(dataDir, "projects", projectID, "artifacts")
	if err := os.MkdirAll(artifactsDir, 0o755); err != nil {
		t.Fatalf("mkdir artifacts: %v", err)
	}

	if _, err := app.exportProjectTo(projectID, artifactsDir); err == nil {
		t.Fatal("expected an error when exporting inside artifacts, got nil")
	}
}

func TestExportProjectToRejectsInvalidProjectID(t *testing.T) {
	app := &App{dataDir: t.TempDir()}
	if _, err := app.exportProjectTo("../escape", t.TempDir()); err == nil {
		t.Fatal("expected invalid project_id to be rejected")
	}
}

func writeTempFile(t *testing.T, name string, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write temp file: %v", err)
	}
	return path
}
