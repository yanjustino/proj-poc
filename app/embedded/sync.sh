#!/usr/bin/env bash
# Refreshes the parts of app/embedded/ that come from elsewhere in this repo
# (or its frontend's node_modules) — run before a release build whenever
# workflows/ changed, or the frontend's mermaid dependency was bumped.
#
# What this script does NOT do: refresh embedded/bin/mhl-*. Those come from
# outside this repo entirely (a mhl release build for each platform, not
# something this repo produces) — copy them in by hand, then rebuild. See
# README.md in this directory.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

rm -rf workflows
cp -R ../../workflows ./workflows
echo "synced workflows/ -> app/embedded/workflows/"

mermaid_src="../frontend/node_modules/mermaid/dist/mermaid.min.js"
if [ -f "$mermaid_src" ]; then
  cp "$mermaid_src" assets/mermaid.min.js
  echo "synced $mermaid_src -> app/embedded/assets/mermaid.min.js"
else
  echo "warning: $mermaid_src not found (run npm install in app/frontend first) — assets/mermaid.min.js left unchanged" >&2
fi
