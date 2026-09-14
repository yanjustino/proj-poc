#!/usr/bin/env sh
set -eu

failures=0

check_command() {
  name="$1"
  if command -v "$name" >/dev/null 2>&1; then
    printf '%-8s %s\n' "$name" "OK ($(command -v "$name"))"
  else
    printf '%-8s %s\n' "$name" "AUSENTE"
    failures=$((failures + 1))
  fi
}

check_command devin
check_command mhl
check_command go
check_command npm

if command -v devin >/dev/null 2>&1; then
  devin version
  if ! devin auth status; then
    printf '%s\n' 'Devin nao autenticado. Execute: devin auth login --force-manual-token-flow'
    failures=$((failures + 1))
  fi
fi

if [ "$failures" -ne 0 ]; then
  printf '%s\n' "Ambiente incompleto: $failures verificacao(oes) falharam."
  exit 1
fi

printf '%s\n' 'Ambiente pronto para desenvolvimento e geracao via Devin CLI.'
