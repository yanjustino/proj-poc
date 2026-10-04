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
#
# Usage: sync.sh [DIST_DIR] [PLATFORM...]
#   No PLATFORM: every binary in bin_targets is required (release refresh,
#   scripts/build-all.sh) — any one missing from DIST_DIR fails the script.
#   With PLATFORM(s) (e.g. "windows-amd64"): a per-platform build only embeds
#   its own mhl (embedded_mhl_<goos>_<goarch>.go is build-tagged), so only
#   those are required, and only to the extent that bin/ has *some* copy —
#   missing from DIST_DIR but present in bin/ warns that the embedded copy
#   may be stale and carries on (same rule as build-linux.sh's precheck).
#   Every other platform missing from DIST_DIR is just a warning. Before
#   this, one absent dist/linux-arm64/mhl failed the Windows, macOS and every
#   Linux build alike.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

DIST_DIR="${1:-../../dist}"
shift || true
required_platforms=" $* "

# sha256 / byte comparison that also work in minimal containers: Rocky
# Linux 8 (linux-rhel-build.Dockerfile) ships neither `cmp` (diffutils) nor
# `shasum` (perl), which left the log printing an empty "sha256 ()".
sha256_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    echo "?"
  fi
}
same_file() {
  if command -v cmp >/dev/null 2>&1; then
    cmp -s "$1" "$2"
  else
    [ "$(sha256_of "$1")" != "?" ] && [ "$(sha256_of "$1")" = "$(sha256_of "$2")" ]
  fi
}
is_required() {
  [ "$required_platforms" = "  " ] || [[ "$required_platforms" == *" $1 "* ]]
}

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

# goos-goarch:dist-binary-name:embedded-name — the 4 platforms
# embedded_mhl_<goos>_<goarch>.go actually embeds today (darwin/amd64 has no
# //go:embed file yet; see README.md).
bin_targets=(
  "darwin-arm64:mhl:mhl-darwin-arm64"
  "linux-amd64:mhl:mhl-linux-amd64"
  "linux-arm64:mhl:mhl-linux-arm64"
  "windows-amd64:mhl.exe:mhl-windows-amd64.exe"
)

bin_failed=0
for target in "${bin_targets[@]}"; do
  IFS=':' read -r platform_dir dist_name embedded_name <<<"$target"
  src="$DIST_DIR/$platform_dir/$dist_name"
  dest="bin/$embedded_name"

  if [ ! -f "$src" ]; then
    if [ "$required_platforms" = "  " ]; then
      echo "warning: $src not found — bin/$embedded_name left unchanged" >&2
      bin_failed=1
    elif ! is_required "$platform_dir"; then
      echo "note: $src not found — bin/$embedded_name left unchanged (not needed for this build)"
    elif [ -f "$dest" ]; then
      echo "warning: $src not found — building with the existing bin/$embedded_name, which may be stale (sha256 $(sha256_of "$dest"))" >&2
    else
      echo "error: $src not found and there is no bin/$embedded_name to fall back on" >&2
      bin_failed=1
    fi
    continue
  fi

  if [ -f "$dest" ] && same_file "$src" "$dest"; then
    echo "bin/$embedded_name already up to date (sha256 $(sha256_of "$dest"))"
    continue
  fi

  # Cópia temporária + mv, nunca cp por cima — ver sync-dev-mhl.sh.
  cp "$src" "$dest.tmp"
  chmod 755 "$dest.tmp"
  mv -f "$dest.tmp" "$dest"
  echo "synced $src -> bin/$embedded_name (sha256 $(sha256_of "$dest"))"
done

if [ "$bin_failed" -ne 0 ]; then
  echo "warning: one or more platform binaries were not refreshed from $DIST_DIR — do not ship a release build until this is fixed" >&2
  exit 1
fi
