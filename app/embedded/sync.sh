#!/usr/bin/env bash
# Refreshes everything under app/embedded/ from its source of truth elsewhere
# on disk — run before a release build whenever workflows/ changed, the
# frontend's mermaid dependency was bumped, or a fresh mhl was built into
# dist/. Each section is independent and soft-fails on its own (a missing
# mermaid bundle or an incomplete dist/ doesn't stop the others), but the
# script still exits non-zero overall if any *required* platform binary
# could not be refreshed, so a release build never silently ships a stale
# mhl.
#
# bin/mhl-<goos>-<goarch>[.exe] source: DIST_DIR (default ../../dist),
# matching the layout mhl-runtime's own build.sh release target produces
# (dist/<goos>-<arch>/mhl[.exe]) — copy or rsync that tree into DIST_DIR
# first (see README.md in this directory for the full refresh procedure).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

DIST_DIR="${1:-../../dist}"

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

# goos-goarch:dist-binary-name:embedded-name — the 3 platforms
# embedded_mhl_<goos>_<goarch>.go actually embeds today (darwin/amd64 has no
# //go:embed file yet; see README.md).
bin_targets=(
  "darwin-arm64:mhl:mhl-darwin-arm64"
  "linux-amd64:mhl:mhl-linux-amd64"
  "windows-amd64:mhl.exe:mhl-windows-amd64.exe"
)

bin_failed=0
for target in "${bin_targets[@]}"; do
  IFS=':' read -r platform_dir dist_name embedded_name <<<"$target"
  src="$DIST_DIR/$platform_dir/$dist_name"
  dest="bin/$embedded_name"

  if [ ! -f "$src" ]; then
    echo "warning: $src not found — bin/$embedded_name left unchanged" >&2
    bin_failed=1
    continue
  fi

  if [ -f "$dest" ] && cmp -s "$src" "$dest"; then
    echo "bin/$embedded_name already up to date (sha256 $(shasum -a 256 "$dest" | cut -d' ' -f1))"
    continue
  fi

  cp "$src" "$dest"
  chmod 755 "$dest"
  echo "synced $src -> bin/$embedded_name (sha256 $(shasum -a 256 "$dest" | cut -d' ' -f1))"
done

if [ "$bin_failed" -ne 0 ]; then
  echo "warning: one or more platform binaries were not refreshed from $DIST_DIR — do not ship a release build until this is fixed" >&2
  exit 1
fi
