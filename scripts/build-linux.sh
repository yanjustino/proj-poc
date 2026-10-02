#!/usr/bin/env bash
# Compila o Senpai para Linux x64 (padrão) ou ARM64. Precisa rodar num host Linux de verdade
# — ao contrário do Windows (cross-compilável via MinGW, ver
# build-windows.sh), os bindings GTK/WebKitGTK do Wails não cruzam sistema
# operacional — mas, se o host não for Linux e o Docker estiver instalado,
# este script se builda e roda sozinho dentro de um container Linux (a VM
# Linux do Docker Desktop conta como "host Linux" de verdade, não é
# cross-compilação) em vez de simplesmente falhar. Ver
# scripts/docker/linux-build.Dockerfile.
#
# Uso:
#   ./scripts/build-linux.sh
#   SENPAI_VERSION=v1.2.3 ./scripts/build-linux.sh
#   WAILS=/caminho/para/wails ./scripts/build-linux.sh --debug
#   SENPAI_LINUX_ARCH=arm64 ./scripts/build-linux.sh
#   SENPAI_LINUX_DISTRO=rhel ./scripts/build-linux.sh
#
# SENPAI_LINUX_ARCH escolhe a arquitetura: amd64 (padrão) ou arm64 — este
# último para Ubuntu ARM64, como uma VM Parallels/UTM num Mac Apple Silicon
# (que não executa um binário x86-64: "Exec format error").
#
# SENPAI_LINUX_DISTRO escolhe a base do build via Docker: debian (padrão,
# webkit2gtk-4.1 + glibc 2.34 — Ubuntu 22.04+, Debian 12+) ou rhel (Rocky
# Linux 8, webkit2gtk-4.0 + glibc 2.28 — RHEL 8 e 9; só amd64). Ver
# scripts/docker/linux-rhel-build.Dockerfile. Num host Linux nativo a
# distro não muda o build (ele usa o WebKitGTK do próprio host), só o nome
# da pasta de saída.
#
# Saída:
#   dist/linux-<arch>/senpai-app         (debian)
#   dist/linux-amd64-rhel/senpai-app     (rhel)
set -euo pipefail

ROOT="$(CDPATH= cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT/app"
ARCH="${SENPAI_LINUX_ARCH:-amd64}"
case "$ARCH" in
  amd64|arm64) ;;
  *) echo "erro: SENPAI_LINUX_ARCH deve ser amd64 ou arm64 (recebido: $ARCH)." >&2; exit 2 ;;
esac
DISTRO="${SENPAI_LINUX_DISTRO:-debian}"
case "$DISTRO" in
  debian) suffix=""; dockerfile="linux-build.Dockerfile" ;;
  rhel) suffix="-rhel"; dockerfile="linux-rhel-build.Dockerfile" ;;
  *) echo "erro: SENPAI_LINUX_DISTRO deve ser debian ou rhel (recebido: $DISTRO)." >&2; exit 2 ;;
esac
if [ "$DISTRO" = "rhel" ] && [ "$ARCH" != "amd64" ]; then
  echo "erro: o build rhel só existe para amd64." >&2
  exit 2
fi
TARGET="linux/$ARCH"
OUTPUT_NAME="senpai-linux-$ARCH$suffix"
DIST_DIR="$ROOT/dist/linux-$ARCH$suffix"
# Imagem e volumes de cache por arquitetura E distro (ver o bloco do Docker).
docker_id="$ARCH$suffix"
FINAL_BIN="$DIST_DIR/senpai-app"
APP_VERSION="${SENPAI_VERSION:-$(git -C "$ROOT" describe --tags --always --dirty 2>/dev/null || printf 'dev')}"

mode="release"
if [ "${1:-}" = "--debug" ]; then
  mode="debug"
elif [ "$#" -gt 0 ]; then
  echo "uso: $0 [--debug]" >&2
  exit 2
fi

step() { printf '\n== %s ==\n' "$1"; }

# Delegação pro Docker: só entra aqui quando o host não é Linux E ainda não
# estamos dentro do próprio container (SENPAI_IN_DOCKER evita um loop —
# dentro do container `go env GOHOSTOS` já responde "linux" de verdade, mas
# a var existe pra não depender só disso). Reexecuta ESTE MESMO script
# dentro do container via `exec`, então tudo abaixo deste bloco (o build de
# verdade) roda exatamente igual, sem um segundo caminho de código pra
# manter sincronizado.
if [ "$(go env GOHOSTOS)" != "linux" ] && [ "${SENPAI_IN_DOCKER:-}" != "1" ]; then
  # String simples, não array: mesmo motivo do build-all-sos.sh (evita
  # "unbound variable" com array vazio no bash 3.2, o padrão do macOS) — e
  # aqui evita um segundo problema, `"${1:-}"` sozinho passaria uma string
  # VAZIA como argumento posicional de verdade quando --debug não foi
  # pedido, o que $# veria como 1 argumento (não zero) do outro lado.
  extra_arg=""
  if [ "${1:-}" = "--debug" ]; then
    extra_arg="--debug"
  fi

  if ! command -v docker >/dev/null 2>&1; then
    echo "erro: build-linux.sh precisa rodar num host Linux (ou com Docker instalado, pra buildar num container Linux)." >&2
    echo "instale o Docker Desktop: https://www.docker.com/products/docker-desktop/" >&2
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "erro: Docker está instalado mas o daemon não está rodando — abra o Docker Desktop e tente de novo." >&2
    exit 1
  fi

  step "host não é Linux — usando Docker (scripts/docker/$dockerfile)"
  # --platform linux/$ARCH em build E run: o Wails usa cgo, então um
  # container de uma arquitetura tentando compilar pra outra falha direto no
  # gcc ("unrecognized command-line option '-m64'", medido). A imagem
  # inteira roda na arquitetura do alvo — amd64 emulado via Rosetta/QEMU do
  # Docker Desktop num host Apple Silicon, arm64 nativo — e o gcc que ela
  # instala já nasce nativo pro alvo, sem toolchain cruzado. Imagem e
  # volumes levam a arquitetura no nome: node_modules (rollup nativo) e o
  # cache do Go de uma arquitetura não servem pra outra.
  docker build -q --platform "linux/$ARCH" -t "senpai-linux-build-$docker_id" -f "$ROOT/scripts/docker/$dockerfile" "$ROOT/scripts/docker" >/dev/null

  step "compilando dentro do container"
  # Roda como root (padrão da imagem) em vez de --user <uid>:<gid> do host —
  # mais simples e sem a pegadinha de permissão que --user teria com volumes
  # nomeados recém-criados (Docker cria o ponto de montagem como root; um
  # usuário não-root não consegue necessariamente escrever nele na primeira
  # vez). Os volumes de cache do Go/npm (gomod/gocache/npm) são só pra
  # sobreviver entre execuções (sem eles, toda run baixaria os módulos Go e
  # pacotes npm de novo) — sempre usados pelo mesmo root, então nunca têm
  # dono incompatível entre uma run e a próxima. O node_modules tem um
  # volume À PARTE (não é só cache) por um motivo real, medido: com
  # node_modules vindo do bind mount do host (instalado no macOS,
  # darwin-arm64), o `npm install` de dentro do container via reaproveitar
  # esse node_modules em vez de reinstalar do zero — e como o
  # @rollup/rollup-<plataforma> é uma dependência opcional resolvida por
  # plataforma, o pacote nativo pra Linux nunca era baixado, e o build
  # quebrava com "Cannot find module @rollup/rollup-linux-arm64-gnu" (bug
  # conhecido do npm, https://github.com/npm/cli/issues/4828). Um volume
  # nomeado À PARTE nesse caminho específico "esconde" o node_modules do
  # host só ali, então o npm de dentro do container sempre parte limpo e
  # instala a variante nativa do Linux de verdade — e ainda fica em cache
  # (mesmo raciocínio dos outros) pras próximas execuções. O `npm ci`
  # explícito antes do build (não deixar o próprio `wails build` decidir
  # se instala) existe porque o Wails só roda `npm install` quando
  # node_modules/ NÃO existe — e um volume nomeado recém-criado já existe
  # como pasta (vazia), então sem isso o Wails pulava a instalação e a
  # build quebrava direto com "vite: not found". As 3 pastas do repositório
  # que o build de fato escreve (bind mount, não volume) — dist/, app/build/
  # e app/embedded/ (via sync.sh) — precisam do dono corrigido de volta pro
  # host no final, daí o chown encadeado abaixo. Deliberadamente NÃO um
  # `chown -R .` na raiz inteira: medido batendo em .git/objects/* com
  # "Permission denied" (limitação real do bind mount do Docker Desktop no
  # macOS com os arquivos read-only do git — inofensivo, .git não ficou
  # corrompido, mas gera erro/ruído à toa mexendo em algo que este script
  # não tem nenhum motivo pra tocar).
  exec docker run --rm \
    --platform "linux/$ARCH" \
    -e SENPAI_IN_DOCKER=1 \
    -e SENPAI_VERSION="${SENPAI_VERSION:-}" \
    -e SENPAI_LINUX_ARCH="$ARCH" \
    -e SENPAI_LINUX_DISTRO="$DISTRO" \
    -v "$ROOT:/workspace" \
    -v senpai-linux-build-gomod:/go/pkg/mod \
    -v "senpai-linux-build-gocache-$docker_id:/root/.cache/go-build" \
    -v senpai-linux-build-npm:/root/.npm \
    -v "senpai-linux-build-node-modules-$docker_id:/workspace/app/frontend/node_modules" \
    -w /workspace \
    "senpai-linux-build-$docker_id" \
    bash -c '(cd app/frontend && npm ci) && bash scripts/build-linux.sh "$@" && chown -R '"$(id -u):$(id -g)"' dist app/build app/embedded' bash $extra_arg
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

# O Wails v2 referencia "webkit2gtk-4.0" via pkg-config por padrão — distros
# atuais (Debian bookworm entre elas, a base da imagem Docker deste script)
# descontinuaram esse pacote a favor do webkit2gtk-4.1, e o link falha com
# "Package webkit2gtk-4.0 was not found" mesmo com libwebkit2gtk-4.1-dev
# instalado (medido, real). `-tags webkit2_41` é a alternativa OFICIAL do
# próprio Wails pra isso (ver internal/frontend/desktop/linux/*.go no módulo
# vendorizado), não um workaround por fora — mas só faz sentido passar
# quando 4.1 é o que existe de verdade neste host/container; uma distro mais
# antiga com só o 4.0 continua precisando do caminho padrão (sem a tag).
# Detectado aqui (string simples, não array — mesmo motivo do $extra_arg
# acima: evita "unbound variable" com array vazio no bash 3.2), não fixo,
# porque este mesmo script roda tanto nativo (qualquer distro) quanto dentro
# do container Docker (sempre bookworm/4.1).
webkit_tag=""
if pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
  webkit_tag="webkit2_41"
elif ! pkg-config --exists webkit2gtk-4.0 2>/dev/null; then
  echo "erro: nem webkit2gtk-4.1 nem webkit2gtk-4.0 encontrados via pkg-config." >&2
  echo "instale libwebkit2gtk-4.1-dev (ou libwebkit2gtk-4.0-dev em distros mais antigas)." >&2
  exit 1
fi

if [ ! -f "$APP_DIR/embedded/bin/mhl-linux-$ARCH" ] && [ ! -f "$ROOT/dist/linux-$ARCH/mhl" ]; then
  echo "erro: runtime MHL para linux/$ARCH não encontrado em app/embedded/bin/ nem em dist/linux-$ARCH/." >&2
  echo "gere dist/linux-$ARCH/mhl (mhl-runtime: ./build.sh release, ou ./build.sh linux-arm64) e execute app/embedded/sync.sh." >&2
  exit 1
fi
if [ ! -f "$APP_DIR/embedded/bin/pdftotext-linux-$ARCH" ]; then
  echo "erro: pdftotext para linux/$ARCH não encontrado em app/embedded/bin/." >&2
  echo "gere com: app/embedded/build-pdftotext.sh linux-$ARCH" >&2
  exit 1
fi

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
if [ -n "$webkit_tag" ]; then
  build_args+=( -tags "$webkit_tag" )
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
