package mhlbridge

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLookPathIn_FindsTheFirstExecutableOnThePath(t *testing.T) {
	first, second := t.TempDir(), t.TempDir()
	for _, dir := range []string{first, second} {
		if err := os.WriteFile(filepath.Join(dir, "devin"), []byte("#!/bin/sh\n"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(first, "codex"), []byte("not executable"), 0o644); err != nil {
		t.Fatal(err)
	}
	path := first + string(os.PathListSeparator) + second
	if got := lookPathIn("devin", path); got != filepath.Join(first, "devin") {
		t.Fatalf("devin = %q, want the one in %s", got, first)
	}
	if got := lookPathIn("codex", path); got != "" {
		t.Fatalf("codex = %q, want empty (not executable)", got)
	}
}
