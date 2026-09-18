#!/usr/bin/env bash
# One-shot dev build: refreshes mhl from its own source tree, re-vendors it
# (+ workflows/mermaid, via app/embedded/sync.sh) into app/embedded/, then
# builds the Senpai app bundle. This is a local dev convenience script tied
# to this machine's checkout layout (MHL_RUNTIME_DIR below) — not meant for
# CI or another dev's machine as-is; see app/embedded/README.md for the
# underlying manual steps this automates.
#
# Usage: ./scripts/build-all.sh [--update-deps] [--debug|--release]
#
#   --update-deps  go get -u ./... && go mod tidy in both the mhl-runtime
#                  source tree and this app, before building. Off by
#                  default — a dependency bump can change behavior or break
#                  the build, so it's opt-in rather than silent on every run.
#   --debug        (default) debug app bundle — same incantation as the VS
#                  Code "build app bundle (debug)" task (xattr/codesign
#                  workaround included, since a raw `wails build -debug`
#                  output fails native sheets otherwise).
#   --release      release app bundle (`wails build -clean`, no -debug).
set -euo pipefail

ROOT="$(CDPATH= cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
MHL_RUNTIME_DIR="${MHL_RUNTIME_DIR:-$HOME/Documents/mhl.lang.nosync/src/mhl-runtime}"
WAILS="${WAILS:-$HOME/go/bin/wails}"
APP_VERSION="${SENPAI_VERSION:-$(git -C "$ROOT" describe --tags --always --dirty)}"

update_deps=0
mode=debug
for arg in "$@"; do
  case "$arg" in
    --update-deps) update_deps=1 ;;
    --debug) mode=debug ;;
    --release) mode=release ;;
    *) echo "unknown argument: $arg (expected --update-deps, --debug, or --release)" >&2; exit 2 ;;
  esac
done

if [ ! -d "$MHL_RUNTIME_DIR" ]; then
  echo "error: mhl-runtime source not found at $MHL_RUNTIME_DIR (set MHL_RUNTIME_DIR to override)" >&2
  exit 1
fi
if [ ! -x "$WAILS" ]; then
  echo "error: wails CLI not found at $WAILS (set WAILS to override)" >&2
  exit 1
fi

step() { printf '\n== %s ==\n' "$1"; }

if [ "$update_deps" -eq 1 ]; then
  step "updating Go deps: mhl-runtime ($MHL_RUNTIME_DIR)"
  ( cd "$MHL_RUNTIME_DIR" && go get -u ./... && go mod tidy )

  step "updating Go deps: senpai-app"
  ( cd "$ROOT/app" && go get -u ./... && go mod tidy )
fi

step "mhl-runtime: go test ./..."
( cd "$MHL_RUNTIME_DIR" && ./build.sh test )

step "mhl-runtime: release build (linux/amd64, darwin/arm64, windows/amd64)"
( cd "$MHL_RUNTIME_DIR" && ./build.sh release )

step "staging dist/ from mhl-runtime"
# Only the per-platform subdirs build.sh's release target produces (and
# sync.sh's bin_targets reads) — not a blanket mirror of mhl-runtime/dist/,
# which can also hold host-build artifacts (e.g. a plain "dist/mhl" from an
# ad hoc `./build.sh build`) that don't belong in this repo's tracked dist/.
for platform_dir in linux-amd64 darwin-arm64 windows-amd64; do
  mkdir -p "$ROOT/dist/$platform_dir"
  rsync -a --delete "$MHL_RUNTIME_DIR/dist/$platform_dir/" "$ROOT/dist/$platform_dir/"
done

step "app/embedded: sync bin/workflows/mermaid from dist/ and workflows/"
"$ROOT/app/embedded/sync.sh" "$ROOT/dist"

step "senpai-app: go build sanity check"
( cd "$ROOT/app" && go build ./... )

step "senpai-app: wails build ($mode)"
bundle="$ROOT/app/build/bin/senpai-app.app"
rm -rf "$bundle"
# wails build's own ad-hoc self-sign is flaky here (see tasks.json's "build
# app bundle (debug)" comment): macOS tags the freshly written bundle with
# com.apple.provenance, which codesign then rejects ("resource fork ...
# not allowed") — sometimes inside wails' own signing step (making the
# whole `wails build` exit non-zero even though the binary was compiled and
# packaged just fine beforehand), sometimes only on our own re-sign below.
# So: don't let a failure here abort the script (`|| wails_failed=1`, not
# `set -e`) — the bundle + unsigned/half-signed binary already exist by
# this point — and instead let the xattr/codesign retry below paper over
# it, exactly like the VS Code task does.
wails_failed=0
if [ "$mode" = debug ]; then
  ( cd "$ROOT/app" && CGO_LDFLAGS="-framework UniformTypeIdentifiers" "$WAILS" build -debug -clean -ldflags "-X main.buildVersion=$APP_VERSION" ) || wails_failed=1
else
  ( cd "$ROOT/app" && CGO_LDFLAGS="-framework UniformTypeIdentifiers" "$WAILS" build -clean -ldflags "-X main.buildVersion=$APP_VERSION" ) || wails_failed=1
fi
if [ "$wails_failed" -ne 0 ]; then
  echo "warning: wails build reported a failure (likely its own flaky self-sign) — retrying the re-sign below before giving up" >&2
fi

xattr -cr "$bundle" || true
if ! codesign --force --deep -s - "$bundle" 2>/tmp/senpai-build-codesign.log; then
  echo "warning: manual re-sign failed (likely macOS com.apple.provenance) — checking for a signature from wails' own attempt" >&2
  cat /tmp/senpai-build-codesign.log >&2
fi
if ! codesign -dv "$bundle" >/dev/null 2>&1; then
  echo "error: $bundle has no valid code signature (neither wails' own signing nor the manual retry succeeded)" >&2
  exit 1
fi

step "done"
echo "app bundle: $bundle ($(codesign -dv "$bundle" 2>&1 | grep '^Signature='))"
