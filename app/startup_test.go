package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func startupStatusOf(t *testing.T, a *App) map[string]string {
	t.Helper()
	var status map[string]string
	if err := json.Unmarshal([]byte(a.StartupStatus()), &status); err != nil {
		t.Fatalf("StartupStatus: %v", err)
	}
	return status
}

// Before OnStartup runs, the frontend must read "starting", not "failed".
func TestStartupStatus_IsStartingBeforeStartupRuns(t *testing.T) {
	a := NewApp()
	if got := startupStatusOf(t, a)["state"]; got != startupStarting {
		t.Fatalf("state = %q, want %q", got, startupStarting)
	}
}

// A failed startup reaches the frontend with its cause — both through
// StartupStatus (waitUntilReady) and MCPStatus (the sidebar footer).
func TestStartupStatus_ReportsTheFailureCause(t *testing.T) {
	a := NewApp()
	a.setStartupResult(errors.New("iniciar o mhl: mhl exited early"))
	status := startupStatusOf(t, a)
	if status["state"] != startupFailed || status["error"] != "iniciar o mhl: mhl exited early" {
		t.Fatalf("status = %v", status)
	}
	body, err := a.MCPStatus()
	if err != nil {
		t.Fatalf("MCPStatus: %v", err)
	}
	if !strings.Contains(body, `"error":"iniciar o mhl: mhl exited early"`) || !strings.Contains(body, `"ready":false`) {
		t.Fatalf("MCPStatus = %s", body)
	}

	a.setStartupResult(nil)
	if status := startupStatusOf(t, a); status["state"] != startupReady || status["error"] != "" {
		t.Fatalf("after success: %v", status)
	}
}

// RetryStartup runs the whole startup again, so prependToPath must not
// stack the same directory on PATH each time.
func TestPrependToPath_DoesNotDuplicateTheEntry(t *testing.T) {
	t.Setenv("PATH", "/usr/bin")
	prependToPath("/opt/senpai/bin")
	prependToPath("/opt/senpai/bin")
	want := "/opt/senpai/bin" + string(os.PathListSeparator) + "/usr/bin"
	if got := os.Getenv("PATH"); got != want {
		t.Fatalf("PATH = %q, want %q", got, want)
	}
}

// The vendored mhl is replaced through a rename, never rewritten in place:
// on macOS an in-place rewrite while a leftover mhl still runs from that
// file gets the next exec SIGKILLed (Code Signature Invalid). A new inode
// is what proves the rename.
func TestExtractIfChanged_ReplacesTheFileInsteadOfRewritingIt(t *testing.T) {
	dir := t.TempDir()
	dest := filepath.Join(dir, "mhl")
	if err := extractIfChanged(dest, []byte("v1"), 0o755); err != nil {
		t.Fatalf("first extract: %v", err)
	}
	before, err := os.Stat(dest)
	if err != nil {
		t.Fatal(err)
	}
	if err := extractIfChanged(dest, []byte("v2"), 0o755); err != nil {
		t.Fatalf("second extract: %v", err)
	}
	after, err := os.Stat(dest)
	if err != nil {
		t.Fatal(err)
	}
	if os.SameFile(before, after) {
		t.Fatal("dest was rewritten in place; want a new file renamed over it")
	}
	if got, _ := os.ReadFile(dest); string(got) != "v2" {
		t.Fatalf("content = %q, want v2", got)
	}
	if after.Mode().Perm() != 0o755 {
		t.Fatalf("perm = %v, want 0755", after.Mode().Perm())
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Fatalf("leftover files in %s: %v", dir, entries)
	}
}

// On Windows renaming over an mhl.exe that a leftover process still runs
// fails with "Acesso negado", but renaming the running file itself works:
// replaceFile must move the old file aside and then install the new one.
func TestReplaceFile_SidelinesALockedDestination(t *testing.T) {
	dir := t.TempDir()
	dest := filepath.Join(dir, "mhl.exe")
	src := filepath.Join(dir, ".mhl.exe.tmp-1")
	if err := os.WriteFile(dest, []byte("v1"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(src, []byte("v2"), 0o755); err != nil {
		t.Fatal(err)
	}
	// Simulates Windows: replacing an existing dest is refused.
	renameFile = func(from, to string) error {
		if to == dest {
			if _, err := os.Stat(dest); err == nil {
				return &os.LinkError{Op: "rename", Old: from, New: to, Err: os.ErrPermission}
			}
		}
		return os.Rename(from, to)
	}
	t.Cleanup(func() { renameFile = os.Rename })

	if err := replaceFile(src, dest, true); err != nil {
		t.Fatalf("replaceFile: %v", err)
	}
	if got, _ := os.ReadFile(dest); string(got) != "v2" {
		t.Fatalf("content = %q, want v2", got)
	}
	removeSidelined(dest)
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Fatalf("leftover files in %s: %v", dir, entries)
	}
}

// Guards the build itself: app/embedded/bin/mhl-<goos>-<goarch> must be the
// real mhl executable, not an empty placeholder — an empty one only shows up
// at startup as "exec format error".
func TestVendoredMHLBinary_IsARealExecutable(t *testing.T) {
	if !vendoredMHLAvailable {
		t.Skip("no vendored mhl for this platform")
	}
	if len(vendoredMHLBinary) < 1<<20 {
		t.Fatalf("vendored mhl is %d bytes — app/embedded/bin holds a placeholder, not the mhl binary", len(vendoredMHLBinary))
	}
}
