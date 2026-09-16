package main

import (
	"crypto/sha256"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"runtime"
)

// workflowsMarker is a file that only exists inside a real workflows/ tree —
// checked before accepting any candidate directory as "the workflows dir",
// so a coincidentally-present but unrelated "../workflows" never gets used
// silently.
const workflowsMarker = "work_item/work_item.mh"

// extractIfChanged writes content to dest only if dest doesn't exist yet or
// its content differs (compared by sha256, cheap relative to the I/O it
// avoids) — repeated app starts don't rewrite unchanged vendored files.
func extractIfChanged(dest string, content []byte, perm os.FileMode) error {
	if existing, err := os.ReadFile(dest); err == nil {
		if sha256.Sum256(existing) == sha256.Sum256(content) {
			return nil
		}
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	return os.WriteFile(dest, content, perm)
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
