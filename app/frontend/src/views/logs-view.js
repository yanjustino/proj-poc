// A dedicated screen for watching what mhl/the CLI agents (Devin/Codex/
// Claude) are actually doing during a run — separate from the work-item
// screen so it survives switching work-items/tabs and gives full width to
// raw log text. Exists because runs failing deep in an agent call (e.g. the
// Devin "unavailable" connection error) previously had no visible trace
// anywhere in the UI; mhl already retains this via mhl_run_logs
// (mhlbridge.Client.RunLogs / App.GetRunLogs), it just had no caller before
// this view.
import { listRuns, getRunLogs } from '../api.js';
import { dotClass } from '../status.js';
import { STATE_LABEL } from '../run-tracker.js';
import { icon } from '../icons.js';

const RUN_LIST_POLL_MS = 4000;
const LOG_POLL_MS = 1500;

// Session-scoped cache so switching between runs (or away from this screen
// and back) doesn't re-fetch/re-render log text already seen — mirrors
// active-runs.js's own reasoning for why this kind of state can't just live
// inside the view's closure.
const logCache = new Map(); // runId -> { text, since, dropped }

function normalizeRunList(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.runs)) return raw.runs;
  return [];
}

function runLabel(run) {
  return run.tool || run.workflow || run.name || 'run';
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return iso;
  }
}

export function renderLogsView(container) {
  container.innerHTML = `
    <div class="logs-view">
      <div class="logs-runs">
        <div class="logs-runs-head">
          <h3>Execuções</h3>
          <button class="icon-btn" data-refresh-runs aria-label="Atualizar lista" title="Atualizar lista">${icon('download', 14)}</button>
        </div>
        <div class="list logs-run-list" data-run-list><p class="empty-nav">Carregando…</p></div>
      </div>
      <div class="logs-panel">
        <div class="logs-panel-head">
          <div class="logs-panel-meta" data-run-meta>Selecione uma execução à esquerda.</div>
          <div class="demo-row">
            <button class="button tertiary small" data-copy disabled>Copiar</button>
            <button class="button tertiary small" data-clear disabled>Limpar tela</button>
          </div>
        </div>
        <pre class="logs-output" data-log-output></pre>
      </div>
    </div>
  `;

  const runListEl = container.querySelector('[data-run-list]');
  const runMetaEl = container.querySelector('[data-run-meta]');
  const logOutputEl = container.querySelector('[data-log-output]');
  const copyButton = container.querySelector('[data-copy]');
  const clearButton = container.querySelector('[data-clear]');
  const refreshRunsButton = container.querySelector('[data-refresh-runs]');

  let runs = [];
  let selectedRunId = null;
  let logTimer = null;
  let autoScroll = true;

  function cacheFor(runId) {
    if (!logCache.has(runId)) logCache.set(runId, { text: '', since: '', dropped: false, lastError: null });
    return logCache.get(runId);
  }

  function renderRunList() {
    if (runs.length === 0) {
      runListEl.innerHTML = '<p class="empty-nav">Nenhuma execução nesta sessão ainda.</p>';
      return;
    }
    runListEl.innerHTML = runs
      .map(
        (run) => `
        <button class="list-item ${run.runId === selectedRunId ? 'active' : ''}" data-run-id="${run.runId}">
          <span><strong>${escapeHtml(runLabel(run))}</strong><small>${escapeHtml(run.runId)} · ${escapeHtml(formatDate(run.startedAt))}</small></span>
          <span class="status-dot ${dotClass(run.state)}" title="${escapeHtml(STATE_LABEL[run.state] || run.state)}"></span>
        </button>
      `,
      )
      .join('');
    runListEl.querySelectorAll('[data-run-id]').forEach((button) => {
      button.addEventListener('click', () => selectRun(button.dataset.runId));
    });
  }

  async function refreshRunList({ autoSelect } = {}) {
    try {
      runs = normalizeRunList(await listRuns());
    } catch (err) {
      runListEl.innerHTML = `<p class="empty-nav">Erro ao listar execuções: ${escapeHtml(String(err))}</p>`;
      return;
    }
    // Mais recente primeiro quando a API traz startedAt; caso contrário
    // mantém a ordem original (não pinado a um formato de data específico).
    if (runs.every((run) => run.startedAt)) {
      runs = [...runs].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    }
    if (autoSelect && !selectedRunId && runs[0]) {
      selectedRunId = runs[0].runId;
    }
    renderRunList();
  }

  function renderMeta() {
    const run = runs.find((r) => r.runId === selectedRunId);
    if (!selectedRunId) {
      runMetaEl.textContent = 'Selecione uma execução à esquerda.';
      return;
    }
    const label = run ? `${runLabel(run)} · ${STATE_LABEL[run.state] || run.state}` : selectedRunId;
    const cache = cacheFor(selectedRunId);
    const droppedNote = cache.dropped ? ' · parte do log mais antigo foi descartada (retenção)' : '';
    const errorNote = cache.lastError ? ' · falha ao atualizar (tentando de novo…)' : '';
    runMetaEl.innerHTML = `<span class="status-dot ${run ? dotClass(run.state) : ''}"></span> <strong>${escapeHtml(label)}</strong><span class="logs-run-id">${escapeHtml(selectedRunId)}${droppedNote}${errorNote}</span>`;
  }

  function renderLogText() {
    const cache = cacheFor(selectedRunId);
    const wasAtBottom = logOutputEl.scrollHeight - logOutputEl.scrollTop - logOutputEl.clientHeight < 24;
    logOutputEl.textContent = cache.text || '(sem saída registrada ainda)';
    if (autoScroll || wasAtBottom) {
      logOutputEl.scrollTop = logOutputEl.scrollHeight;
    }
  }

  async function pollLogsOnce() {
    if (!selectedRunId) return;
    const runId = selectedRunId;
    const cache = cacheFor(runId);
    try {
      const result = await getRunLogs(runId, cache.since);
      if (runId !== selectedRunId) return; // usuário trocou de execução enquanto a chamada estava em voo
      if (result.text) cache.text += cache.text ? '\n' + result.text : result.text;
      // GetRunLogs (App.GetRunLogs) exige `since` como string; nextSince
      // volta como number do lado do mhl_run_logs — sem essa coerção, o
      // próximo poll manda um number de volta e o bridge Go rejeita com
      // "error parsing arguments: json: cannot unmarshal number into Go
      // value of type string", em loop a cada tick.
      if (result.nextSince != null) cache.since = String(result.nextSince);
      if (result.dropped) cache.dropped = true;
      cache.lastError = null;
      renderMeta();
      renderLogText();
    } catch (err) {
      if (runId !== selectedRunId) return;
      // Não repete a mesma falha a cada 1.5s no corpo do log (viraria ruído
      // que engole a saída real) — só registra a primeira ocorrência de uma
      // falha nova; o cabeçalho (renderMeta) mostra que há um erro ativo.
      const message = String(err);
      if (cache.lastError !== message) {
        cache.lastError = message;
        cache.text += (cache.text ? '\n' : '') + `[erro ao buscar logs: ${message}]`;
        renderLogText();
      }
      renderMeta();
    }
  }

  function stopLogPolling() {
    if (logTimer) {
      clearInterval(logTimer);
      logTimer = null;
    }
  }

  function startLogPolling() {
    stopLogPolling();
    pollLogsOnce();
    logTimer = setInterval(pollLogsOnce, LOG_POLL_MS);
  }

  function selectRun(runId) {
    selectedRunId = runId;
    copyButton.disabled = false;
    clearButton.disabled = false;
    renderRunList();
    renderMeta();
    renderLogText();
    startLogPolling();
  }

  logOutputEl.addEventListener('scroll', () => {
    autoScroll = logOutputEl.scrollHeight - logOutputEl.scrollTop - logOutputEl.clientHeight < 24;
  });

  refreshRunsButton.addEventListener('click', () => refreshRunList());

  copyButton.addEventListener('click', async () => {
    if (!selectedRunId) return;
    const text = cacheFor(selectedRunId).text;
    try {
      await navigator.clipboard.writeText(text);
      copyButton.textContent = 'Copiado!';
      setTimeout(() => {
        copyButton.textContent = 'Copiar';
      }, 1500);
    } catch {
      // Sem permissão de clipboard: o texto continua selecionável na tela.
    }
  });

  clearButton.addEventListener('click', () => {
    if (!selectedRunId) return;
    logCache.delete(selectedRunId);
    renderLogText();
  });

  const runListTimer = setInterval(() => refreshRunList(), RUN_LIST_POLL_MS);
  refreshRunList({ autoSelect: true }).then(() => {
    if (selectedRunId) selectRun(selectedRunId);
  });

  return function dispose() {
    clearInterval(runListTimer);
    stopLogPolling();
  };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}
