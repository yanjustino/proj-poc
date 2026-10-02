// friendlyRunError turns a run's raw error (mhl's "runtime: step ... failed:
// ... agent "Devin" failed: exit status 1: Error: ..." chain, with the CLI's
// own JSON details at the end) into one sentence a person can act on, keeping
// the raw text as `detail` for whoever needs to dig in. Unknown errors keep
// their raw text as the summary — never a vague "algo deu errado".
const KNOWN = [
  {
    // Cota diária da conta/modelo esgotada. O Devin marca como retryable,
    // mas não volta em minutos: só com mais cota, outro modelo ou no dia
    // seguinte.
    test: /cognition\.ai\/errorKind"\s*:\s*"resource_exhausted"|usage quota has been exhausted/i,
    summary: 'A cota de uso do Devin acabou para este modelo/conta. Libere mais uso em app.devin.ai/settings/usage, escolha outro modelo na barra lateral ou tente de novo amanhã.',
  },
  {
    // Serviço do Devin fora do ar ou inalcançável. agents.mh já repete a
    // chamada; chegar aqui significa que a falha durou mais que as tentativas.
    test: /cognition\.ai\/errorKind"\s*:\s*"unavailable"|Agent error: Connection error/i,
    summary: 'O Devin está indisponível no momento (o serviço não respondeu). Tente novamente em alguns minutos; se persistir, rode scripts/check-devin-environment.sh --call para ver o erro da chamada.',
  },
  {
    // A resposta passou do limite de tokens de saída do modelo e veio
    // cortada. Repetir dá o mesmo tamanho; histórias já são geradas em
    // páginas (common_drafts.mh) por isso.
    test: /Response truncated|max output token limit/i,
    summary: 'A resposta do modelo passou do limite de tamanho e veio cortada. Tente um modelo com limite de saída maior na barra lateral ou divida o item em partes menores.',
  },
  {
    test: /rate[_ ]?limit|\b429\b/i,
    summary: 'O limite de uso do agente foi atingido. Aguarde alguns minutos e tente novamente.',
  },
  {
    test: /execução interrompida: o servidor mhl foi reiniciado/i,
    summary: 'A execução foi interrompida porque o servidor mhl reiniciou enquanto ela rodava. Gere novamente.',
  },
];

// Qualquer outra falha do Devin: a frase do próprio CLI ("Agent error: ..."),
// sem o encadeamento do mhl nem o trace ID — nunca uma categoria genérica
// que esconda o motivo real.
const DEVIN_MESSAGE = /agent "Devin" failed:[^]*?Error:\s*(?:Agent error:\s*)?([^]*?)(?:\s*\(trace ID[^)]*\))?(?::\s*\{|$)/i;

export function friendlyRunError(raw) {
  const detail = String(raw ?? '').trim();
  for (const known of KNOWN) {
    if (known.test.test(detail)) return { summary: known.summary, detail };
  }
  const devin = DEVIN_MESSAGE.exec(detail);
  if (devin && devin[1].trim()) return { summary: `O Devin recusou a chamada: ${devin[1].trim()}`, detail };
  return { summary: detail || 'Erro desconhecido.', detail: '' };
}
