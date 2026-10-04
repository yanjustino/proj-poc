package main

import (
	"bufio"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
)

// runLogMeta is what the Logs tab needs to title a run — written next to
// its log (projects/<id>/run_logs/<runID>.meta.json) when StartRun starts
// it, since the log itself only carries the session id and step names.
// Only identifying arguments are kept: free text (a wiki question) is
// clipped, and feedback text is reduced to whether there was any.
type runLogMeta struct {
	Workflow     string   `json:"workflow"`
	Action       string   `json:"action,omitempty"`
	Artifact     string   `json:"artifact,omitempty"`
	FeatureID    string   `json:"feature_id,omitempty"`
	HistoriaID   string   `json:"historia_id,omitempty"`
	ConceptTitle string   `json:"concept_title,omitempty"`
	RawPaths     []string `json:"raw_paths,omitempty"`
	Question     string   `json:"question,omitempty"`
	Feedback     bool     `json:"feedback,omitempty"`
	Approved     bool     `json:"approved,omitempty"`
	StartedAt    string   `json:"started_at"`
}

const runLogMetaQuestionMax = 120

func newRunLogMeta(workflow string, arguments map[string]any, now time.Time) runLogMeta {
	str := func(key string) string { s, _ := arguments[key].(string); return strings.TrimSpace(s) }
	meta := runLogMeta{
		Workflow:     workflow,
		Action:       str("action"),
		Artifact:     str("artifact"),
		FeatureID:    str("feature_id"),
		HistoriaID:   str("historia_id"),
		ConceptTitle: str("concept_title"),
		Question:     clipRunes(str("question"), runLogMetaQuestionMax),
		Feedback:     str("feedback") != "",
		StartedAt:    now.UTC().Format(time.RFC3339),
	}
	if approved, ok := arguments["approved"].(bool); ok {
		meta.Approved = approved
	}
	if paths, ok := arguments["raw_paths"].([]any); ok {
		for _, p := range paths {
			if s, ok := p.(string); ok {
				meta.RawPaths = append(meta.RawPaths, s)
			}
		}
	}
	return meta
}

func clipRunes(s string, max int) string {
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	return string([]rune(s)[:max]) + "…"
}

func runLogMetaPath(logPath string) string {
	return strings.TrimSuffix(logPath, ".log") + ".meta.json"
}

// writeRunLogMeta is best-effort: a run without its meta file still lists,
// just titled from its steps (see runLogSteps).
func (a *App) writeRunLogMeta(projectID, runID, workflow string, arguments map[string]any) {
	dataDir, err := a.resolvedDataDir()
	if err != nil {
		return
	}
	logPath, err := runLogFilePath(dataDir, projectID, runID)
	if err != nil {
		return
	}
	body, err := json.Marshal(newRunLogMeta(workflow, arguments, time.Now()))
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
		log.Printf("run log meta %s: %v", runID, err)
		return
	}
	if err := os.WriteFile(runLogMetaPath(logPath), body, 0o644); err != nil {
		log.Printf("run log meta %s: %v", runID, err)
	}
}

func readRunLogMeta(logPath string) *runLogMeta {
	raw, err := os.ReadFile(runLogMetaPath(logPath))
	if err != nil {
		return nil
	}
	var meta runLogMeta
	if json.Unmarshal(raw, &meta) != nil {
		return nil
	}
	return &meta
}

// runLogSteps: the distinct "step: X" names at the head of a log, in order —
// enough to tell what a run was (SyncHtml, IngestGenerate, Generate…) for
// logs persisted before the meta file existed.
func runLogSteps(logPath string) []string {
	f, err := os.Open(logPath)
	if err != nil {
		return nil
	}
	defer f.Close()
	seen := map[string]bool{}
	var steps []string
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for lines := 0; scanner.Scan() && lines < 400 && len(steps) < 12; lines++ {
		line := strings.TrimSpace(scanner.Text())
		if name, ok := strings.CutPrefix(line, "step: "); ok && !seen[name] {
			seen[name] = true
			steps = append(steps, name)
		}
	}
	return steps
}
