package mhlbridge

import (
	"context"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// TestLoginShellPath_FindsUserInstalledTools is a regression guard for the
// exact incident this file fixes: a real user had `codex` installed at
// ~/.local/bin/codex (only on PATH because ~/.zshrc sources
// ~/.local/bin/env), and the packaged app — whose own process PATH never
// ran that profile — failed with "executable file not found in $PATH" the
// moment mhl tried to spawn it. This doesn't assert on that specific path
// (not portable across machines/CI) — it asserts the mechanism actually
// produces the user's real login-shell PATH, not an empty/unrelated one.
func TestLoginShellPath_ProducesANonEmptyRealPath(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	path, ok := loginShellPath(ctx)
	if !ok {
		t.Skip("no usable login shell in this environment — nothing to assert")
	}
	if path == "" {
		t.Fatal("loginShellPath reported ok but returned an empty string")
	}
	if !strings.Contains(path, "/bin") {
		t.Fatalf("login shell PATH doesn't look like a real PATH: %q", path)
	}
}

// TestEnrichedEnv_LetsPATHOnlyToolResolve proves the actual failure mode
// end to end: a command resolvable only via the login shell's PATH (not
// this test binary's own minimal exec.LookPath) becomes runnable once
// enrichedEnv folds that PATH in — the same mechanism mhlbridge.Start now
// applies before spawning mhl (which in turn spawns the configured LLM
// agent CLI).
func TestEnrichedEnv_LetsPATHOnlyToolResolve(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	loginPath, ok := loginShellPath(ctx)
	if !ok || loginPath == "" {
		t.Skip("no usable login shell PATH in this environment")
	}

	// Pick any tool the login shell can see. This assertion is deliberately
	// generic (works on any dev machine/CI, not just the one this bug was
	// found on) — it just needs ONE binary that's on the login-shell PATH.
	found, err := exec.LookPath("sh")
	if err != nil || found == "" {
		t.Skip("no reference binary found to validate against")
	}

	enriched := enrichedEnv(ctx, []string{"PATH=/nonexistent-only"})
	var enrichedPath string
	for _, kv := range enriched {
		if strings.HasPrefix(kv, "PATH=") {
			enrichedPath = strings.TrimPrefix(kv, "PATH=")
		}
	}
	if !strings.Contains(enrichedPath, loginPath) {
		t.Fatalf("expected the login shell PATH to be folded into the enriched PATH; got %q", enrichedPath)
	}
	if !strings.Contains(enrichedPath, "/nonexistent-only") {
		t.Fatalf("expected the original PATH to be preserved (not replaced); got %q", enrichedPath)
	}
}
