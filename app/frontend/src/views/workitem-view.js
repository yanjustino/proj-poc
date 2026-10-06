import { listProjectDir, workItemUsage, workItemProductivity, listIngestedRaw, getRunStatus } from '../api.js';
import { computeCategoryProgress } from '../artifacts.js';
import { renderFontesTab } from './tab-fontes.js';
import { renderWikiTab } from './tab-wiki.js';
import { renderArtefatosTab } from './tab-artefatos.js';
import { perfStart, perfLog } from '../perf-log.js';
import { renderLogsTab } from './tab-logs.js';
import { renderMudancasTab } from './tab-mudancas.js';
import { showEmpty as showEmptyReadingPane } from '../reading-pane.js';
import { openConfirmDeleteModal } from './confirm-delete-modal.js';
import { listActiveRunsForProject } from '../active-runs.js';
import { llmJobsForProject, subscribeLlmJobs } from '../llm-queue.js';
import { ingestQueueSnapshot, subscribeIngestQueue } from '../ingest-queue.js';
import { STATE_LABEL } from '../run-tracker.js';
import { dotClass } from '../status.js';
import { icon } from '../icons.js';
import { summarizeCost } from '../cost.js';
import { formatDurationShort, formatRelativeTime } from '../time-format.js';
import { LogFrontendError } from '../../wailsjs/go/main/App';

const LEVEL_LABEL = { discovery: 'Oportunidade · Discovery', delivery: 'Feature/Enabler/História · Delivery' };

// renderWorkItemView mounts the hero + summary cards + tab switcher for one
// work-item into `container`. `initialTab` lets the "criar work-item" flow
// land straight on Fontes instead of the default Artefatos tab. `onDeleted`
// is called once the user confirms deletion and App.DeleteProject actually
// succeeds — the shell owns navigating back to the list and refreshing the
// sidebar, since this view has no access to either.
// productivityCardHtml: "quanto esforço este work-item já custou e quão
// rápido os artefatos passam pela revisão" — tempo de processamento (soma da
// duração de cada chamada de LLM), ciclo médio de um artefato (geração até
// aprovação, com as rodadas de ajuste), espera média pela revisão humana e
// aprovações de primeira. Métricas só existem a partir dos registros que
// as alimentam (duração em usage.jsonl, eventos em activity.jsonl): um
// work-item mais antigo mostra "—" em vez de um zero enganoso, e o tooltip
// avisa quando só parte das chamadas tem duração registrada.
// failureNote: null when the source refreshed fine; otherwise what to tell
// the person — whether the card is showing an older reading or nothing at
// all — plus the real error (tooltip), which is also written to app.log.
// The reason used to be a fixed "o servidor mhl não respondeu", shown even
// when mhl was answering fine and the call had failed for another reason.
function failureNote(result, lastGood, what) {
  if (result.status !== 'rejected') return null;
  const reason = String(result.reason?.message || result.reason || 'erro desconhecido');
  LogFrontendError(`resumo do projeto: falha ao atualizar ${what}: ${reason}`).catch(() => {});
  return {
    text: lastGood ? 'não atualizado — mostrando a última leitura' : 'indisponível no momento',
    reason,
  };
}

// LOADING_NOTE: what a mhl-backed source shows while the mhl bridge is
// still starting (about 5s on a cold app start) — the summary paints from
// disk first and fills these in once mhl answers (refreshSummary).
const LOADING_NOTE = { text: 'carregando…', reason: 'Aguardando o mhl iniciar', loading: true };

function failureRowHtml(failure) {
  if (!failure) return '';
  return `<div class="summary-tokens-row summary-unavailable" title="${escapeHtml(failure.reason)}">${icon(failure.loading ? 'clock' : 'alertCircle', 13)}<span>${escapeHtml(failure.text)}</span></div>`;
}

function productivityCardHtml(p, failure = null) {
  const hasTiming = p && p.timed_calls > 0;
  const hasCycles = p && p.cycle_samples > 0;
  const hasReviews = p && p.review_samples > 0;
  const partial = p && p.timed_calls > 0 && p.timed_calls < p.total_calls;
  const title = !p
    ? 'Métricas indisponíveis'
    : [
        partial ? `Tempo de processamento cobre ${p.timed_calls} de ${p.total_calls} chamadas — as anteriores ao registro de duração ficam de fora.` : null,
        hasReviews ? `Média de ${p.avg_rounds.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} rascunho(s) por aprovação.` : null,
        p.approved_count ? `${p.approved_count} aprovação(ões) registrada(s).` : null,
      ]
        .filter(Boolean)
        .join(' ') || 'Sem aprovações registradas ainda';
  const firstPass = hasReviews ? `${Math.round((p.first_pass_count / p.review_samples) * 100)}%` : '—';
  return `
    <div class="summary-card summary-card-progress summary-card-tokens" title="${escapeHtml(title)}">
      <div class="summary-progress-head">
        <span class="summary-icon">${icon('zap', 16)}</span>
        <div><b>Produtividade</b></div>
      </div>
      <div class="summary-tokens-stack">
        <div class="summary-tokens-row">${icon('clock', 13)}<b>${hasTiming ? formatDurationShort(p.processing_seconds) : '—'}</b><span>tempo de processamento${partial ? '*' : ''}</span></div>
        <div class="summary-tokens-row">${icon('refreshCw', 13)}<b>${hasCycles ? formatDurationShort(p.avg_cycle_seconds) : '—'}</b><span>ciclo médio até aprovação</span></div>
        <div class="summary-tokens-row">${icon('eye', 13)}<b>${hasReviews ? formatDurationShort(p.avg_review_seconds) : '—'}</b><span>espera média pela revisão</span></div>
        <div class="summary-tokens-row">${icon('checkCircle', 13)}<b>${firstPass}</b><span>aprovados de primeira</span></div>
        ${failureRowHtml(failure)}
      </div>
    </div>
  `;
}

export async function renderWorkItemView(container, project, { initialTab = 'artefatos', onDeleted } = {}) {
  container.innerHTML = `
    <div class="hero">
      <div>
        <div class="eyebrow">${LEVEL_LABEL[project.level] || project.level}</div>
        <h1>${escapeHtml(project.name)}</h1>
        <p>${formatDate(project.created_at)} · ${escapeHtml(project.id)}</p>
        ${project.continuidade_de ? `<p class="hero-continuidade">Continuidade de: ${escapeHtml(project.continuidade_de)}</p>` : ''}
      </div>
      <div class="hero-actions">
        <div class="token-pill" data-token-pill hidden></div>
        <button class="icon-btn" aria-label="Excluir work-item" title="Excluir work-item" data-delete>${icon('trash', 15)}</button>
      </div>
    </div>
    <div class="summary" data-summary></div>
    <div class="tabs">
      <button class="tab-btn" data-tab="fontes">Fontes</button>
      <button class="tab-btn" data-tab="wiki">Wiki</button>
      <button class="tab-btn" data-tab="artefatos">Artefatos</button>
      <button class="tab-btn" data-tab="mudancas">Mudanças</button>
      <button class="tab-btn" data-tab="logs">Logs</button>
    </div>
    <div data-tab-content></div>
  `;

  const summaryEl = container.querySelector('[data-summary]');
  const tokenPillEl = container.querySelector('[data-token-pill]');
  const tabContent = container.querySelector('[data-tab-content]');
  const tabButtons = [...container.querySelectorAll('.tab-btn')];

  container.querySelector('[data-delete]').addEventListener('click', async () => {
    const deleted = await openConfirmDeleteModal(project);
    if (deleted) await onDeleted?.();
  });

  // pipelineStage resolves "what's actually happening right now" for this
  // work-item from every place a run can be: the app's own queues (a
  // generation waiting for an LLM slot, a source waiting to be ingested —
  // neither has a runId yet) and active-runs.js's registry (every run
  // started, from any tab, surviving remounts and restarts). A paused run is
  // the most actionable state (someone needs to look at it), so it wins over
  // a working/queued one; a registry entry mhl no longer knows about fails
  // GetRunStatus and is dropped here — clearing it is the owning tab's job.
  async function pipelineStage() {
    const live = [];
    const seenRunIds = new Set();
    for (const { key, status } of llmJobsForProject(project.id)) {
      if (status.runId) seenRunIds.add(status.runId);
      if (status.state === 'working' || status.state === 'queued') {
        live.push({ state: status.state, artifact: status.vars?.artifact || key.slice(project.id.length + 1) });
      }
    }
    const ingest = ingestQueueSnapshot(project.id);
    if (ingest.running) {
      if (ingest.running.status?.runId) seenRunIds.add(ingest.running.status.runId);
      live.push({ state: 'working', artifact: `ingest:${ingest.running.name}` });
    }
    ingest.queued.forEach((name) => live.push({ state: 'queued', artifact: `ingest:${name}` }));

    const entries = listActiveRunsForProject(project.id).filter(({ runId }) => !seenRunIds.has(runId));
    const statuses = await Promise.all(
      entries.map(({ runId }) =>
        getRunStatus(runId)
          .then((status) => (status.state === 'working' || status.state === 'queued' || status.state === 'paused' ? status : null))
          .catch(() => null),
      ),
    );
    // status.vars is already a plain object here — getRunStatus parses it.
    for (const status of statuses.filter(Boolean)) {
      const vars = status.vars || {};
      live.push({ state: status.state, artifact: vars.artifact || vars.current_artifact || null });
    }
    if (live.length === 0) return { state: null, count: 0 };
    const paused = live.filter((s) => s.state === 'paused');
    const working = live.filter((s) => s.state === 'working');
    const group = paused.length ? paused : working.length ? working : live;
    return { state: group[0].state, count: group.length, artifact: stageArtifactLabel(group[0].artifact) };
  }

  // The stage card on its own: refreshed live (queue notifications plus a
  // short poll for transitions only mhl sees, like a resumed review) without
  // re-running the summary's mhl queries.
  async function refreshStage() {
    const card = summaryEl.querySelector('[data-goto-artefatos]');
    if (!card || !container.isConnected) return;
    const stage = await pipelineStage();
    const { label, sub } = stageText(stage);
    card.className = `summary-card summary-card-progress summary-card-clickable ${stage.state ? `summary-card-stage-${dotClass(stage.state)}` : ''}`;
    card.querySelector('[data-stage-head]').innerHTML = `<b>${escapeHtml(label)}</b><span>${escapeHtml(sub)}</span>`;
  }

  let stageTimer = null;
  function scheduleStage() {
    clearTimeout(stageTimer);
    stageTimer = setTimeout(() => refreshStage().catch(() => {}), 250);
  }
  const unsubscribeLlm = subscribeLlmJobs((key) => {
    if (key.startsWith(`${project.id}:`)) scheduleStage();
  });
  const unsubscribeIngest = subscribeIngestQueue(project.id, scheduleStage);
  const stagePoll = setInterval(() => refreshStage().catch(() => {}), STAGE_POLL_MS);

  // Last successful reading of each mhl-backed source, for this work-item.
  // A failed refresh keeps showing these (flagged as not refreshed) instead
  // of wiping the card — a single transient failure used to blank both
  // cards until the next refresh happened to succeed.
  let lastUsage = null;
  let lastProductivity = null;

  // refreshSummary paints in two passes. Each source fails on its own (a
  // single Promise.all used to drop even the local numbers to zero when mhl
  // was down). The local sources (Go file reads) are fast; usage,
  // productivity and the pipeline stage go through mhl, whose bridge takes
  // ~5s to start on a cold app launch — waiting for them used to hold the
  // whole project screen. Now the summary paints from disk first (mhl cards
  // "carregando…") and repaints once mhl answers; a bridge that's already
  // warm answers within REMOTE_GRACE_MS, so the common case paints once.
  // `summaryVersion` drops a stale pass when refreshes overlap.
  const REMOTE_GRACE_MS = 120;
  let summaryVersion = 0;
  async function refreshSummary() {
    const version = ++summaryVersion;
    const localPromise = Promise.allSettled([
      listProjectDir(project.id, 'artifacts', ''),
      listProjectDir(project.id, 'raw', ''),
      listIngestedRaw(project.id),
    ]);
    const remotePromise = Promise.allSettled([workItemUsage(project.id), pipelineStage(), workItemProductivity(project.id)]);
    const local = await localPromise;
    const quick = await Promise.race([remotePromise, new Promise((resolve) => setTimeout(() => resolve(null), REMOTE_GRACE_MS))]);
    if (!quick) {
      if (version !== summaryVersion || !container.isConnected) return;
      paintSummary(local, null);
    }
    const remote = quick ?? (await remotePromise);
    if (version !== summaryVersion || !container.isConnected) return;
    paintSummary(local, remote);
  }

  // paintSummary: `remote` null means mhl hasn't answered yet — the last
  // good reading (if any) or a "carregando…" note stands in for it.
  function paintSummary(local, remote) {
    const emptyUsage = { total_tokens_in: 0, total_tokens_out: 0, total_cache_creation_tokens: 0, total_cache_read_tokens: 0, total_cost_usd: 0 };
    const valueOf = (results, i, fallback) => (results[i].status === 'fulfilled' ? results[i].value : fallback);
    const artifactNodes = valueOf(local, 0, []);
    const rawNodes = valueOf(local, 1, []);
    const ingestedNames = valueOf(local, 2, []);
    let stage = remote ? valueOf(remote, 1, { state: null, count: 0 }) : null;
    let usageFailure = null;
    let productivityFailure = null;
    if (remote) {
      if (remote[0].status === 'fulfilled') lastUsage = remote[0].value;
      if (remote[2].status === 'fulfilled') lastProductivity = remote[2].value;
      usageFailure = failureNote(remote[0], lastUsage, 'uso de tokens');
      productivityFailure = failureNote(remote[2], lastProductivity, 'produtividade');
    } else {
      if (!lastUsage) usageFailure = LOADING_NOTE;
      if (!lastProductivity) productivityFailure = LOADING_NOTE;
    }
    const usage = lastUsage ?? emptyUsage;
    const productivity = lastProductivity;

    const { byCategory, doneCount, totalCount } = computeCategoryProgress(project, artifactNodes);

    const tokensIn = usage.total_tokens_in || 0;
    const tokensOut = usage.total_tokens_out || 0;
    // Cache tokens (Claude: cache_creation + cache_read; Codex: cache_write
    // + cache_read; Devin ATIF: cache_read only) are a SUBSET of tokensIn,
    // never added on top — see workItemUsage's own summarize_usage in
    // actions.mh. cacheRead specifically is the part of that input that was
    // served from cache instead of freshly reprocessed, so cacheRead /
    // tokensIn reads as "how much of the input came from cache". It remains
    // a token share rather than a dollar claim because a project can contain
    // calls from different backends and pricing sources.
    const cacheCreation = usage.total_cache_creation_tokens || 0;
    const cacheRead = usage.total_cache_read_tokens || 0;
    const totalCache = cacheCreation + cacheRead;
    const cost = summarizeCost(usage);
    const cacheSharePct = tokensIn > 0 ? Math.round((cacheRead / tokensIn) * 100) : 0;
    // The pill shows cache share, input, output and cost; its tooltip adds
    // the cache creation/read split.
    const tokensTitle =
      [
        totalCache > 0 ? `${cacheCreation.toLocaleString('pt-BR')} tokens de criação de cache` : null,
        totalCache > 0 ? `${cacheRead.toLocaleString('pt-BR')} tokens lidos do cache` : null,
      ]
        .filter(Boolean)
        .join(' · ') || 'Sem uso de cache registrado ainda';

    const ingestedCount = rawNodes.filter((n) => ingestedNames.includes(n.name)).length;
    const lastActivity = productivity?.last_activity_at ? formatRelativeTime(Date.parse(productivity.last_activity_at)) : '—';

    const { label: stageLabel, sub: stageSub } = stage ? stageText(stage) : { label: 'Carregando…', sub: 'aguardando o mhl iniciar' };
    stage = stage ?? { state: null, count: 0 };

    summaryEl.innerHTML = `
      <div class="summary-card summary-card-progress">
        <div class="summary-progress-head">
          <span class="summary-icon">${icon('checkCircle', 16)}</span>
          <div><b>${doneCount} de ${totalCount}</b><span>artefatos prontos</span></div>
        </div>
        <div class="summary-progress-bars">
          ${byCategory
            .map((c) => {
              const barPct = c.total ? Math.round((c.done / c.total) * 100) : 0;
              return `
                <div class="summary-progress-row">
                  <span class="summary-progress-label" title="${escapeHtml(c.category)}">${escapeHtml(c.category)}</span>
                  <span class="summary-progress-bar"><i style="width:${barPct}%"></i></span>
                  <span class="summary-progress-count">${c.done}/${c.total}</span>
                </div>
              `;
            })
            .join('')}
        </div>
      </div>
      <div class="summary-card summary-card-progress summary-card-clickable ${stage.state ? `summary-card-stage-${dotClass(stage.state)}` : ''}" data-goto-artefatos title="Ver na aba Artefatos">
        <div class="summary-progress-head">
          <span class="summary-icon">${icon('clock', 16)}</span>
          <div data-stage-head><b>${escapeHtml(stageLabel)}</b><span>${escapeHtml(stageSub)}</span></div>
        </div>
        <div class="summary-tokens-stack">
          <div class="summary-tokens-row">${icon('inbox', 13)}<b>${ingestedCount} de ${rawNodes.length}</b><span>fontes ingeridas</span></div>
          <div class="summary-tokens-row">${icon('refreshCw', 13)}<b>${productivity ? productivity.change_requests : remote ? 0 : '…'}</b><span>pedidos de mudança</span></div>
          <div class="summary-tokens-row">${icon('zap', 13)}<b>${escapeHtml(lastActivity)}</b><span>última atividade</span></div>
        </div>
      </div>
      ${productivityCardHtml(productivity, productivityFailure)}
    `;

    // Token usage lives only in this hero pill (it replaced the "Uso de
    // tokens" summary card): cache share, input, output, cost.
    // Nothing to show until mhl answers once — a row of zeros would read as
    // "this project never used any tokens".
    tokenPillEl.hidden = !lastUsage && !remote;
    tokenPillEl.title = `${tokensTitle} · US$: ${cost.label}${usageFailure ? ` · ${usageFailure.text}` : ''}`;
    tokenPillEl.classList.toggle('token-pill-stale', Boolean(usageFailure));
    tokenPillEl.innerHTML = `
      <span class="token-pill-label">Tokens</span>
      <span class="token-pill-group">
        <span class="token-pill-item" aria-label="do input veio do cache">${icon('gauge', 13)}${cacheSharePct}%</span>
        <span class="token-pill-sep"></span>
        <span class="token-pill-item" aria-label="tokens de entrada">${icon('arrowDown', 13)}${tokensIn.toLocaleString('pt-BR')}</span>
        <span class="token-pill-sep"></span>
        <span class="token-pill-item" aria-label="tokens de saída">${icon('arrowUp', 13)}${tokensOut.toLocaleString('pt-BR')}</span>
        <span class="token-pill-sep"></span>
        <span class="token-pill-item" aria-label="${escapeHtml(cost.label)}">${icon('dollarSign', 13)}${escapeHtml(cost.value)}</span>
      </span>
    `;

    const stageCard = summaryEl.querySelector('[data-goto-artefatos]');
    if (stageCard) stageCard.addEventListener('click', () => showTab('artefatos'));
  }

  // A tab (Artefatos or Wiki) may leave background work running past its
  // own mount — a generation or a wiki question that keeps writing into the
  // shared reading pane once it resolves (see those files' `active` flag).
  // disposeTab() tells the outgoing tab its writes should stop landing,
  // before the next tab (or this whole view, via the dispose this function
  // returns) takes over the pane.
  let disposeTab = null;

  async function showTab(tab) {
    disposeTab?.();
    disposeTab = null;
    tabButtons.forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
    const handlers = { onChanged: refreshSummary };
    if (tab === 'fontes') {
      showEmptyReadingPane('A aba Fontes não usa a coluna de leitura — envie arquivos aqui ao lado.');
      disposeTab = await renderFontesTab(tabContent, project, handlers);
    } else if (tab === 'wiki') {
      disposeTab = await renderWikiTab(tabContent, project);
    } else if (tab === 'logs') {
      showEmptyReadingPane('A aba Logs não usa a coluna de leitura — o painel de execuções fica aqui ao lado.');
      disposeTab = await renderLogsTab(tabContent, project);
    } else if (tab === 'mudancas') {
      showEmptyReadingPane('A aba Mudanças não usa a coluna de leitura — o histórico de pedidos fica aqui ao lado.');
      disposeTab = await renderMudancasTab(tabContent, project);
    } else {
      disposeTab = await renderArtefatosTab(tabContent, project, handlers);
    }
  }

  tabButtons.forEach((button) => {
    button.addEventListener('click', () => showTab(button.dataset.tab));
  });

  // The summary is not awaited: the tab only needs disk reads, and holding it
  // behind the summary's mhl queries is what made a project take ~5s to open
  // while the mhl bridge was still starting.
  const perfMount = perfStart();
  refreshSummary()
    .then(() => perfLog(`workitem ${project.id} summary (mhl)`, perfMount))
    .catch(() => {});
  await showTab(initialTab);
  perfLog(`workitem ${project.id} TOTAL (tab ${initialTab})`, perfMount);

  return () => {
    disposeTab?.();
    clearInterval(stagePoll);
    clearTimeout(stageTimer);
    unsubscribeLlm();
    unsubscribeIngest();
  };
}

const STAGE_POLL_MS = 4000;

// Singular: the specific artifact ("adr") headlines, its state the
// subtext. Plural: the count headlines — the group is all-paused or
// all-working (see pipelineStage), so the shared state still reads right.
function stageText(stage) {
  if (!stage.state) return { label: 'Nada em andamento', sub: 'todas as execuções concluídas ou paradas' };
  const sub = STATE_LABEL[stage.state] || stage.state;
  if (stage.count > 1) return { label: `${stage.count} execuções`, sub };
  return { label: stage.artifact || sub, sub };
}

// Run names as people read them: "ingest:ata.pdf" → "Ingestão: ata.pdf".
function stageArtifactLabel(artifact) {
  if (!artifact) return null;
  if (artifact.startsWith('ingest:')) return `Ingestão: ${artifact.slice(7)}`;
  if (artifact.startsWith('concept:')) return `Conceito: ${artifact.slice(8)}`;
  if (artifact === 'lint' || artifact === 'wiki-lint') return 'Verificação da wiki';
  if (artifact === 'query' || artifact === 'wiki-query') return 'Pergunta à wiki';
  return artifact;
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return iso;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}
