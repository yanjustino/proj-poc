package main

import (
	"context"
	"os"
	"path/filepath"
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
	client, err := mhlbridge.Start(ctx, mhlPath, workflowsDir, "", t.TempDir(), "", "", "", "")
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
