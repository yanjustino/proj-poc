// A dedicated screen for watching what mhl/the CLI agents (Devin/Codex/
// Claude) are actually doing during a run — separate from the work-item
// screen so it survives switching work-items/tabs and gives full width to
// raw log text. Exists because runs failing deep in an agent call (e.g. the
// Devin "unavailable" connection error) previously had no visible trace
// anywhere in the UI; mhl already retains this via mhl_run_logs
// (mhlbridge.Client.RunLogs / App.GetRunLogs), it just had no caller before
// this view.
import { listRuns, getRunLogs, getRunStatus, getRunProjectId, workItemPromptLog } from '../api.js';
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

// api.js's callWorkflowOnce fires a brand-new mhl_run_start for every
// WorkItem/ArtifactPreview action — including ones the user never asked to
// watch, like this same view's own ensureLlmCalls polling "prompt_log" every
// couple seconds while a real run is selected. Neither workflow ever calls
// an LLM (see callWorkflowOnce's own doc comment), so they never produce
// anything worth showing here; left unfiltered they showed up as a stream of
// noise sessions with just "step: Dispatch" → "step: PromptLog"/etc., no
// agent output at all. This view exists to watch Wiki/Discovery/Delivery
// (the only workflows started via startAndWatch), so anything else is
// dropped before it ever reaches the run list.
const INTERNAL_ONLY_TOOLS = new Set(['WorkItem', 'ArtifactPreview']);

function normalizeRunList(raw) {
  const runs = Array.isArray(raw) ? raw : raw && Array.isArray(raw.runs) ? raw.runs : [];
  return runs.filter((run) => !INTERNAL_ONLY_TOOLS.has(run.tool));
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
        <div class="logs-llm-calls" data-llm-calls hidden></div>
        <div class="logs-output" data-log-output></div>
      </div>
    </div>
  `;

  const runListEl = container.querySelector('[data-run-list]');
  const runMetaEl = container.querySelector('[data-run-meta]');
  const llmCallsEl = container.querySelector('[data-llm-calls]');
  const logOutputEl = container.querySelector('[data-log-output]');
  const copyButton = container.querySelector('[data-copy]');
  const clearButton = container.querySelector('[data-clear]');
  const refreshRunsButton = container.querySelector('[data-refresh-runs]');

  let runs = [];
  let selectedRunId = null;
  let logTimer = null;
  let autoScroll = true;

  function cacheFor(runId) {
    // `groups` is what actually renders now (one entry per step, see
    // pollLogsOnce) — `text` survives alongside it only because Copiar still
    // wants the whole thing as one flat string, and because a run's log
    // format from mhl itself isn't reliably delimited by step (so grouping
    // is inferred from mhl_run_status's own step/stepIndex, polled
    // alongside mhl_run_logs, not by parsing this text).
    //
    // projectId/artifact/llmCalls back the "Chamadas de LLM" panel (see
    // ensureLlmCalls) — mhl_run_logs itself never carries the prompt/
    // response/usage of a Writer.generate call (see workflows/shared/agents/
    // agents.mh's PromptLog), only step-transition/log() text, so that panel
    // reads a completely different source (WorkItem's own "prompt_log"
    // action) keyed by this run's project_id + artifact, not by runId.
    if (!logCache.has(runId)) {
      logCache.set(runId, {
        text: '',
        since: '',
        dropped: false,
        lastError: null,
        groups: [],
        projectId: null,
        artifact: null,
        llmCalls: [],
        llmCallsFetched: false,
        llmCallsFetchedAfterTerminal: false,
      });
    }
    return logCache.get(runId);
  }

  // ensureLlmCalls resolves this run's project_id (once, via
  // app.go's runProjects — best-effort, "" for a run this process didn't
  // start or that predates this feature) and, once mhl_run_status exposes
  // an artifact/current_artifact for it, fetches WorkItem's "prompt_log"
  // action and keeps only the entries matching that artifact. Fetched at
  // most twice per run — once as soon as the artifact is known, once more
  // when the run reaches a terminal state (catches an entry written right
  // as Writer.generate finished, which could otherwise land after the first
  // fetch) — not on every 1.5s tick.
  //
  // This is an artifact-scoped view, not a true per-run one: mhl gives a
  // workflow no way to read its own runId from inside the script (confirmed
  // — no such builtin exists), so "every prompt_log entry for this
  // project+artifact" is the closest available proxy. In practice a run
  // maps to exactly one artifact, so this reads as "this run" almost always
  // — but if the same artifact was regenerated in an earlier, different run,
  // its older entries show here too.
  async function ensureLlmCalls(runId, cache, runStatus) {
    if (cache.projectId == null) {
      cache.projectId = (await getRunProjectId(runId).catch(() => '')) || '';
    }
    const artifactKey = runStatus?.vars?.artifact ?? runStatus?.vars?.current_artifact ?? null;
    if (artifactKey) cache.artifact = artifactKey;
    if (!cache.projectId || !cache.artifact) return;

    const isTerminal = runStatus && ['completed', 'failed', 'canceled'].includes(runStatus.state);
    const shouldFetch = !cache.llmCallsFetched || (isTerminal && !cache.llmCallsFetchedAfterTerminal);
    if (!shouldFetch) return;
    try {
      const all = await workItemPromptLog(cache.projectId);
      cache.llmCalls = (all || []).filter((entry) => entry.artifact === cache.artifact);
      cache.llmCallsFetched = true;
      if (isTerminal) cache.llmCallsFetchedAfterTerminal = true;
    } catch {
      // Best-effort — mantém o que já tinha, tenta de novo no próximo tick.
    }
  }

  function renderLlmCalls() {
    const cache = cacheFor(selectedRunId);
    if (!cache.projectId || !cache.artifact) {
      llmCallsEl.hidden = true;
      llmCallsEl.innerHTML = '';
      return;
    }
    llmCallsEl.hidden = false;
    if (cache.llmCalls.length === 0) {
      llmCallsEl.innerHTML = `<h4>Chamadas de LLM · ${escapeHtml(cache.artifact)}</h4><p class="empty-nav">Nenhuma chamada registrada ainda.</p>`;
      return;
    }
    const lastIndex = cache.llmCalls.length - 1;
    llmCallsEl.innerHTML = `
      <h4>Chamadas de LLM · ${escapeHtml(cache.artifact)}</h4>
      ${cache.llmCalls
        .map((entry, index) => {
          const costNote = entry.cost_usd ? ` · US$ ${Number(entry.cost_usd).toFixed(4)}` : '';
          return `
          <details class="logs-step-group" ${index === lastIndex ? 'open' : ''}>
            <summary>
              <strong>${escapeHtml(entry.backend || '—')}</strong>
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
  }

  function currentGroup(cache) {
    return cache.groups[cache.groups.length - 1] || null;
  }

  // appendToGroup attributes newly-fetched log text to whichever step was
  // active when it arrived — starting a new group when the step changed
  // since the last poll (or none exists yet), otherwise appending to the
  // open one. `state` only ever moves a group toward a terminal outcome
  // (failed/canceled/completed) — a group already closed that way never gets
  // silently reopened as 'working' by a stale poll.
  function appendToGroup(cache, step, stepIndex, state, text) {
    let group = currentGroup(cache);
    const isTerminal = state === 'completed' || state === 'failed' || state === 'canceled';
    const stepChanged = !group || group.step !== step;
    if (stepChanged) {
      group = { step: step || 'execução', stepIndex, state, text: '' };
      cache.groups.push(group);
    }
    if (text) group.text += group.text ? '\n' + text : text;
    if (isTerminal) group.state = state;
    else if (!stepChanged) group.state = state;
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

  // renderGroups replaces the old flat <pre> dump with one <details> per
  // step (see appendToGroup) — a native disclosure widget covers "expandir"
  // for free, no bespoke toggle JS needed. Every group starts open except
  // ones that finished successfully before the run's own last (still-open)
  // group, so a long run reads top-to-bottom without the user having to
  // expand every finished step just to see what's currently running/failed.
  function renderGroups() {
    const cache = cacheFor(selectedRunId);
    const wasAtBottom = logOutputEl.scrollHeight - logOutputEl.scrollTop - logOutputEl.clientHeight < 24;
    if (cache.groups.length === 0) {
      logOutputEl.innerHTML = '<p class="empty-nav">(sem saída registrada ainda)</p>';
      return;
    }
    const lastIndex = cache.groups.length - 1;
    logOutputEl.innerHTML = cache.groups
      .map((group, index) => {
        const lineCount = group.text ? group.text.split('\n').length : 0;
        const open = index === lastIndex || group.state === 'failed';
        return `
          <details class="logs-step-group" ${open ? 'open' : ''}>
            <summary>
              <span class="status-dot ${dotClass(group.state)}"></span>
              <strong>${escapeHtml(group.step)}</strong>
              ${group.stepIndex ? `<small>passo ${group.stepIndex}</small>` : ''}
              <small>${lineCount} ${lineCount === 1 ? 'linha' : 'linhas'}</small>
            </summary>
            <pre>${escapeHtml(group.text || '(sem saída para este passo)')}</pre>
          </details>
        `;
      })
      .join('');
    if (autoScroll || wasAtBottom) {
      logOutputEl.scrollTop = logOutputEl.scrollHeight;
    }
  }

  async function pollLogsOnce() {
    if (!selectedRunId) return;
    const runId = selectedRunId;
    const cache = cacheFor(runId);
    try {
      const [result, runStatus] = await Promise.all([getRunLogs(runId, cache.since), getRunStatus(runId).catch(() => null)]);
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
      if (runStatus) {
        appendToGroup(cache, runStatus.step, runStatus.stepIndex, runStatus.state, result.text);
      } else if (result.text) {
        // Sem status disponível (ex.: chamada falhou) — ainda assim não
        // perde o texto novo, só não sabe atribuí-lo a um passo específico.
        appendToGroup(cache, currentGroup(cache)?.step, currentGroup(cache)?.stepIndex, currentGroup(cache)?.state, result.text);
      }
      await ensureLlmCalls(runId, cache, runStatus);
      if (runId !== selectedRunId) return;
      renderMeta();
      renderGroups();
      renderLlmCalls();
    } catch (err) {
      if (runId !== selectedRunId) return;
      // Não repete a mesma falha a cada 1.5s no corpo do log (viraria ruído
      // que engole a saída real) — só registra a primeira ocorrência de uma
      // falha nova; o cabeçalho (renderMeta) mostra que há um erro ativo.
      const message = String(err);
      if (cache.lastError !== message) {
        cache.lastError = message;
        const line = `[erro ao buscar logs: ${message}]`;
        cache.text += (cache.text ? '\n' : '') + line;
        appendToGroup(cache, 'erro ao atualizar', null, 'failed', line);
        renderGroups();
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
    renderGroups();
    renderLlmCalls();
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
    renderGroups();
    renderLlmCalls();
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
