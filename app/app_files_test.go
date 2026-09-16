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

func writeTempFile(t *testing.T, name string, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write temp file: %v", err)
	}
	return path
}
