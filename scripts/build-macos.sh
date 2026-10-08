#!/usr/bin/env bash
# Compila o Senpai para macOS (Apple Silicon / arm64) — precisa rodar num
# host macOS com as Xcode Command Line Tools instaladas. Ao contrário do
# Windows (cross-compilável via MinGW, ver build-windows.sh), os bindings
# Cocoa/WebKit do Wails não cruzam sistema operacional. Só arm64 por
# enquanto: app/embedded/sync.sh ainda não embute um runtime MHL para
# darwin/amd64 (ver o comentário desse script).
#
# O .app resultante NÃO é assinado nem notarizado — abrir num outro Mac vai
# disparar o aviso padrão do Gatekeeper ("desenvolvedor não identificado")
# até que isso seja configurado separadamente.
#
# Uso:
#   ./scripts/build-macos.sh
#   SENPAI_VERSION=v1.2.3 ./scripts/build-macos.sh
#   WAILS=/caminho/para/wails ./scripts/build-macos.sh --debug
#
# Saída:
#   dist/darwin-arm64/senpai-app.app
#   dist/darwin-arm64/senpai-app.dmg  (o .app + atalho para /Applications)
#
# Distribua o .dmg, não o .app solto: zipar/copiar o bundle por Teams,
# OneDrive, e-mail etc. costuma perder o bit de execução do binário e o
# Finder passa a recusar abrir o app ("não pode ser aberto").
set -euo pipefail

ROOT="$(CDPATH= cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT/app"
TARGET="darwin/arm64"
OUTPUT_NAME="senpai-app"
DIST_DIR="$ROOT/dist/darwin-arm64"
FINAL_APP="$DIST_DIR/senpai-app.app"
FINAL_DMG="$DIST_DIR/senpai-app.dmg"
VOLUME_NAME="Senpai"
APP_VERSION="${SENPAI_VERSION:-$(git -C "$ROOT" describe --tags --always --dirty 2>/dev/null || printf 'dev')}"

mode="release"
if [ "${1:-}" = "--debug" ]; then
  mode="debug"
elif [ "$#" -gt 0 ]; then
  echo "uso: $0 [--debug]" >&2
  exit 2
fi

if [ "$(go env GOHOSTOS)" != "darwin" ]; then
  echo "erro: build-macos.sh precisa rodar num host macOS." >&2
  echo "o Wails não cruza SO pros bindings Cocoa/WebKit (diferente do Windows, que cruza via MinGW)." >&2
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

if ! xcode-select -p >/dev/null 2>&1; then
  echo "erro: Xcode Command Line Tools não encontrado." >&2
  echo "instale com: xcode-select --install" >&2
  exit 1
fi

if [ ! -f "$APP_DIR/embedded/bin/mhl-darwin-arm64" ]; then
  echo "erro: runtime MHL para macOS (arm64) não encontrado em app/embedded/bin/." >&2
  echo "gere dist/darwin-arm64/mhl e execute app/embedded/sync.sh primeiro." >&2
  exit 1
fi

step() { printf '\n== %s ==\n' "$1"; }

step "sincronizando workflows e runtimes embutidos"
"$APP_DIR/embedded/sync.sh" "$ROOT/dist" darwin-arm64

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

# O Wails empacota macOS como um bundle .app (build/bin/<nome>.app), não um
# binário solto como Windows/Linux — procurado por padrão em vez de fixar o
# nome exato, já que -o nomeia o binário interno mas o nome do bundle em si
# vem de wails.json's "name".
built_app="$(find "$APP_DIR/build/bin" -maxdepth 1 -name '*.app' -print -quit)"
if [ -z "$built_app" ] || [ ! -d "$built_app" ]; then
  echo "erro: o Wails terminou sem criar um pacote .app em app/build/bin/" >&2
  exit 1
fi

mkdir -p "$DIST_DIR"
rm -rf "$FINAL_APP"
# ditto em vez de cp -R: preserva permissões, symlinks e a assinatura do
# bundle exatamente como o Wails gerou.
ditto "$built_app" "$FINAL_APP"

step "empacotando $FINAL_DMG"
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
ditto "$FINAL_APP" "$staging/senpai-app.app"
ln -s /Applications "$staging/Applications"
# O app é só ad-hoc (sem Developer ID/notarização), então o Gatekeeper
# bloqueia a primeira abertura num Mac que baixou o .dmg. Vai junto no
# volume o passo a passo para liberar.
cat > "$staging/LEIA-ME.txt" <<'TXT'
Senpai para macOS (Apple Silicon)

1. Arraste senpai-app.app para a pasta Applications.
2. O app não é assinado pela Apple. Na primeira vez, libere-o no Terminal:

     xattr -dr com.apple.quarantine /Applications/senpai-app.app

   ou tente abrir uma vez e depois vá em Ajustes do Sistema >
   Privacidade e Segurança > "Abrir Mesmo Assim".

Requer um Mac com chip Apple (M1 ou posterior).
TXT
rm -f "$FINAL_DMG"
hdiutil create \
  -volname "$VOLUME_NAME" \
  -srcfolder "$staging" \
  -fs HFS+ \
  -format UDZO \
  -ov \
  "$FINAL_DMG" >/dev/null
hdiutil verify "$FINAL_DMG" >/dev/null

step "build concluído"
echo "aplicativo: $FINAL_APP"
echo "dmg:        $FINAL_DMG"
echo "versão:     $APP_VERSION"
echo "tamanho:    $(du -sh "$FINAL_APP" | cut -f1) (app), $(du -sh "$FINAL_DMG" | cut -f1) (dmg)"
