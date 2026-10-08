package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/net/html/charset"
)

// htmlFormats are the local HTML pages AddRawFile converts to Markdown on
// upload, with the same converter AddRawURL uses for a downloaded page
// (htmlToMarkdown). RawExtract has no HTML parser, so a copied .html would
// only fail later, at ingest.
var htmlFormats = map[string]bool{".html": true, ".htm": true, ".xhtml": true}

func isHTMLSource(name string) bool {
	return htmlFormats[strings.ToLower(filepath.Ext(name))]
}

// convertHTMLSource reads the HTML page at sourcePath and returns its
// Markdown rendering, with the original filename and conversion date at the
// top for provenance (same header style as AddRawURL and Office sources).
// The charset comes from the page's own <meta> (or a BOM), defaulting to
// UTF-8 — a page saved from a browser keeps its declared encoding.
func convertHTMLSource(sourcePath string) ([]byte, error) {
	base := filepath.Base(sourcePath)
	raw, err := os.ReadFile(sourcePath)
	if err != nil {
		return nil, fmt.Errorf("ler '%s': %w", base, err)
	}
	reader, err := charset.NewReader(bytes.NewReader(raw), "text/html")
	if err != nil {
		return nil, fmt.Errorf("decodificar charset de '%s': %w", base, err)
	}
	title, markdown, err := htmlToMarkdown(reader)
	if err != nil {
		return nil, fmt.Errorf("interpretar html de '%s': %w", base, err)
	}
	if strings.TrimSpace(markdown) == "" {
		return nil, fmt.Errorf("nenhum texto legivel encontrado em '%s' (paginas que dependem de JavaScript nao sao suportadas)", base)
	}
	if title == "" {
		title = strings.TrimSuffix(base, filepath.Ext(base))
	}

	var b strings.Builder
	b.WriteString("# " + title + "\n\n")
	b.WriteString("> Fonte: pagina HTML (" + base + ")  \n")
	b.WriteString("> Convertido em: " + time.Now().Format("2006-01-02 15:04") + "\n\n")
	b.WriteString(strings.TrimSpace(markdown))
	b.WriteString("\n")
	return []byte(b.String()), nil
}
