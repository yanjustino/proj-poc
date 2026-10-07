package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"senpai-app/mhlbridge"
)

// SelectRepoDir opens the native folder picker for the "quero inserir um
// repositório" source and returns the chosen folder ("" if cancelled), already
// validated: the Wiki action snapshot_repo (RepoSnapshot in
// workflows/shared/wiki/repo_snapshot.mh) reads it through git, so it must be
// a git work tree, and it must not overlap the app's own data — mhl's CWD
// holds every work-item, and AGENTS.md forbids reading another one's data.
func (a *App) SelectRepoDir() (string, error) {
	if _, err := a.requireBridge(); err != nil {
		return "", err
	}
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Selecionar a pasta do repositório",
	})
	if err != nil {
		return "", fmt.Errorf("select repo dir: %w", err)
	}
	if dir == "" {
		return "", nil
	}
	base, err := senpaiBaseDir()
	if err != nil {
		return "", fmt.Errorf("resolve app data dir: %w", err)
	}
	if err := validateRepoDir(dir, base); err != nil {
		return "", err
	}
	if err := requireGitWorkTree(dir); err != nil {
		return "", err
	}
	return dir, nil
}

// validateRepoDir rejects a folder that isn't an absolute, existing directory
// or that overlaps appDir (the senpai base dir: work-item data, mhl state):
// inside it would expose work-items, and an ancestor of it (the home folder,
// say) could too, if it happens to be a git work tree.
func validateRepoDir(dir string, appDir string) error {
	if !filepath.IsAbs(dir) {
		return fmt.Errorf("a pasta do repositório precisa ser um caminho absoluto: %q", dir)
	}
	info, err := os.Stat(dir)
	if err != nil {
		return fmt.Errorf("pasta do repositório não encontrada: %w", err)
	}
	if !info.IsDir() {
		return fmt.Errorf("não é uma pasta: %q", dir)
	}
	repo := canonicalPath(dir)
	app := canonicalPath(appDir)
	if isWithin(repo, app) || isWithin(app, repo) {
		return fmt.Errorf("essa pasta contém ou está dentro dos dados do Senpai (%s); escolha a pasta do repositório", appDir)
	}
	return nil
}

// canonicalPath cleans p and resolves symlinks when it can (macOS /var ->
// /private/var, say), so the overlap check can't be dodged by a link.
func canonicalPath(p string) string {
	cleaned := filepath.Clean(p)
	if resolved, err := filepath.EvalSymlinks(cleaned); err == nil {
		return resolved
	}
	return cleaned
}

// isWithin reports whether child is parent itself or somewhere below it.
func isWithin(child string, parent string) bool {
	rel, err := filepath.Rel(parent, child)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel))
}

// errGitMissing is what every git call here reports when there's no git at
// all — distinct from git running and failing.
var errGitMissing = errors.New("Git não encontrado: instale o git para importar um repositório")

// gitCommand resolves git from the login-shell PATH (mhlbridge.CommandContext)
// — the same git mhl's RepoSnapshot will run, with the same credential
// helpers; a GUI app's own PATH on macOS would miss a Homebrew git.
func gitCommand(ctx context.Context, args ...string) *exec.Cmd {
	return mhlbridge.CommandContext(ctx, "git", args...)
}

// isGitMissing: exec.ErrNotFound on Windows; on Unix the lookup happens in
// /usr/bin/env, which exits 127 when the command doesn't exist.
func isGitMissing(err error) bool {
	if errors.Is(err, exec.ErrNotFound) {
		return true
	}
	var exitErr *exec.ExitError
	return errors.As(err, &exitErr) && exitErr.ExitCode() == 127
}

// requireGitWorkTree fails early, with a message the person can act on,
// before a snapshot_repo run would fail the same way inside mhl.
func requireGitWorkTree(dir string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	out, err := gitCommand(ctx, "-C", dir, "rev-parse", "--is-inside-work-tree").Output()
	if isGitMissing(err) {
		return errGitMissing
	}
	if err != nil || strings.TrimSpace(string(out)) != "true" {
		return fmt.Errorf("essa pasta não é um repositório git: %q", dir)
	}
	return nil
}

// ---- clone a partir de um link --------------------------------------------

// cloneTimeout bounds the whole clone; a repository that takes longer than
// this to fetch at --depth 20 is far bigger than a snapshot needs anyway.
const cloneTimeout = 3 * time.Minute

// cloneDepth keeps enough history for the snapshot's "atividade recente"
// (RepoSnapshot.log_entries is 15) without fetching the whole history.
const cloneDepth = "20"

// scpLikeRepo is git's "user@host:path" SSH shorthand (git@github.com:org/repo.git).
var scpLikeRepo = regexp.MustCompile(`^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[A-Za-z0-9._~/-]+$`)

var safeBranch = regexp.MustCompile(`^[A-Za-z0-9._/-]+$`)

// parseRepoURL accepts only https:// and SSH (ssh:// or user@host:path)
// links and returns the repository name for the clone folder. Everything
// else is refused: file:// and plain paths (would read local folders the
// folder picker validates), ext:: (runs an arbitrary command), http:// (no
// TLS). A link carrying credentials (https://user:token@host/...) is refused
// too — AGENTS.md: no secrets on command lines; private repositories go
// through the git credential helper or SSH keys already set up on the machine.
func parseRepoURL(raw string) (string, error) {
	link := strings.TrimSpace(raw)
	if link == "" {
		return "", fmt.Errorf("informe o link do repositório")
	}
	if strings.HasPrefix(link, "-") {
		return "", fmt.Errorf("link de repositório inválido: %q", link)
	}
	var repoPath string
	switch {
	case scpLikeRepo.MatchString(link):
		repoPath = link[strings.Index(link, ":")+1:]
	case strings.HasPrefix(link, "https://") || strings.HasPrefix(link, "ssh://"):
		parsed, err := url.Parse(link)
		if err != nil || parsed.Host == "" {
			return "", fmt.Errorf("link de repositório inválido: %q", link)
		}
		if parsed.User != nil {
			if _, hasPassword := parsed.User.Password(); hasPassword || parsed.Scheme == "https" {
				return "", fmt.Errorf("o link não pode conter usuário ou token; para repositórios privados, configure o acesso no git desta máquina (credential helper ou chave SSH)")
			}
		}
		repoPath = parsed.Path
	default:
		return "", fmt.Errorf("use um link https:// ou SSH (git@host:org/repo.git)")
	}
	segments := strings.FieldsFunc(repoPath, func(r rune) bool { return r == '/' })
	if len(segments) == 0 {
		return "", fmt.Errorf("o link não aponta para um repositório: %q", link)
	}
	name := sanitizeSourceTitle(strings.TrimSuffix(segments[len(segments)-1], ".git"))
	name = strings.ReplaceAll(name, " ", "-")
	if name == "" {
		name = "repositorio"
	}
	return name, nil
}

// clones tracks the temporary clones this process created, so DiscardClone
// only ever deletes one of them — never a path that merely came back from
// the frontend.
var clones = struct {
	sync.Mutex
	dirs map[string]string // clone path -> its MkdirTemp parent
}{dirs: map[string]string{}}

// CloneRepoForSnapshot shallow-clones rawURL (branch optional) into a fresh
// temp folder, outside the app's data, and returns the clone's path — the
// caller then runs snapshotRepo on it and must call DiscardClone afterwards.
// The folder is named after the repository, which is what the snapshot uses
// as the repository name.
func (a *App) CloneRepoForSnapshot(rawURL string, branch string) (string, error) {
	name, err := parseRepoURL(rawURL)
	if err != nil {
		return "", err
	}
	branch = strings.TrimSpace(branch)
	if branch != "" && (!safeBranch.MatchString(branch) || strings.HasPrefix(branch, "-") || strings.Contains(branch, "..")) {
		return "", fmt.Errorf("nome de branch inválido: %q", branch)
	}
	parent, err := os.MkdirTemp("", "senpai-clone-")
	if err != nil {
		return "", fmt.Errorf("criar pasta temporária: %w", err)
	}
	dest := filepath.Join(parent, name)
	ctx, cancel := context.WithTimeout(context.Background(), cloneTimeout)
	defer cancel()
	if err := gitClone(ctx, strings.TrimSpace(rawURL), branch, dest, "https:ssh"); err != nil {
		os.RemoveAll(parent)
		return "", err
	}
	clones.Lock()
	clones.dirs[dest] = parent
	clones.Unlock()
	return dest, nil
}

// gitClone runs the shallow clone. allowProtocols is GIT_ALLOW_PROTOCOL —
// "https:ssh" in the app; the tests pass "file" to clone a local fixture.
// Nothing may prompt: no terminal exists to answer, so a prompt would just
// hang until the timeout (GIT_TERMINAL_PROMPT=0, ssh BatchMode). A
// credential helper with its own window (Git Credential Manager) still works.
func gitClone(ctx context.Context, link string, branch string, dest string, allowProtocols string) error {
	args := []string{"clone", "--depth", cloneDepth, "--single-branch", "--no-tags", "-q"}
	if branch != "" {
		args = append(args, "--branch", branch)
	}
	args = append(args, "--", link, dest)
	cmd := gitCommand(ctx, args...)
	cmd.Env = append(cmd.Env, "GIT_TERMINAL_PROMPT=0", "GIT_ALLOW_PROTOCOL="+allowProtocols)
	if os.Getenv("GIT_SSH_COMMAND") == "" {
		cmd.Env = append(cmd.Env, "GIT_SSH_COMMAND=ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new")
	}
	out, err := cmd.CombinedOutput()
	if err == nil {
		return nil
	}
	if isGitMissing(err) {
		return errGitMissing
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return fmt.Errorf("o clone passou de %s — o repositório é grande demais ou a rede está lenta", cloneTimeout)
	}
	return friendlyCloneError(string(out))
}

// friendlyCloneError turns git's stderr into something actionable; the raw
// message stays at the end for whoever needs the detail.
func friendlyCloneError(stderr string) error {
	detail := strings.TrimSpace(stderr)
	lower := strings.ToLower(detail)
	switch {
	// Before the generic "not found": git says "Remote branch X not found".
	case strings.Contains(lower, "remote branch") && strings.Contains(lower, "not found"):
		return fmt.Errorf("branch não encontrada no repositório: %s", detail)
	case strings.Contains(lower, "not found") || strings.Contains(lower, "could not read username") ||
		strings.Contains(lower, "authentication failed") || strings.Contains(lower, "permission denied") ||
		strings.Contains(lower, "terminal prompts disabled"):
		return fmt.Errorf("repositório não encontrado, ou privado sem acesso configurado no git desta máquina (credential helper ou chave SSH): %s", detail)
	case strings.Contains(lower, "could not resolve host") || strings.Contains(lower, "unable to access"):
		return fmt.Errorf("não foi possível acessar o servidor do repositório (rede ou endereço): %s", detail)
	}
	return fmt.Errorf("falha ao clonar o repositório: %s", detail)
}

// DiscardClone deletes a clone CloneRepoForSnapshot made (its whole temp
// parent). An unknown path is ignored, not deleted.
func (a *App) DiscardClone(path string) error {
	clones.Lock()
	parent, ok := clones.dirs[path]
	delete(clones.dirs, path)
	clones.Unlock()
	if !ok {
		return nil
	}
	return os.RemoveAll(parent)
}

// discardAllClones runs on shutdown: a clone whose snapshot never finished
// (app closed mid-run) shouldn't linger in the temp folder.
func discardAllClones() {
	clones.Lock()
	defer clones.Unlock()
	for path, parent := range clones.dirs {
		if err := os.RemoveAll(parent); err != nil {
			log.Printf("repo clone cleanup %s: %v", path, err)
		}
		delete(clones.dirs, path)
	}
}
