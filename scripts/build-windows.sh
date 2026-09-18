#!/usr/bin/env bash
# Compila o Senpai para Windows x64 a partir de macOS, Linux ou Windows.
#
# Uso:
#   ./scripts/build-windows.sh
#   SENPAI_VERSION=v1.2.3 ./scripts/build-windows.sh
#   WAILS=/caminho/para/wails ./scripts/build-windows.sh --debug
#
# Saída:
#   dist/windows-amd64/senpai-app.exe
set -euo pipefail

ROOT="$(CDPATH= cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT/app"
TARGET="windows/amd64"
OUTPUT_NAME="senpai-windows-amd64.exe"
DIST_DIR="$ROOT/dist/windows-amd64"
FINAL_EXE="$DIST_DIR/senpai-app.exe"
APP_VERSION="${SENPAI_VERSION:-$(git -C "$ROOT" describe --tags --always --dirty 2>/dev/null || printf 'dev')}"

mode="release"
if [ "${1:-}" = "--debug" ]; then
  mode="debug"
elif [ "$#" -gt 0 ]; then
  echo "uso: $0 [--debug]" >&2
  exit 2
fi

if [ -n "${WAILS:-}" ]; then
  WAILS_BIN="$WAILS"
elif command -v wails >/dev/null 2>&1; then
  WAILS_BIN="$(command -v wails)"
elif [ -x "${HOME}/go/bin/wails" ]; then
  WAILS_BIN="${HOME}/go/bin/wails"
else
  echo "erro: Wails CLI não encontrado." >&2
  echo "instale com: go install github.com/wailsapp/wails/v2/cmd/wails@latest" >&2
  exit 1
fi

if [ ! -x "$WAILS_BIN" ]; then
  echo "erro: WAILS não aponta para um executável: $WAILS_BIN" >&2
  exit 1
fi

case "$(go env GOHOSTOS)" in
  darwin|linux)
    if ! command -v x86_64-w64-mingw32-gcc >/dev/null 2>&1; then
      echo "erro: compilador MinGW x64 não encontrado (x86_64-w64-mingw32-gcc)." >&2
      if [ "$(go env GOHOSTOS)" = "darwin" ]; then
        echo "instale com: brew install mingw-w64" >&2
      else
        echo "instale o pacote mingw-w64 da sua distribuição." >&2
      fi
      exit 1
    fi
    ;;
esac

if [ ! -f "$APP_DIR/embedded/bin/mhl-windows-amd64.exe" ]; then
  echo "erro: runtime MHL para Windows não encontrado em app/embedded/bin/." >&2
  echo "gere dist/windows-amd64/mhl.exe e execute app/embedded/sync.sh primeiro." >&2
  exit 1
fi

step() { printf '\n== %s ==\n' "$1"; }

step "sincronizando workflows e runtimes embutidos"
"$APP_DIR/embedded/sync.sh" "$ROOT/dist"

step "compilando Senpai $APP_VERSION para $TARGET ($mode)"
build_args=(
  build
  -platform "$TARGET"
  -o "$OUTPUT_NAME"
  -ldflags "-X main.buildVersion=$APP_VERSION"
)
if [ "$mode" = "debug" ]; then
  build_args+=( -debug )
fi

( cd "$APP_DIR" && "$WAILS_BIN" "${build_args[@]}" )

built_exe="$APP_DIR/build/bin/$OUTPUT_NAME"
if [ ! -f "$built_exe" ]; then
  echo "erro: o Wails terminou sem criar $built_exe" >&2
  exit 1
fi

mkdir -p "$DIST_DIR"
cp "$built_exe" "$FINAL_EXE"

step "build concluído"
echo "executável: $FINAL_EXE"
echo "versão:     $APP_VERSION"
echo "tamanho:    $(du -h "$FINAL_EXE" | cut -f1)"
