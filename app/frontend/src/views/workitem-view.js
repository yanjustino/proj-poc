import { listProjectDir, workItemUsage } from '../api.js';
import { sequenceFor } from '../artifacts.js';
import { renderFontesTab } from './tab-fontes.js';
import { renderWikiTab } from './tab-wiki.js';
import { renderArtefatosTab } from './tab-artefatos.js';
import { renderLogsTab } from './tab-logs.js';
import { showEmpty as showEmptyReadingPane } from '../reading-pane.js';
import { openConfirmDeleteModal } from './confirm-delete-modal.js';
import { icon } from '../icons.js';

const LEVEL_LABEL = { discovery: 'Oportunidade · Discovery', delivery: 'Feature/História · Delivery' };

// renderWorkItemView mounts the hero + summary cards + tab switcher for one
// work-item into `container`. `initialTab` lets the "criar work-item" flow
// land straight on Fontes instead of the default Artefatos tab. `onDeleted`
// is called once the user confirms deletion and App.DeleteProject actually
// succeeds — the shell owns navigating back to the list and refreshing the
// sidebar, since this view has no access to either.
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

  async function refreshSummary() {
    const sequence = sequenceFor(project);
    const expectedCount = sequence.length;

    let artifactNodes = [];
    let rawNodes = [];
    let usage = { total_tokens_in: 0, total_tokens_out: 0, total_cache_creation_tokens: 0, total_cache_read_tokens: 0, total_cost_usd: 0 };
    try {
      [artifactNodes, rawNodes, usage] = await Promise.all([
        listProjectDir(project.id, 'artifacts', ''),
        listProjectDir(project.id, 'raw', ''),
        workItemUsage(project.id),
      ]);
    } catch {
      // best-effort — summary cards just show zeros if any call fails.
    }
    const byName = Object.fromEntries(artifactNodes.map((n) => [n.name, n]));
    const doneCount = sequence.filter((entry) => {
      if (entry.dir) return byName[entry.dir] && byName[entry.dir].children && byName[entry.dir].children.length > 0;
      if (entry.path) return Boolean(byName[entry.path]);
      return false;
    }).length;
    const pct = expectedCount ? Math.round((doneCount / expectedCount) * 100) : 0;
    const tokensIn = usage.total_tokens_in || 0;
    const tokensOut = usage.total_tokens_out || 0;

    // Cache tokens (Claude: cache_creation + cache_read; Codex: cache_write
    // + cache_read; Devin ATIF: cache_read only) get their own card. For
    // ATIF/Codex the cache count is a subset of input, so this card is a
    // breakdown for observability and must not be added to tokensIn again.
    // Cost remains a tooltip detail because not every backend exposes it.
    const cacheCreation = usage.total_cache_creation_tokens || 0;
    const cacheRead = usage.total_cache_read_tokens || 0;
    const totalCache = cacheCreation + cacheRead;
    const costUsd = usage.total_cost_usd || 0;
    const cacheLabel = totalCache > 0 ? totalCache.toLocaleString('pt-BR') : '—';
    const cacheTitle = totalCache > 0
      ? [
          `${cacheCreation.toLocaleString('pt-BR')} de criação de cache`,
          `${cacheRead.toLocaleString('pt-BR')} lidos do cache`,
          costUsd > 0 ? `custo estimado: ${costUsd.toLocaleString('pt-BR', { style: 'currency', currency: 'USD' })}` : null,
        ].filter(Boolean).join(' · ')
      : 'Sem uso de cache registrado ainda';

    summaryEl.innerHTML = `
      <div class="summary-card">
        <span class="summary-icon">${icon('inbox', 16)}</span>
        <div><b>${rawNodes.length}</b><span>fontes enviadas</span></div>
      </div>
      <div class="summary-card">
        <span class="summary-icon">${icon('checkCircle', 16)}</span>
        <div><b>${doneCount} de ${expectedCount}</b><span>artefatos prontos</span></div>
        <span class="ring" style="background:conic-gradient(var(--green) 0 ${pct}%,var(--line) ${pct}%)"><i>${pct}%</i></span>
      </div>
      <div class="summary-card">
        <span class="summary-icon">${icon('arrowDown', 16)}</span>
        <div><b>${tokensIn.toLocaleString('pt-BR')}</b><span>tokens de entrada</span></div>
      </div>
      <div class="summary-card">
        <span class="summary-icon">${icon('arrowUp', 16)}</span>
        <div><b>${tokensOut.toLocaleString('pt-BR')}</b><span>tokens de saída</span></div>
      </div>
      <div class="summary-card" title="${escapeHtml(cacheTitle)}">
        <span class="summary-icon">${icon('layers', 16)}</span>
        <div><b>${cacheLabel}</b><span>tokens em cache</span></div>
      </div>
    `;
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
