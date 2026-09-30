package main

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Portable project package: ExportProject writes one senpai-<id>.zip and
// ImportProject reads it back. The zip holds everything needed to recreate a
// work-item (identity, raw sources, wiki, artifacts, wiki index state, change
// and activity history, usage) plus a manifest with a format version and a
// sha256 per file. prompt_log.jsonl and run_logs/ are deliberately left out:
// they can carry sensitive prompt text and are not needed to continue work.

const (
	transferManifestName  = "senpai-export.json"
	transferFormatVersion = 1
	// Guards against zip bombs: the manifest is not trusted for sizes, so the
	// actual decompressed bytes are counted while extracting.
	transferMaxFileBytes  int64 = 512 << 20
	transferMaxTotalBytes int64 = 4 << 30
)

// transferFiles are the single files at the project root that travel;
// transferDirs are the trees. Both are missing-tolerant on export.
var (
	transferFiles = []string{"project.json", ".index-state.json", "changes.jsonl", "activity.jsonl", "usage.jsonl"}
	transferDirs  = []string{"raw", "wiki", "artifacts"}
)

type transferEntry struct {
	Path   string `json:"path"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

type transferManifest struct {
	FormatVersion int             `json:"format_version"`
	ExportedAt    string          `json:"exported_at"`
	AppVersion    string          `json:"app_version,omitempty"`
	ProjectID     string          `json:"project_id"`
	ProjectName   string          `json:"project_name"`
	Files         []transferEntry `json:"files"`
}

type importResult struct {
	ProjectID  string `json:"project_id"`
	Name       string `json:"name"`
	OriginalID string `json:"original_id"`
	// Copied is true when the original id was already taken and the package
	// was imported as a new work-item under a fresh id.
	Copied bool `json:"copied"`
}

func isTransferPath(name string) bool {
	for _, file := range transferFiles {
		if name == file {
			return true
		}
	}
	top, _, nested := strings.Cut(name, "/")
	if !nested {
		return false
	}
	for _, dir := range transferDirs {
		if top == dir {
			return true
		}
	}
	return false
}

// ExportProject lets the user choose a destination directory, then writes the
// project package there as a new, non-overwriting senpai-<projectID>.zip. The
// returned path is empty when the dialog is cancelled.
func (a *App) ExportProject(projectID string) (string, error) {
	if err := validateProjectID(projectID); err != nil {
		return "", err
	}
	destination, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:                "Exportar projeto",
		CanCreateDirectories: true,
	})
	if err != nil {
		return "", fmt.Errorf("selecionar pasta de exportacao: %w", err)
	}
	if destination == "" {
		return "", nil
	}
	return a.exportProjectTo(projectID, destination)
}

// exportProjectTo is the filesystem part of ExportProject, testable headlessly.
func (a *App) exportProjectTo(projectID string, destinationParent string) (string, error) {
	if err := validateProjectID(projectID); err != nil {
		return "", err
	}
	if a.dataDir == "" {
		return "", fmt.Errorf("data dir nao resolvido — veja o log de startup")
	}
	projectDir := filepath.Join(a.dataDir, "projects", projectID)
	if info, err := os.Stat(projectDir); err != nil {
		if os.IsNotExist(err) {
			return "", fmt.Errorf("work-item nao encontrado: %q", projectID)
		}
		return "", fmt.Errorf("ler work-item para exportacao: %w", err)
	} else if !info.IsDir() {
		return "", fmt.Errorf("work-item nao e um diretorio: %q", projectID)
	}
	if info, err := os.Stat(destinationParent); err != nil {
		return "", fmt.Errorf("ler pasta de destino: %w", err)
	} else if !info.IsDir() {
		return "", fmt.Errorf("destino nao e uma pasta: %q", destinationParent)
	}
	for _, root := range transferDirs {
		if pathIsWithin(filepath.Join(projectDir, root), destinationParent) {
			return "", fmt.Errorf("a pasta de exportacao nao pode ficar dentro de %s/", root)
		}
	}

	record, err := readProjectRecord(filepath.Join(projectDir, "project.json"))
	if err != nil {
		return "", fmt.Errorf("ler project.json: %w", err)
	}

	relatives, err := collectTransferFiles(projectDir)
	if err != nil {
		return "", err
	}

	zipPath := uniqueFileDestination(destinationParent, "senpai-"+projectID, ".zip")
	out, err := os.OpenFile(zipPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return "", fmt.Errorf("criar pacote de exportacao: %w", err)
	}
	completed := false
	defer func() {
		_ = out.Close()
		if !completed {
			_ = os.Remove(zipPath)
		}
	}()

	writer := zip.NewWriter(out)
	manifest := transferManifest{
		FormatVersion: transferFormatVersion,
		ExportedAt:    time.Now().UTC().Format(time.RFC3339),
		AppVersion:    currentAppVersion(),
		ProjectID:     projectID,
		ProjectName:   stringField(record, "name"),
	}
	for _, relative := range relatives {
		entry, err := addTransferFile(writer, filepath.Join(projectDir, filepath.FromSlash(relative)), relative)
		if err != nil {
			return "", err
		}
		manifest.Files = append(manifest.Files, entry)
	}
	manifestBytes, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return "", fmt.Errorf("gerar manifesto: %w", err)
	}
	manifestWriter, err := writer.Create(transferManifestName)
	if err != nil {
		return "", fmt.Errorf("gravar manifesto: %w", err)
	}
	if _, err := manifestWriter.Write(manifestBytes); err != nil {
		return "", fmt.Errorf("gravar manifesto: %w", err)
	}
	if err := writer.Close(); err != nil {
		return "", fmt.Errorf("finalizar pacote: %w", err)
	}
	if err := out.Close(); err != nil {
		return "", fmt.Errorf("finalizar pacote: %w", err)
	}
	completed = true
	return zipPath, nil
}

// collectTransferFiles lists, as slash-separated paths relative to the
// project, every file that goes into the package. Symlinks abort the export.
func collectTransferFiles(projectDir string) ([]string, error) {
	var relatives []string
	for _, name := range transferFiles {
		info, err := os.Lstat(filepath.Join(projectDir, name))
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, fmt.Errorf("ler %s para exportacao: %w", name, err)
		}
		if !info.Mode().IsRegular() {
			return nil, fmt.Errorf("%s nao e um arquivo regular", name)
		}
		relatives = append(relatives, name)
	}
	for _, root := range transferDirs {
		base := filepath.Join(projectDir, root)
		if _, err := os.Lstat(base); err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, fmt.Errorf("ler %s para exportacao: %w", root, err)
		}
		err := filepath.WalkDir(base, func(current string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if entry.Type()&os.ModeSymlink != 0 {
				return fmt.Errorf("links simbolicos nao sao exportados: %s", entry.Name())
			}
			if entry.IsDir() {
				return nil
			}
			if !entry.Type().IsRegular() {
				return fmt.Errorf("arquivo especial nao e exportado: %s", entry.Name())
			}
			rel, err := filepath.Rel(projectDir, current)
			if err != nil {
				return err
			}
			relatives = append(relatives, filepath.ToSlash(rel))
			return nil
		})
		if err != nil {
			return nil, fmt.Errorf("exportar %s: %w", root, err)
		}
	}
	sort.Strings(relatives)
	return relatives, nil
}

func addTransferFile(writer *zip.Writer, source string, relative string) (transferEntry, error) {
	in, err := os.Open(source)
	if err != nil {
		return transferEntry{}, fmt.Errorf("abrir %s para exportacao: %w", relative, err)
	}
	defer in.Close()
	dest, err := writer.Create(relative)
	if err != nil {
		return transferEntry{}, fmt.Errorf("adicionar %s ao pacote: %w", relative, err)
	}
	hash := sha256.New()
	size, err := io.Copy(io.MultiWriter(dest, hash), in)
	if err != nil {
		return transferEntry{}, fmt.Errorf("copiar %s para o pacote: %w", relative, err)
	}
	return transferEntry{Path: relative, Size: size, SHA256: hex.EncodeToString(hash.Sum(nil))}, nil
}

// ImportProject asks for a package (.zip) and recreates the work-item from
// it. It returns a JSON importResult, or "" when the dialog is cancelled.
func (a *App) ImportProject() (string, error) {
	source, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Importar projeto",
		Filters: []runtime.FileFilter{{DisplayName: "Pacote Senpai (*.zip)", Pattern: "*.zip"}},
	})
	if err != nil {
		return "", fmt.Errorf("selecionar pacote: %w", err)
	}
	if source == "" {
		return "", nil
	}
	result, err := a.importProjectFrom(source)
	if err != nil {
		return "", err
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

// importProjectFrom validates the whole package before anything is visible:
// it extracts into a hidden staging directory and only renames it to
// projects/<id> once every checksum matched. If the id is already taken the
// package is imported as a copy under a fresh id, never over the existing one.
func (a *App) importProjectFrom(zipPath string) (importResult, error) {
	if a.dataDir == "" {
		return importResult{}, fmt.Errorf("data dir nao resolvido — veja o log de startup")
	}
	reader, err := zip.OpenReader(zipPath)
	if err != nil {
		return importResult{}, fmt.Errorf("abrir pacote: %w", err)
	}
	defer reader.Close()

	manifest, err := readTransferManifest(reader)
	if err != nil {
		return importResult{}, err
	}
	expected := make(map[string]transferEntry, len(manifest.Files))
	for _, entry := range manifest.Files {
		if !isTransferPath(entry.Path) || path.Clean(entry.Path) != entry.Path || strings.ContainsAny(entry.Path, "\\:\x00") {
			return importResult{}, fmt.Errorf("pacote invalido: caminho nao permitido %q", entry.Path)
		}
		if _, dup := expected[entry.Path]; dup {
			return importResult{}, fmt.Errorf("pacote invalido: caminho repetido %q", entry.Path)
		}
		expected[entry.Path] = entry
	}
	if _, ok := expected["project.json"]; !ok {
		return importResult{}, fmt.Errorf("pacote invalido: project.json ausente")
	}

	projectsDir := filepath.Join(a.dataDir, "projects")
	if err := os.MkdirAll(projectsDir, 0o755); err != nil {
		return importResult{}, fmt.Errorf("criar pasta de projetos: %w", err)
	}
	staging, err := os.MkdirTemp(projectsDir, ".import-")
	if err != nil {
		return importResult{}, fmt.Errorf("criar pasta temporaria: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = os.RemoveAll(staging)
		}
	}()

	seen := make(map[string]bool, len(expected))
	var total int64
	for _, file := range reader.File {
		if file.Name == transferManifestName {
			continue
		}
		if file.FileInfo().IsDir() {
			continue
		}
		want, ok := expected[file.Name]
		if !ok {
			return importResult{}, fmt.Errorf("pacote invalido: arquivo fora do manifesto %q", file.Name)
		}
		if !file.Mode().IsRegular() {
			return importResult{}, fmt.Errorf("pacote invalido: %q nao e arquivo regular", file.Name)
		}
		if seen[file.Name] {
			return importResult{}, fmt.Errorf("pacote invalido: arquivo repetido %q", file.Name)
		}
		seen[file.Name] = true
		written, sum, err := extractTransferFile(file, filepath.Join(staging, filepath.FromSlash(file.Name)))
		if err != nil {
			return importResult{}, err
		}
		if sum != want.SHA256 {
			return importResult{}, fmt.Errorf("pacote corrompido: checksum diferente em %q", file.Name)
		}
		total += written
		if total > transferMaxTotalBytes {
			return importResult{}, fmt.Errorf("pacote excede o tamanho maximo permitido")
		}
	}
	for name := range expected {
		if !seen[name] {
			return importResult{}, fmt.Errorf("pacote incompleto: %q ausente", name)
		}
	}

	projectFile := filepath.Join(staging, "project.json")
	record, err := readProjectRecord(projectFile)
	if err != nil {
		return importResult{}, fmt.Errorf("pacote invalido: project.json: %w", err)
	}
	originalID := stringField(record, "id")
	if err := validateProjectID(manifest.ProjectID); err != nil || originalID != manifest.ProjectID {
		return importResult{}, fmt.Errorf("pacote invalido: id do projeto inconsistente")
	}

	result := importResult{ProjectID: originalID, Name: stringField(record, "name"), OriginalID: originalID}
	target := filepath.Join(projectsDir, originalID)
	if _, err := os.Lstat(target); err == nil {
		newID, err := uuid.NewV7()
		if err != nil {
			return importResult{}, fmt.Errorf("gerar novo id: %w", err)
		}
		result.ProjectID = newID.String()
		result.Copied = true
		result.Name = result.Name + " (importado)"
		record["id"] = result.ProjectID
		record["name"] = result.Name
		encoded, err := json.Marshal(record)
		if err != nil {
			return importResult{}, fmt.Errorf("reescrever project.json: %w", err)
		}
		if err := os.WriteFile(projectFile, encoded, 0o644); err != nil {
			return importResult{}, fmt.Errorf("reescrever project.json: %w", err)
		}
		target = filepath.Join(projectsDir, result.ProjectID)
	} else if !os.IsNotExist(err) {
		return importResult{}, fmt.Errorf("verificar projeto existente: %w", err)
	}

	if err := os.Rename(staging, target); err != nil {
		return importResult{}, fmt.Errorf("gravar projeto importado: %w", err)
	}
	committed = true
	return result, nil
}

func readTransferManifest(reader *zip.ReadCloser) (transferManifest, error) {
	for _, file := range reader.File {
		if file.Name != transferManifestName {
			continue
		}
		in, err := file.Open()
		if err != nil {
			return transferManifest{}, fmt.Errorf("ler manifesto: %w", err)
		}
		defer in.Close()
		var manifest transferManifest
		if err := json.NewDecoder(io.LimitReader(in, 32<<20)).Decode(&manifest); err != nil {
			return transferManifest{}, fmt.Errorf("manifesto invalido: %w", err)
		}
		if manifest.FormatVersion < 1 {
			return transferManifest{}, fmt.Errorf("manifesto invalido: format_version ausente")
		}
		if manifest.FormatVersion > transferFormatVersion {
			return transferManifest{}, fmt.Errorf("pacote de versao mais nova (formato %d) — atualize o Senpai para importar", manifest.FormatVersion)
		}
		return manifest, nil
	}
	return transferManifest{}, fmt.Errorf("nao e um pacote Senpai: %s ausente", transferManifestName)
}

func extractTransferFile(file *zip.File, destination string) (int64, string, error) {
	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		return 0, "", fmt.Errorf("criar pasta de %q: %w", file.Name, err)
	}
	in, err := file.Open()
	if err != nil {
		return 0, "", fmt.Errorf("abrir %q no pacote: %w", file.Name, err)
	}
	defer in.Close()
	out, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return 0, "", fmt.Errorf("criar %q: %w", file.Name, err)
	}
	hash := sha256.New()
	written, err := io.Copy(io.MultiWriter(out, hash), io.LimitReader(in, transferMaxFileBytes+1))
	closeErr := out.Close()
	if err != nil {
		return 0, "", fmt.Errorf("extrair %q: %w", file.Name, err)
	}
	if closeErr != nil {
		return 0, "", fmt.Errorf("extrair %q: %w", file.Name, closeErr)
	}
	if written > transferMaxFileBytes {
		return 0, "", fmt.Errorf("arquivo %q excede o tamanho maximo permitido", file.Name)
	}
	return written, hex.EncodeToString(hash.Sum(nil)), nil
}

func readProjectRecord(file string) (map[string]any, error) {
	content, err := os.ReadFile(file)
	if err != nil {
		return nil, err
	}
	var record map[string]any
	if err := json.Unmarshal(content, &record); err != nil {
		return nil, err
	}
	if record == nil {
		return nil, errors.New("project.json vazio")
	}
	return record, nil
}

func stringField(record map[string]any, key string) string {
	value, _ := record[key].(string)
	return value
}

func uniqueFileDestination(parent string, name string, ext string) string {
	candidate := filepath.Join(parent, name+ext)
	if _, err := os.Stat(candidate); os.IsNotExist(err) {
		return candidate
	}
	for i := 2; ; i++ {
		candidate = filepath.Join(parent, name+" ("+strconv.Itoa(i)+")"+ext)
		if _, err := os.Stat(candidate); os.IsNotExist(err) {
			return candidate
		}
	}
}
