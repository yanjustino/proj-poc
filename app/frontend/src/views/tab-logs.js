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
import { listProjectRunLogs, getPersistedRunLogs, getRunStatus, workItemPromptLog } from '../api.js';
import { dotClass } from '../status.js';
import { STATE_LABEL } from '../run-tracker.js';
import { icon } from '../icons.js';

const LIST_POLL_MS = 5000;
const CONTENT_POLL_MS = 2500;
// LLM calls come from a separate source (prompt_log.jsonl, via the WorkItem
// workflow's own "prompt_log" action — see workItemPromptLog) than the
// run_logs/ step trace above, and fetching it spins up a real mhl_run_start
// under the hood (see workItemPromptLog's own doc comment) — cheap, but not
// free the way a plain array read would be, so this polls on its own much
// slower cadence instead of piggybacking on LIST_POLL_MS/CONTENT_POLL_MS.
const LLM_CALLS_POLL_MS = 8000;

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

export async function renderLogsTab(container, project) {
  container.innerHTML = `
    <div class="project-logs">
      <div class="logs-runs project-logs-runs">
        <div class="logs-runs-head">
          <h3>Execuções</h3>
          <button class="icon-btn" data-refresh aria-label="Atualizar lista" title="Atualizar lista">${icon('download', 14)}</button>
        </div>
        <div class="list logs-run-list" data-run-list><p class="empty-nav">Carregando…</p></div>
      </div>
      <div class="logs-panel project-logs-panel">
        <div class="logs-panel-head">
          <div class="logs-panel-meta" data-meta>Selecione uma execução à esquerda.</div>
          <button class="button tertiary small" data-copy disabled>Copiar</button>
        </div>
        <div class="logs-llm-calls" data-llm-calls hidden></div>
        <pre class="logs-output project-logs-output" data-content></pre>
      </div>
    </div>
  `;

  const runListEl = container.querySelector('[data-run-list]');
  const metaEl = container.querySelector('[data-meta]');
  const contentEl = container.querySelector('[data-content]');
  const llmCallsEl = container.querySelector('[data-llm-calls]');
  const copyButton = container.querySelector('[data-copy]');
  const refreshButton = container.querySelector('[data-refresh]');

  let entries = [];
  let selectedRunId = null;
  // liveStatus: best-effort mhl_run_status for whichever entry is selected —
  // present only while this process's own mhl session still knows about
  // that runId (a run it started this session, still active or recently
  // finished). null for anything older or from a past session; the entry
  // still reads fine from disk either way, it just shows no status dot.
  let liveStatus = null;
  let statusExhausted = false; // stop asking once we've confirmed mhl doesn't know this run
  let listTimer = null;
  let contentTimer = null;
  let llmCallsTimer = null;
  let lastContentLength = -1;
  // llmCalls: every prompt/response call recorded for the WHOLE project
  // (workItemPromptLog has no runId to filter by — see that function's own
  // doc comment), oldest first as the API returns it. Filtered down to the
  // selected run's own artifact when liveStatus happens to know one (same
  // best-effort proxy logs-view.js's ensureLlmCalls uses); shown unfiltered
  // otherwise, which is still correct — just less precise — for an old run
  // mhl no longer tracks.
  let llmCalls = [];
  const llmOpenStates = new Map(); // índice -> aberto/fechado, sobrevive a um re-render (ver applyOpenOverrides)

  function renderList() {
    if (entries.length === 0) {
      runListEl.innerHTML = '<p class="empty-nav">Nenhum log registrado ainda para este work-item.</p>';
      return;
    }
    runListEl.innerHTML = entries
      .map(
        (entry) => `
        <button class="list-item ${entry.runId === selectedRunId ? 'active' : ''}" data-run-id="${escapeHtml(entry.runId)}">
          <span><strong>${escapeHtml(formatDate(entry.modifiedAt))}</strong><small>${escapeHtml(entry.runId)} · ${formatSize(entry.sizeBytes)}</small></span>
        </button>
      `,
      )
      .join('');
    runListEl.querySelectorAll('[data-run-id]').forEach((button) => {
      button.addEventListener('click', () => selectRun(button.dataset.runId));
    });
  }

  function renderMeta() {
    if (!selectedRunId) {
      metaEl.textContent = 'Selecione uma execução à esquerda.';
      return;
    }
    const entry = entries.find((e) => e.runId === selectedRunId);
    const dot = liveStatus ? `<span class="status-dot ${dotClass(liveStatus.state)}" title="${escapeHtml(STATE_LABEL[liveStatus.state] || liveStatus.state)}"></span>` : '';
    const when = entry ? formatDate(entry.modifiedAt) : '';
    metaEl.innerHTML = `${dot}<strong>${escapeHtml(selectedRunId)}</strong><span class="logs-run-id">${escapeHtml(when)}</span>`;
  }

  // applyOpenOverrides/openAttr: same "remember what the reader toggled by
  // hand across a rebuild" pattern as logs-view.js's own versions (not
  // shared — that file doesn't export them, and this tab's needs are
  // simple enough not to justify pulling them into a shared module for
  // one caller).
  function applyOpenOverrides(root) {
    root.querySelectorAll('details').forEach((el, index) => {
      el.addEventListener('toggle', () => llmOpenStates.set(index, el.open));
    });
  }

  function openAttr(index, defaultOpen) {
    const open = llmOpenStates.has(index) ? llmOpenStates.get(index) : defaultOpen;
    return open ? 'open' : '';
  }

  // artifactFilter resolves which artifact (if any) to narrow llmCalls
  // down to, from the selected entry's best-effort liveStatus.
  function artifactFilter() {
    const vars = liveStatus?.vars || {};
    return vars.artifact ?? vars.current_artifact ?? null;
  }

  function renderLlmCalls() {
    if (llmCalls.length === 0) {
      llmCallsEl.hidden = true;
      llmCallsEl.innerHTML = '';
      return;
    }
    const artifact = artifactFilter();
    const calls = artifact ? llmCalls.filter((entry) => entry.artifact === artifact) : llmCalls;
    llmCallsEl.hidden = false;
    if (calls.length === 0) {
      llmCallsEl.innerHTML = `<h4>Chamadas de LLM${artifact ? ` · ${escapeHtml(artifact)}` : ''}</h4><p class="empty-nav">Nenhuma chamada registrada ainda para este artefato.</p>`;
      return;
    }
    const lastIndex = calls.length - 1;
    llmCallsEl.innerHTML = `
      <h4>Chamadas de LLM${artifact ? ` · ${escapeHtml(artifact)}` : ' · todo o projeto'}</h4>
      ${calls
        .map((entry, index) => {
          const costNote = entry.cost_usd ? ` · US$ ${Number(entry.cost_usd).toFixed(4)}` : '';
          return `
          <details class="logs-step-group" ${openAttr(index, index === lastIndex)}>
            <summary>
              <strong>${escapeHtml(entry.backend || '—')}</strong>
              ${entry.artifact && !artifact ? `<small>${escapeHtml(entry.artifact)}</small>` : ''}
              <small>${entry.tokens_in ?? 0} → ${entry.tokens_out ?? 0} tokens${costNote}</small>
              <small>${escapeHtml(formatDate(entry.at))}</small>
            </summary>
            <div class="llm-call-body">
              <div class="llm-call-block"><h5>Prompt enviado</h5><pre>${escapeHtml(entry.prompt || '')}</pre></div>
              <div class="llm-call-block"><h5>Resposta bruta</h5><pre>${escapeHtml(entry.response || '')}</pre></div>
            </div>
          </details>
        `;
        })
        .join('')}
    `;
    applyOpenOverrides(llmCallsEl);
  }

  async function refreshLlmCalls() {
    try {
      llmCalls = (await workItemPromptLog(project.id)) || [];
    } catch {
      // Best-effort — mantém o que já tinha, tenta de novo no próximo tick.
      return;
    }
    renderLlmCalls();
  }

  async function refreshList({ autoSelect } = {}) {
    try {
      entries = await listProjectRunLogs(project.id);
    } catch (err) {
      runListEl.innerHTML = `<p class="empty-nav">Erro ao listar logs: ${escapeHtml(String(err))}</p>`;
      return;
    }
    if (autoSelect && !selectedRunId && entries[0]) {
      selectRun(entries[0].runId);
      return; // selectRun already re-renders the list
    }
    renderList();
  }

  async function pollContentOnce() {
    if (!selectedRunId) return;
    const runId = selectedRunId;
    try {
      const text = await getPersistedRunLogs(project.id, runId);
      if (runId !== selectedRunId) return; // trocou de execução durante a chamada
      if (text.length !== lastContentLength) {
        lastContentLength = text.length;
        contentEl.textContent = text || '(sem saída registrada)';
        contentEl.scrollTop = contentEl.scrollHeight;
      }
    } catch {
      // Best-effort — mantém o que já tinha na tela, tenta de novo no
      // próximo tick.
    }
    if (!statusExhausted) {
      try {
        const status = await getRunStatus(runId);
        if (runId !== selectedRunId) return;
        liveStatus = status;
        if (status.state !== 'working' && status.state !== 'queued') statusExhausted = true;
      } catch {
        // mhl não conhece mais este runId (sessão antiga, ou execução de
        // antes do último restart) — sem status ao vivo, sem problema, o
        // conteúdo persistido continua acessível normalmente.
        liveStatus = null;
        statusExhausted = true;
      }
      renderMeta();
      renderLlmCalls(); // a filtragem por artefato depende de liveStatus — ver artifactFilter
    }
  }

  function stopContentPolling() {
    if (contentTimer) {
      clearInterval(contentTimer);
      contentTimer = null;
    }
  }

  function startContentPolling() {
    stopContentPolling();
    pollContentOnce();
    contentTimer = setInterval(pollContentOnce, CONTENT_POLL_MS);
  }

  function selectRun(runId) {
    selectedRunId = runId;
    liveStatus = null;
    statusExhausted = false;
    lastContentLength = -1;
    contentEl.textContent = 'Carregando…';
    copyButton.disabled = false;
    renderList();
    renderMeta();
    renderLlmCalls(); // liveStatus acabou de zerar — volta a mostrar tudo até um novo status chegar
    startContentPolling();
  }

  refreshButton.addEventListener('click', () => refreshList());

  copyButton.addEventListener('click', async () => {
    if (!selectedRunId) return;
    try {
      await navigator.clipboard.writeText(contentEl.textContent);
      copyButton.textContent = 'Copiado!';
      setTimeout(() => {
        copyButton.textContent = 'Copiar';
      }, 1500);
    } catch {
      // Sem permissão de clipboard: o texto continua selecionável na tela.
    }
  });

  await refreshList({ autoSelect: true });
  listTimer = setInterval(() => refreshList(), LIST_POLL_MS);

  refreshLlmCalls();
  llmCallsTimer = setInterval(refreshLlmCalls, LLM_CALLS_POLL_MS);

  return function dispose() {
    if (listTimer) clearInterval(listTimer);
    if (llmCallsTimer) clearInterval(llmCallsTimer);
    stopContentPolling();
  };
}
