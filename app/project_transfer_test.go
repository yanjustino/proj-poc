package main

import (
	"archive/zip"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func seedTransferProject(t *testing.T, dataDir string, projectID string) string {
	t.Helper()
	projectDir := filepath.Join(dataDir, "projects", projectID)
	files := map[string]string{
		"project.json":                     `{"archived":false,"id":"` + projectID + `","level":"delivery","name":"Checkout","type":"feature"}`,
		".index-state.json":                `{"concepts":[]}`,
		"changes.jsonl":                    "{\"a\":1}\n",
		"activity.jsonl":                   "{\"b\":2}\n",
		"usage.jsonl":                      "{\"value\":{\"tokens_in\":10}}\n",
		"prompt_log.jsonl":                 "segredo\n",
		"run_logs/r1.log":                  "log\n",
		"raw/fonte.md":                     "# Fonte\n",
		"wiki/entities/cliente.md":         "# Cliente\n",
		"artifacts/features/checkout.html": "<h1>Checkout</h1>",
	}
	for name, content := range files {
		full := filepath.Join(projectDir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	return projectDir
}

func zipNames(t *testing.T, zipPath string) map[string]bool {
	t.Helper()
	reader, err := zip.OpenReader(zipPath)
	if err != nil {
		t.Fatalf("open zip: %v", err)
	}
	defer reader.Close()
	names := map[string]bool{}
	for _, f := range reader.File {
		names[f.Name] = true
	}
	return names
}

func TestExportProjectToWritesZipWithUsageAndWithoutPromptsOrRunLogs(t *testing.T) {
	dataDir := t.TempDir()
	app := &App{dataDir: dataDir}
	seedTransferProject(t, dataDir, "export-test")

	destinationParent := t.TempDir()
	exported, err := app.exportProjectTo("export-test", destinationParent)
	if err != nil {
		t.Fatalf("exportProjectTo: %v", err)
	}
	if filepath.Base(exported) != "senpai-export-test.zip" {
		t.Fatalf("unexpected export file: %s", exported)
	}
	names := zipNames(t, exported)
	for _, want := range []string{
		"senpai-export.json", "project.json", ".index-state.json", "changes.jsonl", "activity.jsonl", "usage.jsonl",
		"raw/fonte.md", "wiki/entities/cliente.md", "artifacts/features/checkout.html",
	} {
		if !names[want] {
			t.Errorf("zip is missing %s", want)
		}
	}
	for _, unwanted := range []string{"prompt_log.jsonl", "run_logs/r1.log"} {
		if names[unwanted] {
			t.Errorf("zip must not contain %s", unwanted)
		}
	}

	second, err := app.exportProjectTo("export-test", destinationParent)
	if err != nil {
		t.Fatalf("second exportProjectTo: %v", err)
	}
	if filepath.Base(second) != "senpai-export-test (2).zip" {
		t.Fatalf("second export should not overwrite the first: %s", second)
	}
}

func TestImportProjectRoundTripIntoEmptyDataDir(t *testing.T) {
	source := &App{dataDir: t.TempDir()}
	seedTransferProject(t, source.dataDir, "round-trip")
	zipPath, err := source.exportProjectTo("round-trip", t.TempDir())
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	target := &App{dataDir: t.TempDir()}
	result, err := target.importProjectFrom(zipPath)
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if result.ProjectID != "round-trip" || result.Copied {
		t.Fatalf("unexpected result: %+v", result)
	}
	for name, want := range map[string]string{
		"usage.jsonl":                      "{\"value\":{\"tokens_in\":10}}\n",
		"raw/fonte.md":                     "# Fonte\n",
		"artifacts/features/checkout.html": "<h1>Checkout</h1>",
	} {
		got, err := os.ReadFile(filepath.Join(target.dataDir, "projects", "round-trip", filepath.FromSlash(name)))
		if err != nil || string(got) != want {
			t.Errorf("%s = %q, %v; want %q", name, got, err, want)
		}
	}
	entries, _ := os.ReadDir(filepath.Join(target.dataDir, "projects"))
	if len(entries) != 1 {
		t.Fatalf("staging directory left behind: %v", entries)
	}
}

func TestImportProjectCopiesWhenIDAlreadyExists(t *testing.T) {
	app := &App{dataDir: t.TempDir()}
	original := seedTransferProject(t, app.dataDir, "dup")
	zipPath, err := app.exportProjectTo("dup", t.TempDir())
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	result, err := app.importProjectFrom(zipPath)
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if !result.Copied || result.ProjectID == "dup" || result.OriginalID != "dup" {
		t.Fatalf("expected a copy under a new id: %+v", result)
	}
	content, err := os.ReadFile(filepath.Join(app.dataDir, "projects", result.ProjectID, "project.json"))
	if err != nil {
		t.Fatalf("read copy project.json: %v", err)
	}
	var record map[string]any
	if err := json.Unmarshal(content, &record); err != nil || record["id"] != result.ProjectID || !strings.HasSuffix(record["name"].(string), "(importado)") {
		t.Fatalf("copy project.json not rewritten: %s (%v)", content, err)
	}
	if got, _ := os.ReadFile(filepath.Join(original, "project.json")); !strings.Contains(string(got), `"id":"dup"`) {
		t.Fatalf("original project was modified: %s", got)
	}
}

func writeTestZip(t *testing.T, entries map[string]string) string {
	t.Helper()
	zipPath := filepath.Join(t.TempDir(), "pkg.zip")
	out, err := os.Create(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(out)
	for name, content := range entries {
		w, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write([]byte(content))
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	_ = out.Close()
	return zipPath
}

func TestImportProjectRejectsBadPackages(t *testing.T) {
	const emptySum = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
	cases := map[string]map[string]string{
		"sem manifesto": {"project.json": "{}"},
		"caminho com ..": {
			"senpai-export.json": `{"format_version":1,"project_id":"x","files":[{"path":"wiki/../../evil","sha256":"` + emptySum + `"}]}`,
		},
		"caminho com barra invertida": {
			"senpai-export.json": `{"format_version":1,"project_id":"x","files":[{"path":"wiki/..\\evil","sha256":"` + emptySum + `"}]}`,
		},
		"arquivo fora da allowlist": {
			"senpai-export.json": `{"format_version":1,"project_id":"x","files":[{"path":"prompt_log.jsonl","sha256":"` + emptySum + `"}]}`,
		},
		"versao futura": {
			"senpai-export.json": `{"format_version":99,"project_id":"x","files":[]}`,
		},
		"checksum errado": {
			"senpai-export.json": `{"format_version":1,"project_id":"x","files":[{"path":"project.json","sha256":"` + emptySum + `"}]}`,
			"project.json":       `{"id":"x","name":"n"}`,
		},
		"arquivo fora do manifesto": {
			"senpai-export.json": `{"format_version":1,"project_id":"x","files":[{"path":"project.json","sha256":"` + emptySum + `"}]}`,
			"project.json":       "",
			"wiki/extra.md":      "x",
		},
	}
	for name, entries := range cases {
		t.Run(name, func(t *testing.T) {
			app := &App{dataDir: t.TempDir()}
			if _, err := app.importProjectFrom(writeTestZip(t, entries)); err == nil {
				t.Fatal("expected the package to be rejected")
			}
			leftovers, _ := os.ReadDir(filepath.Join(app.dataDir, "projects"))
			if len(leftovers) != 0 {
				t.Fatalf("rejected import left files behind: %v", leftovers)
			}
		})
	}
}
