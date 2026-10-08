package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConvertHTMLSource_UsesTheMainContentAndTheDeclaredCharset(t *testing.T) {
	// Saved from a browser in ISO-8859-1: "Decisão" must come out as UTF-8.
	page := "<html><head><meta charset=\"iso-8859-1\"><title>Ata do comit\xea</title></head><body>" +
		"<nav>Menu</nav><main><h2>Decis\xe3o</h2><p>Fica decidido usar gRPC.</p></main></body></html>"
	path := writeTempFile(t, "ata.html", page)

	body, err := convertHTMLSource(path)
	if err != nil {
		t.Fatalf("convertHTMLSource: %v", err)
	}
	got := string(body)
	assertContains(t, got, "# Ata do comitê")
	assertContains(t, got, "> Fonte: pagina HTML (ata.html)")
	assertContains(t, got, "Decisão")
	assertContains(t, got, "Fica decidido usar gRPC.")
	if strings.Contains(got, "Menu") {
		t.Fatalf("navigation chrome must be dropped: %s", got)
	}
}

func TestConvertHTMLSource_RejectsAPageWithoutText(t *testing.T) {
	path := writeTempFile(t, "app.htm", "<html><body><div id=\"root\"></div><script>render()</script></body></html>")
	if _, err := convertHTMLSource(path); err == nil || !strings.Contains(err.Error(), "nenhum texto legivel") {
		t.Fatalf("expected a clear no-text error, got %v", err)
	}
}

// TestAddRawFile_ConvertsHTMLToMarkdown proves a local HTML page lands in
// raw/ as "<name>.md" (a format RawExtract reads), never as the .html.
func TestAddRawFile_ConvertsHTMLToMarkdown(t *testing.T) {
	app, _ := newTestApp(t)
	projectID := createTestProject(t, app, "AddRawFile html", "comite")

	src := writeTempFile(t, "Reuniao WAR.html", "<html><body><h1>Reunião WAR</h1><p>Acordamos o padrão de observabilidade.</p></body></html>")
	name, err := app.AddRawFile(projectID, src)
	if err != nil {
		t.Fatalf("AddRawFile: %v", err)
	}
	if name != "Reuniao WAR.html.md" {
		t.Fatalf("expected \"Reuniao WAR.html.md\", got %q", name)
	}
	rawDir := filepath.Join(app.DataDir(), "projects", projectID, "raw")
	got, err := os.ReadFile(filepath.Join(rawDir, name))
	if err != nil {
		t.Fatalf("read converted file: %v", err)
	}
	assertContains(t, string(got), "Acordamos o padrão de observabilidade.")
	if _, err := os.Stat(filepath.Join(rawDir, "Reuniao WAR.html")); !os.IsNotExist(err) {
		t.Fatalf("the original .html must not be copied into raw/ (stat err: %v)", err)
	}
}
