package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateRepoDir(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "config", "senpai")
	repo := filepath.Join(root, "dev", "checkout")
	file := filepath.Join(root, "dev", "notes.txt")
	for _, dir := range []string{filepath.Join(appDir, "data", "projects", "outro"), repo} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name    string
		dir     string
		wantErr string
	}{
		{"repo outside app data", repo, ""},
		{"relative path", "dev/checkout", "caminho absoluto"},
		{"missing folder", filepath.Join(root, "nope"), "não encontrada"},
		{"a file", file, "não é uma pasta"},
		{"work-item inside app data", filepath.Join(appDir, "data", "projects", "outro"), "dados do Senpai"},
		{"app data itself", appDir, "dados do Senpai"},
		{"ancestor of app data", root, "dados do Senpai"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateRepoDir(tc.dir, appDir)
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("error = %v, want containing %q", err, tc.wantErr)
			}
		})
	}
}

func TestValidateRepoDirFollowsSymlinks(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "senpai")
	if err := os.MkdirAll(filepath.Join(appDir, "data"), 0o755); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "atalho")
	if err := os.Symlink(filepath.Join(appDir, "data"), link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if err := validateRepoDir(link, appDir); err == nil {
		t.Fatal("a symlink into the app data must be rejected")
	}
}

func TestRequireGitWorkTree(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	plain := t.TempDir()
	if err := requireGitWorkTree(plain); err == nil || !strings.Contains(err.Error(), "não é um repositório git") {
		t.Fatalf("plain folder: error = %v", err)
	}
	repo := t.TempDir()
	if out, err := exec.Command("git", "-C", repo, "init", "-q").CombinedOutput(); err != nil {
		t.Fatalf("git init: %v: %s", err, out)
	}
	sub := filepath.Join(repo, "services", "api")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := requireGitWorkTree(sub); err != nil {
		t.Fatalf("a subfolder of a work tree (monorepo) must be accepted: %v", err)
	}
}

func TestParseRepoURL(t *testing.T) {
	cases := []struct {
		link     string
		wantName string
		wantErr  string
	}{
		{"https://github.com/gin-gonic/gin.git", "gin", ""},
		{"  https://gitlab.com/grupo/sub/checkout-api  ", "checkout-api", ""},
		{"git@github.com:org/pagamentos.git", "pagamentos", ""},
		{"ssh://git@bitbucket.org/org/cobranca.git", "cobranca", ""},
		{"https://ana:ghp_token@github.com/org/repo.git", "", "não pode conter usuário ou token"},
		{"https://ghp_token@github.com/org/repo.git", "", "não pode conter usuário ou token"},
		{"ssh://git:senha@host/org/repo.git", "", "não pode conter usuário ou token"},
		{"http://github.com/org/repo.git", "", "https:// ou SSH"},
		{"file:///etc", "", "https:// ou SSH"},
		{"ext::sh -c touch% /tmp/pwned", "", "https:// ou SSH"},
		{"/Users/ana/dev/repo", "", "https:// ou SSH"},
		{"--upload-pack=touch /tmp/x", "", "inválido"},
		{"https://github.com/", "", "não aponta para um repositório"},
		{"", "", "informe o link"},
	}
	for _, tc := range cases {
		t.Run(tc.link, func(t *testing.T) {
			name, err := parseRepoURL(tc.link)
			if tc.wantErr == "" {
				if err != nil || name != tc.wantName {
					t.Fatalf("parseRepoURL(%q) = %q, %v; want %q", tc.link, name, err, tc.wantName)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("parseRepoURL(%q) error = %v, want containing %q", tc.link, err, tc.wantErr)
			}
		})
	}
}

func TestFriendlyCloneError(t *testing.T) {
	cases := map[string]string{
		"warning: Could not find remote branch nope to clone.\nfatal: Remote branch nope not found in upstream origin": "branch não encontrada",
		"remote: Repository not found.\nfatal: repository 'https://github.com/x/y.git/' not found":                     "privado sem acesso",
		"fatal: could not read Username for 'https://github.com': terminal prompts disabled":                           "privado sem acesso",
		"fatal: unable to access 'https://nohost.invalid/x.git/': Could not resolve host: nohost.invalid":              "não foi possível acessar",
	}
	for stderr, want := range cases {
		if err := friendlyCloneError(stderr); !strings.Contains(err.Error(), want) {
			t.Errorf("friendlyCloneError(%q) = %v, want containing %q", stderr, err, want)
		}
	}
}

// gitClone against a local fixture (file protocol allowed only here — the
// app passes "https:ssh"): shallow, single branch, and the same clone with
// file disallowed is refused by git itself.
func TestGitCloneShallowAndProtocolAllowList(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	src := t.TempDir()
	run := func(args ...string) {
		t.Helper()
		if out, err := exec.Command("git", append([]string{"-C", src}, args...)...).CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v: %s", args, err, out)
		}
	}
	run("init", "-q", "-b", "main")
	for i := 0; i < 25; i++ {
		if err := os.WriteFile(filepath.Join(src, "f.txt"), []byte(strings.Repeat("x", i+1)), 0o644); err != nil {
			t.Fatal(err)
		}
		run("add", "-A")
		run("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "c")
	}
	link := "file://" + filepath.ToSlash(src)
	ctx := context.Background()

	dest := filepath.Join(t.TempDir(), "repo")
	if err := gitClone(ctx, link, "", dest, "file"); err != nil {
		t.Fatalf("gitClone: %v", err)
	}
	out, err := exec.Command("git", "-C", dest, "rev-list", "--count", "HEAD").Output()
	if err != nil || strings.TrimSpace(string(out)) != cloneDepth {
		t.Fatalf("history depth = %q (%v), want %s", out, err, cloneDepth)
	}

	if err := gitClone(ctx, link, "nope", filepath.Join(t.TempDir(), "b"), "file"); err == nil || !strings.Contains(err.Error(), "branch não encontrada") {
		t.Fatalf("missing branch: error = %v", err)
	}
	if err := gitClone(ctx, link, "", filepath.Join(t.TempDir(), "c"), "https:ssh"); err == nil {
		t.Fatal("file:// must be refused when only https and ssh are allowed")
	}
}

func TestDiscardCloneOnlyDeletesTrackedClones(t *testing.T) {
	a := &App{}
	untracked := t.TempDir()
	if err := a.DiscardClone(untracked); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(untracked); err != nil {
		t.Fatalf("an untracked path must never be deleted: %v", err)
	}

	parent := t.TempDir()
	clone := filepath.Join(parent, "repo")
	if err := os.MkdirAll(clone, 0o755); err != nil {
		t.Fatal(err)
	}
	clones.Lock()
	clones.dirs[clone] = parent
	clones.Unlock()
	if err := a.DiscardClone(clone); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(parent); !os.IsNotExist(err) {
		t.Fatalf("tracked clone parent should be gone, stat err = %v", err)
	}
}
