import {
  listProjectDir,
  selectRawFiles,
  addRawFile,
  watchExistingRun,
  isFullyTerminal,
  listIngestedRaw,
  markRawIngested,
} from '../api.js';
import { createRunTracker } from '../run-tracker.js';
import { icon } from '../icons.js';
import { getActiveRun, clearActiveRun } from '../active-runs.js';
import { enqueueIngest, ingestFailure, ingestQueueSnapshot, isQueuedOrRunning, subscribeIngestQueue } from '../ingest-queue.js';
import { formatRelativeTime } from '../time-format.js';

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
//
// The batch loop itself lives in ingest-queue.js, not here — see that
// file's comment for the duplicate-ingest incident a mount-owned loop
// caused. This tab only renders the queue's state and enqueues into it.
export async function renderFontesTab(container, project, { onChanged }) {
  // Flipped off by the dispose() this returns — guards a status callback
  // that outlives this mount from touching torn-down DOM.
  let active = true;

  container.innerHTML = `
    <div class="collection-map-head">
      <div>
        <div class="collection-map-title"><h2>Fontes do projeto</h2><span data-source-count>0 arquivos</span></div>
        <p>Documentos usados como contexto para construir a wiki e os artefatos.</p>
      </div>
      <div class="collection-map-actions">
        <button class="button tertiary small" data-ingest-pending disabled>${icon('inbox', 14)} Ingerir pendentes</button>
        <button class="button primary small" data-add>${icon('plus', 14)} Adicionar fontes</button>
        <div class="view-toggle" data-view-toggle>
          <button class="view-toggle-btn" data-view="cards" title="Ver como cards">${icon('grid', 15)}</button>
          <button class="view-toggle-btn" data-view="table" title="Ver como tabela">${icon('list', 15)}</button>
        </div>
      </div>
    </div>
    <div class="collection-filters" data-source-filters>
      <button class="collection-filter active" data-source-filter="all">Todas</button>
      <button class="collection-filter" data-source-filter="ready">Ingeridas</button>
      <button class="collection-filter" data-source-filter="pending">Pendentes</button>
    </div>
    <div class="list-area" data-sources></div>
  `;

  const sourcesEl = container.querySelector('[data-sources]');
  const addButton = container.querySelector('[data-add]');
  const ingestPendingButton = container.querySelector('[data-ingest-pending]');
  const sourceCountEl = container.querySelector('[data-source-count]');
  const filterButtons = [...container.querySelectorAll('[data-source-filter]')];
  const viewButtons = [...container.querySelectorAll('[data-view]')];

  // viewMode: same default/persistence reasoning as tab-artefatos.js's own
  // (see its comment) — table by default, cards one click away. Own
  // localStorage key: a per-tab preference, not a single global "how does
  // this person like to browse lists" toggle — someone might want Artefatos
  // dense but Fontes as cards, say.
  let viewMode = 'table';
  try {
    if (localStorage.getItem('senpai-fontes-view') === 'cards') viewMode = 'cards';
  } catch {
    // Degrades to 'table'.
  }
  viewButtons.forEach((button) => button.classList.toggle('active', button.dataset.view === viewMode));
  function setViewMode(mode) {
    viewMode = mode;
    try {
      localStorage.setItem('senpai-fontes-view', mode);
    } catch {
      // Not persisted this time — still applies for the rest of this mount.
    }
    viewButtons.forEach((button) => button.classList.toggle('active', button.dataset.view === mode));
    render();
  }
  viewButtons.forEach((button) => button.addEventListener('click', () => setViewMode(button.dataset.view)));

  let rawNodes = []; // full listProjectDir() nodes (name + modifiedAt), not just names — the table view's "Última atualização" column needs the timestamp too
  let rawNames = [];
  let ingestedNames = new Set();
  let activeFilter = 'all';
  // trackers: filename -> live tracker. Either the queue's current run
  // (mirrored from ingest-queue.js's status events, one tracker per mount)
  // or a run reattached from active-runs.js that no queue owns (started
  // before an app restart). Removed once that file's run is terminal.
  const trackers = new Map();

  // Keyed by project + filename (not just filename) so this stays correct
  // even though active-runs.js's registry is a single app-wide map shared
  // by every work-item's Fontes tab.
  function activeKey(name) {
    return `${project.id}:raw:${name}`;
  }

  await loadState();
  const queueRunning = ingestQueueSnapshot(project.id).running;
  if (queueRunning) trackerFor(queueRunning.name).update(queueRunning.status);
  reattachActiveRuns();
  const unsubscribeQueue = subscribeIngestQueue(project.id, onQueueEvent);
  render();

  function trackerFor(name) {
    if (!trackers.has(name)) trackers.set(name, createRunTracker());
    return trackers.get(name);
  }

  // onQueueEvent: a queued file started or progressed (repaint its tracker),
  // or finished — then .ingested.json is re-read from the server rather
  // than patched locally, since the queue may have been started by a
  // different mount of this tab than the one listening now.
  function onQueueEvent(event) {
    if (!active) return;
    if (event.type === 'status') {
      trackerFor(event.name).update(event.status);
      render();
      return;
    }
    if (event.type === 'done') {
      trackers.get(event.name)?.dispose();
      trackers.delete(event.name);
      refresh().then(() => onChanged());
      return;
    }
    render();
  }

  async function loadState() {
    let nodes;
    try {
      nodes = await listProjectDir(project.id, 'raw', '');
    } catch (err) {
      sourcesEl.innerHTML = `<p class="doc-empty">Erro ao listar fontes: ${escapeHtml(String(err))}</p>`;
      rawNodes = [];
      rawNames = [];
      return;
    }
    let ingestedList = [];
    try {
      ingestedList = await listIngestedRaw(project.id);
    } catch (err) {
      console.error('listIngestedRaw', err);
    }
    rawNodes = nodes;
    rawNames = nodes.map((node) => node.name);
    ingestedNames = new Set(ingestedList);
  }

  async function refresh() {
    await loadState();
    if (active) render();
  }

  function isBusy(name) {
    return trackers.has(name) || isQueuedOrRunning(project.id, name);
  }

  function pendingNames() {
    return rawNames.filter((name) => !ingestedNames.has(name) && !isBusy(name));
  }

  // modifiedAtOf: epoch-ms (or null) for the table view's "Última
  // atualização" column — app.go's ListProjectDir returns each node's own
  // mtime now (added for tab-artefatos.js's staleness matrix, reused here).
  function modifiedAtOf(name) {
    const node = rawNodes.find((n) => n.name === name);
    return node?.modifiedAt ? Date.parse(node.modifiedAt) : null;
  }

  function render() {
    const visibleNames = rawNames.filter((name) => {
      if (activeFilter === 'all') return true;
      return activeFilter === 'ready' ? ingestedNames.has(name) : !ingestedNames.has(name);
    });
    sourceCountEl.textContent = `${rawNames.length} ${rawNames.length === 1 ? 'arquivo' : 'arquivos'}`;
    if (rawNames.length === 0) {
      sourcesEl.className = 'list-area';
      sourcesEl.innerHTML = '<div class="collection-map-empty">Nenhuma fonte enviada ainda.</div>';
    } else if (visibleNames.length === 0) {
      sourcesEl.className = 'list-area';
      sourcesEl.innerHTML = '<div class="collection-map-empty">Nenhuma fonte neste filtro.</div>';
    } else if (viewMode === 'table') {
      renderTable(visibleNames);
    } else {
      renderCards(visibleNames);
    }
    const pending = pendingNames();
    ingestPendingButton.disabled = pending.length === 0;
    ingestPendingButton.innerHTML = pending.length
      ? `${icon('inbox', 14)} Ingerir pendentes (${pending.length})`
      : `${icon('inbox', 14)} Ingerir pendentes`;
  }

  function renderCards(visibleNames) {
    sourcesEl.className = 'list-area source-card-grid';
    sourcesEl.innerHTML = '';
    for (const name of visibleNames) {
      const row = document.createElement('article');
      row.className = `source-card ${ingestedNames.has(name) ? 'ready' : 'pending'}`;
      sourcesEl.appendChild(row);
      const tracker = trackers.get(name);
      if (tracker) {
        row.innerHTML = sourceCardBody(name, 'Processando a fonte…', 'working');
        row.appendChild(tracker.element);
        row.appendChild(tracker.composer);
      } else if (isQueuedOrRunning(project.id, name)) {
        row.innerHTML = sourceCardBody(name, 'Na fila', 'queued');
      } else {
        row.innerHTML = rowBody(name);
        const ingestButton = row.querySelector('[data-ingest-one]');
        if (ingestButton) ingestButton.addEventListener('click', () => enqueueIngest(project.id, [name]));
      }
    }
  }

  // renderTable: the dense alternative to renderCards, same reasoning as
  // tab-artefatos.js's own table view — one row per source instead of one
  // tile. Rows aren't clickable as a whole (.data-row.static — there's no
  // detail pane here, this tab never renders into reading-pane.js at all),
  // only the "Ingerir →" action does anything. A file still being ingested
  // just shows "Processando…" text instead of embedding the live tracker
  // widget inline (unlike renderCards, which appends tracker.element/
  // .composer directly) — that widget's animated orbit and composer don't
  // fit a dense table row, and Wiki's ingest action never actually pauses
  // for approval, so there's nothing the composer would offer here anyway.
  function renderTable(visibleNames) {
    sourcesEl.className = 'list-area data-table-wrap';
    sourcesEl.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th></th>
            <th>Nome</th>
            <th>Status</th>
            <th>Última atualização</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          ${visibleNames.map((name) => tableRowHtml(name)).join('')}
        </tbody>
      </table>
    `;
    sourcesEl.querySelectorAll('[data-ingest-one]').forEach((button) => {
      button.addEventListener('click', () => enqueueIngest(project.id, [button.dataset.ingestOne]));
    });
  }

  function tableRowHtml(name) {
    const tracker = trackers.get(name);
    const queued = !tracker && isQueuedOrRunning(project.id, name);
    const ingested = ingestedNames.has(name);
    const failure = !tracker && !queued && !ingested ? ingestFailure(project.id, name) : null;
    const dot = tracker ? 'working' : queued ? 'queued' : ingested ? 'done' : failure ? 'failed' : '';
    const statusText = tracker ? 'Processando…' : queued ? 'Na fila' : ingested ? 'Ingerido' : failure ? 'Falhou' : 'Pendente';
    const when = formatRelativeTime(modifiedAtOf(name));
    const canIngest = !tracker && !queued && !ingested;
    const rowTitle = failure ? [failure.summary, failure.detail].filter(Boolean).join('\n\n') : statusText;
    return `
      <tr class="data-row static ${failure ? 'failed' : ''}" title="${escapeAttribute(rowTitle)}">
        <td class="data-row-dot"><span class="status-dot ${dot}"></span></td>
        <td class="data-row-name"><i>${icon('fileText', 14)}</i><span title="${escapeAttribute(name)}">${escapeHtml(name)}</span></td>
        <td class="data-row-status">${escapeHtml(statusText)}${failure ? `<div class="data-row-error">${escapeHtml(failure.summary)}</div>` : ''}</td>
        <td class="data-row-when">${escapeHtml(when)}</td>
        <td class="data-row-actions">
          ${canIngest ? `<button data-ingest-one="${escapeAttribute(name)}">${failure ? 'Tentar novamente' : 'Ingerir →'}</button>` : ''}
        </td>
      </tr>
    `;
  }

  function sourceCardBody(name, status, state, action = '') {
    const extension = name.includes('.') ? name.split('.').pop().toUpperCase() : 'ARQUIVO';
    return `
      <div class="source-card-kind"><i>${icon('fileText', 15)}</i><span>${escapeHtml(extension)}</span></div>
      <strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong>
      <p>${state === 'done' ? 'Disponível como contexto na wiki.' : state === 'failed' ? 'A última tentativa de ingestão falhou.' : 'Aguardando processamento para entrar no contexto.'}</p>
      <footer><span class="status-dot ${state}"></span><span>${escapeHtml(status)}</span>${action}</footer>
    `;
  }

  function rowBody(name) {
    if (ingestedNames.has(name)) {
      return sourceCardBody(name, 'Ingerido', 'done');
    }
    const failure = ingestFailure(project.id, name);
    if (failure) {
      return sourceCardBody(
        name,
        failure.summary,
        'failed',
        `<button class="source-card-action" data-ingest-one title="${escapeAttribute(failure.detail || failure.summary)}">Tentar novamente</button>`,
      );
    }
    return sourceCardBody(
      name,
      'Pendente',
      '',
      `<button class="source-card-action" data-ingest-one>Ingerir →</button>`,
    );
  }

  filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      activeFilter = button.dataset.sourceFilter;
      filterButtons.forEach((candidate) => candidate.classList.toggle('active', candidate === button));
      render();
    });
  });

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

  ingestPendingButton.addEventListener('click', () => enqueueIngest(project.id, pendingNames()));

  // Runs once at mount: a file whose key is still in active-runs.js'
  // registry but that no ingest queue owns (its run was started before an
  // app restart — the queue itself is in-memory) genuinely has an ingest
  // running on the backend — reattach a tracker instead of letting it look
  // like it silently reverted to "pendente". A file the queue owns is
  // skipped: the queue already broadcasts that run's status to this mount.
  function reattachActiveRuns() {
    for (const name of rawNames) {
      if (ingestedNames.has(name) || isQueuedOrRunning(project.id, name)) continue;
      const key = activeKey(name);
      const runId = getActiveRun(key);
      if (!runId) continue;
      const tracker = trackerFor(name);
      watchExistingRun(runId, (status) => {
        tracker.update(status);
        if (!isFullyTerminal(status)) {
          if (active) render();
          return;
        }
        clearActiveRun(key);
        trackers.delete(name);
        tracker.dispose();
        const done = status.state === 'completed' ? markRawIngested(project.id, name).catch((err) => console.error('markRawIngested', err)) : Promise.resolve();
        done.finally(() => {
          if (!active) return;
          refresh().then(() => onChanged());
        });
      }).catch((err) => {
        clearActiveRun(key);
        trackers.delete(name);
        tracker.dispose();
        console.error('watchExistingRun', err);
        if (active) render();
      });
    }
  }

  return () => {
    active = false;
    unsubscribeQueue();
    // A tracker still working/queued when this tab unmounts owns a ticking
    // setInterval (run-tracker.js's elapsed-time display) — nothing else
    // ever references it again to clear it, so this must, even though the
    // ingest itself keeps running on the backend regardless.
    for (const tracker of trackers.values()) tracker.dispose();
  };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
function escapeAttribute(text) {
  return escapeHtml(text).replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
