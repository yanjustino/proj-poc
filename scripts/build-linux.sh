#!/usr/bin/env bash
# Compila o Senpai para Linux x64 — precisa rodar num host Linux. Ao
# contrário do Windows (cross-compilável via MinGW, ver build-windows.sh),
# os bindings GTK/WebKitGTK do Wails não cruzam sistema operacional.
#
# Uso:
#   ./scripts/build-linux.sh
#   SENPAI_VERSION=v1.2.3 ./scripts/build-linux.sh
#   WAILS=/caminho/para/wails ./scripts/build-linux.sh --debug
#
# Saída:
#   dist/linux-amd64/senpai-app
set -euo pipefail

ROOT="$(CDPATH= cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT/app"
TARGET="linux/amd64"
OUTPUT_NAME="senpai-linux-amd64"
DIST_DIR="$ROOT/dist/linux-amd64"
FINAL_BIN="$DIST_DIR/senpai-app"
APP_VERSION="${SENPAI_VERSION:-$(git -C "$ROOT" describe --tags --always --dirty 2>/dev/null || printf 'dev')}"

mode="release"
if [ "${1:-}" = "--debug" ]; then
  mode="debug"
elif [ "$#" -gt 0 ]; then
  echo "uso: $0 [--debug]" >&2
  exit 2
fi

if [ "$(go env GOHOSTOS)" != "linux" ]; then
  echo "erro: build-linux.sh precisa rodar num host Linux." >&2
  echo "o Wails não cruza SO pros bindings GTK/WebKitGTK (diferente do Windows, que cruza via MinGW)." >&2
  exit 1
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

if ! command -v pkg-config >/dev/null 2>&1 || ! pkg-config --exists gtk+-3.0 2>/dev/null; then
  echo "erro: dependências de build do Wails para Linux não encontradas (gtk+-3.0 via pkg-config)." >&2
  echo "instale com (Debian/Ubuntu): sudo apt install build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev" >&2
  echo "(em distros mais antigas o pacote pode se chamar libwebkit2gtk-4.0-dev)" >&2
  exit 1
fi

if [ ! -f "$APP_DIR/embedded/bin/mhl-linux-amd64" ]; then
  echo "erro: runtime MHL para Linux não encontrado em app/embedded/bin/." >&2
  echo "gere dist/linux-amd64/mhl e execute app/embedded/sync.sh primeiro." >&2
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

built_bin="$APP_DIR/build/bin/$OUTPUT_NAME"
if [ ! -f "$built_bin" ]; then
  echo "erro: o Wails terminou sem criar $built_bin" >&2
  exit 1
fi

mkdir -p "$DIST_DIR"
cp "$built_bin" "$FINAL_BIN"
chmod 755 "$FINAL_BIN"

step "build concluído"
echo "executável: $FINAL_BIN"
echo "versão:     $APP_VERSION"
echo "tamanho:    $(du -h "$FINAL_BIN" | cut -f1)"
