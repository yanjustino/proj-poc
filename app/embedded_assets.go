package main

import _ "embed"

// vendoredMermaidJS is the same mermaid UMD bundle the frontend inlines
// into its own preview (Fase 6, app/frontend/src/mermaid-inline.js) — here
// it's what ensureArtifactMermaidAsset writes out as
// projects/<id>/artifacts/assets/mermaid.min.js, so a diagram/DER artifact
// still renders when opened outside the app (double-click, emailed, no
// running Senpai instance nearby). The file in embedded/assets is the source
// of truth; app/frontend/vendor/README.md says how to update it.
//
//go:embed embedded/assets/mermaid.min.js
var vendoredMermaidJS []byte
