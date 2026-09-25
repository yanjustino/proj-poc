// formatRelativeTime: pt-BR "há 7 horas" / "há 13 dias" style, shared by
// every tab that lists filesystem entries by their own mtime (Artefatos'
// "Última geração", Fontes' and Wiki's "Última atualização" table columns —
// all three read the same listProjectDir()/readProjectFile() `modifiedAt`
// field, app.go's own RFC3339 timestamp). Originally lived only in
// tab-artefatos.js; pulled out here once Fontes/Wiki grew their own table
// views and needed the identical wording instead of a second hand-rolled
// copy that could drift.
//
// `ms` is an epoch-milliseconds number, not an ISO string — callers convert
// once at the source (Date.parse(node.modifiedAt)) instead of every
// formatter call re-parsing it.
const RELATIVE_TIME_UNITS = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];
const relativeTimeFormatter = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

// formatDurationShort: a compact pt-BR duration for summary figures —
// "45s", "12min", "1h 05min", "2d 3h". Seconds only show below one minute;
// finer detail stops mattering at that scale.
export function formatDurationShort(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined || Number.isNaN(totalSeconds)) return '—';
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, '0')}min`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function formatRelativeTime(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
  const diff = ms - Date.now();
  for (const [unit, unitMs] of RELATIVE_TIME_UNITS) {
    if (Math.abs(diff) >= unitMs) return relativeTimeFormatter.format(Math.round(diff / unitMs), unit);
  }
  return relativeTimeFormatter.format(Math.round(diff / 1000), 'second');
}
