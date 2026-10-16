package main

import (
	"bytes"
	"compress/flate"
	"encoding/base64"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// A small architecture diagram exercising what the conversion keeps:
// a container, HTML labels, a database and an AWS icon, an <object> with
// properties, an edge label on its own cell, an undirected link, free text
// and an unlabeled decoration box.
const drawioSampleModel = `<mxGraphModel><root>
<mxCell id="0"/>
<mxCell id="1" parent="0"/>
<mxCell id="ctx" value="Contexto Pagamentos" style="swimlane;html=1;" vertex="1" parent="1"/>
<mxCell id="api" value="&lt;b&gt;API&lt;/b&gt;&lt;br&gt;Gateway" style="rounded=1;html=1;" vertex="1" parent="ctx"/>
<mxCell id="fn" value="" style="sketch=0;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;" vertex="1" parent="ctx"/>
<mxCell id="db" value="Pedidos" style="shape=cylinder3;whiteSpace=wrap;" vertex="1" parent="1"/>
<UserObject id="user" label="Cliente %canal%" placeholders="1" canal="mobile" tooltip="Quem compra" dono="Time B"><mxCell style="shape=umlActor;" vertex="1" parent="1"/></UserObject>
<mxCell id="e1" value="" style="edgeStyle=orthogonalEdgeStyle;" edge="1" parent="1" source="user" target="api"/>
<mxCell id="e1l" value="chama" style="edgeLabel;html=1;" vertex="1" connectable="0" parent="e1"/>
<mxCell id="e2" value="grava" style="endArrow=classic;" edge="1" parent="1" source="fn" target="db"/>
<mxCell id="e3" value="" style="endArrow=none;" edge="1" parent="1" source="api" target="fn"/>
<mxCell id="t" value="Rascunho v2" style="text;html=1;" vertex="1" parent="1"/>
<mxCell id="deco" value="" style="rounded=0;" vertex="1" parent="1"/>
</root></mxGraphModel>`

func writeDrawioFile(t *testing.T, name, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func compressDrawioModel(t *testing.T, model string) string {
	t.Helper()
	var buf bytes.Buffer
	w, err := flate.NewWriter(&buf, flate.BestCompression)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write([]byte(url.PathEscape(model))); err != nil {
		t.Fatal(err)
	}
	w.Close()
	return base64.StdEncoding.EncodeToString(buf.Bytes())
}

func convertDrawioString(t *testing.T, name, content string) string {
	t.Helper()
	body, err := convertDrawioSource(writeDrawioFile(t, name, content))
	if err != nil {
		t.Fatal(err)
	}
	return string(body)
}

func mustContain(t *testing.T, text string, wants ...string) {
	t.Helper()
	for _, want := range wants {
		if !strings.Contains(text, want) {
			t.Fatalf("expected %q in:\n%s", want, text)
		}
	}
}

func TestDrawioConversionListsElementsContainersAndConnections(t *testing.T) {
	md := convertDrawioString(t, "arquitetura.drawio", `<mxfile><diagram name="Visão geral">`+drawioSampleModel+`</diagram></mxfile>`)
	mustContain(t, md,
		"# arquitetura\n",
		"> Fonte: diagrama draw.io (arquitetura.drawio)",
		"## Diagrama: Visão geral",
		"- Contexto Pagamentos (contêiner) — contém:\n  - API Gateway\n  - AWS lambda\n",
		"- Pedidos (banco de dados)\n",
		"- Cliente mobile (ator)\n  - canal: mobile\n  - dica: Quem compra\n  - dono: Time B\n",
		"- Cliente mobile → API Gateway: chama\n",
		"- AWS lambda → Pedidos: grava\n",
		"- API Gateway — AWS lambda\n",
		"### Textos soltos no diagrama\n\n- Rascunho v2\n",
	)
	if strings.Contains(md, "(sem rótulo)") {
		t.Fatalf("an unlabeled decoration box should be dropped:\n%s", md)
	}
}

// The Mermaid block sits inside the LiteralBlocks markers the ingest copies
// into the source's wiki page untouched.
func TestDrawioConversionRendersAMermaidFlowchartAsALiteralBlock(t *testing.T) {
	md := convertDrawioString(t, "a.drawio", `<mxfile><diagram name="P1">`+drawioSampleModel+`</diagram></mxfile>`)
	open := strings.Index(md, literalOpenMarker)
	end := strings.Index(md, literalCloseMarker)
	if open < 0 || end < open {
		t.Fatalf("expected a literal block in:\n%s", md)
	}
	block := md[open:end]
	mustContain(t, block,
		"## Diagrama (Mermaid): P1\n\n```mermaid\nflowchart LR\n",
		"  subgraph n1[\"Contexto Pagamentos\"]\n    n2[\"API Gateway\"]\n    n3[\"AWS lambda\"]\n  end\n",
		"  n4[(\"Pedidos\")]\n",
		"  n5((\"Cliente mobile\"))\n",
		"  n5 -->|\"chama\"| n2\n",
		"  n2 --- n3\n",
		"```\n",
	)
}

func TestDrawioConversionReadsCompressedPagesAndBareModels(t *testing.T) {
	compressed := `<mxfile host="app.diagrams.net"><diagram id="a" name="Comprimida">` + compressDrawioModel(t, drawioSampleModel) + `</diagram>` +
		`<diagram id="b" name="Segunda">` + drawioSampleModel + `</diagram></mxfile>`
	md := convertDrawioString(t, "multi.drawio", compressed)
	mustContain(t, md, "## Comprimida\n", "## Segunda\n", "- Cliente mobile → API Gateway: chama")

	bare := convertDrawioString(t, "antigo.dio", drawioSampleModel)
	mustContain(t, bare, "## Diagrama: Página 1\n", "- Pedidos (banco de dados)")
}

func TestDrawioConversionSkipsMermaidForAHugeDiagram(t *testing.T) {
	var b strings.Builder
	b.WriteString(`<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>`)
	for i := 0; i <= drawioMermaidMaxNodes; i++ {
		b.WriteString(`<mxCell id="v` + strconv.Itoa(i) + `" value="N` + strconv.Itoa(i) + `" vertex="1" parent="1"/>`)
	}
	b.WriteString(`</root></mxGraphModel>`)
	md := convertDrawioString(t, "grande.drawio", b.String())
	mustContain(t, md, "Diagrama grande demais para o bloco Mermaid", "- N150\n")
	if strings.Contains(md, "```mermaid") {
		t.Fatal("expected no mermaid block for a huge diagram")
	}
}

func TestDrawioConversionRejectsWhatIsNotADiagram(t *testing.T) {
	for name, content := range map[string]string{
		"html.drawio":  "<html><body>oi</body></html>",
		"vazio.drawio": `<mxfile><diagram name="P"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>`,
		"lixo.drawio":  `<mxfile><diagram name="P">não é base64!</diagram></mxfile>`,
	} {
		if _, err := convertDrawioSource(writeDrawioFile(t, name, content)); err == nil {
			t.Fatalf("expected an error for %s", name)
		}
	}
}

func TestAddRawFileStoresADrawioDiagramConverted(t *testing.T) {
	app, rawDir := rebuildTestApp(t, nil, nil)
	src := writeDrawioFile(t, "Arquitetura.drawio", `<mxfile><diagram name="P">`+drawioSampleModel+`</diagram></mxfile>`)
	name, err := app.AddRawFile("wi_1", src)
	if err != nil {
		t.Fatal(err)
	}
	if name != "Arquitetura.drawio.md" {
		t.Fatalf("expected Arquitetura.drawio.md, got %q", name)
	}
	body, err := os.ReadFile(filepath.Join(rawDir, name))
	if err != nil {
		t.Fatal(err)
	}
	mustContain(t, string(body), "- Pedidos (banco de dados)")
}
