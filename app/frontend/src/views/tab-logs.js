// A per-project "Logs" tab: lists every run whose log survived to disk for
// this work-item (projects/<id>/run_logs/*.log, written by app.go's
// tailRunLogs) and lets you read any of them back. Exists because the
// global Logs screen (logs-view.js) only ever lists the CURRENT app
// session's own runs (mhl_run_list) — leave the screen, switch work-items,
// restart the app, or just let SetAgent reconnect the bridge, and that list
// forgets every run it had, even though the bytes themselves were durably
// written to disk the whole time. This tab reads straight from that
// filesystem index instead, so a project's history stays reachable exactly
// where you'd look for it: on the project, not on a session that already
// ended.
//
// One full-width table, one row per run — clicking a row expands a second,
// nested row right below it (raw log + LLM calls for that run), instead of
// a narrow sidebar list driving a separate detail panel. Loads once on
// mount and stays put until the person clicks "Atualizar" or expands a row
// for the first time — no interval-based polling anywhere in this file.
// Real complaint this replaces a fix for: the previous version polled the
// run list every 5s, the open run's content every 2.5s and every LLM call
// for the whole project every 8s, all independently — on a work-item with
// many runs the screen never held still long enough to read, and there was
// no way to just stop it short of leaving the tab.
import { listProjectRunLogs, getPersistedRunLogs, getRunStatus, workItemPromptLog } from '../api.js';
import { dotClass } from '../status.js';
import { STATE_LABEL } from '../run-tracker.js';
import { icon } from '../icons.js';
import { callCostNote } from '../cost.js';

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return iso;
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}
function escapeAttribute(text) {
  return escapeHtml(text).replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

// copyToClipboard: one "Copiado!" feedback flash shared by every copy
// button on this tab (the whole-log copy and every per-call prompt/
// resposta copy) — the button's own label is the only state that changes,
// so the flash reverts cleanly even with several buttons on screen at once.
function copyToClipboard(button, text) {
  navigator.clipboard
    .writeText(text)
    .then(() => {
      const original = button.textContent;
      button.textContent = 'Copiado!';
      setTimeout(() => {
        button.textContent = original;
      }, 1500);
    })
    .catch(() => {
      // Sem permissão de clipboard: o texto continua selecionável na tela.
    });
}

export async function renderLogsTab(container, project) {
  container.innerHTML = `
    <div class="logs-tab-head">
      <div>
        <h2>Logs</h2>
        <p>Execuções registradas para este work-item — clique numa linha para ver o log completo e as chamadas de LLM.</p>
      </div>
      <button class="button secondary small" data-refresh>${icon('download', 14)} Atualizar</button>
    </div>
    <div class="list-area" data-list><p class="empty-nav">Carregando…</p></div>
  `;

  const listEl = container.querySelector('[data-list]');
  const refreshButton = container.querySelector('[data-refresh]');

  let entries = [];
  // llmCalls: every prompt/response call recorded for the WHOLE project
  // (workItemPromptLog has no runId to filter by — see below), fetched once
  // per mount/refresh, then filtered per expanded row using that row's own
  // best-effort artifact (from a one-time getRunStatus call — see
  // expandRow). Fetching it spins up a real mhl_run_start under the hood
  // (workItemPromptLog's own doc comment) — cheap, but not free, which is
  // exactly why this only happens on mount/refresh now, never on a timer.
  let llmCalls = [];
  // detailCache: runId -> {loading, content, artifact, error} — populated
  // lazily, the first time a row expands, and kept until the next manual
  // refresh (expandedRunId itself persists across a re-render, e.g. after
  // "Atualizar", but its cached detail is dropped so it reloads fresh).
  const detailCache = new Map();
  let expandedRunId = null;
  const llmOpenStates = new Map(); // "runId:index" -> aberto/fechado, sobrevive a um re-render

  function render() {
    if (entries.length === 0) {
      listEl.className = 'list-area';
      listEl.innerHTML = '<div class="collection-map-empty">Nenhum log registrado ainda para este work-item.</div>';
      return;
    }
    listEl.className = 'list-area data-table-wrap';
    listEl.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th></th>
            <th>Execução</th>
            <th>Quando</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${entries.map((entry) => rowHtml(entry)).join('')}
        </tbody>
      </table>
    `;

    listEl.querySelectorAll('[data-run-id]').forEach((row) => {
      row.addEventListener('click', () => toggleRow(row.dataset.runId));
    });

    if (expandedRunId) renderDetailInto(expandedRunId);
  }

  function rowHtml(entry) {
    const expanded = entry.runId === expandedRunId;
    return `
      <tr class="data-row ${expanded ? 'selected' : ''}" data-run-id="${escapeHtml(entry.runId)}" title="${escapeHtml(entry.runId)}">
        <td class="data-row-dot"><span class="status-dot" data-status-dot></span></td>
        <td class="data-row-name"><span>${escapeHtml(entry.runId)}</span></td>
        <td class="data-row-when">${escapeHtml(formatDate(entry.modifiedAt))} · ${formatSize(entry.sizeBytes)}</td>
        <td class="data-row-actions"><i class="logs-chevron ${expanded ? 'open' : ''}">${icon('arrowDown', 14)}</i></td>
      </tr>
      <tr class="logs-detail-row" data-detail-for="${escapeHtml(entry.runId)}" ${expanded ? '' : 'hidden'}>
        <td colspan="4"><div class="logs-detail" data-detail-body></div></td>
      </tr>
    `;
  }

  // toggleRow expands `runId`'s nested row (collapsing whatever else was
  // open — one at a time, same as the old single-selection panel) or
  // collapses it back if it was already the open one. Loads its detail on
  // the way in, exactly once, unless a prior load already cached it.
  async function toggleRow(runId) {
    expandedRunId = expandedRunId === runId ? null : runId;
    render();
    if (expandedRunId) await loadDetail(expandedRunId);
  }

  async function loadDetail(runId) {
    if (detailCache.has(runId)) {
      renderDetailInto(runId);
      return;
    }
    detailCache.set(runId, { loading: true });
    renderDetailInto(runId);

    const [contentResult, statusResult] = await Promise.allSettled([getPersistedRunLogs(project.id, runId), getRunStatus(runId)]);
    if (expandedRunId !== runId) return; // colapsado (ou trocou de linha) antes da resposta chegar

    detailCache.set(runId, {
      loading: false,
      content: contentResult.status === 'fulfilled' ? contentResult.value : '',
      contentError: contentResult.status === 'rejected' ? String(contentResult.reason) : null,
      // status pode genuinamente não existir (runId de uma sessão antiga do
      // mhl, ou de antes do último restart do app) — sem problema, o log
      // persistido continua acessível; só perde o filtro de "Chamadas de
      // LLM" por artefato, que cai pro fallback (mostra tudo).
      status: statusResult.status === 'fulfilled' ? statusResult.value : null,
    });
    renderDetailInto(runId);
    updateStatusDot(runId);
  }

  function updateStatusDot(runId) {
    const detail = detailCache.get(runId);
    const row = listEl.querySelector(`tr.data-row[data-run-id="${cssEscape(runId)}"]`);
    const dotEl = row?.querySelector('[data-status-dot]');
    if (!dotEl) return;
    dotEl.className = `status-dot ${detail?.status ? dotClass(detail.status.state) : ''}`;
    if (detail?.status) dotEl.title = STATE_LABEL[detail.status.state] || detail.status.state;
  }

  function renderDetailInto(runId) {
    const body = listEl.querySelector(`tr.logs-detail-row[data-detail-for="${cssEscape(runId)}"] [data-detail-body]`);
    if (!body) return;
    const detail = detailCache.get(runId);
    if (!detail || detail.loading) {
      body.innerHTML = '<p class="empty-nav">Carregando…</p>';
      return;
    }

    const artifact = detail.status?.vars?.artifact ?? detail.status?.vars?.current_artifact ?? null;
    const calls = artifact ? llmCalls.filter((entry) => entry.artifact === artifact) : llmCalls;

    body.innerHTML = `
      <div class="logs-detail-head">
        <span class="logs-run-id">${escapeHtml(runId)}</span>
        <button class="button tertiary small" data-copy-log>Copiar log</button>
      </div>
      ${llmCallsHtml(runId, calls, artifact)}
      <pre class="logs-output">${escapeHtml(detail.contentError ? `Erro ao carregar log: ${detail.contentError}` : detail.content || '(sem saída registrada)')}</pre>
    `;

    body.querySelector('[data-copy-log]').addEventListener('click', (event) => {
      event.stopPropagation();
      copyToClipboard(event.currentTarget, detail.content || '');
    });
    wireLlmCallCopyButtons(body, runId, calls);
  }

  function llmCallsHtml(runId, calls, artifact) {
    if (llmCalls.length === 0) return '';
    if (calls.length === 0) {
      return `<h4>Chamadas de LLM${artifact ? ` · ${escapeHtml(artifact)}` : ''}</h4><p class="empty-nav">Nenhuma chamada registrada ainda para este artefato.</p>`;
    }
    const lastIndex = calls.length - 1;
    return `
      <h4>Chamadas de LLM${artifact ? ` · ${escapeHtml(artifact)}` : ' · todo o projeto (sem status ao vivo pra filtrar por artefato)'}</h4>
      ${calls
        .map((entry, index) => {
          const costNote = callCostNote(entry);
          const openKey = `${runId}:${index}`;
          const open = llmOpenStates.has(openKey) ? llmOpenStates.get(openKey) : index === lastIndex;
          return `
          <details class="logs-step-group" data-open-key="${escapeAttribute(openKey)}" ${open ? 'open' : ''}>
            <summary>
              <strong>${escapeHtml(entry.backend || '—')}</strong>
              ${entry.artifact && !artifact ? `<small>${escapeHtml(entry.artifact)}</small>` : ''}
              <small>${entry.tokens_in ?? 0} → ${entry.tokens_out ?? 0} tokens${costNote}</small>
              <small>${escapeHtml(formatDate(entry.at))}</small>
            </summary>
            <div class="llm-call-body">
              <div class="llm-call-block">
                <div class="llm-call-block-head"><h5>Prompt enviado</h5><button class="button tertiary small" data-copy-call="${index}" data-copy-field="prompt">Copiar</button></div>
                <pre>${escapeHtml(entry.prompt || '')}</pre>
              </div>
              <div class="llm-call-block">
                <div class="llm-call-block-head"><h5>Resposta bruta</h5><button class="button tertiary small" data-copy-call="${index}" data-copy-field="response">Copiar</button></div>
                <pre>${escapeHtml(entry.response || '')}</pre>
              </div>
            </div>
          </details>
        `;
        })
        .join('')}
    `;
  }

  function wireLlmCallCopyButtons(root, runId, calls) {
    root.querySelectorAll('[data-open-key]').forEach((el) => {
      el.addEventListener('toggle', () => llmOpenStates.set(el.dataset.openKey, el.open));
      el.addEventListener('click', (event) => event.stopPropagation()); // não deixa o clique borbulhar até a <tr> e recolher a linha
    });
    root.querySelectorAll('[data-copy-call]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault(); // dentro de <summary> — sem isto o clique também alterna o accordion
        event.stopPropagation();
        const entry = calls[Number(button.dataset.copyCall)];
        copyToClipboard(button, entry?.[button.dataset.copyField] || '');
      });
    });
  }

  async function refreshAll() {
    refreshButton.disabled = true;
    try {
      const [entriesResult, llmCallsResult] = await Promise.allSettled([listProjectRunLogs(project.id), workItemPromptLog(project.id)]);
      if (entriesResult.status === 'fulfilled') entries = entriesResult.value;
      if (llmCallsResult.status === 'fulfilled') llmCalls = llmCallsResult.value || [];
      // Descarta o cache de detalhe — "Atualizar" deve trazer o log e as
      // chamadas mais recentes pra qualquer linha que estava aberta, não
      // repetir o que já tinha sido carregado antes do clique.
      detailCache.clear();
      if (entriesResult.status === 'rejected') {
        listEl.className = 'list-area';
        listEl.innerHTML = `<p class="doc-empty">Erro ao listar logs: ${escapeHtml(String(entriesResult.reason))}</p>`;
        return;
      }
      render();
      if (expandedRunId) await loadDetail(expandedRunId);
    } finally {
      refreshButton.disabled = false;
    }
  }

  refreshButton.addEventListener('click', refreshAll);

  await refreshAll();
}

// cssEscape: minimal escape for a runId used inside a CSS attribute
// selector (querySelector) — runIds are UUIDs from this app's own uuid.v7()
// (see work_item/actions.mh), never user-authored text, so this only ever
// needs to survive being *valid* CSS, not be a security boundary; kept
// local rather than pulling in the platform CSS.escape for one call site.
function cssEscape(value) {
  return value.replace(/["\\]/g, '\\$&');
}
