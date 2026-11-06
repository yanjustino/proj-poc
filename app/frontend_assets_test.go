package main

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"path"
	"regexp"
	"strings"
	"testing"
)

func TestFrontendFallbackAssetsServesEmbeddedFiles(t *testing.T) {
	handler := frontendFallbackAssets()
	tests := []struct {
		url, contentType, body string
	}{
		{"/embedded/mermaid.min.js", "text/javascript; charset=utf-8", "mermaid"},
		{"/embedded/page_shell.prompt.md", "text/plain; charset=utf-8", "<style>"},
	}
	for _, tt := range tests {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tt.url, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status %d", tt.url, rec.Code)
		}
		if got := rec.Header().Get("Content-Type"); got != tt.contentType {
			t.Errorf("%s: Content-Type %q", tt.url, got)
		}
		if !strings.Contains(rec.Body.String(), tt.body) {
			t.Errorf("%s: body has no %q", tt.url, tt.body)
		}
	}
}

func TestFrontendFallbackAssetsRejectsOtherPaths(t *testing.T) {
	rec := httptest.NewRecorder()
	frontendFallbackAssets().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/embedded/workflows/secret", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status %d, want 404", rec.Code)
	}
}

// With no bundler to fail on them, a broken import would only surface as a
// blank window at runtime.
func TestFrontendModuleImportsResolve(t *testing.T) {
	importPattern := regexp.MustCompile(`(?m)^\s*(?:import\s+['"]|(?:import|export|\})[^'"\n]*\bfrom\s+['"])([^'"\n]+)['"]`)
	urlPattern := regexp.MustCompile(`new URL\('([^']+)', import\.meta\.url\)`)
	checked := 0
	err := fs.WalkDir(assets, "frontend/src", func(file string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() || path.Ext(file) != ".js" {
			return err
		}
		source, err := fs.ReadFile(assets, file)
		if err != nil {
			return err
		}
		matches := append(importPattern.FindAllSubmatch(source, -1), urlPattern.FindAllSubmatch(source, -1)...)
		for _, match := range matches {
			target := string(match[1])
			if !strings.HasPrefix(target, ".") {
				t.Errorf("%s: %q is not a relative path; the page has no bundler to resolve it", file, target)
				continue
			}
			if _, err := fs.Stat(assets, path.Join(path.Dir(file), target)); err != nil {
				t.Errorf("%s: %q does not resolve: %v", file, target, err)
			}
			checked++
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if checked < 50 {
		t.Fatalf("checked only %d imports; the pattern likely stopped matching", checked)
	}
}
