package main

import (
	"bytes"
	"compress/flate"
	"encoding/base64"
	"encoding/xml"
	"fmt"
	"html"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// draw.io diagrams (.drawio/.dio) are converted to Markdown when they are
// added, the same split as Office and HTML sources (office_source.go): raw/
// only ever holds formats RawExtract reads. The raw mxGraph XML is mostly
// coordinates and styles, with edges pointing at cell ids — costly in a
// prompt and easy for an LLM to misread. The conversion keeps what the wiki
// needs, per page of the diagram:
//
//   - the elements, with their labels (HTML stripped), a kind read from the
//     style (database, actor, AWS Lambda…) and their tooltip/metadata;
//   - containers (swimlanes, groups) as a nested list — usually layers or
//     bounded contexts;
//   - the connections, resolved to element names ("API → Fila: publica");
//   - an equivalent Mermaid flowchart inside a LiteralBlocks marker
//     (workflows/shared/wiki/literal_blocks.mh), copied into the source's
//     wiki page as is — so the wiki still shows the diagram.
//
// Layout, colors and positions are lost on purpose. Only the standard
// library is used (docs/DEPENDENCIAS.md).

var drawioFormats = map[string]bool{".drawio": true, ".dio": true}

func isDrawioSource(name string) bool {
	return drawioFormats[strings.ToLower(filepath.Ext(name))]
}

// Bounds for what goes into a prompt and into the Mermaid block. A diagram
// above the Mermaid limits keeps its full element/connection lists; only the
// rendered flowchart is skipped, with a note saying so.
const (
	drawioMaxBytes        = 50 << 20
	drawioMaxInflated     = 50 << 20
	drawioMermaidMaxNodes = 150
	drawioMermaidMaxEdges = 300
	drawioMaxListedCells  = 3000
	literalOpenMarker     = "<!-- senpai:literal -->"
	literalCloseMarker    = "<!-- /senpai:literal -->"
)

// convertDrawioSource reads the diagram at sourcePath and returns its
// Markdown rendering, with the same provenance header as the other
// converted sources.
func convertDrawioSource(sourcePath string) ([]byte, error) {
	base := filepath.Base(sourcePath)
	info, err := os.Stat(sourcePath)
	if err != nil {
		return nil, fmt.Errorf("ler '%s': %w", base, err)
	}
	if info.Size() > drawioMaxBytes {
		return nil, fmt.Errorf("'%s' e grande demais para um diagrama (%d MB)", base, info.Size()>>20)
	}
	raw, err := os.ReadFile(sourcePath)
	if err != nil {
		return nil, fmt.Errorf("ler '%s': %w", base, err)
	}
	pages, err := parseDrawio(raw)
	if err != nil {
		return nil, fmt.Errorf("'%s' nao e um diagrama draw.io valido: %w", base, err)
	}
	body := drawioToMarkdown(pages)
	if strings.TrimSpace(body) == "" {
		return nil, fmt.Errorf("nenhum elemento encontrado em '%s' (diagrama vazio?)", base)
	}

	var b strings.Builder
	b.WriteString("# " + strings.TrimSuffix(base, filepath.Ext(base)) + "\n\n")
	b.WriteString("> Fonte: diagrama draw.io (" + base + ")  \n")
	b.WriteString("> Convertido em: " + time.Now().Format("2006-01-02 15:04") + "\n\n")
	b.WriteString(strings.TrimSpace(body))
	b.WriteString("\n")
	return []byte(b.String()), nil
}

// --- parsing -----------------------------------------------------------------

type drawioPage struct {
	name  string
	cells []*drawioCell
}

type drawioCell struct {
	id, parent, source, target string
	value, style               string
	vertex, edge               bool
	// attrs: the custom properties of an <object>/<UserObject> wrapper
	// ("Editar dados" in draw.io), tooltip and link included.
	attrs []xml.Attr
}

// drawioXMLNode is a generic element tree, like office_source.go's xmlNode.
type drawioXMLNode struct {
	XMLName xml.Name
	Attrs   []xml.Attr      `xml:",any,attr"`
	Content string          `xml:",chardata"`
	Nodes   []drawioXMLNode `xml:",any"`
}

func (n *drawioXMLNode) attr(name string) string {
	for _, a := range n.Attrs {
		if a.Name.Local == name {
			return a.Value
		}
	}
	return ""
}

func (n *drawioXMLNode) child(name string) *drawioXMLNode {
	for i := range n.Nodes {
		if n.Nodes[i].XMLName.Local == name {
			return &n.Nodes[i]
		}
	}
	return nil
}

// parseDrawio accepts an <mxfile> with one <diagram> per page — each either
// holding an <mxGraphModel> or, compressed, its deflated text — or a bare
// <mxGraphModel> (old files).
func parseDrawio(raw []byte) ([]drawioPage, error) {
	var root drawioXMLNode
	if err := xml.Unmarshal(raw, &root); err != nil {
		return nil, err
	}
	switch root.XMLName.Local {
	case "mxGraphModel":
		return []drawioPage{{name: "", cells: drawioCells(&root)}}, nil
	case "mxfile":
	default:
		return nil, fmt.Errorf("elemento raiz inesperado <%s>", root.XMLName.Local)
	}
	var pages []drawioPage
	for i := range root.Nodes {
		diagram := &root.Nodes[i]
		if diagram.XMLName.Local != "diagram" {
			continue
		}
		name := diagram.attr("name")
		model := diagram.child("mxGraphModel")
		if model == nil {
			text := strings.TrimSpace(diagram.Content)
			if text == "" {
				continue
			}
			decoded, err := inflateDrawioDiagram(text)
			if err != nil {
				return nil, fmt.Errorf("pagina %q: %w", name, err)
			}
			var inner drawioXMLNode
			if err := xml.Unmarshal(decoded, &inner); err != nil {
				return nil, fmt.Errorf("pagina %q: %w", name, err)
			}
			model = &inner
		}
		pages = append(pages, drawioPage{name: name, cells: drawioCells(model)})
	}
	if len(pages) == 0 {
		return nil, fmt.Errorf("nenhuma pagina <diagram> encontrada")
	}
	return pages, nil
}

// inflateDrawioDiagram undoes draw.io's compression: base64 of the raw
// deflate of the URI-encoded XML.
func inflateDrawioDiagram(text string) ([]byte, error) {
	compressed, err := base64.StdEncoding.DecodeString(text)
	if err != nil {
		return nil, fmt.Errorf("conteudo comprimido invalido (base64): %w", err)
	}
	reader := flate.NewReader(bytes.NewReader(compressed))
	defer reader.Close()
	inflated, err := io.ReadAll(io.LimitReader(reader, drawioMaxInflated+1))
	if err != nil {
		return nil, fmt.Errorf("conteudo comprimido invalido (deflate): %w", err)
	}
	if len(inflated) > drawioMaxInflated {
		return nil, fmt.Errorf("pagina descomprimida grande demais")
	}
	decoded, err := url.PathUnescape(string(inflated))
	if err != nil {
		return nil, fmt.Errorf("conteudo comprimido invalido (uri): %w", err)
	}
	return []byte(decoded), nil
}

// drawioCells flattens <root>: plain <mxCell>s, and <object>/<UserObject>
// wrappers whose id/label/properties live on the wrapper and the rest on the
// inner <mxCell>.
func drawioCells(model *drawioXMLNode) []*drawioCell {
	root := model.child("root")
	if root == nil {
		return nil
	}
	var cells []*drawioCell
	for i := range root.Nodes {
		node := &root.Nodes[i]
		switch node.XMLName.Local {
		case "mxCell":
			cells = append(cells, drawioCellFrom(node, node.attr("value"), node.attr("id"), nil))
		case "object", "UserObject":
			inner := node.child("mxCell")
			if inner == nil {
				continue
			}
			var attrs []xml.Attr
			for _, a := range node.Attrs {
				switch a.Name.Local {
				case "id", "label", "placeholders":
				default:
					attrs = append(attrs, a)
				}
			}
			label := node.attr("label")
			if node.attr("placeholders") == "1" {
				label = drawioPlaceholders(label, node)
			}
			cells = append(cells, drawioCellFrom(inner, label, node.attr("id"), attrs))
		}
	}
	return cells
}

func drawioCellFrom(node *drawioXMLNode, value, id string, attrs []xml.Attr) *drawioCell {
	return &drawioCell{
		id:     id,
		parent: node.attr("parent"),
		source: node.attr("source"),
		target: node.attr("target"),
		value:  value,
		style:  node.attr("style"),
		vertex: node.attr("vertex") == "1",
		edge:   node.attr("edge") == "1",
		attrs:  attrs,
	}
}

var drawioPlaceholder = regexp.MustCompile(`%([A-Za-z0-9_]+)%`)

func drawioPlaceholders(label string, node *drawioXMLNode) string {
	return drawioPlaceholder.ReplaceAllStringFunc(label, func(match string) string {
		if value := node.attr(match[1 : len(match)-1]); value != "" {
			return value
		}
		return match
	})
}

// --- labels and kinds --------------------------------------------------------

var (
	drawioLineBreak = regexp.MustCompile(`(?i)<br\s*/?>|</(div|p|li|h[1-6])>`)
	drawioTag       = regexp.MustCompile(`<[^>]*>`)
)

// drawioLabel turns a cell value (plain text, or HTML with html=1) into one
// line of text.
func drawioLabel(value string) string {
	text := drawioLineBreak.ReplaceAllString(value, " ")
	text = drawioTag.ReplaceAllString(text, "")
	text = html.UnescapeString(text)
	return strings.Join(strings.Fields(text), " ")
}

func drawioStyle(style string) map[string]string {
	out := map[string]string{}
	for i, part := range strings.Split(style, ";") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		key, value, found := strings.Cut(part, "=")
		if !found {
			if i == 0 {
				out["_base"] = part
			}
			continue
		}
		out[key] = value
	}
	return out
}

var drawioVendors = map[string]string{
	"aws3": "AWS", "aws4": "AWS", "azure": "Azure", "azure2": "Azure", "gcp": "GCP", "gcp2": "GCP",
	"kubernetes": "Kubernetes", "cisco": "Cisco", "cisco19": "Cisco", "office": "Office",
}

var drawioKnownShapes = map[string]string{
	"cylinder": "banco de dados", "cylinder2": "banco de dados", "cylinder3": "banco de dados", "datastore": "banco de dados",
	"umlActor": "ator", "actor": "ator", "rhombus": "decisão", "note": "nota", "document": "documento",
	"cloud": "nuvem", "queue": "fila", "process": "processo", "hexagon": "hexágono", "folder": "pasta",
	"umlLifeline": "linha de vida", "swimlane": "contêiner", "table": "tabela", "parallelogram": "entrada/saída",
}

// drawioKind: a short human name for a cell's shape ("" for a plain box).
func drawioKind(style map[string]string) string {
	if icon := style["resIcon"]; icon != "" {
		return drawioLibraryShape(icon)
	}
	shape := style["shape"]
	if strings.HasPrefix(shape, "mxgraph.") {
		return drawioLibraryShape(shape)
	}
	if kind, ok := drawioKnownShapes[shape]; ok {
		return kind
	}
	if kind, ok := drawioKnownShapes[style["_base"]]; ok {
		return kind
	}
	if style["container"] == "1" || style["_base"] == "group" {
		return "contêiner"
	}
	return ""
}

// "mxgraph.aws4.api_gateway" → "AWS api gateway"; "mxgraph.flowchart.database"
// → "database".
func drawioLibraryShape(shape string) string {
	parts := strings.Split(strings.TrimPrefix(shape, "mxgraph."), ".")
	if len(parts) == 0 {
		return ""
	}
	name := drawioHumanize(parts[len(parts)-1])
	if vendor, ok := drawioVendors[parts[0]]; ok && len(parts) > 1 {
		return vendor + " " + name
	}
	if kind, ok := drawioKnownShapes[parts[len(parts)-1]]; ok {
		return kind
	}
	return name
}

func drawioHumanize(name string) string {
	var b strings.Builder
	prev := rune(0)
	for _, r := range name {
		switch {
		case r == '_' || r == '-':
			b.WriteRune(' ')
		case unicode.IsUpper(r) && unicode.IsLower(prev):
			b.WriteRune(' ')
			b.WriteRune(unicode.ToLower(r))
		default:
			b.WriteRune(r)
		}
		prev = r
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

// --- the graph of one page ---------------------------------------------------

type drawioNode struct {
	cell      *drawioCell
	label     string
	kind      string
	container bool
	freeText  bool
	children  []*drawioNode
	parent    *drawioNode
}

type drawioEdge struct {
	from, to *drawioNode
	label    string
	arrow    string // "→", "↔" or "—"
}

type drawioGraph struct {
	roots []*drawioNode
	nodes []*drawioNode
	edges []drawioEdge
	notes []string
}

func buildDrawioGraph(cells []*drawioCell) drawioGraph {
	byID := map[string]*drawioCell{}
	for _, c := range cells {
		byID[c.id] = c
	}
	// Layers: children of the model root (cell "0").
	isLayer := func(id string) bool {
		c, ok := byID[id]
		return ok && !c.vertex && !c.edge && (c.parent == "" || byID[c.parent] == nil || byID[c.parent].parent == "")
	}

	var g drawioGraph
	nodes := map[string]*drawioNode{}
	edgeLabels := map[string][]string{}
	hasChildren := map[string]bool{}
	for _, c := range cells {
		if c.vertex {
			hasChildren[c.parent] = true
		}
	}
	for _, c := range cells {
		if !c.vertex {
			continue
		}
		// A label sitting on an edge (style edgeLabel, parent = the edge).
		if parent := byID[c.parent]; parent != nil && parent.edge {
			if label := drawioLabel(c.value); label != "" {
				edgeLabels[parent.id] = append(edgeLabels[parent.id], label)
			}
			continue
		}
		style := drawioStyle(c.style)
		n := &drawioNode{cell: c, label: drawioLabel(c.value), kind: drawioKind(style)}
		n.container = hasChildren[c.id] || style["_base"] == "swimlane" || style["container"] == "1" || n.kind == "contêiner"
		n.freeText = style["_base"] == "text"
		nodes[c.id] = n
	}
	for _, c := range cells {
		n := nodes[c.id]
		if n == nil {
			continue
		}
		if parent := nodes[c.parent]; parent != nil && !isLayer(c.parent) {
			n.parent = parent
			parent.children = append(parent.children, n)
		}
	}

	connected := map[*drawioNode]bool{}
	for _, c := range cells {
		if !c.edge {
			continue
		}
		from, to := nodes[c.source], nodes[c.target]
		if from == nil && to == nil {
			continue
		}
		style := drawioStyle(c.style)
		labels := edgeLabels[c.id]
		if own := drawioLabel(c.value); own != "" {
			labels = append([]string{own}, labels...)
		}
		label := strings.Join(labels, " / ")
		g.edges = append(g.edges, drawioEdge{from: from, to: to, label: label, arrow: drawioArrow(style)})
		connected[from] = true
		connected[to] = true
	}

	// Free text with no connection is an annotation on the canvas, not an
	// element; an unlabeled plain box with nothing inside or attached is
	// decoration.
	for _, c := range cells {
		n := nodes[c.id]
		if n == nil {
			continue
		}
		if n.freeText && !connected[n] && len(n.children) == 0 {
			if n.label != "" {
				g.notes = append(g.notes, n.label)
			}
			n.cell = nil
			continue
		}
		if n.label == "" && n.kind == "" && !connected[n] && len(n.children) == 0 && len(c.attrs) == 0 {
			n.cell = nil
			continue
		}
		g.nodes = append(g.nodes, n)
	}
	for _, n := range g.nodes {
		if n.parent == nil || n.parent.cell == nil {
			g.roots = append(g.roots, n)
		}
	}
	return g
}

func drawioArrow(style map[string]string) string {
	end := style["endArrow"] != "none"
	start := style["startArrow"] != "" && style["startArrow"] != "none"
	switch {
	case start && end:
		return "↔"
	case start:
		return "←"
	case end:
		return "→"
	default:
		return "—"
	}
}

func (n *drawioNode) name() string {
	if n == nil {
		return "(ponta solta)"
	}
	if n.label != "" {
		return n.label
	}
	if n.kind != "" {
		return n.kind
	}
	return "(sem rótulo)"
}

// --- rendering ---------------------------------------------------------------

func drawioToMarkdown(pages []drawioPage) string {
	var b strings.Builder
	for i, page := range pages {
		g := buildDrawioGraph(page.cells)
		if len(g.nodes) == 0 && len(g.notes) == 0 {
			continue
		}
		name := page.name
		if name == "" {
			name = "Página " + strconv.Itoa(i+1)
		}
		heading := "## " + name
		if len(pages) == 1 {
			heading = "## Diagrama: " + name
		}
		b.WriteString(heading + "\n\n")

		if len(g.nodes) > 0 {
			b.WriteString("### Elementos\n\n")
			listed := 0
			for _, root := range g.roots {
				writeDrawioNode(&b, root, 0, &listed)
			}
			if listed >= drawioMaxListedCells {
				b.WriteString("\n(lista cortada em " + strconv.Itoa(drawioMaxListedCells) + " elementos)\n")
			}
			b.WriteString("\n")
		}
		if len(g.edges) > 0 {
			b.WriteString("### Conexões\n\n")
			for i, e := range g.edges {
				if i >= drawioMaxListedCells {
					b.WriteString("(lista cortada em " + strconv.Itoa(drawioMaxListedCells) + " conexões)\n")
					break
				}
				line := "- " + e.from.name() + " " + e.arrow + " " + e.to.name()
				if e.label != "" {
					line += ": " + e.label
				}
				b.WriteString(line + "\n")
			}
			b.WriteString("\n")
		}
		if len(g.notes) > 0 {
			b.WriteString("### Textos soltos no diagrama\n\n")
			for _, note := range g.notes {
				b.WriteString("- " + note + "\n")
			}
			b.WriteString("\n")
		}
		if len(g.nodes) > 0 {
			b.WriteString(drawioMermaidBlock(name, g) + "\n\n")
		}
	}
	return b.String()
}

func writeDrawioNode(b *strings.Builder, n *drawioNode, depth int, listed *int) {
	if n.cell == nil {
		for _, child := range n.children {
			writeDrawioNode(b, child, depth, listed)
		}
		return
	}
	if *listed >= drawioMaxListedCells {
		return
	}
	*listed++
	indent := strings.Repeat("  ", depth)
	line := indent + "- " + n.name()
	if n.kind != "" && n.label != "" {
		line += " (" + n.kind + ")"
	}
	if n.container && len(n.children) > 0 {
		line += " — contém:"
	}
	b.WriteString(line + "\n")
	for _, a := range n.cell.attrs {
		value := strings.TrimSpace(drawioLabel(a.Value))
		if value == "" {
			continue
		}
		key := a.Name.Local
		switch key {
		case "tooltip":
			key = "dica"
		case "link":
			key = "link"
		}
		b.WriteString(indent + "  - " + key + ": " + value + "\n")
	}
	for _, child := range n.children {
		writeDrawioNode(b, child, depth+1, listed)
	}
}

// drawioMermaidBlock renders the page as a Mermaid flowchart inside a
// LiteralBlocks marker. Containers become subgraphs.
func drawioMermaidBlock(pageName string, g drawioGraph) string {
	edges := 0
	for _, e := range g.edges {
		if e.from != nil && e.to != nil {
			edges++
		}
	}
	title := "## Diagrama (Mermaid): " + pageName + "\n\n"
	if len(g.nodes) > drawioMermaidMaxNodes || edges > drawioMermaidMaxEdges {
		return literalOpenMarker + "\n" + title + "Diagrama grande demais para o bloco Mermaid (" +
			strconv.Itoa(len(g.nodes)) + " elementos, " + strconv.Itoa(edges) + " conexões); as listas acima estão completas.\n" + literalCloseMarker
	}
	ids := map[*drawioNode]string{}
	for i, n := range g.nodes {
		ids[n] = "n" + strconv.Itoa(i+1)
	}
	var b strings.Builder
	b.WriteString("flowchart LR\n")
	var write func(n *drawioNode, depth int)
	write = func(n *drawioNode, depth int) {
		if n.cell == nil {
			for _, child := range n.children {
				write(child, depth)
			}
			return
		}
		indent := strings.Repeat("  ", depth+1)
		if n.container && len(n.children) > 0 {
			b.WriteString(indent + "subgraph " + ids[n] + "[\"" + mermaidText(n.name()) + "\"]\n")
			for _, child := range n.children {
				write(child, depth+1)
			}
			b.WriteString(indent + "end\n")
			return
		}
		b.WriteString(indent + ids[n] + mermaidShape(n) + "\n")
	}
	for _, root := range g.roots {
		write(root, 0)
	}
	for _, e := range g.edges {
		if e.from == nil || e.to == nil || ids[e.from] == "" || ids[e.to] == "" {
			continue
		}
		link := map[string]string{"→": "-->", "←": "<--", "↔": "<-->", "—": "---"}[e.arrow]
		label := ""
		if e.label != "" {
			label = "|\"" + mermaidText(e.label) + "\"|"
		}
		b.WriteString("  " + ids[e.from] + " " + link + label + " " + ids[e.to] + "\n")
	}
	return literalOpenMarker + "\n" + title + "```mermaid\n" + b.String() + "```\n" + literalCloseMarker
}

func mermaidShape(n *drawioNode) string {
	text := "\"" + mermaidText(n.name()) + "\""
	switch n.kind {
	case "banco de dados":
		return "[(" + text + ")]"
	case "decisão":
		return "{" + text + "}"
	case "ator":
		return "((" + text + "))"
	default:
		return "[" + text + "]"
	}
}

// mermaidText escapes what would end a quoted Mermaid label.
func mermaidText(text string) string {
	return strings.NewReplacer("\"", "#quot;", "|", "#124;", "`", "'").Replace(text)
}
