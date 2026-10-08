package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

// Removing a source and rebuilding the wiki. The wiki keeps no per-fact
// provenance (an entity/concept page accumulates fact blocks from every
// source that touched it), so a source that was already ingested can't be
// carved out of it. Removing one deletes the raw file and records its name in
// wikiStaleMarkerFile: the wiki still holds what it said until the user
// rebuilds it — Wiki's "reset" action wipes what came from the sources, and
// the frontend re-ingests the remaining ones in their original order
// (ingest-queue.js's rebuildWiki). A source never ingested just goes away.

// wikiStaleMarkerFile lists the ingested sources removed since the last
// rebuild. Dotfile in raw/, same convention (and the same ingestedMu lock)
// as ingestedMarkerFile.
const wikiStaleMarkerFile = ".wiki-stale.json"

func readWikiStale(rawDir string) ([]string, error) {
	data, err := os.ReadFile(filepath.Join(rawDir, wikiStaleMarkerFile))
	if os.IsNotExist(err) {
		return []string{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read wiki stale marker: %w", err)
	}
	var names []string
	if err := json.Unmarshal(data, &names); err != nil {
		return nil, fmt.Errorf("parse wiki stale marker: %w", err)
	}
	return names, nil
}

func writeWikiStale(rawDir string, names []string) error {
	body, err := json.Marshal(names)
	if err != nil {
		return fmt.Errorf("encode wiki stale marker: %w", err)
	}
	return os.WriteFile(filepath.Join(rawDir, wikiStaleMarkerFile), body, 0o644)
}

// removeRawResult is RemoveRawSource's answer: whether the removed source had
// been ingested (so the wiki now needs a rebuild) and every removed source
// the wiki still carries content from.
type removeRawResult struct {
	WasIngested  bool     `json:"wasIngested"`
	StaleSources []string `json:"staleSources"`
}

// RemoveRawSource deletes raw/<filename>. If it had been ingested, it leaves
// the ingested list and joins the stale list. The frontend never offers this
// for a source queued or being ingested.
func (a *App) RemoveRawSource(projectID string, filename string) (string, error) {
	if filename == "" || filename != filepath.Base(filename) || strings.HasPrefix(filename, ".") {
		return "", fmt.Errorf("nome de arquivo invalido: %q", filename)
	}
	rawDir, err := a.projectRootDir(projectID, "raw", []string{"raw"})
	if err != nil {
		return "", err
	}
	a.ingestedMu.Lock()
	defer a.ingestedMu.Unlock()

	path := filepath.Join(rawDir, filename)
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", fmt.Errorf("fonte nao encontrada: %q", filename)
		}
		return "", fmt.Errorf("remove raw source: %w", err)
	}
	if info.IsDir() {
		return "", fmt.Errorf("fonte nao e um arquivo: %q", filename)
	}
	ingested, err := readIngestedRaw(rawDir)
	if err != nil {
		return "", err
	}
	stale, err := readWikiStale(rawDir)
	if err != nil {
		return "", err
	}
	result := removeRawResult{WasIngested: slices.Contains(ingested, filename)}
	if result.WasIngested {
		// Stale first: if the app dies between the two writes, the wiki is
		// flagged for a rebuild rather than silently keeping the content.
		if !slices.Contains(stale, filename) {
			stale = append(stale, filename)
		}
		if err := writeWikiStale(rawDir, stale); err != nil {
			return "", err
		}
		ingested = slices.DeleteFunc(ingested, func(name string) bool { return name == filename })
		if err := writeIngestedRaw(rawDir, ingested); err != nil {
			return "", err
		}
	}
	if err := os.Remove(path); err != nil {
		return "", fmt.Errorf("remove raw source: %w", err)
	}
	result.StaleSources = stale
	body, err := json.Marshal(result)
	if err != nil {
		return "", fmt.Errorf("encode remove result: %w", err)
	}
	return string(body), nil
}

// WikiStaleSources returns, as a JSON array, the ingested sources removed
// since the last rebuild — empty when the wiki matches raw/.
func (a *App) WikiStaleSources(projectID string) (string, error) {
	rawDir, err := a.projectRootDir(projectID, "raw", []string{"raw"})
	if err != nil {
		return "", err
	}
	a.ingestedMu.Lock()
	defer a.ingestedMu.Unlock()
	names, err := readWikiStale(rawDir)
	if err != nil {
		return "", err
	}
	body, err := json.Marshal(names)
	if err != nil {
		return "", fmt.Errorf("encode wiki stale marker: %w", err)
	}
	return string(body), nil
}

// ResetIngestedRaw is the bookkeeping half of a wiki rebuild, called right
// after Wiki's "reset" action emptied the wiki: every source goes back to
// pending and the stale list is cleared. Returns, as a JSON array, the
// sources to re-ingest — the ones ingested before, in ingest order, that
// still exist in raw/.
func (a *App) ResetIngestedRaw(projectID string) (string, error) {
	rawDir, err := a.projectRootDir(projectID, "raw", []string{"raw"})
	if err != nil {
		return "", err
	}
	a.ingestedMu.Lock()
	defer a.ingestedMu.Unlock()
	ingested, err := readIngestedRaw(rawDir)
	if err != nil {
		return "", err
	}
	toIngest := []string{}
	for _, name := range ingested {
		if info, err := os.Stat(filepath.Join(rawDir, name)); err == nil && !info.IsDir() {
			toIngest = append(toIngest, name)
		}
	}
	if err := os.MkdirAll(rawDir, 0o755); err != nil {
		return "", fmt.Errorf("create raw dir: %w", err)
	}
	if err := writeIngestedRaw(rawDir, []string{}); err != nil {
		return "", err
	}
	if err := writeWikiStale(rawDir, []string{}); err != nil {
		return "", err
	}
	body, err := json.Marshal(toIngest)
	if err != nil {
		return "", fmt.Errorf("encode sources to ingest: %w", err)
	}
	return string(body), nil
}
