#!/usr/bin/env bash
# Keeps app/embedded/bin/mhl-<goos>-<goarch>[.exe] in sync with whatever
# `mhl` is on PATH, for the CURRENT machine only — the dev-loop counterpart
# to sync.sh's full multi-platform release sync (see README.md: "whenever
# you upgrade your local dev mhl install and validate the new version, also
# refresh the matching file here"). Meant to run as a preLaunchTask before
# every local debug build, so this can't happen again: app/embedded/bin/
# mhl-darwin-arm64 sat at v1.4.0-beta.14 (pre-`stdin:` support) for a day
# after the dev `mhl` install moved to v1.4.0-beta.15, and the resulting
# symptom (Claude Code CLI silently getting empty stdin) looked nothing like
# "wrong mhl version" until the vendored binary's own sha256/version was
# checked directly against the running app's own startup log.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

path_mhl="$(command -v mhl || true)"
if [ -z "$path_mhl" ]; then
  echo "sync-dev-mhl: no 'mhl' on PATH — skipping (nothing to sync from)" >&2
  exit 0
fi

goos="$(go env GOOS)"
goarch="$(go env GOARCH)"
dest="bin/mhl-${goos}-${goarch}"
[ "$goos" = "windows" ] && dest="${dest}.exe"

if [ ! -f "$dest" ]; then
  echo "sync-dev-mhl: no vendored binary for ${goos}/${goarch} at $dest — add it via sync.sh first (see README.md)" >&2
  exit 0
fi

if cmp -s "$path_mhl" "$dest"; then
  echo "sync-dev-mhl: $dest already matches PATH mhl ($("$path_mhl" version))"
  exit 0
fi

old_version="$("$dest" version 2>/dev/null || echo "unknown")"
cp "$path_mhl" "$dest"
chmod 755 "$dest"
new_version="$("$dest" version)"
echo "sync-dev-mhl: updated $dest: $old_version -> $new_version (sha256 $(shasum -a 256 "$dest" | cut -d' ' -f1))"
