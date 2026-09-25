import { listProjectDir, workItemUsage, workItemProductivity, listIngestedRaw, getRunStatus } from '../api.js';
import { computeCategoryProgress } from '../artifacts.js';
import { renderFontesTab } from './tab-fontes.js';
import { renderWikiTab } from './tab-wiki.js';
import { renderArtefatosTab } from './tab-artefatos.js';
import { renderLogsTab } from './tab-logs.js';
import { renderMudancasTab } from './tab-mudancas.js';
import { showEmpty as showEmptyReadingPane } from '../reading-pane.js';
import { openConfirmDeleteModal } from './confirm-delete-modal.js';
import { listActiveRunsForProject } from '../active-runs.js';
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

function failureRowHtml(failure) {
  if (!failure) return '';
  return `<div class="summary-tokens-row summary-unavailable" title="${escapeHtml(failure.reason)}">${icon('alertCircle', 13)}<span>${escapeHtml(failure.text)}</span></div>`;
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
      </div>
      <button class="icon-btn" aria-label="Excluir work-item" title="Excluir work-item" data-delete>${icon('trash', 15)}</button>
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
  const tabContent = container.querySelector('[data-tab-content]');
  const tabButtons = [...container.querySelectorAll('.tab-btn')];

  container.querySelector('[data-delete]').addEventListener('click', async () => {
    const deleted = await openConfirmDeleteModal(project);
    if (deleted) await onDeleted?.();
  });

  // pipelineStage resolves "what's actually happening right now" across
  // every run this project has ever started (active-runs.js's registry,
  // not just whatever tab-artefatos.js's own trackers Map currently holds —
  // that's thrown away on every remount, this survives it, see that
  // module's own comment). A paused run is the most actionable state
  // (someone needs to actually look at it), so it wins over a merely
  // working/queued one when both exist; a registry entry whose run mhl no
  // longer knows about (long finished, or from a session so old the
  // process restarted) fails GetRunStatus and is silently dropped here —
  // tab-artefatos.js's own reattach flow is what actually clears a truly
  // dead entry, this is read-only.
  async function pipelineStage() {
    const entries = listActiveRunsForProject(project.id);
    if (entries.length === 0) return { state: null, count: 0 };
    const statuses = await Promise.all(
      entries.map(({ runId }) =>
        getRunStatus(runId)
          .then((status) => (status.state === 'working' || status.state === 'queued' || status.state === 'paused' ? status : null))
          .catch(() => null),
      ),
    );
    const live = statuses.filter(Boolean);
    if (live.length === 0) return { state: null, count: 0 };
    const paused = live.filter((s) => s.state === 'paused');
    const chosen = paused[0] || live[0];
    const count = (paused.length > 0 ? paused : live).length;
    // status.vars is already a plain object by the time it reaches here —
    // GetRunStatus's own json.RawMessage field round-trips through one
    // JSON.parse (api.js's getRunStatus), not two (same as run-tracker.js's
    // own `s.vars || {}` reads it).
    const vars = chosen.vars || {};
    return { state: chosen.state, count, artifact: vars.artifact || vars.current_artifact || null };
  }

  // Last successful reading of each mhl-backed source, for this work-item.
  // A failed refresh keeps showing these (flagged as not refreshed) instead
  // of wiping the card — a single transient failure used to blank both
  // cards until the next refresh happened to succeed.
  let lastUsage = null;
  let lastProductivity = null;

  async function refreshSummary() {
    const emptyUsage = { total_tokens_in: 0, total_tokens_out: 0, total_cache_creation_tokens: 0, total_cache_read_tokens: 0, total_cost_usd: 0 };
    // Each source fails on its own. This used to be one Promise.all whose
    // single catch kept every default — so when mhl was down (the usage and
    // productivity queries run through it), even the purely local numbers
    // (fontes, artefatos) dropped to zero and the whole summary read as if
    // the project's history had been erased. Now a failed source shows as
    // unavailable, and only that source.
    const results = await Promise.allSettled([
      listProjectDir(project.id, 'artifacts', ''),
      listProjectDir(project.id, 'raw', ''),
      listIngestedRaw(project.id),
      workItemUsage(project.id),
      pipelineStage(),
      workItemProductivity(project.id),
    ]);
    const valueOf = (i, fallback) => (results[i].status === 'fulfilled' ? results[i].value : fallback);
    const artifactNodes = valueOf(0, []);
    const rawNodes = valueOf(1, []);
    const ingestedNames = valueOf(2, []);
    const stage = valueOf(4, { state: null, count: 0 });
    if (results[3].status === 'fulfilled') lastUsage = results[3].value;
    if (results[5].status === 'fulfilled') lastProductivity = results[5].value;
    const usage = lastUsage ?? emptyUsage;
    const productivity = lastProductivity;
    const usageFailure = failureNote(results[3], lastUsage, 'uso de tokens');
    const productivityFailure = failureNote(results[5], lastProductivity, 'produtividade');

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
    // Cost gets its own visible row (below) now — the tooltip keeps just
    // the cache creation/read split, detail that doesn't earn a whole row
    // of its own the way cost does.
    const tokensTitle =
      [
        totalCache > 0 ? `${cacheCreation.toLocaleString('pt-BR')} tokens de criação de cache` : null,
        totalCache > 0 ? `${cacheRead.toLocaleString('pt-BR')} tokens lidos do cache` : null,
      ]
        .filter(Boolean)
        .join(' · ') || 'Sem uso de cache registrado ainda';

    const ingestedCount = rawNodes.filter((n) => ingestedNames.includes(n.name)).length;
    const lastActivity = productivity?.last_activity_at ? formatRelativeTime(Date.parse(productivity.last_activity_at)) : '—';

    // Singular: the specific artifact ("ADR") reads as the headline, its
    // state ("aguarda aprovação") as the subtext. Plural: no single
    // artifact to headline, so the count takes that spot instead and the
    // shared state (every counted run is either all-paused or all-active,
    // never mixed — see pipelineStage's own paused-wins-over-active choice)
    // still reads fine as the subtext either way.
    const stageLabel = !stage.state ? 'Nada em andamento' : stage.count > 1 ? `${stage.count} execuções` : stage.artifact || STATE_LABEL[stage.state] || stage.state;
    const stageSub = !stage.state ? 'todas as execuções concluídas ou paradas' : STATE_LABEL[stage.state] || stage.state;

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
          <div><b>${escapeHtml(stageLabel)}</b><span>${escapeHtml(stageSub)}</span></div>
        </div>
        <div class="summary-tokens-stack">
          <div class="summary-tokens-row">${icon('inbox', 13)}<b>${ingestedCount} de ${rawNodes.length}</b><span>fontes ingeridas</span></div>
          <div class="summary-tokens-row">${icon('refreshCw', 13)}<b>${productivity ? productivity.change_requests : 0}</b><span>pedidos de mudança</span></div>
          <div class="summary-tokens-row">${icon('zap', 13)}<b>${escapeHtml(lastActivity)}</b><span>última atividade</span></div>
        </div>
      </div>
      ${productivityCardHtml(productivity, productivityFailure)}
      <div class="summary-card summary-card-progress summary-card-tokens" title="${escapeHtml(tokensTitle)}">
        <div class="summary-progress-head">
          <span class="summary-icon">${icon('layers', 16)}</span>
          <div><b>Uso de tokens</b></div>
        </div>
        <div class="summary-tokens-stack">
          <div class="summary-tokens-row">${icon('arrowDown', 13)}<b>${tokensIn.toLocaleString('pt-BR')}</b><span>entrada</span></div>
          <div class="summary-tokens-row">${icon('arrowUp', 13)}<b>${tokensOut.toLocaleString('pt-BR')}</b><span>saída</span></div>
          ${totalCache > 0 ? `<div class="summary-tokens-row">${icon('layers', 13)}<b>${cacheSharePct}%</b><span>do input veio do cache</span></div>` : ''}
          <div class="summary-tokens-row">${icon('dollarSign', 13)}<b>${escapeHtml(cost.value)}</b><span>${escapeHtml(cost.label)}</span></div>
          ${failureRowHtml(usageFailure)}
        </div>
      </div>
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

  await refreshSummary();
  await showTab(initialTab);

  return () => disposeTab?.();
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
