package main

import (
	"archive/zip"
	"encoding/xml"
	"fmt"
	"io"
	"math"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Office sources (.docx/.pptx/.xlsx) are converted to Markdown when they are
// added, the same split AddRawURL uses for HTML: raw/ only ever holds formats
// RawExtract already reads (workflows/shared/wiki/raw_extract.mh), so the
// ingest workflow needs no Office parser. OOXML is a zip of XML parts, so the
// standard library is enough — no new dependency to clear in the
// Artifactory (docs/DEPENDENCIAS.md).
//
// The converted file is saved as "<original name>.md" (e.g.
// "Contrato.docx.md"): it keeps the original extension visible and lets the
// Fontes tab show the Office icon (kindOfFile in source-kinds.js).

// officeEntryMaxBytes caps how much of one zip part is decompressed — a
// guard against zip bombs; real documents stay far below it.
const officeEntryMaxBytes = 100 << 20

// xlsxMaxRows / xlsxMaxCols bound each sheet's table: a source ends up inside
// an LLM prompt, so a 100k-row dump is cost, not context.
const (
	xlsxMaxRows = 2000
	xlsxMaxCols = 50
)

type officeFormat struct {
	label   string
	convert func(*zip.Reader) (string, error)
}

var officeFormats = map[string]officeFormat{
	".docx": {"documento Word", docxToMarkdown},
	".pptx": {"apresentação PowerPoint", pptxToMarkdown},
	".xlsx": {"planilha Excel", xlsxToMarkdown},
}

func isOfficeSource(name string) bool {
	_, ok := officeFormats[strings.ToLower(filepath.Ext(name))]
	return ok
}

// convertOfficeSource reads the Office file at sourcePath and returns its
// Markdown rendering, with the original filename and conversion date at the
// top for provenance (same header style as AddRawURL).
func convertOfficeSource(sourcePath string) ([]byte, error) {
	base := filepath.Base(sourcePath)
	format, ok := officeFormats[strings.ToLower(filepath.Ext(base))]
	if !ok {
		return nil, fmt.Errorf("formato Office nao suportado: %q", base)
	}
	archive, err := zip.OpenReader(sourcePath)
	if err != nil {
		return nil, fmt.Errorf("'%s' nao e um arquivo Office valido (protegido por senha ou no formato antigo .doc/.ppt/.xls?): %w", base, err)
	}
	defer archive.Close()

	body, err := format.convert(&archive.Reader)
	if err != nil {
		return nil, fmt.Errorf("converter '%s': %w", base, err)
	}
	if strings.TrimSpace(body) == "" {
		return nil, fmt.Errorf("nenhum texto encontrado em '%s' (o conteudo e so imagem?)", base)
	}

	var b strings.Builder
	b.WriteString("# " + strings.TrimSuffix(base, filepath.Ext(base)) + "\n\n")
	b.WriteString("> Fonte: " + format.label + " (" + base + ")  \n")
	b.WriteString("> Convertido em: " + time.Now().Format("2006-01-02 15:04") + "\n\n")
	b.WriteString(strings.TrimSpace(body))
	b.WriteString("\n")
	return []byte(b.String()), nil
}

// --- generic OOXML plumbing -------------------------------------------------

// xmlNode is a namespace-agnostic element tree: OOXML parts are matched by
// local name only (w:p, a:t, ...), which is what every helper below does.
// Text is only read from leaf elements (w:t, a:t, v, ...), so losing the
// order of mixed content in Content is harmless.
type xmlNode struct {
	XMLName xml.Name
	Attrs   []xml.Attr `xml:",any,attr"`
	Content string     `xml:",chardata"`
	Nodes   []xmlNode  `xml:",any"`
}

func (n *xmlNode) name() string { return n.XMLName.Local }

// attr returns the value of the attribute with that local name and no
// namespace — or, when the local name is shared (sldId's id vs r:id), use
// relAttr.
func (n *xmlNode) attr(local string) string {
	for _, a := range n.Attrs {
		if a.Name.Local == local && a.Name.Space == "" {
			return a.Value
		}
	}
	for _, a := range n.Attrs {
		if a.Name.Local == local {
			return a.Value
		}
	}
	return ""
}

// relAttr returns the r:id-style attribute (relationships namespace).
func (n *xmlNode) relAttr(local string) string {
	for _, a := range n.Attrs {
		if a.Name.Local == local && strings.HasSuffix(a.Name.Space, "/relationships") {
			return a.Value
		}
	}
	return ""
}

func (n *xmlNode) child(local string) *xmlNode {
	for i := range n.Nodes {
		if n.Nodes[i].name() == local {
			return &n.Nodes[i]
		}
	}
	return nil
}

func (n *xmlNode) children(local string) []*xmlNode {
	var out []*xmlNode
	for i := range n.Nodes {
		if n.Nodes[i].name() == local {
			out = append(out, &n.Nodes[i])
		}
	}
	return out
}

// path follows a chain of child names; nil if any step is missing.
func (n *xmlNode) path(locals ...string) *xmlNode {
	current := n
	for _, local := range locals {
		if current == nil {
			return nil
		}
		current = current.child(local)
	}
	return current
}

// descendants collects every element named local, in document order, without
// descending into a match (a cell's paragraphs, not paragraphs-in-paragraphs).
func (n *xmlNode) descendants(local string) []*xmlNode {
	var out []*xmlNode
	var walk func(*xmlNode)
	walk = func(node *xmlNode) {
		for i := range node.Nodes {
			child := &node.Nodes[i]
			if child.name() == local {
				out = append(out, child)
				continue
			}
			walk(child)
		}
	}
	walk(n)
	return out
}

func zipEntry(archive *zip.Reader, name string) *zip.File {
	for _, f := range archive.File {
		if f.Name == name {
			return f
		}
	}
	return nil
}

// readXMLPart parses one part of the package; a missing optional part
// (styles, shared strings, notes) comes back as (nil, nil).
func readXMLPart(archive *zip.Reader, name string) (*xmlNode, error) {
	f := zipEntry(archive, name)
	if f == nil {
		return nil, nil
	}
	rc, err := f.Open()
	if err != nil {
		return nil, fmt.Errorf("abrir %s: %w", name, err)
	}
	defer rc.Close()
	data, err := io.ReadAll(io.LimitReader(rc, officeEntryMaxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("ler %s: %w", name, err)
	}
	if len(data) > officeEntryMaxBytes {
		return nil, fmt.Errorf("%s excede %d MB descompactado", name, officeEntryMaxBytes>>20)
	}
	var root xmlNode
	if err := xml.Unmarshal(data, &root); err != nil {
		return nil, fmt.Errorf("xml invalido em %s: %w", name, err)
	}
	return &root, nil
}

func requireXMLPart(archive *zip.Reader, name string) (*xmlNode, error) {
	root, err := readXMLPart(archive, name)
	if err == nil && root == nil {
		err = fmt.Errorf("parte obrigatoria %s ausente", name)
	}
	return root, err
}

type officeRel struct {
	typ    string
	target string // package path, resolved against the owning part
}

// readRels maps relationship Id -> target for the part at partPath
// (e.g. "ppt/presentation.xml" -> "ppt/_rels/presentation.xml.rels").
func readRels(archive *zip.Reader, partPath string) (map[string]officeRel, error) {
	dir, file := path.Split(partPath)
	root, err := readXMLPart(archive, dir+"_rels/"+file+".rels")
	if err != nil || root == nil {
		return map[string]officeRel{}, err
	}
	rels := map[string]officeRel{}
	for _, rel := range root.children("Relationship") {
		if rel.attr("TargetMode") == "External" {
			continue
		}
		target := rel.attr("Target")
		if strings.HasPrefix(target, "/") {
			target = strings.TrimPrefix(target, "/")
		} else {
			target = path.Join(dir, target)
		}
		rels[rel.attr("Id")] = officeRel{typ: rel.attr("Type"), target: target}
	}
	return rels, nil
}

// writeMarkdownTable renders rows as a GFM table (first row as header),
// padding ragged rows; cell text is flattened to one line.
func writeMarkdownTable(b *strings.Builder, rows [][]string) {
	width := 0
	for _, row := range rows {
		width = max(width, len(row))
	}
	if width == 0 {
		return
	}
	writeRow := func(row []string) {
		b.WriteString("|")
		for i := 0; i < width; i++ {
			cell := ""
			if i < len(row) {
				cell = markdownTableCell(row[i])
			}
			b.WriteString(" " + cell + " |")
		}
		b.WriteString("\n")
	}
	writeRow(rows[0])
	b.WriteString("|" + strings.Repeat(" --- |", width) + "\n")
	for _, row := range rows[1:] {
		writeRow(row)
	}
	b.WriteString("\n")
}

func markdownTableCell(text string) string {
	text = strings.ReplaceAll(text, "|", `\|`)
	lines := strings.FieldsFunc(text, func(r rune) bool { return r == '\n' || r == '\r' })
	for i := range lines {
		lines[i] = strings.TrimSpace(lines[i])
	}
	return strings.Join(lines, "<br>")
}

// --- .docx ------------------------------------------------------------------

var headingStyleName = regexp.MustCompile(`^heading\s*([1-9])$`)

// docxHeadingLevels maps paragraph style ids to a Markdown heading level.
// Style ids are localized ("Ttulo1" in a Portuguese Word), but the w:name of
// the built-in heading styles is always "heading N" / "Title".
func docxHeadingLevels(styles *xmlNode) map[string]int {
	levels := map[string]int{}
	if styles == nil {
		return levels
	}
	for _, style := range styles.children("style") {
		id := style.attr("styleId")
		name := ""
		if n := style.child("name"); n != nil {
			name = strings.ToLower(n.attr("val"))
		}
		switch {
		case name == "title":
			levels[id] = 1
		case name == "subtitle":
			levels[id] = 2
		case headingStyleName.MatchString(name):
			levels[id], _ = strconv.Atoi(headingStyleName.FindStringSubmatch(name)[1])
		default:
			if lvl := style.path("pPr", "outlineLvl"); lvl != nil {
				if v, err := strconv.Atoi(lvl.attr("val")); err == nil && v < 9 {
					levels[id] = v + 1
				}
			}
		}
	}
	return levels
}

func docxToMarkdown(archive *zip.Reader) (string, error) {
	document, err := requireXMLPart(archive, "word/document.xml")
	if err != nil {
		return "", err
	}
	styles, err := readXMLPart(archive, "word/styles.xml")
	if err != nil {
		return "", err
	}
	body := document.child("body")
	if body == nil {
		return "", fmt.Errorf("word/document.xml sem w:body")
	}
	w := docxWriter{levels: docxHeadingLevels(styles)}
	w.blocks(body)
	return w.b.String(), nil
}

type docxWriter struct {
	b      strings.Builder
	levels map[string]int
}

func (w *docxWriter) blocks(container *xmlNode) {
	for i := range container.Nodes {
		node := &container.Nodes[i]
		switch node.name() {
		case "p":
			w.paragraph(node)
		case "tbl":
			w.table(node)
		case "sdt":
			if content := node.child("sdtContent"); content != nil {
				w.blocks(content)
			}
		}
	}
}

func (w *docxWriter) paragraph(p *xmlNode) {
	text := strings.TrimSpace(docxParagraphText(p))
	if text == "" {
		return
	}
	level := 0
	if style := p.path("pPr", "pStyle"); style != nil {
		id := style.attr("val")
		level = w.levels[id]
		if level == 0 {
			// No styles.xml: English style ids still say what they are.
			if m := headingStyleName.FindStringSubmatch(strings.ToLower(id)); m != nil {
				level, _ = strconv.Atoi(m[1])
			}
		}
	}
	if lvl := p.path("pPr", "outlineLvl"); lvl != nil && level == 0 {
		if v, err := strconv.Atoi(lvl.attr("val")); err == nil && v < 9 {
			level = v + 1
		}
	}
	switch {
	case level > 0:
		// The file's own title is the "#" header; document headings start at "##".
		w.b.WriteString(strings.Repeat("#", min(level+1, 6)) + " " + strings.ReplaceAll(text, "\n", " ") + "\n\n")
	case p.path("pPr", "numPr") != nil:
		indent := 0
		if ilvl := p.path("pPr", "numPr", "ilvl"); ilvl != nil {
			indent, _ = strconv.Atoi(ilvl.attr("val"))
		}
		w.b.WriteString(strings.Repeat("  ", indent) + "- " + strings.ReplaceAll(text, "\n", " ") + "\n\n")
	default:
		w.b.WriteString(strings.ReplaceAll(text, "\n", "  \n") + "\n\n")
	}
}

func (w *docxWriter) table(tbl *xmlNode) {
	var rows [][]string
	for _, tr := range tbl.children("tr") {
		var row []string
		for _, tc := range tr.children("tc") {
			var parts []string
			for _, p := range tc.descendants("p") {
				if text := strings.TrimSpace(docxParagraphText(p)); text != "" {
					parts = append(parts, text)
				}
			}
			row = append(row, strings.Join(parts, "\n"))
		}
		rows = append(rows, row)
	}
	writeMarkdownTable(&w.b, rows)
}

// docxParagraphText concatenates a paragraph's visible text in order: w:t
// runs (inside hyperlinks, insertions, fields...), tabs and line breaks.
// Deleted text lives in w:delText and is skipped; so are mc:Fallback copies,
// which would otherwise duplicate text boxes.
func docxParagraphText(p *xmlNode) string {
	var b strings.Builder
	var walk func(*xmlNode)
	walk = func(node *xmlNode) {
		for i := range node.Nodes {
			child := &node.Nodes[i]
			switch child.name() {
			case "t":
				b.WriteString(child.Content)
			case "tab":
				b.WriteString("\t")
			case "br", "cr":
				b.WriteString("\n")
			case "pPr", "rPr", "del", "Fallback", "instrText":
			case "p":
				// Text box paragraphs nested in a run.
				walk(child)
				b.WriteString("\n")
			default:
				walk(child)
			}
		}
	}
	walk(p)
	return b.String()
}

// --- .pptx ------------------------------------------------------------------

var trailingNumber = regexp.MustCompile(`(\d+)\.xml$`)

func pptxToMarkdown(archive *zip.Reader) (string, error) {
	slides, err := pptxSlideOrder(archive)
	if err != nil {
		return "", err
	}
	if len(slides) == 0 {
		return "", fmt.Errorf("nenhum slide encontrado")
	}
	var b strings.Builder
	for i, slidePath := range slides {
		slide, err := requireXMLPart(archive, slidePath)
		if err != nil {
			return "", err
		}
		title, lines := pptxShapes(slide.path("cSld", "spTree"))
		heading := "## Slide " + strconv.Itoa(i+1)
		if title != "" {
			heading += " — " + title
		}
		if slide.attr("show") == "0" {
			heading += " (oculto)"
		}
		b.WriteString(heading + "\n\n")
		for _, line := range lines {
			b.WriteString(line + "\n")
		}
		if len(lines) > 0 {
			b.WriteString("\n")
		}
		if notes := pptxNotes(archive, slidePath); notes != "" {
			b.WriteString("**Notas do apresentador:**\n\n" + notes + "\n\n")
		}
	}
	return b.String(), nil
}

// pptxSlideOrder returns slide part paths in presentation order (sldIdLst),
// falling back to slideN.xml numbering when presentation.xml can't say.
func pptxSlideOrder(archive *zip.Reader) ([]string, error) {
	presentation, err := readXMLPart(archive, "ppt/presentation.xml")
	if err != nil {
		return nil, err
	}
	rels, err := readRels(archive, "ppt/presentation.xml")
	if err != nil {
		return nil, err
	}
	var ordered []string
	if list := presentation.path("sldIdLst"); list != nil {
		for _, sld := range list.children("sldId") {
			if rel, ok := rels[sld.relAttr("id")]; ok && zipEntry(archive, rel.target) != nil {
				ordered = append(ordered, rel.target)
			}
		}
	}
	if len(ordered) > 0 {
		return ordered, nil
	}
	for _, f := range archive.File {
		if strings.HasPrefix(f.Name, "ppt/slides/slide") && strings.HasSuffix(f.Name, ".xml") {
			ordered = append(ordered, f.Name)
		}
	}
	sort.Slice(ordered, func(i, j int) bool { return slideNumber(ordered[i]) < slideNumber(ordered[j]) })
	return ordered, nil
}

func slideNumber(name string) int {
	m := trailingNumber.FindStringSubmatch(name)
	if m == nil {
		return math.MaxInt
	}
	n, _ := strconv.Atoi(m[1])
	return n
}

// pptxShapes walks a shape tree in z-order: the title placeholder becomes
// the slide heading, other text boxes become bullets (indented by paragraph
// level) and tables become Markdown tables.
func pptxShapes(tree *xmlNode) (string, []string) {
	title := ""
	var lines []string
	if tree == nil {
		return title, lines
	}
	var walk func(*xmlNode)
	walk = func(container *xmlNode) {
		for i := range container.Nodes {
			node := &container.Nodes[i]
			switch node.name() {
			case "grpSp":
				walk(node)
			case "sp":
				body := node.child("txBody")
				if body == nil {
					continue
				}
				phType := ""
				if ph := node.path("nvSpPr", "nvPr", "ph"); ph != nil {
					phType = ph.attr("type")
				}
				if pptxChromePlaceholders[phType] {
					continue
				}
				if (phType == "title" || phType == "ctrTitle") && title == "" {
					title = strings.Join(strings.Fields(pptxBodyText(body)), " ")
					continue
				}
				for _, p := range body.children("p") {
					text := strings.TrimSpace(pptxParagraphText(p))
					if text == "" {
						continue
					}
					indent := 0
					if pPr := p.child("pPr"); pPr != nil {
						indent, _ = strconv.Atoi(pPr.attr("lvl"))
					}
					lines = append(lines, strings.Repeat("  ", indent)+"- "+strings.ReplaceAll(text, "\n", " "))
				}
			case "graphicFrame":
				for _, tbl := range node.descendants("tbl") {
					var rows [][]string
					for _, tr := range tbl.children("tr") {
						var row []string
						for _, tc := range tr.children("tc") {
							cell := ""
							if body := tc.child("txBody"); body != nil {
								cell = strings.TrimSpace(pptxBodyText(body))
							}
							row = append(row, cell)
						}
						rows = append(rows, row)
					}
					var tb strings.Builder
					writeMarkdownTable(&tb, rows)
					if tb.Len() > 0 {
						lines = append(lines, "", strings.TrimRight(tb.String(), "\n"), "")
					}
				}
			}
		}
	}
	walk(tree)
	return title, lines
}

// pptxChromePlaceholders repeat on every slide (date, footer, slide number)
// and carry no content worth a bullet.
var pptxChromePlaceholders = map[string]bool{"dt": true, "ftr": true, "sldNum": true, "hdr": true}

func pptxBodyText(body *xmlNode) string {
	var parts []string
	for _, p := range body.children("p") {
		if text := strings.TrimSpace(pptxParagraphText(p)); text != "" {
			parts = append(parts, text)
		}
	}
	return strings.Join(parts, "\n")
}

func pptxParagraphText(p *xmlNode) string {
	var b strings.Builder
	for i := range p.Nodes {
		node := &p.Nodes[i]
		switch node.name() {
		case "r", "fld":
			if t := node.child("t"); t != nil {
				b.WriteString(t.Content)
			}
		case "br":
			b.WriteString("\n")
		}
	}
	return b.String()
}

// pptxNotes returns the speaker notes of a slide (the notes page's body
// placeholder), or "" when it has none.
func pptxNotes(archive *zip.Reader, slidePath string) string {
	rels, err := readRels(archive, slidePath)
	if err != nil {
		return ""
	}
	for _, rel := range rels {
		if !strings.HasSuffix(rel.typ, "/notesSlide") {
			continue
		}
		notes, err := readXMLPart(archive, rel.target)
		if err != nil || notes == nil {
			return ""
		}
		tree := notes.path("cSld", "spTree")
		if tree == nil {
			return ""
		}
		var parts []string
		for _, sp := range tree.descendants("sp") {
			ph := sp.path("nvSpPr", "nvPr", "ph")
			body := sp.child("txBody")
			if ph == nil || ph.attr("type") != "body" || body == nil {
				continue
			}
			if text := pptxBodyText(body); text != "" {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, "\n\n")
	}
	return ""
}

// --- .xlsx ------------------------------------------------------------------

func xlsxToMarkdown(archive *zip.Reader) (string, error) {
	workbook, err := requireXMLPart(archive, "xl/workbook.xml")
	if err != nil {
		return "", err
	}
	rels, err := readRels(archive, "xl/workbook.xml")
	if err != nil {
		return "", err
	}
	shared, err := xlsxSharedStrings(archive)
	if err != nil {
		return "", err
	}
	styles, err := readXMLPart(archive, "xl/styles.xml")
	if err != nil {
		return "", err
	}
	dateStyles := xlsxDateStyles(styles)
	date1904 := false
	if pr := workbook.child("workbookPr"); pr != nil {
		v := pr.attr("date1904")
		date1904 = v == "1" || v == "true"
	}

	sheets := workbook.path("sheets")
	if sheets == nil {
		return "", fmt.Errorf("xl/workbook.xml sem lista de planilhas")
	}
	var b strings.Builder
	for _, sheet := range sheets.children("sheet") {
		rel, ok := rels[sheet.relAttr("id")]
		if !ok {
			continue
		}
		part, err := readXMLPart(archive, rel.target)
		if err != nil {
			return "", err
		}
		if part == nil {
			// Chart sheets and dialogs have no worksheet part to read.
			continue
		}
		heading := "## Planilha: " + sheet.attr("name")
		if state := sheet.attr("state"); state == "hidden" || state == "veryHidden" {
			heading += " (oculta)"
		}
		b.WriteString(heading + "\n\n")
		rows, truncated := xlsxSheetRows(part, shared, dateStyles, date1904)
		if len(rows) == 0 {
			b.WriteString("_(vazia)_\n\n")
			continue
		}
		writeMarkdownTable(&b, rows)
		if truncated != "" {
			b.WriteString("_" + truncated + "_\n\n")
		}
	}
	return b.String(), nil
}

func xlsxSharedStrings(archive *zip.Reader) ([]string, error) {
	sst, err := readXMLPart(archive, "xl/sharedStrings.xml")
	if err != nil || sst == nil {
		return nil, err
	}
	var out []string
	for _, si := range sst.children("si") {
		out = append(out, xlsxRichText(si))
	}
	return out, nil
}

// xlsxRichText joins the t elements of a shared/inline string, skipping
// phonetic runs (rPh) that would repeat the text in kana.
func xlsxRichText(node *xmlNode) string {
	var b strings.Builder
	var walk func(*xmlNode)
	walk = func(n *xmlNode) {
		for i := range n.Nodes {
			child := &n.Nodes[i]
			switch child.name() {
			case "t":
				b.WriteString(child.Content)
			case "rPh", "phoneticPr":
			default:
				walk(child)
			}
		}
	}
	walk(node)
	return b.String()
}

// xlsxDateStyles marks which cell formats (cellXfs index, the c@s attribute)
// display a date: Excel stores dates as serial numbers, and without this they
// would reach the wiki as "45567".
func xlsxDateStyles(styles *xmlNode) map[int]bool {
	dates := map[int]bool{}
	if styles == nil {
		return dates
	}
	customDate := map[int]bool{}
	if numFmts := styles.child("numFmts"); numFmts != nil {
		for _, f := range numFmts.children("numFmt") {
			id, err := strconv.Atoi(f.attr("numFmtId"))
			if err == nil && isDateFormatCode(f.attr("formatCode")) {
				customDate[id] = true
			}
		}
	}
	if xfs := styles.child("cellXfs"); xfs != nil {
		for i, xf := range xfs.children("xf") {
			id, err := strconv.Atoi(xf.attr("numFmtId"))
			if err != nil {
				continue
			}
			if (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || customDate[id] {
				dates[i] = true
			}
		}
	}
	return dates
}

var formatLiterals = regexp.MustCompile(`"[^"]*"|\[[^\]]*\]|\\.`)

func isDateFormatCode(code string) bool {
	code = strings.ToLower(formatLiterals.ReplaceAllString(code, ""))
	return strings.ContainsAny(code, "dy") || (strings.Contains(code, "m") && strings.ContainsAny(code, "hs"))
}

func xlsxSerialDate(serial float64, date1904 bool) string {
	base := time.Date(1899, 12, 30, 0, 0, 0, 0, time.UTC)
	if date1904 {
		base = time.Date(1904, 1, 1, 0, 0, 0, 0, time.UTC)
	}
	days := math.Floor(serial)
	seconds := math.Round((serial - days) * 86400)
	t := base.AddDate(0, 0, int(days)).Add(time.Duration(seconds) * time.Second)
	if seconds == 0 {
		return t.Format("2006-01-02")
	}
	if days == 0 {
		return t.Format("15:04:05")
	}
	return t.Format("2006-01-02 15:04:05")
}

// xlsxSheetRows turns a worksheet into a dense grid trimmed to the used
// area (empty rows and columns dropped), capped at xlsxMaxRows x xlsxMaxCols; the second
// return describes what was cut, if anything.
func xlsxSheetRows(sheet *xmlNode, shared []string, dateStyles map[int]bool, date1904 bool) ([][]string, string) {
	data := sheet.child("sheetData")
	if data == nil {
		return nil, ""
	}
	type cellRow map[int]string
	var grid []cellRow
	minCol, maxCol := math.MaxInt, -1
	extraRows := 0
	for _, row := range data.children("row") {
		values := cellRow{}
		next := 0
		for _, c := range row.children("c") {
			col := next
			if ref := c.attr("r"); ref != "" {
				if parsed, ok := columnIndex(ref); ok {
					col = parsed
				}
			}
			next = col + 1
			if text := strings.TrimSpace(xlsxCellText(c, shared, dateStyles, date1904)); text != "" {
				values[col] = text
			}
		}
		if len(values) == 0 {
			continue
		}
		if len(grid) >= xlsxMaxRows {
			extraRows++
			continue
		}
		for col := range values {
			minCol, maxCol = min(minCol, col), max(maxCol, col)
		}
		grid = append(grid, values)
	}
	if len(grid) == 0 {
		return nil, ""
	}
	var notes []string
	if extraRows > 0 {
		notes = append(notes, fmt.Sprintf("%d linhas omitidas (limite de %d)", extraRows, xlsxMaxRows))
	}
	// Spacer columns (empty in every row) only widen the table.
	var used []int
	extraCols := 0
	for col := minCol; col <= maxCol; col++ {
		for _, values := range grid {
			if values[col] == "" {
				continue
			}
			if len(used) < xlsxMaxCols {
				used = append(used, col)
			} else {
				extraCols++
			}
			break
		}
	}
	if extraCols > 0 {
		notes = append(notes, fmt.Sprintf("%d colunas omitidas (limite de %d)", extraCols, xlsxMaxCols))
	}
	rows := make([][]string, len(grid))
	for i, values := range grid {
		row := make([]string, len(used))
		for j, col := range used {
			row[j] = values[col]
		}
		rows[i] = row
	}
	return rows, strings.Join(notes, "; ")
}

func xlsxCellText(c *xmlNode, shared []string, dateStyles map[int]bool, date1904 bool) string {
	value := ""
	if v := c.child("v"); v != nil {
		value = v.Content
	}
	switch c.attr("t") {
	case "s":
		i, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil || i < 0 || i >= len(shared) {
			return ""
		}
		return shared[i]
	case "inlineStr":
		if is := c.child("is"); is != nil {
			return xlsxRichText(is)
		}
		return ""
	case "b":
		if strings.TrimSpace(value) == "1" {
			return "TRUE"
		}
		return "FALSE"
	case "str", "e":
		return value
	}
	if style, err := strconv.Atoi(c.attr("s")); err == nil && dateStyles[style] {
		if serial, err := strconv.ParseFloat(strings.TrimSpace(value), 64); err == nil && serial >= 0 {
			return xlsxSerialDate(serial, date1904)
		}
	}
	return value
}

// columnIndex parses the column letters of an A1-style reference ("BC12" ->
// 54, zero-based).
func columnIndex(ref string) (int, bool) {
	col := 0
	letters := 0
	for _, r := range strings.ToUpper(ref) {
		if r < 'A' || r > 'Z' {
			break
		}
		col = col*26 + int(r-'A'+1)
		letters++
	}
	if letters == 0 || letters > 3 {
		return 0, false
	}
	return col - 1, true
}
