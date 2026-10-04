package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
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
