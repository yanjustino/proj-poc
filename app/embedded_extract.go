package main

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// workflowsMarker is a file that only exists inside a real workflows/ tree —
// checked before accepting any candidate directory as "the workflows dir",
// so a coincidentally-present but unrelated "../workflows" never gets used
// silently.
const workflowsMarker = "work_item/work_item.mh"

// extractIfChanged writes content to dest only if dest doesn't exist yet or
// its content differs (compared by sha256, cheap relative to the I/O it
// avoids) — repeated app starts don't rewrite unchanged vendored files.
//
// Writes a temp file and renames it over dest, never rewriting dest in
// place: on macOS, overwriting an executable in place while a process
// started from it is still alive (an mhl left over from a previous app run)
// makes the kernel SIGKILL the next exec of the new content ("Code
// Signature Invalid" in DiagnosticReports) — the mhl child dies at once and
// startup fails. A rename gives the new binary its own inode, so the
// leftover process keeps the old one and both run.
func extractIfChanged(dest string, content []byte, perm os.FileMode) error {
	if runtime.GOOS == "windows" {
		removeSidelined(dest)
	}
	if existing, err := os.ReadFile(dest); err == nil {
		if sha256.Sum256(existing) == sha256.Sum256(content) {
			return nil
		}
	}
	dir := filepath.Dir(dest)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(dest)+".tmp-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	_, writeErr := tmp.Write(content)
	closeErr := tmp.Close()
	if err := errors.Join(writeErr, closeErr, os.Chmod(tmpPath, perm)); err != nil {
		os.Remove(tmpPath)
		return err
	}
	if err := replaceFile(tmpPath, dest, runtime.GOOS == "windows"); err != nil {
		os.Remove(tmpPath)
		return err
	}
	return nil
}

// renameFile is os.Rename, swappable in tests to simulate Windows refusing
// to replace a file.
var renameFile = os.Rename

// replaceFile renames src over dest. On Windows (sideline=true) that
// rename fails with "Acesso negado" when dest is an .exe still running — an
// mhl.exe left over from a previous app run, after an update changed the
// embedded binary — or while an antivirus still holds the freshly written
// src. Windows does allow renaming a running image, so on failure dest is
// moved aside to a ".<name>.old-*" file (deleted by removeSidelined on a
// later extraction, once nothing runs it) and the rename is retried, with a
// short backoff for transient antivirus locks.
func replaceFile(src, dest string, sideline bool) error {
	err := renameFile(src, dest)
	if err == nil || !sideline {
		return err
	}
	for attempt := 1; ; attempt++ {
		aside := filepath.Join(filepath.Dir(dest), fmt.Sprintf(".%s.old-%d", filepath.Base(dest), time.Now().UnixNano()))
		if asideErr := renameFile(dest, aside); asideErr == nil || errors.Is(asideErr, fs.ErrNotExist) {
			if err = renameFile(src, dest); err == nil {
				return nil
			}
			if asideErr == nil {
				renameFile(aside, dest)
			}
		} else if err = renameFile(src, dest); err == nil {
			return nil
		}
		if attempt == 5 {
			return err
		}
		time.Sleep(time.Duration(attempt) * 200 * time.Millisecond)
	}
}

// removeSidelined deletes the ".<name>.old-*" copies replaceFile moved
// aside. Best-effort: a copy whose process is still alive stays locked and
// is retried on the next extraction.
func removeSidelined(dest string) {
	matches, _ := filepath.Glob(filepath.Join(filepath.Dir(dest), "."+filepath.Base(dest)+".old-*"))
	for _, path := range matches {
		os.Remove(path)
	}
}

// ensureVendoredMHL extracts this build's embedded mhl binary to
// <UserConfigDir>/senpai/embedded/bin/<name> and returns that absolute path —
// the app always runs this copy, never whatever "mhl" resolves to on PATH
// (a deliberate choice: mhl is still pre-1.0 and has been upgraded
// repeatedly during this project's own development, so PATH-first would
// risk the packaged app silently depending on whatever a given dev machine
// happens to have installed, rather than the exact build that was tested
// and shipped). See app/embedded/README.md for how to refresh the vendored
// binary when the dev mhl install is upgraded.
func ensureVendoredMHL() (string, error) {
	if !vendoredMHLAvailable {
		return "", fmt.Errorf(
			"nenhum binario mhl vendorizado para este build (GOOS=%s GOARCH=%s) — "+
				"adicione app/embedded/bin/mhl-%s-%s (ou mhl-%s-%s.exe no Windows) e recompile; "+
				"veja app/embedded/README.md",
			runtime.GOOS, runtime.GOARCH, runtime.GOOS, runtime.GOARCH, runtime.GOOS, runtime.GOARCH,
		)
	}
	// Um build que embutiu um arquivo vazio (ex.: o binário apagado do
	// repositório e trocado por um placeholder) só falharia depois, como um
	// "exec format error" sem pista da causa.
	if len(vendoredMHLBinary) == 0 {
		return "", fmt.Errorf(
			"o mhl embutido neste build está vazio — app/embedded/bin/mhl-%s-%s precisa ser o binário do mhl; restaure-o e recompile",
			runtime.GOOS, runtime.GOARCH,
		)
	}
	binDir, err := senpaiSubdir(filepath.Join("embedded", "bin"))
	if err != nil {
		return "", fmt.Errorf("resolve vendored bin dir: %w", err)
	}
	dest := filepath.Join(binDir, vendoredMHLBinaryName)
	if err := extractIfChanged(dest, vendoredMHLBinary, 0o755); err != nil {
		return "", fmt.Errorf("extract vendored mhl binary: %w", err)
	}
	log.Printf("mhl bridge: usando mhl vendorizado em %s (sha256 %x)", dest, sha256.Sum256(vendoredMHLBinary))
	return dest, nil
}

// ensureVendoredPdftotext extracts this build's embedded pdftotext (poppler)
// next to the vendored mhl and returns the directory that holds it, so the
// caller can put it on PATH — RawExtract (workflows/shared/wiki/raw_extract.mh)
// invokes a bare "pdftotext" through mhl's cmd.exec, and this is what makes
// .pdf ingestion work on a machine without poppler installed. Returns
// ("", nil) when this GOOS/GOARCH has no vendored copy: not an error, the
// workflow then falls back to whatever pdftotext is on PATH (and fails with
// its own clear message when there is none).
func ensureVendoredPdftotext() (string, error) {
	if !vendoredPdftotextAvailable {
		return "", nil
	}
	binDir, err := senpaiSubdir(filepath.Join("embedded", "bin"))
	if err != nil {
		return "", fmt.Errorf("resolve vendored bin dir: %w", err)
	}
	dest := filepath.Join(binDir, vendoredPdftotextBinaryName)
	if err := extractIfChanged(dest, vendoredPdftotextBinary, 0o755); err != nil {
		return "", fmt.Errorf("extract vendored pdftotext: %w", err)
	}
	log.Printf("mhl bridge: usando pdftotext vendorizado em %s (sha256 %x)", dest, sha256.Sum256(vendoredPdftotextBinary))
	return binDir, nil
}

// prependToPath puts dir first on this process's PATH — mhlbridge.Start
// builds the mhl child's environment from os.Environ() (this process's PATH
// wins over the login-shell PATH it appends), so the vendored pdftotext
// shadows any system copy for every workflow run.
func prependToPath(dir string) {
	current := os.Getenv("PATH")
	// RetryStartup chama de novo: nao duplicar a entrada.
	if current == dir || strings.HasPrefix(current, dir+string(os.PathListSeparator)) {
		return
	}
	if current == "" {
		os.Setenv("PATH", dir)
		return
	}
	os.Setenv("PATH", dir+string(os.PathListSeparator)+current)
}

// resolveWorkflowsDir finds the workflows/ tree mhl should serve, preferring
// a live checkout over the embedded copy — unlike the mhl binary above,
// workflows/*.mh is this repo's own code, edited constantly during
// development; forcing the embedded copy here would mean every `.mh` edit
// needs a full rebuild before `go test`/`wails dev` sees it, breaking the
// dev loop every other phase of this project has relied on. Only a packaged
// app with no dev tree anywhere nearby falls through to extracting the
// embedded copy.
//
// Tier 1 (../workflows relative to the current working directory) matches
// today's exact behavior — go test, go run, and wails dev all run with CWD
// in app/, so this keeps working unchanged. Tier 2 (../workflows relative
// to the running executable) covers a built binary launched from some other
// CWD. Tier 3 extracts the embedded vendoredWorkflowsFS.
func resolveWorkflowsDir() (string, error) {
	if dir, ok := workflowsDirIfLive("../workflows"); ok {
		return dir, nil
	}
	if exe, err := os.Executable(); err == nil {
		if dir, ok := workflowsDirIfLive(filepath.Join(filepath.Dir(exe), "..", "workflows")); ok {
			return dir, nil
		}
	}
	return extractVendoredWorkflows()
}

func workflowsDirIfLive(candidate string) (string, bool) {
	abs, err := filepath.Abs(candidate)
	if err != nil {
		return "", false
	}
	info, err := os.Stat(filepath.Join(abs, filepath.FromSlash(workflowsMarker)))
	if err != nil || info.IsDir() {
		return "", false
	}
	return abs, true
}

func extractVendoredWorkflows() (string, error) {
	root, err := senpaiSubdir(filepath.Join("embedded", "workflows"))
	if err != nil {
		return "", fmt.Errorf("resolve vendored workflows dir: %w", err)
	}
	wanted := make(map[string]bool)
	err = fs.WalkDir(vendoredWorkflowsFS, vendoredWorkflowsRoot, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(vendoredWorkflowsRoot, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		target := filepath.Join(root, filepath.FromSlash(rel))
		wanted[target] = true
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		content, err := vendoredWorkflowsFS.ReadFile(path)
		if err != nil {
			return err
		}
		return extractIfChanged(target, content, 0o644)
	})
	if err != nil {
		return "", fmt.Errorf("extract vendored workflows: %w", err)
	}
	if err := removeStale(root, wanted); err != nil {
		return "", fmt.Errorf("clean stale vendored workflows: %w", err)
	}
	log.Printf("mhl bridge: usando workflows vendorizados (embutidos) em %s", root)
	return root, nil
}

// removeStale deletes anything under root that extractVendoredWorkflows did
// not just write or visit — e.g. a .mh file left behind by an earlier
// version of workflows/ after a later version moved or renamed it (this bit
// us for real: workflows/shared/*.mh moved into core/, agents/, artifacts/,
// wiki/ subdirectories, but nothing ever deleted the old flat copies from a
// prior extraction, so mhl loaded both the stale and the current file and
// hung on the resulting duplicate tool/workflow names — see
// FASE0/5-ACHADOS or git blame around this comment for the incident).
// extractIfChanged only ever adds or updates, so without this pass `root`
// only grows across workflows/ reorganizations, never shrinks.
func removeStale(root string, wanted map[string]bool) error {
	var stale []string
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil || path == root || wanted[path] {
			return walkErr
		}
		stale = append(stale, path)
		if d.IsDir() {
			return filepath.SkipDir
		}
		return nil
	})
	if err != nil {
		return err
	}
	for _, path := range stale {
		if err := os.RemoveAll(path); err != nil {
			return err
		}
		log.Printf("mhl bridge: removendo arquivo obsoleto do workflows vendorizado: %s", path)
	}
	return nil
}

// ensureArtifactMermaidAsset writes the vendored mermaid bundle to
// <artifactsDir>/assets/mermaid.min.js if it isn't already there — the
// diagram/DER templates reference "./assets/mermaid.min.js" (or
// "../assets/mermaid.min.js" one level down) so the artifact still renders
// when opened outside the app, with no dependency on Senpai running (§3.5
// of the plan). Best-effort by design: called opportunistically from
// projectRootDir (app.go) whenever the "artifacts" root is touched, for
// both newly created and pre-existing projects — a failure here (e.g. a
// read-only disk) shouldn't block listing/reading artifacts, so callers log
// and continue rather than propagate the error.
func ensureArtifactMermaidAsset(artifactsDir string) error {
	dest := filepath.Join(artifactsDir, "assets", "mermaid.min.js")
	return extractIfChanged(dest, vendoredMermaidJS, 0o644)
}
