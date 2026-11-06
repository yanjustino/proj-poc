package main

import (
	"net/http"
	"path"
)

// frontendFallbackAssets serves the files the frontend needs but the embedded
// page assets can't hold, because their source of truth lives under
// app/embedded/: Wails calls it for every GET that frontend/ can't satisfy.
func frontendFallbackAssets() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /embedded/mermaid.min.js", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		w.Write(vendoredMermaidJS)
	})
	mux.HandleFunc("GET /embedded/page_shell.prompt.md", func(w http.ResponseWriter, _ *http.Request) {
		shell, err := vendoredWorkflowsFS.ReadFile(path.Join(vendoredWorkflowsRoot, "shared/artifacts/page_shell.prompt.md"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Write(shell)
	})
	return mux
}
