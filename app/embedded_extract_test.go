package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"senpai-app/mhlbridge"
)

// TestResolveWorkflowsDir_PrefersLiveCheckout is a regression guard for the
// dev-loop guarantee resolveWorkflowsDir's doc comment promises: running
// from this repo's app/ directory (exactly what go test does) must resolve
// tier 1 (../workflows) — the real, live, editable tree — never fall
// through to extracting the embedded copy. If this ever starts returning a
// path under a user config dir instead, editing a .mh file would silently
// stop affecting go test/wails dev.
func TestResolveWorkflowsDir_PrefersLiveCheckout(t *testing.T) {
	dir, err := resolveWorkflowsDir()
	if err != nil {
		t.Fatalf("resolveWorkflowsDir: %v", err)
	}
	wantSuffix := filepath.Join("senpai.info.nosync", "workflows")
	if !strings.HasSuffix(dir, wantSuffix) {
		t.Fatalf("expected the live repo workflows dir (ending in %q), got: %s", wantSuffix, dir)
	}
	if _, err := os.Stat(filepath.Join(dir, filepath.FromSlash(workflowsMarker))); err != nil {
		t.Fatalf("resolved dir doesn't look like a real workflows tree: %v", err)
	}
}

// TestExtractVendoredWorkflows_IsARealRunnableTree is the actual Fase 7
// scenario resolveWorkflowsDir's tier 3 exists for: a packaged app with no
// dev checkout nearby. Rather than trust that copying files worked, this
// points a real mhl bridge directly at the extracted directory (bypassing
// resolveWorkflowsDir's live-checkout preference on purpose) and drives a
// real WorkItem call through it — proving the embedded copy is a complete,
// independently runnable workflows tree, not just "files landed on disk".
func TestExtractVendoredWorkflows_IsARealRunnableTree(t *testing.T) {
	workflowsDir, err := extractVendoredWorkflows()
	if err != nil {
		t.Fatalf("extractVendoredWorkflows: %v", err)
	}
	if _, err := os.Stat(filepath.Join(workflowsDir, filepath.FromSlash(workflowsMarker))); err != nil {
		t.Fatalf("extracted tree missing marker file: %v", err)
	}

	mhlPath, err := ensureVendoredMHL()
	if err != nil {
		t.Fatalf("ensureVendoredMHL: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	client, err := mhlbridge.Start(ctx, mhlPath, workflowsDir, "", t.TempDir(), "", "", "", "", "", "")
	if err != nil {
		t.Fatalf("mhlbridge.Start against the extracted embedded workflows dir: %v", err)
	}
	defer client.Stop()

	status, err := client.RunStart(ctx, "WorkItem", map[string]any{"action": "list"})
	if err != nil {
		t.Fatalf("RunStart(WorkItem list) against the extracted tree: %v", err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for status.State == "working" || status.State == "queued" {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for WorkItem list to complete, last state: %s", status.State)
		}
		time.Sleep(100 * time.Millisecond)
		status, err = client.RunStatusGet(ctx, status.RunID)
		if err != nil {
			t.Fatalf("RunStatusGet: %v", err)
		}
	}
	if status.State != "completed" {
		t.Fatalf("expected the embedded tree to run WorkItem successfully, got state %q (error: %s)", status.State, status.Error)
	}
}

// minimalPDF is a one-page PDF whose only content is the text "Ola Senpai".
// The xref table is deliberately omitted: poppler rebuilds it, which keeps
// the fixture readable instead of hand-counting byte offsets.
const minimalPDF = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 44 >> stream
BT /F1 18 Tf 20 50 Td (Ola Senpai) Tj ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
trailer << /Root 1 0 R /Size 6 >>
%%EOF
`

// TestEnsureVendoredPdftotext_ExtractsARunnableBinary is what RawExtract
// depends on: after the extraction the returned directory must hold a
// pdftotext that runs on its own (no poppler on the machine) and turns a PDF
// into text, with PATH pointing at it first.
func TestEnsureVendoredPdftotext_ExtractsARunnableBinary(t *testing.T) {
	if !vendoredPdftotextAvailable {
		t.Skip("no vendored pdftotext for this GOOS/GOARCH")
	}
	t.Setenv("SENPAI_APPDATA_DIR", t.TempDir())

	dir, err := ensureVendoredPdftotext()
	if err != nil {
		t.Fatalf("ensureVendoredPdftotext: %v", err)
	}
	bin := filepath.Join(dir, vendoredPdftotextBinaryName)
	if _, err := os.Stat(bin); err != nil {
		t.Fatalf("extracted binary missing: %v", err)
	}

	pdf := filepath.Join(t.TempDir(), "ata.pdf")
	if err := os.WriteFile(pdf, []byte(minimalPDF), 0o644); err != nil {
		t.Fatal(err)
	}
	// Empty PATH: only the extracted binary may satisfy the call.
	t.Setenv("PATH", "")
	prependToPath(dir)
	cmd := exec.Command("pdftotext", pdf, "-")
	if filepath.Base(cmd.Path) != vendoredPdftotextBinaryName || filepath.Dir(cmd.Path) != dir {
		t.Fatalf("pdftotext resolved to %q, want the vendored copy in %q", cmd.Path, dir)
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("running vendored pdftotext: %v\n%s", err, out)
	}
	if !strings.Contains(string(out), "Ola Senpai") {
		t.Fatalf("expected the PDF text in the output, got: %q", out)
	}
}

// TestExtractIfChanged_RestoresTheExecBitOfAnUnchangedBinary: same bytes on
// disk but without the exec bit (a copied or restored config folder) must
// not be skipped as "already extracted" — that left mhl failing with
// "permission denied" on every launch.
func TestExtractIfChanged_RestoresTheExecBitOfAnUnchangedBinary(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("no exec bit on Windows")
	}
	dest := filepath.Join(t.TempDir(), "mhl")
	content := []byte("#!/bin/sh\necho ok\n")
	if err := os.WriteFile(dest, content, 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := extractIfChanged(dest, content, 0o755); err != nil {
		t.Fatalf("extractIfChanged: %v", err)
	}
	info, err := os.Stat(dest)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if info.Mode().Perm()&0o111 != 0o111 {
		t.Fatalf("mode = %v, want the exec bits restored", info.Mode().Perm())
	}
}
