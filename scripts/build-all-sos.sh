#!/usr/bin/env bash
# Roda os 3 builds de plataforma (build-windows.sh/build-linux.sh/
# build-macos.sh) e imprime um resumo no final. Windows cruza sistema
# operacional (via MinGW, ver build-windows.sh) e por isso sempre é
# tentado; Linux e macOS não cruzam — cada um só é tentado quando este
# próprio script já está rodando naquele SO, e é marcado como "pulado" (não
# como falha) nos outros casos, já que não há como satisfazer esse
# requisito daqui.
#
# Uso:
#   ./scripts/build-all-sos.sh
#   SENPAI_VERSION=v1.2.3 ./scripts/build-all-sos.sh
#   ./scripts/build-all-sos.sh --debug
#
# Saída: a soma das saídas de cada script individual —
#   dist/windows-amd64/senpai-app.exe
#   dist/linux-amd64/senpai-app      (só rodando em Linux)
#   dist/darwin-arm64/senpai-app.app (só rodando em macOS)
set -uo pipefail
# Deliberadamente sem -e: uma plataforma falhando não deve impedir as
# outras de serem tentadas — o resumo no final é o que decide o exit code.

ROOT="$(CDPATH= cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
HOST_OS="$(go env GOHOSTOS)"

mode_args=()
if [ "${1:-}" = "--debug" ]; then
  mode_args=(--debug)
elif [ "$#" -gt 0 ]; then
  echo "uso: $0 [--debug]" >&2
  exit 2
fi

step() { printf '\n== %s ==\n' "$1"; }

summary=""
any_failed=0

attempt() {
  local label="$1" script="$2"
  step "$label"
  if "$ROOT/scripts/$script" "${mode_args[@]}"; then
    summary="${summary}  ✓ ${label}\n"
  else
    summary="${summary}  ✗ ${label} (falhou — veja o log acima)\n"
    any_failed=1
  fi
}

skip() {
  local label="$1" reason="$2"
  step "$label (pulado)"
  echo "$reason"
  summary="${summary}  – ${label} (pulado: ${reason})\n"
}

attempt "Windows x64" build-windows.sh

if [ "$HOST_OS" = "linux" ]; then
  attempt "Linux x64" build-linux.sh
else
  skip "Linux x64" "precisa rodar num host Linux — bindings GTK/WebKitGTK do Wails não cruzam SO"
fi

if [ "$HOST_OS" = "darwin" ]; then
  attempt "macOS arm64" build-macos.sh
else
  skip "macOS arm64" "precisa rodar num host macOS — bindings Cocoa/WebKit do Wails não cruzam SO"
fi

step "resumo"
printf '%b' "$summary"

if [ "$any_failed" -ne 0 ]; then
  exit 1
fi
