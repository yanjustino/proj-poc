import { startAndWatch, isFullyTerminal } from './api.js';

// App-wide limit on runs that call an LLM (artifact generations, wiki
// ingest). mhl itself caps concurrent executions (mhlbridge.go's
// maxConcurrentRuns), but that cap is shared by EVERY run — including the
// quick, deterministic ones the UI waits on: approving a draft (a
// commit-only run), previews, the project summary's WorkItem queries.
// Measured against a bare `mhl serve`: with the slots busy on a long run, a
// trivial run waits in mhl's queue until one frees up. With every slot held
// by multi-minute LLM calls ("Gerar histórias pendentes" used to start every
// pending feature at once), approving an item sat behind all of them and the
// screen looked frozen on "Aplicando…" until the approval timed out.
//
// Capping LLM runs here, below mhl's own cap, keeps slots free for the quick
// runs. A paused run holds no mhl slot (also measured), so a draft waiting
// for review releases its slot the moment it pauses.
//
// On top of that, at most ONE run per pipeline at a time: two concurrent
// sessions of the same pipeline can collide on mhl's shared "latest" pointer
// file (see api.js's callWorkflowOnce — an upstream mhl bug, "Acesso negado"
// on Windows), and two Discovery generations at once (several features'
// histórias) are exactly that. Different pipelines — a Discovery generation
// alongside a Wiki ingest — still run in parallel.
export const MAX_CONCURRENT_LLM_RUNS = 2;

let running = 0;
const busyPipelines = new Set();
const waiters = []; // { pipeline, grant }, FIFO

function canRun(pipeline) {
  return running < MAX_CONCURRENT_LLM_RUNS && !busyPipelines.has(pipeline);
}

// Starts every waiter that can run now, oldest first — skipping (not
// blocking on) one whose pipeline is still busy, so a queued Wiki ingest
// isn't held up behind a line of Discovery generations.
function dispatch() {
  for (let i = 0; i < waiters.length && running < MAX_CONCURRENT_LLM_RUNS; ) {
    if (canRun(waiters[i].pipeline)) {
      const [waiter] = waiters.splice(i, 1);
      waiter.grant();
    } else {
      i += 1;
    }
  }
}

// acquireLlmSlot resolves with a release() once a slot is free for
// `pipeline` (the workflow name: Discovery, Delivery, Wiki). release() is
// idempotent — callers release on the first of paused/terminal/error.
export function acquireLlmSlot(pipeline) {
  return new Promise((resolve) => {
    const grant = () => {
      running += 1;
      busyPipelines.add(pipeline);
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        running -= 1;
        busyPipelines.delete(pipeline);
        dispatch();
      });
    };
    waiters.push({ pipeline, grant });
    dispatch();
  });
}

// --- Queued generations -----------------------------------------------------
//
// A generation waiting for a slot hasn't been started in mhl yet — there is
// no runId for active-runs.js to remember, so a tab remount would lose it
// (and show "Gerar" again for something that's about to start). The job
// therefore lives here, module-level, like ingest-queue.js: the queue itself
// starts the run and broadcasts every status to whichever Artefatos mount is
// listening, keyed by the same `${projectId}:${rowKey}` key active-runs.js uses.

const jobs = new Map(); // key -> { status, canceled }
const listeners = new Set();

function notify(key, status) {
  for (const listener of listeners) {
    try {
      listener(key, status);
    } catch (err) {
      console.error('llm-queue listener', err);
    }
  }
}

export function subscribeLlmJobs(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// llmJob: the latest status of a job this queue still owns (queued, or
// started and not yet paused/terminal), or null.
export function llmJob(key) {
  return jobs.get(key)?.status ?? null;
}

// cancelQueuedLlmJob drops a job that hasn't started yet. Returns false when
// the job already has a run in mhl — that one is canceled through mhl.
export function cancelQueuedLlmJob(key) {
  const job = jobs.get(key);
  if (!job || job.status.runId) return false;
  job.canceled = true;
  jobs.delete(key);
  return true;
}

// enqueueLlmRun starts `workflow` with `args` once an LLM slot is free,
// broadcasting {key, status} for every update. The job leaves the queue when
// its run pauses (Modo Buddy review — the host takes over from there with
// the status it just received) or reaches a terminal state.
export function enqueueLlmRun(key, workflow, args) {
  if (jobs.has(key)) return;
  const job = { status: { runId: '', state: 'queued' }, canceled: false };
  jobs.set(key, job);
  notify(key, job.status);

  acquireLlmSlot(workflow).then((release) => {
    if (job.canceled) {
      release();
      return;
    }
    const update = (status) => {
      job.status = status;
      if (status.state === 'paused' || isFullyTerminal(status)) {
        release();
        if (jobs.get(key) === job) jobs.delete(key);
      }
      notify(key, status);
    };
    update({ runId: '', state: 'working' });
    startAndWatch(workflow, args, update).catch((err) => {
      update({ runId: job.status.runId || '', state: 'failed', error: String(err) });
    });
  });
}
