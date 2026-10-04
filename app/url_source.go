package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
	"golang.org/x/net/html/charset"
)

// urlFetchTimeout bounds the whole download (connect + body) of a URL source.
const urlFetchTimeout = 30 * time.Second

// urlFetchMaxBytes caps how much of a page is read — a source ends up inside
// an LLM prompt anyway, so anything past this is noise, and an unbounded read
// would let a misbehaving server hang or bloat the app.
const urlFetchMaxBytes = 20 << 20

// urlSourceClient is swappable so tests can point it at an httptest server.
var urlSourceClient = &http.Client{Timeout: urlFetchTimeout}

// AddRawURL registers a web page as a source: it downloads rawURL, converts
// the HTML to Markdown (title, headings, paragraphs, lists, code, tables as
// plain rows) and writes it as projects/<projectID>/raw/<title>.md, with the
// URL and capture date at the top for provenance. A PDF response is saved
// as-is under .pdf and plain text/Markdown under .md — exactly the formats
// RawExtract already reads, so ingest needs no change. title is optional;
// empty falls back to the page's <title>, then to the URL host + path.
// Returns the resulting basename, ready for Wiki's `raw_paths`; ingesting
// stays the caller's choice, same split as AddRawText.
func (a *App) AddRawURL(projectID string, rawURL string, title string) (string, error) {
	target, err := parseSourceURL(rawURL)
	if err != nil {
		return "", err
	}
	rawDir, err := a.projectRootDir(projectID, "raw", []string{"raw"})
	if err != nil {
		return "", err
	}

	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	page, err := fetchURLSource(ctx, target)
	if err != nil {
		return "", err
	}

	stem := sanitizeSourceTitle(title)
	if stem == "" {
		stem = sanitizeSourceTitle(page.title)
	}
	if stem == "" {
		stem = sanitizeSourceTitle(target.Host + " " + strings.ReplaceAll(strings.Trim(target.Path, "/"), "/", " "))
	}
	if stem == "" {
		return "", fmt.Errorf("nao foi possivel derivar um titulo para %q", rawURL)
	}

	if err := os.MkdirAll(rawDir, 0o755); err != nil {
		return "", fmt.Errorf("create raw dir: %w", err)
	}
	dest := uniqueDestination(rawDir, stem+page.ext)
	out, err := os.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return "", fmt.Errorf("create destination file: %w", err)
	}
	defer out.Close()
	if _, err := out.Write(page.body); err != nil {
		return "", fmt.Errorf("write url source: %w", err)
	}
	return filepath.Base(dest), nil
}

// parseSourceURL accepts only absolute http(s) URLs; a bare "exemplo.com"
// is promoted to https:// since that's how people paste links.
func parseSourceURL(rawURL string) (*url.URL, error) {
	trimmed := strings.TrimSpace(rawURL)
	if trimmed == "" {
		return nil, fmt.Errorf("url da fonte e obrigatoria")
	}
	if !strings.Contains(trimmed, "://") {
		trimmed = "https://" + trimmed
	}
	target, err := url.Parse(trimmed)
	if err != nil {
		return nil, fmt.Errorf("url invalida: %w", err)
	}
	if target.Scheme != "http" && target.Scheme != "https" {
		return nil, fmt.Errorf("apenas urls http ou https sao suportadas")
	}
	if target.Host == "" {
		return nil, fmt.Errorf("url invalida: host ausente")
	}
	if target.User != nil {
		// Credentials in the URL would end up in the saved source's header.
		return nil, fmt.Errorf("urls com usuario/senha nao sao suportadas")
	}
	return target, nil
}

type urlSourcePage struct {
	title string
	ext   string
	body  []byte
}

func fetchURLSource(ctx context.Context, target *url.URL) (*urlSourcePage, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("montar requisicao: %w", err)
	}
	req.Header.Set("User-Agent", "Senpai/"+currentAppVersion()+" (+source ingest)")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,text/plain,text/markdown,application/pdf;q=0.9,*/*;q=0.5")

	resp, err := urlSourceClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("falha ao baixar %s: %w", target, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("falha ao baixar %s: HTTP %d", target, resp.StatusCode)
	}

	raw, err := io.ReadAll(io.LimitReader(resp.Body, urlFetchMaxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("ler resposta de %s: %w", target, err)
	}
	if len(raw) > urlFetchMaxBytes {
		return nil, fmt.Errorf("pagina excede o limite de %d MB", urlFetchMaxBytes>>20)
	}

	contentType := resp.Header.Get("Content-Type")
	mediaType, _, _ := mime.ParseMediaType(contentType)
	if mediaType == "" {
		mediaType = http.DetectContentType(raw)
		mediaType, _, _ = mime.ParseMediaType(mediaType)
	}
	finalURL := resp.Request.URL.String()
	header := func(title string) string {
		var b strings.Builder
		if title != "" {
			b.WriteString("# " + title + "\n\n")
		}
		b.WriteString("> Fonte: " + finalURL + "  \n")
		b.WriteString("> Capturado em: " + time.Now().Format("2006-01-02 15:04") + "\n\n")
		return b.String()
	}

	switch {
	case mediaType == "application/pdf":
		return &urlSourcePage{title: strings.TrimSuffix(path.Base(target.Path), ".pdf"), ext: ".pdf", body: raw}, nil
	case mediaType == "text/html" || mediaType == "application/xhtml+xml":
		utf8Reader, err := charset.NewReader(bytes.NewReader(raw), contentType)
		if err != nil {
			return nil, fmt.Errorf("decodificar charset de %s: %w", target, err)
		}
		title, markdown, err := htmlToMarkdown(utf8Reader)
		if err != nil {
			return nil, fmt.Errorf("interpretar html de %s: %w", target, err)
		}
		if strings.TrimSpace(markdown) == "" {
			return nil, fmt.Errorf("nenhum texto legivel encontrado em %s (paginas que dependem de JavaScript nao sao suportadas)", target)
		}
		return &urlSourcePage{title: title, ext: ".md", body: []byte(header(title) + markdown)}, nil
	case strings.HasPrefix(mediaType, "text/"):
		if strings.TrimSpace(string(raw)) == "" {
			return nil, fmt.Errorf("conteudo vazio em %s", target)
		}
		return &urlSourcePage{ext: ".md", body: []byte(header("") + string(raw))}, nil
	default:
		return nil, fmt.Errorf("tipo de conteudo nao suportado em %s: %q (use paginas html, texto ou pdf)", target, mediaType)
	}
}

// skippedHTMLElements never carry page content worth ingesting: code, chrome
// (menus, footers, sidebars) and interactive widgets.
var skippedHTMLElements = map[atom.Atom]bool{
	atom.Script: true, atom.Style: true, atom.Noscript: true, atom.Template: true,
	atom.Svg: true, atom.Canvas: true, atom.Iframe: true, atom.Object: true,
	atom.Nav: true, atom.Header: true, atom.Footer: true, atom.Aside: true,
	atom.Form: true, atom.Button: true, atom.Select: true, atom.Dialog: true,
}

// htmlToMarkdown extracts the page title and a readable Markdown rendering
// of its main content: <main> or <article> when the page has one, <body>
// otherwise. It is deliberately lossy — the goal is clean text for the
// ingest prompt, not a faithful round-trip of the page.
func htmlToMarkdown(r io.Reader) (string, string, error) {
	doc, err := html.Parse(r)
	if err != nil {
		return "", "", err
	}
	title := ""
	if node := findHTMLElement(doc, atom.Title); node != nil {
		title = collapseSpaces(nodeText(node))
	}
	root := findHTMLElement(doc, atom.Main)
	if root == nil {
		root = findHTMLElement(doc, atom.Article)
	}
	if root == nil {
		root = findHTMLElement(doc, atom.Body)
	}
	if root == nil {
		root = doc
	}
	if title == "" {
		if node := findHTMLElement(root, atom.H1); node != nil {
			title = collapseSpaces(nodeText(node))
		}
	}
	w := &markdownWriter{}
	w.walk(root)
	return title, w.String(), nil
}

func findHTMLElement(node *html.Node, tag atom.Atom) *html.Node {
	if node.Type == html.ElementNode && node.DataAtom == tag {
		return node
	}
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		if found := findHTMLElement(child, tag); found != nil {
			return found
		}
	}
	return nil
}

func nodeText(node *html.Node) string {
	var b strings.Builder
	var visit func(*html.Node)
	visit = func(n *html.Node) {
		if n.Type == html.TextNode {
			b.WriteString(n.Data)
			return
		}
		if n.Type == html.ElementNode && skippedHTMLElements[n.DataAtom] {
			return
		}
		for child := n.FirstChild; child != nil; child = child.NextSibling {
			visit(child)
		}
	}
	visit(node)
	return b.String()
}

func collapseSpaces(text string) string {
	return strings.Join(strings.Fields(text), " ")
}

// markdownWriter accumulates blocks (paragraphs, headings, list items, code)
// separated by blank lines; inline text is buffered in `line` until the
// enclosing block closes.
type markdownWriter struct {
	blocks    []string
	line      strings.Builder
	listDepth int
}

func (w *markdownWriter) String() string {
	w.flush("")
	return strings.Join(w.blocks, "\n\n") + "\n"
}

func (w *markdownWriter) flush(prefix string) {
	text := collapseSpaces(w.line.String())
	w.line.Reset()
	if text != "" {
		w.blocks = append(w.blocks, prefix+text)
	}
}

func (w *markdownWriter) walk(node *html.Node) {
	switch node.Type {
	case html.TextNode:
		w.line.WriteString(node.Data)
		return
	case html.ElementNode:
	default:
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			w.walk(child)
		}
		return
	}
	if skippedHTMLElements[node.DataAtom] || hasHTMLAttr(node, "hidden") || attrValue(node, "aria-hidden") == "true" {
		return
	}

	switch node.DataAtom {
	case atom.H1, atom.H2, atom.H3, atom.H4, atom.H5, atom.H6:
		w.flush("")
		level := int(node.Data[1] - '0')
		w.children(node)
		w.flush(strings.Repeat("#", level) + " ")
	case atom.P, atom.Div, atom.Section, atom.Blockquote, atom.Dd, atom.Dt, atom.Figcaption, atom.Tr, atom.Caption:
		w.flush("")
		w.children(node)
		prefix := ""
		if node.DataAtom == atom.Blockquote {
			prefix = "> "
		}
		w.flush(prefix)
	case atom.Ul, atom.Ol:
		w.flush("")
		w.listDepth++
		index := 0
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			if child.Type != html.ElementNode || child.DataAtom != atom.Li {
				w.walk(child)
				continue
			}
			index++
			marker := "- "
			if node.DataAtom == atom.Ol {
				marker = fmt.Sprintf("%d. ", index)
			}
			w.flush("")
			w.children(child)
			w.flush(strings.Repeat("  ", w.listDepth-1) + marker)
		}
		w.listDepth--
	case atom.Pre:
		w.flush("")
		code := strings.Trim(nodeText(node), "\n")
		if strings.TrimSpace(code) != "" {
			w.blocks = append(w.blocks, "```\n"+code+"\n```")
		}
	case atom.Td, atom.Th:
		w.children(node)
		w.line.WriteString(" | ")
	case atom.Br:
		w.line.WriteString(" ")
	case atom.Hr:
		w.flush("")
		w.blocks = append(w.blocks, "---")
	case atom.Code:
		text := collapseSpaces(nodeText(node))
		if text != "" {
			w.line.WriteString(" `" + text + "` ")
		}
	case atom.Img:
		if alt := collapseSpaces(attrValue(node, "alt")); alt != "" {
			w.line.WriteString(" [imagem: " + alt + "] ")
		}
	default:
		w.children(node)
	}
}

func (w *markdownWriter) children(node *html.Node) {
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		w.walk(child)
	}
}

func hasHTMLAttr(node *html.Node, key string) bool {
	for _, attr := range node.Attr {
		if attr.Key == key {
			return true
		}
	}
	return false
}

func attrValue(node *html.Node, key string) string {
	for _, attr := range node.Attr {
		if attr.Key == key {
			return attr.Val
		}
	}
	return ""
}
