// A registry of in-flight/paused generation runs, keyed by a caller-chosen
// string (project_id + artifact key) — persisted to localStorage, not just
// this module's own memory, so a run left paused for approval (Modo Buddy)
// is still found after the app itself restarts, not only after a tab
// remount.
//
// Why this exists: mhl keeps running — or holding paused — a started
// workflow regardless of what the UI is showing, and regardless of whether
// the app was even open in between: --state-dir (see app/app.go's startup)
// makes a paused run's state survive the mhl child process being killed and
// a new one started, and GetRunStatus can reattach to a runId from a
// previous app session by that id alone (no session/list dependency — see
// api.js's watchExistingRun; mhl_run_list, unlike mhl_run_status, IS scoped
// to the current session, so it can't be used to rediscover this). The only
// piece that was ever memory-only was this map: without it surviving a
// restart, the frontend had no way to know which runId belonged to which
// project+artifact, so a paused-for-approval artifact looked exactly like
// one that had never been generated, forcing the user to redo work mhl was
// still holding onto the whole time. Real user-reported bug this fixes.
//
// A stale entry (project deleted, run long gone from state-dir, ...)
// self-heals the next time its Artefatos tab mounts: reattachActiveRuns'
// watchExistingRun call fails, onRunError clears it here (tab-artefatos.js)
// — no separate expiry logic needed.
//
// localStorage failing (private window, disabled storage, ...) degrades to
// "nothing persists" rather than throwing — reattachment across a restart
// is a nice-to-have, not something worth crashing over.
const STORAGE_KEY = 'senpai-active-runs';

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function writeAll(all) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Degrades to "not persisted" — see this file's own doc comment.
  }
}

export function setActiveRun(key, runId) {
  const all = readAll();
  all[key] = runId;
  writeAll(all);
}

export function getActiveRun(key) {
  return readAll()[key];
}

export function clearActiveRun(key) {
  const all = readAll();
  delete all[key];
  writeAll(all);
}

// listActiveRunsForProject returns every {key, runId} this registry holds
// whose key starts with "<projectId>:" — every other caller here only ever
// deals with one key at a time (its own artifact), but workitem-view.js's
// summary needs to know about every run tied to a project at once, from
// any tab, to show a single "what's the pipeline doing right now" card.
// Entries are read-only here — a stale one (run long finished/gone) is the
// caller's job to notice (a failed GetRunStatus) and filter out, not this
// module's to guess at or clear; tab-artefatos.js's own reattach flow
// already owns clearing a truly dead entry once it mounts.
export function listActiveRunsForProject(projectId) {
  const prefix = `${projectId}:`;
  return Object.entries(readAll())
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, runId]) => ({ key, runId }));
}
