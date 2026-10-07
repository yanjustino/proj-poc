package main

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const (
	nsW   = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"`
	nsA   = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"`
	nsP   = `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`
	nsR   = `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`
	nsS   = `xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"`
	nsRel = `xmlns="http://schemas.openxmlformats.org/package/2006/relationships"`
)

// writeOfficeZip writes parts (package path -> XML) as a zip named name in a
// temp dir and returns its path.
func writeOfficeZip(t *testing.T, name string, parts map[string]string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	f, err := os.Create(path)
	if err != nil {
		t.Fatalf("create zip: %v", err)
	}
	zw := zip.NewWriter(f)
	for part, body := range parts {
		w, err := zw.Create(part)
		if err != nil {
			t.Fatalf("zip part %s: %v", part, err)
		}
		if _, err := w.Write([]byte(body)); err != nil {
			t.Fatalf("write part %s: %v", part, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	if err := f.Close(); err != nil {
		t.Fatalf("close file: %v", err)
	}
	return path
}

func convertForTest(t *testing.T, path string) string {
	t.Helper()
	body, err := convertOfficeSource(path)
	if err != nil {
		t.Fatalf("convertOfficeSource: %v", err)
	}
	return string(body)
}

func assertContains(t *testing.T, got string, wants ...string) {
	t.Helper()
	for _, want := range wants {
		if !strings.Contains(got, want) {
			t.Errorf("expected output to contain %q, got:\n%s", want, got)
		}
	}
}

func TestConvertOfficeSource_Docx(t *testing.T) {
	path := writeOfficeZip(t, "Contrato.docx", map[string]string{
		"word/styles.xml": `<w:styles ` + nsW + `>
			<w:style w:type="paragraph" w:styleId="Ttulo1"><w:name w:val="heading 1"/></w:style>
		</w:styles>`,
		"word/document.xml": `<w:document ` + nsW + `><w:body>
			<w:p><w:pPr><w:pStyle w:val="Ttulo1"/></w:pPr><w:r><w:t>Cláusulas</w:t></w:r></w:p>
			<w:p><w:r><w:t xml:space="preserve">O boleto vence </w:t></w:r><w:r><w:t>no dia 10.</w:t></w:r><w:del><w:r><w:delText>dia 5</w:delText></w:r></w:del></w:p>
			<w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>item aninhado</w:t></w:r></w:p>
			<w:tbl>
				<w:tr><w:tc><w:p><w:r><w:t>Campo</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Tipo</w:t></w:r></w:p></w:tc></w:tr>
				<w:tr><w:tc><w:p><w:r><w:t>valor|bruto</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>decimal</w:t></w:r></w:p></w:tc></w:tr>
			</w:tbl>
			<w:sectPr/>
		</w:body></w:document>`,
	})
	got := convertForTest(t, path)
	assertContains(t, got,
		"# Contrato\n",
		"> Fonte: documento Word (Contrato.docx)",
		"## Cláusulas\n",
		"O boleto vence no dia 10.\n",
		"  - item aninhado\n",
		"| Campo | Tipo |\n| --- | --- |\n| valor\\|bruto | decimal |\n",
	)
	if strings.Contains(got, "dia 5") {
		t.Errorf("deleted (tracked-change) text leaked into output:\n%s", got)
	}
}

func TestConvertOfficeSource_Pptx(t *testing.T) {
	slide := func(title, body string) string {
		return `<p:sld ` + nsA + ` ` + nsP + `><p:cSld><p:spTree>
			<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>` + title + `</a:t></a:r></a:p></p:txBody></p:sp>
			<p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr><p:txBody>` + body + `</p:txBody></p:sp>
			<p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:fld><a:t>99</a:t></a:fld></a:p></p:txBody></p:sp>
		</p:spTree></p:cSld></p:sld>`
	}
	path := writeOfficeZip(t, "Kickoff.pptx", map[string]string{
		"ppt/presentation.xml": `<p:presentation ` + nsP + ` ` + nsR + `><p:sldIdLst>
			<p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/>
		</p:sldIdLst></p:presentation>`,
		"ppt/_rels/presentation.xml.rels": `<Relationships ` + nsRel + `>
			<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
			<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
		</Relationships>`,
		// slide2 comes first in sldIdLst: order must follow the presentation.
		"ppt/slides/slide2.xml": slide("Objetivos", `<a:p><a:r><a:t>Reduzir inadimplência</a:t></a:r></a:p><a:p><a:pPr lvl="1"/><a:r><a:t>em 10%</a:t></a:r></a:p>`),
		"ppt/slides/slide1.xml": slide("Próximos passos", `<a:p><a:r><a:t>Piloto em março</a:t></a:r></a:p>`),
		"ppt/slides/_rels/slide2.xml.rels": `<Relationships ` + nsRel + `>
			<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>
		</Relationships>`,
		"ppt/notesSlides/notesSlide1.xml": `<p:notes ` + nsA + ` ` + nsP + `><p:cSld><p:spTree>
			<p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Lembrar do jurídico</a:t></a:r></a:p></p:txBody></p:sp>
		</p:spTree></p:cSld></p:notes>`,
	})
	got := convertForTest(t, path)
	assertContains(t, got,
		"> Fonte: apresentação PowerPoint (Kickoff.pptx)",
		"## Slide 1 — Objetivos\n\n- Reduzir inadimplência\n  - em 10%\n",
		"**Notas do apresentador:**\n\nLembrar do jurídico",
		"## Slide 2 — Próximos passos\n\n- Piloto em março\n",
	)
	if strings.Contains(got, "99") {
		t.Errorf("slide-number placeholder leaked into output:\n%s", got)
	}
}

func TestConvertOfficeSource_Xlsx(t *testing.T) {
	path := writeOfficeZip(t, "Tarifas.xlsx", map[string]string{
		"xl/workbook.xml": `<workbook ` + nsS + ` ` + nsR + `><sheets>
			<sheet name="Tarifas" sheetId="1" r:id="rId1"/>
			<sheet name="Vazia" sheetId="2" r:id="rId2"/>
		</sheets></workbook>`,
		"xl/_rels/workbook.xml.rels": `<Relationships ` + nsRel + `>
			<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
			<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet2.xml"/>
		</Relationships>`,
		"xl/sharedStrings.xml": `<sst ` + nsS + `><si><t>Produto</t></si><si><t>Vigência</t></si><si><r><t>Boleto </t></r><r><t>PJ</t></r></si></sst>`,
		"xl/styles.xml":        `<styleSheet ` + nsS + `><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`,
		"xl/worksheets/sheet1.xml": `<worksheet ` + nsS + `><sheetData>
			<row r="1"><c r="B1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>Valor</t></is></c></row>
			<row r="2"/>
			<row r="3"><c r="B3" t="s"><v>2</v></c><c r="C3" s="1"><v>45658</v></c><c r="D3"><v>2.5</v></c></row>
			<row r="4"><c r="F4" t="str"><v></v></c></row>
		</sheetData></worksheet>`,
		"xl/worksheets/sheet2.xml": `<worksheet ` + nsS + `><sheetData/></worksheet>`,
	})
	got := convertForTest(t, path)
	assertContains(t, got,
		"> Fonte: planilha Excel (Tarifas.xlsx)",
		"## Planilha: Tarifas\n\n| Produto | Vigência | Valor |\n| --- | --- | --- |\n| Boleto PJ | 2025-01-01 | 2.5 |\n",
		"## Planilha: Vazia\n\n_(vazia)_",
	)
}

func TestConvertOfficeSource_RejectsNonZip(t *testing.T) {
	path := writeTempFile(t, "antigo.docx", "isto nao e um zip")
	if _, err := convertOfficeSource(path); err == nil || !strings.Contains(err.Error(), "nao e um arquivo Office valido") {
		t.Fatalf("expected a clear invalid-office error, got %v", err)
	}
}

// TestAddRawFile_ConvertsOfficeToMarkdown proves an Office upload lands in
// raw/ as "<name>.md" (a format RawExtract reads), never as the binary.
func TestAddRawFile_ConvertsOfficeToMarkdown(t *testing.T) {
	app, _ := newTestApp(t)
	projectID := createTestProject(t, app, "AddRawFile office", "historia")

	src := writeOfficeZip(t, "Ata.docx", map[string]string{
		"word/document.xml": `<w:document ` + nsW + `><w:body><w:p><w:r><w:t>Decidimos usar Pix.</w:t></w:r></w:p></w:body></w:document>`,
	})
	name, err := app.AddRawFile(projectID, src)
	if err != nil {
		t.Fatalf("AddRawFile: %v", err)
	}
	if name != "Ata.docx.md" {
		t.Fatalf("expected \"Ata.docx.md\", got %q", name)
	}
	rawDir := filepath.Join(app.DataDir(), "projects", projectID, "raw")
	got, err := os.ReadFile(filepath.Join(rawDir, name))
	if err != nil {
		t.Fatalf("read converted file: %v", err)
	}
	assertContains(t, string(got), "Decidimos usar Pix.")
	if _, err := os.Stat(filepath.Join(rawDir, "Ata.docx")); !os.IsNotExist(err) {
		t.Fatalf("the original binary must not be copied into raw/ (stat err: %v)", err)
	}
}
