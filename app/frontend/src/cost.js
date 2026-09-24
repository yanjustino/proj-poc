function formatUsdAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '0,00';
  return amount.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

export function formatUsd(value) {
  return `US$ ${formatUsdAmount(value)}`;
}

export function callCostNote(entry) {
  const amount = Number(entry?.cost_usd || 0);
  const source = entry?.cost_source || (amount > 0 ? 'reported' : 'unavailable');
  if (source === 'unavailable') return ' · sem estimativa';
  return ` · ${formatUsd(amount)} (${source === 'estimated' ? 'estimado' : 'informado'})`;
}

export function summarizeCost(usage) {
  const amount = Number(usage?.total_cost_usd || 0);
  const entries = usage?.by_artifact || [];
  const hasCounts =
    usage?.cost_reported_count != null ||
    usage?.cost_estimated_count != null ||
    usage?.cost_unavailable_count != null;
  const reported = hasCounts ? Number(usage.cost_reported_count || 0) : amount > 0 ? 1 : 0;
  const estimated = hasCounts ? Number(usage.cost_estimated_count || 0) : 0;
  const unavailable = hasCounts ? Number(usage.cost_unavailable_count || 0) : amount > 0 ? 0 : entries.length;
  const available = reported + estimated;

  if (available === 0) return { value: '—', label: 'sem estimativa' };
  if (unavailable > 0) {
    const suffix = unavailable === 1 ? '1 chamada sem estimativa' : `${unavailable} chamadas sem estimativa`;
    return { value: formatUsdAmount(amount), label: `estimativa parcial · ${suffix}` };
  }
  if (estimated > 0 && reported > 0) {
    return { value: formatUsdAmount(amount), label: 'custo informado + estimado' };
  }
  return {
    value: formatUsdAmount(amount),
    label: estimated > 0 ? 'custo estimado' : 'custo informado',
  };
}
