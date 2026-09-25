// friendlyRunError turns a run's raw error (mhl's "runtime: step ... failed:
// ... agent "Devin" failed: exit status 1: Error: ..." chain, with the CLI's
// own JSON details at the end) into one sentence a person can act on, keeping
// the raw text as `detail` for whoever needs to dig in. Unknown errors keep
// their raw text as the summary — never a vague "algo deu errado".
const KNOWN = [
  {
    // Devin backend down or unreachable — the CLI itself flags it retryable.
    // agents.mh already retries it; reaching the UI means it outlasted that.
    test: /cognition\.ai\/retryable"\s*:\s*true|cognition\.ai\/errorKind"\s*:\s*"unavailable"|Agent error: Connection error/i,
    summary: 'O Devin está indisponível no momento (falha temporária do serviço, não do Senpai). Tente novamente em alguns minutos.',
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

export function friendlyRunError(raw) {
  const detail = String(raw ?? '').trim();
  for (const known of KNOWN) {
    if (known.test.test(detail)) return { summary: known.summary, detail };
  }
  return { summary: detail || 'Erro desconhecido.', detail: '' };
}
