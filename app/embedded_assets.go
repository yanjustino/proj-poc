package main

import _ "embed"

// vendoredMermaidJS is the same mermaid UMD bundle the frontend inlines
// into its own preview (Fase 6, app/frontend/src/mermaid-inline.js) — here
// it's what ensureArtifactMermaidAsset writes out as
// projects/<id>/artifacts/assets/mermaid.min.js, so a diagram/DER artifact
// still renders when opened outside the app (double-click, emailed, no
// running Senpai instance nearby). Refresh from
// app/frontend/node_modules/mermaid/dist/mermaid.min.js via
// app/embedded/sync.sh whenever the frontend's mermaid dependency is bumped.
//
//go:embed embedded/assets/mermaid.min.js
var vendoredMermaidJS []byte
