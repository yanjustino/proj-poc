#!/usr/bin/env sh
# Verifica o ambiente para gerar com o Devin CLI.
#
# Uso:
#   ./scripts/check-devin-environment.sh            # ferramentas e autenticacao
#   ./scripts/check-devin-environment.sh --call     # + uma chamada real, igual a do Senpai
#   ./scripts/check-devin-environment.sh --call swe-1-6-slow
#
# --call reproduz a chamada de workflows/shared/agents/agents.mh (mesmo
# modelo, mesmas flags, prompt por arquivo, export ATIF) e, para comparar,
# a mesma pergunta sem essas flags. Mostra o codigo de saida e o stderr
# brutos de cada uma: se so a primeira falha, a causa esta nas flags do
# Senpai; se as duas falham, na conta, na cota ou no modelo. Consome uma
# pequena quantidade de creditos.
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

[ "${1:-}" = "--call" ] || exit 0

# Modelo: argumento > SENPAI_DEVIN_MODEL > o escolhido no app (settings.json)
# > o padrao de agents.mh.
settings="${HOME}/Library/Application Support/senpai/settings.json"
[ -f "$settings" ] || settings="${XDG_CONFIG_HOME:-$HOME/.config}/senpai/settings.json"
app_model=""
if [ -f "$settings" ]; then
  app_model="$(sed -n 's/.*"devin_model"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$settings" | head -n 1)"
fi
model="${2:-${SENPAI_DEVIN_MODEL:-${app_model:-swe-1-6-slow}}}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT INT TERM

instruction='Responda com ok verdadeiro.'
schema='{"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"]}'
# Mesmo formato que Writer.generate_devin monta (agents.mh).
cat >"$work/prompt.txt" <<EOF
$instruction

Responda somente com um objeto JSON valido, sem Markdown, comentarios ou texto adicional.
O objeto deve obedecer exatamente a este JSON Schema:
$schema
EOF

run_case() {
  label="$1"
  shift
  printf '\n== %s\n$ devin %s\n' "$label" "$*"
  status=0
  (cd "$work" && devin "$@") >"$work/stdout.txt" 2>"$work/stderr.txt" || status=$?
  printf 'saida: %s\n' "$status"
  printf -- '-- stdout\n'; cat "$work/stdout.txt"
  printf -- '\n-- stderr\n'; cat "$work/stderr.txt"
  return 0
}

printf '\nModelo: %s\n' "$model"
run_case "Chamada do Senpai (agents.mh)" \
  --model "$model" --respect-workspace-trust false --permission-mode auto \
  --prompt-file "$work/prompt.txt" --export "$work/export.json" --print
if [ -s "$work/export.json" ]; then
  printf -- '-- export ATIF gravado (%s bytes)\n' "$(wc -c <"$work/export.json" | tr -d ' ')"
else
  printf -- '-- export ATIF ausente\n'
fi

run_case "Mesma pergunta, sem as flags do Senpai" \
  --model "$model" --respect-workspace-trust false --print -- "$(cat "$work/prompt.txt")"
