package mhlbridge

import (
	"context"
	"log"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// enrichedEnv returns base with PATH extended by the user's login shell
// PATH, on top of whatever PATH base already has.
//
// Why this exists: a GUI app on macOS (launched from Finder, or even
// `wails dev`/a plain `go run` outside of an interactive shell) is started
// by launchd with a minimal PATH (roughly "/usr/bin:/bin:/usr/sbin:/sbin")
// — it never sources the user's ~/.zshrc, ~/.zprofile, etc. A CLI agent
// installed via a user-level installer (codex, claude, nvm/cargo-managed
// tools, ...) into somewhere like ~/.local/bin resolves fine from a
// terminal but not from here, so `agent Codex { command: "codex" }` (see
// workflows/shared/agents/agents.mh) fails with "executable file not found in
// $PATH" the moment mhl (a child of THIS process) tries to spawn it — even
// though the same user, on the same machine, can run `codex` themselves.
// This is the exact class of problem Electron's "fix-path"/"shell-path"
// packages exist for; the fix is the same here: ask the user's own login
// shell what its PATH is, and fold that in before spawning mhl.
//
// No-op on Windows, where GUI processes don't have this launchd-specific
// gap (PATH there is a machine/user environment variable, not something a
// shell profile file re-derives on every login).
func enrichedEnv(ctx context.Context, base []string) []string {
	if runtime.GOOS == "windows" {
		return base
	}
	loginPath, ok := loginShellPath(ctx)
	if !ok || loginPath == "" {
		log.Printf("mhlbridge: could not determine login shell PATH (falling back to this process's own PATH — a CLI agent installed outside the default PATH may not resolve)")
		return base
	}

	currentPath := ""
	out := make([]string, 0, len(base)+1)
	for _, kv := range base {
		if strings.HasPrefix(kv, "PATH=") {
			currentPath = strings.TrimPrefix(kv, "PATH=")
			continue
		}
		out = append(out, kv)
	}
	// This process's own PATH wins for anything it already had (e.g. an
	// explicit override), with the login shell's PATH appended to close
	// the launchd/Finder gap for everything else.
	merged := loginPath
	if currentPath != "" {
		merged = currentPath + string(os.PathListSeparator) + loginPath
	}
	return append(out, "PATH="+merged)
}

// loginShellPath runs $SHELL as an interactive login shell just long enough
// to print its PATH — interactive because profile files like ~/.zshrc only
// load for interactive shells, and this is precisely the environment a
// terminal-launched `codex`/`claude` already benefits from. Bounded by ctx
// (typically a few seconds) so a misbehaving shell profile (waiting on a
// prompt, network, ssh-agent, ...) can't hang app startup — a timeout or
// any other failure here just means "no enrichment", not a fatal error.
func loginShellPath(ctx context.Context) (string, bool) {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/zsh"
	}
	timeoutCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(timeoutCtx, shell, "-ilc", `echo -n "$PATH"`)
	out, err := cmd.Output()
	if err != nil {
		return "", false
	}
	path := strings.TrimSpace(string(out))
	return path, path != ""
}
