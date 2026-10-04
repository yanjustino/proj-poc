package main

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// LocalProjects lists the work-items straight from <dataDir>/projects, without
// the mhl bridge — the same records WorkItem's `list` action returns
// (workflows/work_item/actions.mh: every valid projects/<id>/project.json,
// sorted by created_at). The sidebar renders from this at launch instead of
// waiting the ~5s mhl takes to compile the workflows before it can answer;
// once the bridge is up the frontend replaces it with the WorkItem list.
// Read-only: anything that changes a project still goes through mhl.
func (a *App) LocalProjects() (string, error) {
	dataDir, err := a.resolvedDataDir()
	if err != nil {
		return "", err
	}
	projects, err := readLocalProjects(dataDir)
	if err != nil {
		return "", err
	}
	body, err := json.Marshal(projects)
	if err != nil {
		return "", err
	}
	return string(body), nil
}

// readLocalProjects mirrors WorkItemActions.list: a directory whose name is
// not a valid project id, or that has no project.json, is skipped; so is a
// project.json that doesn't parse (logged — list would fail on it, this
// keeps the rest of the sidebar instead).
func readLocalProjects(dataDir string) ([]map[string]any, error) {
	projects := []map[string]any{}
	root := filepath.Join(dataDir, "projects")
	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return projects, nil
		}
		return nil, fmt.Errorf("list projects: %w", err)
	}
	for _, entry := range entries {
		if !entry.IsDir() || validateProjectID(entry.Name()) != nil {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(root, entry.Name(), "project.json"))
		if err != nil {
			continue
		}
		var record map[string]any
		if err := json.Unmarshal(raw, &record); err != nil {
			log.Printf("local projects: %s/project.json invalido: %v", entry.Name(), err)
			continue
		}
		projects = append(projects, record)
	}
	sort.SliceStable(projects, func(i, j int) bool {
		return fmt.Sprint(projects[i]["created_at"]) < fmt.Sprint(projects[j]["created_at"])
	})
	return projects, nil
}

// resolvedDataDir is a.dataDir, or — when the frontend calls in before
// startup() resolved it, now that the UI renders from disk without waiting
// for mhl — the same <appdata>/data directory prepareAndConnect resolves.
func (a *App) resolvedDataDir() (string, error) {
	if a.dataDir != "" {
		return a.dataDir, nil
	}
	dir, err := senpaiSubdir("data")
	if err != nil {
		return "", fmt.Errorf("data dir nao resolvido: %w", err)
	}
	return dir, nil
}

// projectActivity is what the sidebar shows next to each work-item: when
// anything under projects/<id>/ last changed (the "recent first" ordering)
// and how many raw/ sources are still waiting for ingest.
type projectActivity struct {
	LastActivity   string `json:"lastActivity"`
	PendingSources int    `json:"pendingSources"`
}

// ProjectsActivity returns, as JSON {project_id: projectActivity}, the
// activity summary of every local work-item — the same set LocalProjects
// lists. Read-only, computed from disk on each call: project.json has no
// updated_at, and the newest file mtime under the project is the honest
// answer to "what did I touch last" (wiki pages, artifacts, raw sources).
func (a *App) ProjectsActivity() (string, error) {
	dataDir, err := a.resolvedDataDir()
	if err != nil {
		return "", err
	}
	root := filepath.Join(dataDir, "projects")
	entries, err := os.ReadDir(root)
	if err != nil && !os.IsNotExist(err) {
		return "", fmt.Errorf("list projects: %w", err)
	}
	result := map[string]projectActivity{}
	for _, entry := range entries {
		if !entry.IsDir() || validateProjectID(entry.Name()) != nil {
			continue
		}
		result[entry.Name()] = readProjectActivity(filepath.Join(root, entry.Name()))
	}
	body, err := json.Marshal(result)
	if err != nil {
		return "", err
	}
	return string(body), nil
}

func readProjectActivity(projectDir string) projectActivity {
	var latest time.Time
	_ = filepath.WalkDir(projectDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if info, infoErr := d.Info(); infoErr == nil && info.ModTime().After(latest) {
			latest = info.ModTime()
		}
		return nil
	})

	pending := 0
	rawDir := filepath.Join(projectDir, "raw")
	if rawEntries, err := os.ReadDir(rawDir); err == nil {
		ingested, _ := readIngestedRaw(rawDir)
		done := make(map[string]bool, len(ingested))
		for _, name := range ingested {
			done[name] = true
		}
		for _, raw := range rawEntries {
			if raw.IsDir() || strings.HasPrefix(raw.Name(), ".") || done[raw.Name()] {
				continue
			}
			pending++
		}
	}

	activity := projectActivity{PendingSources: pending}
	if !latest.IsZero() {
		activity.LastActivity = latest.UTC().Format(time.RFC3339)
	}
	return activity
}
