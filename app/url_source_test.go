package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const samplePage = `<!doctype html>
<html><head><title>Guia de Pagamentos</title><style>.x{}</style></head>
<body>
  <nav><a href="/">Menu que nao deve entrar</a></nav>
  <main>
    <h1>Pagamentos</h1>
    <p>O fluxo   de <strong>pagamento</strong> tem
       duas etapas.</p>
    <ul><li>Autorizar</li><li>Capturar</li></ul>
    <pre><code>POST /payments</code></pre>
    <script>alert("nao")</script>
  </main>
  <footer>Rodape</footer>
</body></html>`

func newURLSourceServer(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/page", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(samplePage))
	})
	mux.HandleFunc("/doc.pdf", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/pdf")
		_, _ = w.Write([]byte("%PDF-1.4 fake"))
	})
	mux.HandleFunc("/image.png", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte{0x89, 'P', 'N', 'G'})
	})
	mux.HandleFunc("/missing", http.NotFound)
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server
}

func TestHTMLToMarkdown_KeepsMainContentOnly(t *testing.T) {
	title, markdown, err := htmlToMarkdown(strings.NewReader(samplePage))
	if err != nil {
		t.Fatalf("htmlToMarkdown: %v", err)
	}
	if title != "Guia de Pagamentos" {
		t.Fatalf("unexpected title %q", title)
	}
	for _, want := range []string{"# Pagamentos", "O fluxo de pagamento tem duas etapas.", "- Autorizar", "- Capturar", "```\nPOST /payments\n```"} {
		if !strings.Contains(markdown, want) {
			t.Fatalf("markdown missing %q:\n%s", want, markdown)
		}
	}
	for _, unwanted := range []string{"Menu", "Rodape", "alert", ".x{}"} {
		if strings.Contains(markdown, unwanted) {
			t.Fatalf("markdown should not contain %q:\n%s", unwanted, markdown)
		}
	}
}

func TestAddRawURL_SavesHTMLAsMarkdown(t *testing.T) {
	server := newURLSourceServer(t)
	app, _ := newTestApp(t)
	projectID := createTestProject(t, app, "AddRawURL html", "historia")

	name, err := app.AddRawURL(projectID, server.URL+"/page", "")
	if err != nil {
		t.Fatalf("AddRawURL: %v", err)
	}
	if name != "Guia de Pagamentos.md" {
		t.Fatalf("unexpected basename %q", name)
	}
	got, err := os.ReadFile(filepath.Join(app.DataDir(), "projects", projectID, "raw", name))
	if err != nil {
		t.Fatalf("read saved source: %v", err)
	}
	if !strings.HasPrefix(string(got), "# Guia de Pagamentos\n\n> Fonte: "+server.URL+"/page") || !strings.Contains(string(got), "- Capturar") {
		t.Fatalf("unexpected content:\n%s", got)
	}

	custom, err := app.AddRawURL(projectID, server.URL+"/page", "Meu titulo")
	if err != nil || custom != "Meu titulo.md" {
		t.Fatalf("custom title: %q (%v)", custom, err)
	}
}

func TestAddRawURL_SavesPDFAsIs(t *testing.T) {
	server := newURLSourceServer(t)
	app, _ := newTestApp(t)
	projectID := createTestProject(t, app, "AddRawURL pdf", "historia")

	name, err := app.AddRawURL(projectID, server.URL+"/doc.pdf", "")
	if err != nil {
		t.Fatalf("AddRawURL: %v", err)
	}
	if name != "doc.pdf" {
		t.Fatalf("unexpected basename %q", name)
	}
}

func TestAddRawURL_RejectsInvalidInput(t *testing.T) {
	server := newURLSourceServer(t)
	app, _ := newTestApp(t)
	projectID := createTestProject(t, app, "AddRawURL invalid", "historia")

	cases := map[string]string{
		"empty":       "  ",
		"scheme":      "ftp://example.com/file",
		"credentials": "https://user:pass@example.com/",
		"404":         server.URL + "/missing",
		"binary":      server.URL + "/image.png",
	}
	for label, rawURL := range cases {
		if _, err := app.AddRawURL(projectID, rawURL, ""); err == nil {
			t.Fatalf("%s: expected error for %q", label, rawURL)
		}
	}
	if _, err := app.AddRawURL("../escape", server.URL+"/page", ""); err == nil {
		t.Fatal("expected error for invalid project id")
	}
	entries, _ := os.ReadDir(filepath.Join(app.DataDir(), "projects", projectID, "raw"))
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), ".") {
			t.Fatalf("failed fetch should not leave files behind, found %q", entry.Name())
		}
	}
}
