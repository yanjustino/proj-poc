import { startAndWatch, isFullyTerminal, listIngestedRaw, markRawIngested, resetIngestedRaw } from './api.js';
import { setActiveRun, clearActiveRun } from './active-runs.js';
import { acquireLlmSlot } from './llm-queue.js';
import { friendlyRunError } from './run-errors.js';

// Per-project ingest queue, deliberately module-level instead of living
// inside tab-fontes.js's mount closure. Wiki only ingests one raw file per
// run, so "Ingerir pendentes" is a sequential loop — and that loop used to
// belong to whichever Fontes mount started it. Leave the tab and come back
// mid-batch and the NEW mount knew nothing about the old loop: it had read
// .ingested.json before the loop's remaining files finished, reattached only
// the one run in flight at that instant, and showed every file still queued
// in the old loop as "Pendente" with "Ingerir pendentes" enabled again — while
// the old loop kept ingesting them invisibly. Clicking the button then
// ingested those files a second time (real incident: 4 of 6 sources ingested
// twice, the duplicate batch running alongside the brief's own generation).
//
// Living here, the queue outlives any mount: every Fontes mount subscribes
// to the same state (what's queued, what's running with its latest status)
// and is told when a file finishes, so it can reload .ingested.json instead
// of trusting what it read at mount time.
//
// Rebuilding the wiki (rebuildWiki) lives here for the same reason: it is
// this queue — Wiki's "reset", then every surviving source re-ingested in
// its original order, then one verification — and must outlive the tab that
// started it. A rebuild is how an already-ingested source leaves the wiki
// (see app/wiki_rebuild.go).

// rebuild: null, or {phase: 'reset' | 'ingest' | 'lint', total, names} while rebuildWiki runs.
const projects = new Map(); // projectId -> { queued: string[], running: {name, status} | null, draining: bool, listeners: Set, failures: Map, rebuild }

function stateOf(projectId) {
  if (!projects.has(projectId)) {
    projects.set(projectId, { queued: [], running: null, draining: false, listeners: new Set(), failures: new Map(), rebuild: null });
  }
  return projects.get(projectId);
}

function notify(state, event) {
  for (const listener of state.listeners) {
    try {
      listener(event);
    } catch (err) {
      console.error('ingest-queue listener', err);
    }
  }
}

export function ingestQueueSnapshot(projectId) {
  const state = stateOf(projectId);
  return { queued: [...state.queued], running: state.running ? { ...state.running } : null, rebuild: state.rebuild ? { ...state.rebuild } : null };
}

// isQueuedOrRunning: whether `name` is already owned by this queue — the
// Fontes tab must neither offer "Ingerir" for it nor reattach a second
// tracker to its run (the queue already broadcasts that run's status).
export function isQueuedOrRunning(projectId, name) {
  const state = stateOf(projectId);
  return state.running?.name === name || state.queued.includes(name);
}

// subscribeIngestQueue: listener receives {type: 'queued' | 'status' | 'done' | 'idle' | 'rebuild', name?, status?}.
// 'rebuild' carries {rebuild} (the new phase, or null when it ended) and,
// for the verification phase, the lint run's {runId}.
// Returns the unsubscribe function.
// ingestFailure: the last failure of `name` in this session ({summary,
// detail}), shown inline on its row instead of a blocking window.alert — the
// alert froze the whole window until dismissed and dumped the raw error chain
// on the person. Cleared when the file is queued again.
export function ingestFailure(projectId, name) {
  return stateOf(projectId).failures.get(name) ?? null;
}

export function subscribeIngestQueue(projectId, listener) {
  const state = stateOf(projectId);
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

export function enqueueIngest(projectId, names) {
  const state = stateOf(projectId);
  // While the reset runs, an ingest would land in a wiki about to be wiped.
  if (state.rebuild?.phase === 'reset') return;
  let added = false;
  for (const name of names) {
    if (state.running?.name === name || state.queued.includes(name)) continue;
    state.failures.delete(name);
    state.queued.push(name);
    added = true;
  }
  if (!added) return;
  notify(state, { type: 'queued' });
  drain(projectId);
}

async function drain(projectId) {
  const state = stateOf(projectId);
  if (state.draining) return;
  state.draining = true;
  try {
    while (state.queued.length > 0) {
      const name = state.queued.shift();
      // Last line of defense against a duplicate LLM call: re-read the
      // server-side marker right before starting, not whatever a mount
      // loaded minutes ago. Costs one cheap file read per source; an ingest
      // costs tens of thousands of tokens.
      let alreadyIngested = false;
      try {
        alreadyIngested = (await listIngestedRaw(projectId)).includes(name);
      } catch (err) {
        console.error('listIngestedRaw', err);
      }
      if (alreadyIngested) {
        notify(state, { type: 'done', name, status: { state: 'completed' } });
        continue;
      }
      await runOne(projectId, state, name);
    }
  } finally {
    state.draining = false;
    if (state.rebuild?.phase === 'ingest') await finishRebuild(projectId, state);
    notify(state, { type: 'idle' });
  }
}

function setRebuild(state, rebuild, extra = {}) {
  state.rebuild = rebuild;
  notify(state, { type: 'rebuild', rebuild: rebuild ? { ...rebuild } : null, ...extra });
}

// runToEnd: one Wiki run, resolved with its terminal status.
function runToEnd(args) {
  return new Promise((resolve, reject) => {
    startAndWatch('Wiki', args, (status) => {
      if (isFullyTerminal(status)) resolve(status);
    }).catch(reject);
  });
}

// rebuildWiki empties the wiki (Wiki's "reset": answers kept) and queues
// every source ingested before, in ingest order; finishRebuild verifies the
// wiki once the queue drains. Sources that were never ingested stay pending.
export async function rebuildWiki(projectId) {
  const state = stateOf(projectId);
  if (state.rebuild || state.draining || state.running || state.queued.length) {
    throw new Error('Aguarde a ingestão em andamento terminar antes de reprocessar a wiki.');
  }
  setRebuild(state, { phase: 'reset' });
  let names;
  try {
    const status = await runToEnd({ project_id: projectId, action: 'reset' });
    if (status.state !== 'completed') throw new Error(friendlyRunError(status.error || 'erro desconhecido').summary);
    names = await resetIngestedRaw(projectId);
  } catch (err) {
    setRebuild(state, null);
    throw err;
  }
  if (names.length === 0) {
    setRebuild(state, null);
    return;
  }
  setRebuild(state, { phase: 'ingest', total: names.length, names });
  enqueueIngest(projectId, names);
}

// finishRebuild: the verification that closes a rebuild — it is what points
// out again the concepts the old wiki had pages for (and the new one only
// cites). Skipped if a source failed: the person retries it from the Fontes
// tab and runs "Verificar wiki" themselves. The run is registered under the
// Wiki tab's own lint key, so that tab follows it and opens the report.
async function finishRebuild(projectId, state) {
  if (state.rebuild.names.some((name) => state.failures.has(name))) {
    setRebuild(state, null);
    return;
  }
  const lintKey = `${projectId}:wiki-lint`;
  setRebuild(state, { ...state.rebuild, phase: 'lint' });
  const release = await acquireLlmSlot('Wiki');
  try {
    await new Promise((resolve) => {
      let announced = false;
      startAndWatch('Wiki', { project_id: projectId, action: 'lint' }, (status) => {
        if (status.runId && !announced) {
          announced = true;
          setActiveRun(lintKey, status.runId);
          notify(state, { type: 'rebuild', rebuild: { ...state.rebuild }, runId: status.runId });
        }
        if (isFullyTerminal(status)) resolve();
      }).catch((err) => {
        console.error('rebuild lint', err);
        resolve();
      });
    });
  } finally {
    release();
    setRebuild(state, null);
  }
}

async function runOne(projectId, state, name) {
  const key = `${projectId}:raw:${name}`;
  state.running = { name, status: { runId: '', state: 'queued' } };
  notify(state, { type: 'status', name, status: state.running.status });
  // Ingest calls an LLM too — it shares llm-queue.js's cap with artifact
  // generations, so a batch of sources can't take every mhl slot either.
  const release = await acquireLlmSlot('Wiki');
  state.running = { name, status: { runId: '', state: 'working' } };
  notify(state, { type: 'status', name, status: state.running.status });

  return new Promise((resolve) => {
    let settled = false;
    function finish(status) {
      if (settled) return;
      settled = true;
      release();
      clearActiveRun(key);
      state.running = null;
      notify(state, { type: 'done', name, status });
      resolve();
    }

    function onUpdate(status) {
      if (settled) return;
      if (status.runId) setActiveRun(key, status.runId);
      state.running = { name, status };
      if (!isFullyTerminal(status)) {
        notify(state, { type: 'status', name, status });
        return;
      }
      if (status.state !== 'completed') {
        if (status.state === 'failed') state.failures.set(name, friendlyRunError(status.error || 'erro desconhecido'));
        finish(status);
        return;
      }
      markRawIngested(projectId, name)
        .catch((err) => console.error('markRawIngested', err))
        .finally(() => finish(status));
    }

    startAndWatch('Wiki', { project_id: projectId, action: 'ingest', raw_paths: [name] }, onUpdate).catch((err) => {
      state.failures.set(name, friendlyRunError(err.message || err));
      finish({ runId: '', state: 'failed', error: String(err) });
    });
  });
}
