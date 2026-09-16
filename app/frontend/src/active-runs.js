// A tiny, module-level (session-lifetime) registry of in-flight generation
// runs, keyed by a caller-chosen string (project_id + artifact key).
//
// Why this exists: mhl keeps running a started workflow regardless of what
// the UI is showing — WatchRun's Go-side polling isn't tied to any DOM
// element, and the mhl process itself doesn't know or care whether the tab
// that started a run is still mounted. tab-artefatos.js's own `trackers`
// Map lives inside renderArtefatosTab's closure, so switching away from the
// Artefatos tab (or to a different work-item) and back threw it away —
// making a generation that was still genuinely running server-side look
// like it had silently reset to "pending", with no way to tell the two
// apart from the UI alone. Real user-reported symptom this fixes.
//
// Why this can't just be reconstructed from mhl_run_list/mhl_run_status
// instead: confirmed by a real spike — while a run is still "working",
// its status has no `vars` at all (project_id/artifact only show up once a
// run reaches "completed", as part of the workflow's own declared output).
// There is nothing in the list of in-flight runs to say which project or
// artifact a given runId belongs to, so the app has to remember that
// itself, from the moment it's the one starting the run.
//
// Session-scoped only (in-memory) — restarting the whole app still loses
// this, same already-accepted limitation as the rest of Fase 6's run
// tracking ("fica para depois" in the plan).
const active = new Map();

export function setActiveRun(key, runId) {
  active.set(key, runId);
}

export function getActiveRun(key) {
  return active.get(key);
}

export function clearActiveRun(key) {
  active.delete(key);
}
