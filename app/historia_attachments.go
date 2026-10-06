package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Complementos de uma historia: arquivos quaisquer que o usuario anexa para
// cobrir dependencias da feature que a historia gerada pode nao refletir por
// completo. Ficam em <pasta da historia>/anexos/ (historias/<feature>/<USxxx>
// no Discovery, historias/<USxxx> no Delivery em lote, a raiz de artifacts/
// para a historia unica do Delivery). O workflow so os le: preserva-os ao
// regerar as historias e os copia para o pacote de handoff
// (workflows/shared/artifacts/historia_anexos.mh).

// historiaPathPattern: the only shapes a história folder takes under
// artifacts/ — "" (Delivery's single story at the root) is handled apart.
var historiaPathPattern = regexp.MustCompile(`^historias/[^/\\]+(/[^/\\]+)?$`)

// historiaAttachmentsDir resolves <história>/anexos/ for an existing
// história — historia.json must be there, so a typo'd or stale path never
// creates a stray folder.
func (a *App) historiaAttachmentsDir(projectID string, historiaPath string) (string, error) {
	artifactsDir, err := a.projectRootDir(projectID, "artifacts", []string{"artifacts"})
	if err != nil {
		return "", err
	}
	if historiaPath != "" && !historiaPathPattern.MatchString(historiaPath) {
		return "", fmt.Errorf("pasta de historia invalida: %q", historiaPath)
	}
	storyDir, err := resolveSafeRelative(artifactsDir, historiaPath)
	if err != nil {
		return "", err
	}
	if _, err := os.Stat(filepath.Join(storyDir, "historia.json")); err != nil {
		return "", fmt.Errorf("historia nao encontrada: %q", historiaPath)
	}
	return filepath.Join(storyDir, "anexos"), nil
}

// AttachHistoriaFiles opens the native multi-file picker and copies every
// chosen file into the história's anexos/, returning the stored names as a
// JSON array (empty if the user cancels).
func (a *App) AttachHistoriaFiles(projectID string, historiaPath string) (string, error) {
	if _, err := a.historiaAttachmentsDir(projectID, historiaPath); err != nil {
		return "", err
	}
	paths, err := runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Anexar complementos à história",
	})
	if err != nil {
		return "", fmt.Errorf("selecionar anexos: %w", err)
	}
	names, err := a.attachHistoriaFilesFrom(projectID, historiaPath, paths)
	if err != nil {
		return "", err
	}
	body, err := json.Marshal(names)
	if err != nil {
		return "", fmt.Errorf("encode attached names: %w", err)
	}
	return string(body), nil
}

// attachHistoriaFilesFrom is AttachHistoriaFiles' filesystem part, testable
// headlessly. Each file keeps its basename, de-duplicated like AddRawFile.
// Hidden files are refused: the workflow skips dotfiles (OS bookkeeping), so
// one would never reach the handoff.
func (a *App) attachHistoriaFilesFrom(projectID string, historiaPath string, sources []string) ([]string, error) {
	anexosDir, err := a.historiaAttachmentsDir(projectID, historiaPath)
	if err != nil {
		return nil, err
	}
	names := []string{}
	if len(sources) == 0 {
		return names, nil
	}
	if err := os.MkdirAll(anexosDir, 0o755); err != nil {
		return nil, fmt.Errorf("create anexos dir: %w", err)
	}
	for _, source := range sources {
		base := filepath.Base(source)
		if base == "." || base == string(filepath.Separator) || base == "" {
			return names, fmt.Errorf("caminho de origem invalido: %q", source)
		}
		if strings.HasPrefix(base, ".") {
			return names, fmt.Errorf("arquivo oculto nao pode ser anexado: %q", base)
		}
		dest := uniqueDestination(anexosDir, base)
		if err := copyNewFile(source, dest); err != nil {
			return names, err
		}
		names = append(names, filepath.Base(dest))
	}
	return names, nil
}

// RemoveHistoriaAttachment deletes one attachment by name; the anexos/
// folder goes too once it's empty.
func (a *App) RemoveHistoriaAttachment(projectID string, historiaPath string, name string) error {
	anexosDir, err := a.historiaAttachmentsDir(projectID, historiaPath)
	if err != nil {
		return err
	}
	if name == "" || name == "." || name == ".." || strings.ContainsAny(name, `/\`) {
		return fmt.Errorf("nome de anexo invalido: %q", name)
	}
	if err := os.Remove(filepath.Join(anexosDir, name)); err != nil {
		return fmt.Errorf("remover anexo: %w", err)
	}
	if entries, err := os.ReadDir(anexosDir); err == nil && len(entries) == 0 {
		_ = os.Remove(anexosDir)
	}
	return nil
}

// copyNewFile copies source to dest, refusing to overwrite an existing dest.
func copyNewFile(source string, dest string) error {
	src, err := os.Open(source)
	if err != nil {
		return fmt.Errorf("open source file: %w", err)
	}
	defer src.Close()
	if info, err := src.Stat(); err != nil || info.IsDir() {
		return fmt.Errorf("origem nao e um arquivo: %q", source)
	}
	out, err := os.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return fmt.Errorf("create destination file: %w", err)
	}
	if _, err := io.Copy(out, src); err != nil {
		out.Close()
		_ = os.Remove(dest)
		return fmt.Errorf("copy file: %w", err)
	}
	return out.Close()
}
