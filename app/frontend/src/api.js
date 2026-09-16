// Thin wrapper over the generated Wails bindings (../wailsjs/go/main/App) —
// every binding returns a JSON string (or throws), so this module's only job
// is parsing that string into a real object and giving the run-lifecycle
// dance (StartRun -> EventsOn -> WatchRun -> ResumeRun) a single, correct
// place to live instead of re-deriving it in every view.
import * as App from '../wailsjs/go/main/App';
import { EventsOn } from '../wailsjs/runtime/runtime';

function parseJSON(raw, context) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`resposta invalida de ${context}: ${err.message} (${raw})`);
  }
}

// waitUntilReady blocks until App.IsReady() reports the mhl bridge has
// finished starting. Real incident this fixes: Wails does not guarantee
// OnStartup (which spawns mhl — extracting the vendored binary/workflows
// tree first, since Fase 7) finishes before this module's own code starts
// running; without this, the very first bound-method call the app makes
// (the Work-items list on load) could race that startup work and fail with
// "mhl bridge is not running" — intermittent before Fase 7's extraction
// step lengthened the window, then reliable. Plain polling (not an
// EventsOn subscription) on purpose: it only depends on bound methods,
// which this app already trusts for everything else, not on the separate
// events subsystem also being fully wired up this early.
const READY_POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 20000;

export async function waitUntilReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (!(await App.IsReady())) {
    if (Date.now() > deadline) {
      throw new Error(`o backend (mhl bridge) não ficou pronto em ${READY_TIMEOUT_MS}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
  }
}

export async function listWorkflows() {
  return parseJSON(await App.ListWorkflows(), 'ListWorkflows');
}

export async function getWorkflowManifest(name) {
  return parseJSON(await App.GetWorkflowManifest(name), 'GetWorkflowManifest');
}

export async function getRunStatus(runId) {
  return parseJSON(await App.GetRunStatus(runId), 'GetRunStatus');
}

export async function listRuns() {
  return parseJSON(await App.ListRuns(), 'ListRuns');
}

// mcpStatus reports the mhl MCP server's live health (a /healthz probe, not
// a cached "did startup work") plus its name/version — see app.go's
// MCPStatus doc comment. Never throws: MCPStatus itself only errors on a
// json.Marshal failure, which can't happen for this fixed shape.
export async function mcpStatus() {
  return parseJSON(await App.MCPStatus(), 'MCPStatus');
}

// reconnectMCP tears down and respawns the mhl child process (see app.go's
// ReconnectMCP doc comment) — the sidebar status panel's "Reconectar"
// button, for recovering from mhl crashing mid-session without quitting the
// whole app. Same shape as mcpStatus(): {ready, name, version} or
// {ready:false, error} if the attempt itself failed (binary missing,
// /healthz never answered, ...).
export async function reconnectMCP() {
  return parseJSON(await App.ReconnectMCP(), 'ReconnectMCP');
}

export async function getRunLogs(runId, since) {
  return parseJSON(await App.GetRunLogs(runId, since ?? ''), 'GetRunLogs');
}

export async function selectRawFiles() {
  return parseJSON(await App.SelectRawFiles(), 'SelectRawFiles');
}

export async function addRawFile(projectId, sourcePath) {
  return App.AddRawFile(projectId, sourcePath);
}

export async function listIngestedRaw(projectId) {
  return parseJSON(await App.ListIngestedRaw(projectId), 'ListIngestedRaw');
}

export async function markRawIngested(projectId, filename) {
  return parseJSON(await App.MarkRawIngested(projectId, filename), 'MarkRawIngested');
}

export async function listProjectDir(projectId, root, relative = '') {
  return parseJSON(await App.ListProjectDir(projectId, root, relative), 'ListProjectDir');
}

export async function readProjectFile(projectId, root, relative) {
  return App.ReadProjectFile(projectId, root, relative);
}

// isFullyTerminal is deliberately narrower than the bridge's own
// RunStatus.Terminal() (which also treats "paused" as terminal, purely to
// know when to stop polling on the Go side) — from the UI's perspective a
// paused run is still an open thread the user needs to act on, not a
// finished one. Only these three states mean "nothing more will ever change
// here without a brand new run".
function isFullyTerminal(status) {
  return status.state === 'completed' || status.state === 'failed' || status.state === 'canceled';
}

export { isFullyTerminal };

// startAndWatch starts a workflow run and streams every status update to
// onUpdate, including the very first (possibly-already-terminal) snapshot
// StartRun itself returns. Returns the runId once the first snapshot is in
// hand; onUpdate keeps firing after that as events arrive, until a fully
// terminal state (see isFullyTerminal) — a "paused" snapshot is delivered
// like any other, then no more events arrive until someone calls
// resumeAndWatch, because mhlbridge.Client stops polling a paused run on the
// Go side (see app/app.go's WatchRun doc comment).
//
// The EventsOn subscription is registered *before* WatchRun is awaited —
// WatchRun synchronously emits the first snapshot before its promise
// resolves, so subscribing after would race losing that first push (the
// direct return value of StartRun covers that race today, but keeping the
// order right here matters if that ever changes).
export async function startAndWatch(workflow, args, onUpdate) {
  const start = await parseJSON(await App.StartRun(workflow, JSON.stringify(args)), 'StartRun');
  onUpdate(start);
  const runId = start.runId;
  if (!runId) return start;

  let unsubscribe;
  unsubscribe = EventsOn('run:' + runId, (body) => {
    const status = parseJSON(body, 'run:' + runId);
    onUpdate(status);
    if (isFullyTerminal(status) && unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  });

  if (!isFullyTerminal(start)) {
    await App.WatchRun(runId);
  } else if (unsubscribe) {
    unsubscribe();
  }
  return start;
}

// watchExistingRun re-subscribes to an already-started run that's still
// working — for reattaching after something else lost the original
// EventsOn listener (see active-runs.js: a tab remount throws away the
// closure that was tracking a still-in-flight generation, even though mhl
// itself never stopped running it). Mirrors startAndWatch's second half,
// but starts from GetRunStatus instead of StartRun, since nothing new is
// being started here — same EventsOn-before-WatchRun ordering, for the same
// reason (WatchRun publishes its first snapshot synchronously before the
// promise resolves).
export async function watchExistingRun(runId, onUpdate) {
  let unsubscribe;
  unsubscribe = EventsOn('run:' + runId, (body) => {
    const status = parseJSON(body, 'run:' + runId);
    onUpdate(status);
    if (isFullyTerminal(status) && unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  });

  const current = await parseJSON(await App.GetRunStatus(runId), 'GetRunStatus');
  onUpdate(current);
  if (!isFullyTerminal(current)) {
    await App.WatchRun(runId);
  } else if (unsubscribe) {
    unsubscribe();
  }
  return current;
}

// resumeAndWatch re-enters a paused run (Modo Buddy's "Aprovar e continuar")
// and, if it isn't immediately terminal, re-arms Go-side polling by calling
// WatchRun again — reusing whatever EventsOn listener startAndWatch already
// registered for this runId (never torn down on pause, see isFullyTerminal
// above), so no new subscription is needed here.
export async function resumeAndWatch(runId, args, onUpdate) {
  const resumed = await parseJSON(await App.ResumeRun(runId, JSON.stringify(args)), 'ResumeRun');
  onUpdate(resumed);
  if (!isFullyTerminal(resumed)) {
    await App.WatchRun(runId);
  }
  return resumed;
}

export async function workItemList() {
  const result = await callWorkflowOnce('WorkItem', { action: 'list' });
  return result.projects ?? [];
}

export async function workItemCreate(name, itemType) {
  const result = await callWorkflowOnce('WorkItem', { action: 'create', name, item_type: itemType });
  return result.project;
}

export async function workItemUsage(projectId) {
  const result = await callWorkflowOnce('WorkItem', { action: 'usage', project_id: projectId });
  return result.usage;
}

// artifactPreview renders a paused run's pending_data through the same
// ArtifactBody/PageShell templates the real *Commit step will eventually
// use (workflows/artifact_preview/artifact_preview.mh) — real HTML, not a
// per-artifact guess on the frontend's side, and with no side effect (never
// writes to disk, never consumes a collection artifact's real id sequence).
// Synchronous like WorkItem's own actions (no LLM call in this path).
export async function artifactPreview(artifact, data) {
  const result = await callWorkflowOnce('ArtifactPreview', { artifact, data });
  return result.preview_html;
}

// deleteProject removes projects/<projectId> from disk entirely — there is
// no WorkItem action for this (only "archive", which keeps the files), so it
// goes straight to the Go-side App.DeleteProject binding instead of
// callWorkflowOnce.
export async function deleteProject(projectId) {
  await App.DeleteProject(projectId);
}

// callWorkflowOnce runs a workflow expected to complete on its own (WorkItem
// never calls an LLM, so its actions always end in "completed" or "failed"
// — never "paused") and resolves/rejects with its final vars.
//
// Deliberately plain request/response polling (StartRun + GetRunStatus in a
// loop) — NOT startAndWatch's EventsOn/WatchRun push mechanism. Real-world
// finding: the very first call made right as the app loads (Work-items list
// on startup) would come back empty with no error at all, while the exact
// same call moments later (e.g. right after creating a work-item) worked —
// classic symptom of the frontend's EventsOn subscription racing Wails'
// own event-bus initialization on a fresh page load. WorkItem's own actions
// never run long enough to need live progress anyway (no LLM call, ever),
// so there's no reason to depend on push events for them at all — plain
// polling has no such startup race because it only touches bound methods
// (StartRun/GetRunStatus), not the separate events subsystem. Reserve
// startAndWatch/EventsOn for Wiki/Discovery/Delivery, which genuinely need
// live progress and can pause (Modo Buddy).
const CALL_TIMEOUT_MS = 15000;
const POLL_INTERVAL_MS = 150;

async function callWorkflowOnce(workflow, args) {
  let status = await parseJSON(await App.StartRun(workflow, JSON.stringify(args)), 'StartRun');
  const deadline = Date.now() + CALL_TIMEOUT_MS;

  while (status.state === 'working' || status.state === 'queued') {
    if (Date.now() > deadline) {
      throw new Error(`run de ${workflow} (${JSON.stringify(args)}) não respondeu em ${CALL_TIMEOUT_MS}ms`);
    }
    await sleep(POLL_INTERVAL_MS);
    status = await parseJSON(await App.GetRunStatus(status.runId), 'GetRunStatus');
  }

  if (status.state === 'completed') {
    // status.vars comes from the bridge's RunStatus.Vars, a json.RawMessage
    // — it's embedded as real JSON by encodeStatus, not a string, so it's
    // already a plain object here (no re-parsing).
    return status.vars ?? {};
  }
  throw new Error(status.error || `run de ${workflow} terminou em estado ${status.state}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
