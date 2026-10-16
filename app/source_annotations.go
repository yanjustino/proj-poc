package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
)

// Annotations on sources: the person's own corrections to a raw/ source
// (inaccuracies, contradictions, misconceptions in its text). Unlike the
// other raw/ dotfiles this one IS read by a workflow — Wiki's ingest and
// annotate actions (workflows/shared/wiki/source_annotations.mh) put the
// text into the prompt and into the source's wiki page. Same lock
// (ingestedMu) as ingestedMarkerFile: MarkRawIngested also flips Applied.

const annotationsMarkerFile = ".annotations.json"

// maxAnnotationRunes bounds what goes into every later ingest prompt.
const maxAnnotationRunes = 20000

// rawAnnotation is one source's annotation. Applied: the wiki already holds
// this exact text — an ingest or annotate run finished after the last edit.
type rawAnnotation struct {
	Text      string `json:"text"`
	UpdatedAt string `json:"updatedAt"`
	Applied   bool   `json:"applied"`
}

func readRawAnnotations(rawDir string) (map[string]rawAnnotation, error) {
	data, err := os.ReadFile(filepath.Join(rawDir, annotationsMarkerFile))
	if os.IsNotExist(err) {
		return map[string]rawAnnotation{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read annotations: %w", err)
	}
	annotations := map[string]rawAnnotation{}
	if err := json.Unmarshal(data, &annotations); err != nil {
		return nil, fmt.Errorf("parse annotations: %w", err)
	}
	return annotations, nil
}

func writeRawAnnotations(rawDir string, annotations map[string]rawAnnotation) error {
	body, err := json.Marshal(annotations)
	if err != nil {
		return fmt.Errorf("encode annotations: %w", err)
	}
	if err := os.MkdirAll(rawDir, 0o755); err != nil {
		return fmt.Errorf("create raw dir: %w", err)
	}
	return os.WriteFile(filepath.Join(rawDir, annotationsMarkerFile), body, 0o644)
}

func encodeAnnotations(annotations map[string]rawAnnotation) (string, error) {
	body, err := json.Marshal(annotations)
	if err != nil {
		return "", fmt.Errorf("encode annotations: %w", err)
	}
	return string(body), nil
}

// SetRawAnnotation saves (or, with blank text, removes) the annotation of
// raw/<filename>. Either way it is no longer applied: the wiki has to be
// told — by ingesting the source, or Wiki's annotate action if it already
// was. Returns every annotation of the project as JSON.
func (a *App) SetRawAnnotation(projectID string, filename string, text string) (string, error) {
	if filename == "" || filename != filepath.Base(filename) || strings.HasPrefix(filename, ".") {
		return "", fmt.Errorf("nome de arquivo invalido: %q", filename)
	}
	text = strings.TrimSpace(text)
	if utf8.RuneCountInString(text) > maxAnnotationRunes {
		return "", fmt.Errorf("anotacao longa demais: limite de %d caracteres", maxAnnotationRunes)
	}
	rawDir, err := a.projectRootDir(projectID, "raw", []string{"raw"})
	if err != nil {
		return "", err
	}
	a.ingestedMu.Lock()
	defer a.ingestedMu.Unlock()
	if info, err := os.Stat(filepath.Join(rawDir, filename)); err != nil || info.IsDir() {
		return "", fmt.Errorf("fonte nao encontrada: %q", filename)
	}
	annotations, err := readRawAnnotations(rawDir)
	if err != nil {
		return "", err
	}
	if text == "" {
		delete(annotations, filename)
	} else {
		annotations[filename] = rawAnnotation{Text: text, UpdatedAt: time.Now().UTC().Format(time.RFC3339)}
	}
	if err := writeRawAnnotations(rawDir, annotations); err != nil {
		return "", err
	}
	return encodeAnnotations(annotations)
}

// ListRawAnnotations returns {filename: {text, updatedAt, applied}} as JSON.
func (a *App) ListRawAnnotations(projectID string) (string, error) {
	rawDir, err := a.projectRootDir(projectID, "raw", []string{"raw"})
	if err != nil {
		return "", err
	}
	a.ingestedMu.Lock()
	defer a.ingestedMu.Unlock()
	annotations, err := readRawAnnotations(rawDir)
	if err != nil {
		return "", err
	}
	return encodeAnnotations(annotations)
}

// MarkRawAnnotationApplied records that Wiki's annotate action finished for
// raw/<filename>. A no-op if the source has no annotation (anymore).
func (a *App) MarkRawAnnotationApplied(projectID string, filename string) (string, error) {
	if filename == "" || filename != filepath.Base(filename) {
		return "", fmt.Errorf("nome de arquivo invalido: %q", filename)
	}
	rawDir, err := a.projectRootDir(projectID, "raw", []string{"raw"})
	if err != nil {
		return "", err
	}
	a.ingestedMu.Lock()
	defer a.ingestedMu.Unlock()
	if err := markAnnotationApplied(rawDir, filename); err != nil {
		return "", err
	}
	annotations, err := readRawAnnotations(rawDir)
	if err != nil {
		return "", err
	}
	return encodeAnnotations(annotations)
}

// markAnnotationApplied: caller holds ingestedMu.
func markAnnotationApplied(rawDir string, filename string) error {
	annotations, err := readRawAnnotations(rawDir)
	if err != nil {
		return err
	}
	entry, ok := annotations[filename]
	if !ok || entry.Applied {
		return nil
	}
	entry.Applied = true
	annotations[filename] = entry
	return writeRawAnnotations(rawDir, annotations)
}

// dropAnnotation (removed source) and unapplyAnnotations (wiki reset):
// caller holds ingestedMu.
func dropAnnotation(rawDir string, filename string) error {
	annotations, err := readRawAnnotations(rawDir)
	if err != nil {
		return err
	}
	if _, ok := annotations[filename]; !ok {
		return nil
	}
	delete(annotations, filename)
	return writeRawAnnotations(rawDir, annotations)
}

func unapplyAnnotations(rawDir string) error {
	annotations, err := readRawAnnotations(rawDir)
	if err != nil {
		return err
	}
	if len(annotations) == 0 {
		return nil
	}
	for name, entry := range annotations {
		entry.Applied = false
		annotations[name] = entry
	}
	return writeRawAnnotations(rawDir, annotations)
}
