package mhlbridge

import (
	"context"
	"log"
	"os"
	"os/exec"
	"path/filepath"
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

// CommandContext creates a command that can resolve user-installed CLIs from
// the same login-shell PATH used by Start. On Unix, /usr/bin/env performs the
// executable lookup after cmd.Env has been installed; exec.Command's own
// lookup happens too early and only sees the GUI process's minimal PATH.
func CommandContext(ctx context.Context, name string, args ...string) *exec.Cmd {
	if runtime.GOOS == "windows" {
		cmd := exec.CommandContext(ctx, name, args...)
		cmd.Env = enrichedEnv(ctx, os.Environ())
		setProcessGroup(cmd)
		return cmd
	}
	cmd := exec.CommandContext(ctx, "/usr/bin/env", append([]string{name}, args...)...)
	cmd.Env = enrichedEnv(ctx, os.Environ())
	return cmd
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
	cmd := loginShellCommand(timeoutCtx, shell)
	began := time.Now()
	log.Printf("mhlbridge: lendo o PATH do login shell (%s -ilc)", shell)
	out, err := cmd.Output()
	if err != nil {
		log.Printf("mhlbridge: login shell falhou em %s: %v", time.Since(began).Round(time.Millisecond), err)
		return "", false
	}
	log.Printf("mhlbridge: login shell respondeu em %s", time.Since(began).Round(time.Millisecond))
	path := strings.TrimSpace(string(out))
	return path, path != ""
}

// loginShellCommand: o comando de loginShellPath, isolado do terminal do app
// (detachFromTerminal — um shell interativo com controle de jobs chegava a
// parar o app inteiro). WaitDelay: um ~/.bashrc que deixe um processo em
// segundo plano herdando o stdout (ssh-agent, gpg-agent, ...) faria Output()
// esperar esse pipe fechar para sempre, mesmo depois do timeout matar o shell.
func loginShellCommand(ctx context.Context, shell string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, shell, "-ilc", `echo -n "$PATH"`)
	detachFromTerminal(cmd)
	cmd.WaitDelay = time.Second
	return cmd
}

// logAgentBinaries registra no app.log qual executável de cada CLI de agente
// o mhl vai encontrar com este PATH. O app aberto pelo Finder não herda o
// PATH do terminal: com duas instalações (ex.: uma antiga em /usr/local/bin
// e a atual em ~/.local/bin), "no terminal funciona, no app não" vira uma
// diferença de versão invisível sem esta linha.
func logAgentBinaries(env []string) {
	pathValue := ""
	for _, kv := range env {
		if strings.HasPrefix(kv, "PATH=") {
			pathValue = strings.TrimPrefix(kv, "PATH=")
		}
	}
	for _, name := range []string{"devin", "codex", "claude"} {
		if found := lookPathIn(name, pathValue); found != "" {
			log.Printf("mhlbridge: %s resolvido em %s", name, found)
		} else {
			log.Printf("mhlbridge: %s não encontrado no PATH do mhl", name)
		}
	}
}

// lookPathIn é exec.LookPath sobre um PATH arbitrário (o do processo filho,
// não o deste processo).
func lookPathIn(name, pathValue string) string {
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	for _, dir := range filepath.SplitList(pathValue) {
		if dir == "" {
			continue
		}
		candidate := filepath.Join(dir, name)
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() && (runtime.GOOS == "windows" || info.Mode()&0o111 != 0) {
			return candidate
		}
	}
	return ""
}
