// dotClass maps a run's mhl_run_status state (see api.js's isFullyTerminal
// for the same state vocabulary) to the .status-dot modifier class shared
// by every place a run's progress renders as a colored dot — the artifact
// checklist (tab-artefatos.js), the run tracker widget (run-tracker.js).
// Pulled out once three call sites needed the identical mapping, so it
// can't drift into three near-identical copies (see
// docs/design-system-senpai.html §09, "a mesma taxonomia deve aparecer no
// tracker, na lista de artefatos e em mensagens de operação").
export function dotClass(state) {
  if (state === 'completed') return 'done';
  if (state === 'canceled') return 'failed';
  return state; // working/queued/paused/failed pass through unchanged
}
