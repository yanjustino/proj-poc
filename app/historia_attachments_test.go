package main

import (
	"os"
	"path/filepath"
	"testing"
)

// seedHistoria writes a historia.json at artifacts/<relative> so the
// attachment helpers accept it as an existing história.
func seedHistoria(t *testing.T, app *App, projectID string, relative string) string {
	t.Helper()
	dir := filepath.Join(app.DataDir(), "projects", projectID, "artifacts", filepath.FromSlash(relative))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("create historia dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "historia.json"), []byte("{}"), 0o644); err != nil {
		t.Fatalf("write historia.json: %v", err)
	}
	return dir
}

func TestAttachHistoriaFiles_CopiesDedupsAndRemoves(t *testing.T) {
	app, _ := newTestApp(t)
	projectID := createTestProject(t, app, "Anexos de historia", "historia")
	storyDir := seedHistoria(t, app, projectID, "historias/FT001-a/US001-x")

	first := writeTempFile(t, "dependencias.md", "fila de pagamentos")
	second := writeTempFile(t, "dependencias.md", "outra versao")
	names, err := app.attachHistoriaFilesFrom(projectID, "historias/FT001-a/US001-x", []string{first, second})
	if err != nil {
		t.Fatalf("attachHistoriaFilesFrom: %v", err)
	}
	if len(names) != 2 || names[0] != "dependencias.md" || names[1] != "dependencias (2).md" {
		t.Fatalf("unexpected stored names: %v", names)
	}
	got, err := os.ReadFile(filepath.Join(storyDir, "anexos", "dependencias.md"))
	if err != nil || string(got) != "fila de pagamentos" {
		t.Fatalf("copied content mismatch: %q (%v)", got, err)
	}

	for _, name := range names {
		if err := app.RemoveHistoriaAttachment(projectID, "historias/FT001-a/US001-x", name); err != nil {
			t.Fatalf("RemoveHistoriaAttachment(%q): %v", name, err)
		}
	}
	if _, err := os.Stat(filepath.Join(storyDir, "anexos")); !os.IsNotExist(err) {
		t.Fatalf("expected the empty anexos/ to be removed, stat err = %v", err)
	}
}

func TestAttachHistoriaFiles_RootStoryOfDelivery(t *testing.T) {
	app, _ := newTestApp(t)
	projectID := createTestProject(t, app, "Anexos historia unica", "historia")
	artifactsDir := seedHistoria(t, app, projectID, "")

	names, err := app.attachHistoriaFilesFrom(projectID, "", []string{writeTempFile(t, "contrato.pdf", "%PDF")})
	if err != nil || len(names) != 1 {
		t.Fatalf("attachHistoriaFilesFrom root: %v %v", names, err)
	}
	if _, err := os.Stat(filepath.Join(artifactsDir, "anexos", "contrato.pdf")); err != nil {
		t.Fatalf("expected artifacts/anexos/contrato.pdf: %v", err)
	}
}

func TestAttachHistoriaFiles_RejectsInvalidTargets(t *testing.T) {
	app, _ := newTestApp(t)
	projectID := createTestProject(t, app, "Anexos invalidos", "historia")
	seedHistoria(t, app, projectID, "historias/FT001-a/US001-x")
	src := writeTempFile(t, "nota.md", "x")

	for _, path := range []string{"historias/FT001-a/US009-nao-existe", "../escape", "historias/../../x", "wiki/index", "historias/a/b/c"} {
		if _, err := app.attachHistoriaFilesFrom(projectID, path, []string{src}); err == nil {
			t.Fatalf("attachHistoriaFilesFrom(%q): expected error, got none", path)
		}
	}
	if _, err := app.attachHistoriaFilesFrom(projectID, "historias/FT001-a/US001-x", []string{writeTempFile(t, ".oculto", "x")}); err == nil {
		t.Fatalf("expected a hidden file to be refused")
	}
	for _, name := range []string{"", "..", "../historia.json", "a/b"} {
		if err := app.RemoveHistoriaAttachment(projectID, "historias/FT001-a/US001-x", name); err == nil {
			t.Fatalf("RemoveHistoriaAttachment(%q): expected error, got none", name)
		}
	}
	if _, err := app.attachHistoriaFilesFrom("../escape", "historias/FT001-a/US001-x", []string{src}); err == nil {
		t.Fatalf("expected an invalid project id to be refused")
	}
}
