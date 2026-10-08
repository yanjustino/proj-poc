#!/usr/bin/env bash
# Roda os 3 builds de plataforma (build-windows.sh/build-linux.sh/
# build-macos.sh) e imprime um resumo no final. Windows sempre é tentado
# (cruza SO via MinGW, ver build-windows.sh) e Linux também sempre é
# tentado — build-linux.sh cruza SO sozinho via Docker quando o host não é
# Linux (ver scripts/docker/linux-build.Dockerfile), então só falha de
# verdade se nem Linux nativo nem Docker estiverem disponíveis; o "pulado"
# nesse caso vira uma falha normal no resumo, não um skip. macOS é o único
# que continua sem alternativa nenhuma — Cocoa/WebKit não builda dentro de
# um container Linux de jeito nenhum — então esse sim só é tentado quando
# este próprio script já está rodando em macOS, e aparece como "pulado" (não
# como falha) nos outros casos.
#
# Uso:
#   ./scripts/build-all-sos.sh
#   SENPAI_VERSION=v1.2.3 ./scripts/build-all-sos.sh
#   ./scripts/build-all-sos.sh --debug
#
# Saída: a soma das saídas de cada script individual —
#   dist/windows-amd64/senpai-app.exe
#   dist/linux-amd64/senpai-app      (nativo, ou via Docker se o host não for Linux)
#   dist/linux-arm64/senpai-app      (idem; Docker nativo num Mac Apple Silicon)
#   dist/linux-amd64-rhel/senpai-app (RHEL 8/9; via Docker Rocky Linux 8)
#   dist/darwin-arm64/senpai-app.app (só rodando em macOS)
#   dist/darwin-arm64/senpai-app.dmg (idem; é o que deve ser distribuído)
set -uo pipefail
# Deliberadamente sem -e: uma plataforma falhando não deve impedir as
# outras de serem tentadas — o resumo no final é o que decide o exit code.

ROOT="$(CDPATH= cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
HOST_OS="$(go env GOHOSTOS)"

# String simples, não array: um array vazio ("${arr[@]}") quebra com
# "unbound variable" sob `set -u` no bash 3.2 (o padrão do macOS até hoje) —
# só corrigido no bash 4.4+. Como só existe uma flag opcional, isso evita o
# problema por completo; a expansão sem aspas abaixo é segura aqui porque o
# único valor possível é "" ou o literal "--debug" (sem espaço/glob).
extra_arg=""
if [ "${1:-}" = "--debug" ]; then
  extra_arg="--debug"
elif [ "$#" -gt 0 ]; then
  echo "uso: $0 [--debug]" >&2
  exit 2
fi

step() { printf '\n== %s ==\n' "$1"; }

summary=""
any_failed=0

attempt() {
  local label="$1" script="$2" linux_arch="${3:-}" linux_distro="${4:-}"
  step "$label"
  if SENPAI_LINUX_ARCH="$linux_arch" SENPAI_LINUX_DISTRO="$linux_distro" "$ROOT/scripts/$script" $extra_arg; then
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
attempt "Linux x64" build-linux.sh amd64
attempt "Linux arm64" build-linux.sh arm64
attempt "Linux x64 (RHEL 8/9)" build-linux.sh amd64 rhel

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
