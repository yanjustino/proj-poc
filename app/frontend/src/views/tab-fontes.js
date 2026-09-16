import {
  listProjectDir,
  selectRawFiles,
  addRawFile,
  startAndWatch,
  watchExistingRun,
  isFullyTerminal,
  listIngestedRaw,
  markRawIngested,
} from '../api.js';
import { createRunTracker } from '../run-tracker.js';
import { icon } from '../icons.js';
import { setActiveRun, getActiveRun, clearActiveRun } from '../active-runs.js';

// renderFontesTab owns the "upload de arquivos-base → Wiki ingest" flow
// (§3.2 of the plan). Uploading and ingesting are deliberately separate
// steps here: "+ Adicionar fontes" only copies the picked files into raw/
// (fast, no LLM call), and ingest — either "Ingerir pendentes" for the
// whole batch or a row's own "Ingerir" button for just that one — is a
// distinct action the user triggers afterwards. Wiki only accepts one
// raw_paths entry per call either way, so a batch still runs one file at a
// time, in order.
//
// Which files have already been ingested is bookkept server-side (see
// MarkRawIngested/ListIngestedRaw in app.go) — a plain raw/ listing can't
// tell an ingested source from a freshly uploaded one, and that state has
// to survive switching tabs or restarting the app.
//
// An ingest keeps running on the backend regardless of what the tab does
// (mhl doesn't stop just because the UI remounted) — the local `trackers`
// map below is thrown away on every remount, same class of bug already
// fixed for tab-artefatos.js's generations (see active-runs.js): without
// reattachActiveRuns(), leaving Fontes mid-ingest and coming back showed
// that file as "pendente" again, even though it was genuinely still
// running server-side. Real user-reported symptom this fixes.
export async function renderFontesTab(container, project, { onChanged }) {
  // Flipped off by the dispose() this returns — guards a status callback
  // that outlives this mount from touching torn-down DOM.
  let active = true;

  container.innerHTML = `
    <div class="upload-row">
      <div class="upload-actions">
        <button class="button tertiary small" data-ingest-pending disabled>${icon('inbox', 14)} Ingerir pendentes</button>
        <button class="button primary small" data-add>${icon('plus', 14)} Adicionar fontes</button>
      </div>
    </div>
    <div class="source-list" data-sources></div>
  `;

  const sourcesEl = container.querySelector('[data-sources]');
  const addButton = container.querySelector('[data-add]');
  const ingestPendingButton = container.querySelector('[data-ingest-pending]');

  let rawNames = [];
  let ingestedNames = new Set();
  let batching = false; // true only while ingestBatch's own sequential loop is driving things
  const trackers = new Map(); // filename -> live tracker (fresh or reattached), removed once that file's run reaches a terminal state

  // Keyed by project + filename (not just filename) so this stays correct
  // even though active-runs.js's registry is a single app-wide map shared
  // by every work-item's Fontes tab.
  function activeKey(name) {
    return `${project.id}:raw:${name}`;
  }

  await loadState();
  reattachActiveRuns();
  render();

  async function loadState() {
    let nodes;
    try {
      nodes = await listProjectDir(project.id, 'raw', '');
    } catch (err) {
      sourcesEl.innerHTML = `<p class="doc-empty">Erro ao listar fontes: ${escapeHtml(String(err))}</p>`;
      rawNames = [];
      return;
    }
    let ingestedList = [];
    try {
      ingestedList = await listIngestedRaw(project.id);
    } catch (err) {
      console.error('listIngestedRaw', err);
    }
    rawNames = nodes.map((node) => node.name);
    ingestedNames = new Set(ingestedList);
  }

  async function refresh() {
    await loadState();
    if (active) render();
  }

  function pendingNames() {
    return rawNames.filter((name) => !ingestedNames.has(name) && !trackers.has(name));
  }

  function render() {
    if (rawNames.length === 0) {
      sourcesEl.innerHTML = '<p class="doc-empty">Nenhuma fonte enviada ainda.</p>';
    } else {
      sourcesEl.innerHTML = '';
      for (const name of rawNames) {
        const row = document.createElement('div');
        row.className = 'source-item';
        sourcesEl.appendChild(row);
        const tracker = trackers.get(name);
        if (tracker) {
          row.innerHTML = `<div class="source-row"><span class="source-name">${icon('fileText', 14)} <strong>${escapeHtml(name)}</strong></span></div>`;
          row.appendChild(tracker.element);
        } else {
          row.innerHTML = rowBody(name);
          const ingestButton = row.querySelector('[data-ingest-one]');
          if (ingestButton) ingestButton.addEventListener('click', () => ingestBatch([name]));
        }
      }
    }
    const pending = pendingNames();
    ingestPendingButton.disabled = batching || pending.length === 0;
    ingestPendingButton.innerHTML = pending.length
      ? `${icon('inbox', 14)} Ingerir pendentes (${pending.length})`
      : `${icon('inbox', 14)} Ingerir pendentes`;
  }

  function rowBody(name) {
    if (ingestedNames.has(name)) {
      return `
        <div class="source-row">
          <span class="source-name">${icon('fileText', 14)} <strong>${escapeHtml(name)}</strong></span>
          <span class="source-status source-status-done">${icon('checkCircle', 14)} Ingerido</span>
        </div>
      `;
    }
    return `
      <div class="source-row">
        <span class="source-name">${icon('fileText', 14)} <strong>${escapeHtml(name)}</strong></span>
        <button class="button secondary small" data-ingest-one ${batching ? 'disabled' : ''}>Ingerir</button>
      </div>
    `;
  }

  addButton.addEventListener('click', async () => {
    addButton.disabled = true;
    try {
      const paths = await selectRawFiles();
      for (const sourcePath of paths) {
        try {
          await addRawFile(project.id, sourcePath);
        } catch (err) {
          const displayName = sourcePath.split(/[/\\]/).pop();
          window.alert(`Erro ao copiar "${displayName}": ` + (err.message || err));
        }
      }
      await refresh();
      onChanged();
    } catch (err) {
      window.alert('Erro ao adicionar fontes: ' + (err.message || err));
    } finally {
      addButton.disabled = false;
    }
  });

  ingestPendingButton.addEventListener('click', () => ingestBatch(pendingNames()));

  async function ingestBatch(names) {
    if (batching || names.length === 0) return;
    batching = true;
    render();
    for (const name of names) {
      await watchOne(name, activeKey(name), (onUpdate) =>
        startAndWatch('Wiki', { project_id: project.id, action: 'ingest', raw_paths: [name] }, onUpdate),
      );
    }
    batching = false;
    if (active) render();
  }

  // watchOne drives one file's ingest run to a terminal state, whether it
  // was just started (ingestBatch, via startAndWatch) or was already
  // running on the backend before this mount even existed
  // (reattachActiveRuns, via watchExistingRun) — same status handling
  // either way, which is what makes "leave mid-ingest and come back" look
  // identical to "never left" from the user's side.
  function watchOne(name, key, watchPromiseFactory) {
    if (trackers.has(name)) return Promise.resolve();
    const tracker = createRunTracker();
    trackers.set(name, tracker);
    if (active) render();

    return new Promise((resolve) => {
      function onUpdate(status) {
        tracker.update(status);
        if (status.runId) setActiveRun(key, status.runId);
        if (!isFullyTerminal(status)) {
          if (active) render();
          return;
        }
        clearActiveRun(key);
        trackers.delete(name);
        if (status.state !== 'completed') {
          if (status.state === 'failed') {
            window.alert(`Falha ao ingerir "${name}": ${status.error || 'erro desconhecido'}`);
          }
          if (active) render();
          resolve();
          return;
        }
        markRawIngested(project.id, name)
          .then(() => ingestedNames.add(name))
          .catch((err) => console.error('markRawIngested', err))
          .finally(() => {
            if (active) render();
            onChanged();
            resolve();
          });
      }

      watchPromiseFactory(onUpdate).catch((err) => {
        clearActiveRun(key);
        trackers.delete(name);
        window.alert(`Erro ao ingerir "${name}": ` + (err.message || err));
        if (active) render();
        resolve();
      });
    });
  }

  // Runs once at mount, before the first render: any file whose key is
  // still in active-runs.js' registry genuinely has an ingest running on
  // the backend right now (mhl doesn't stop just because the tab
  // remounted) — reattach a fresh tracker + event subscription instead of
  // letting it look like it silently reverted to "pendente".
  function reattachActiveRuns() {
    for (const name of rawNames) {
      if (ingestedNames.has(name)) continue;
      const key = activeKey(name);
      const runId = getActiveRun(key);
      if (!runId) continue;
      watchOne(name, key, (onUpdate) => watchExistingRun(runId, onUpdate));
    }
  }

  return () => {
    active = false;
  };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
