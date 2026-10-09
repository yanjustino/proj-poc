package mhlbridge

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestPermissionHint_NamesTheMissingExecBit(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("no exec bit on Windows")
	}
	path := filepath.Join(t.TempDir(), "mhl")
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	err := exec.Command(path).Start()
	if err == nil {
		t.Fatal("starting a non-executable file succeeded")
	}
	if hint := permissionHint(err, path); !strings.Contains(hint, "chmod +x") {
		t.Fatalf("hint = %q, want the chmod advice", hint)
	}

	if err := os.Chmod(path, 0o755); err != nil {
		t.Fatalf("chmod: %v", err)
	}
	if hint := permissionHint(err, path); !strings.Contains(hint, "noexec") {
		t.Fatalf("hint with the exec bit set = %q, want the noexec advice", hint)
	}
	if hint := permissionHint(os.ErrNotExist, path); hint != "" {
		t.Fatalf("hint for an unrelated error = %q, want none", hint)
	}
}
