import { listProjectDir, readProjectFile, startAndWatch, watchExistingRun, isFullyTerminal, wikiSyncHtml, cancelRun, wikiStaleSources } from '../api.js';
import { ingestQueueSnapshot, subscribeIngestQueue } from '../ingest-queue.js';
import { confirmRebuildWiki } from './rebuild-wiki.js';
import { setActiveRun, getActiveRun, clearActiveRun } from '../active-runs.js';
import { renderMarkdown } from '../markdown.js';
import { createRunTracker } from '../run-tracker.js';
import { showMarkdownDoc, showHtmlDoc, showEmpty, setFooter, beginCustom, setToolbarAction } from '../reading-pane.js';
import { icon } from '../icons.js';
import { sendButtonHtml, enhanceComposer } from '../composer.js';
import { formatRelativeTime } from '../time-format.js';

const GROUPS = [
  { dir: 'sources', label: 'Fontes' },
  { dir: 'entities', label: 'Entidades' },
  { dir: 'concepts', label: 'Conceitos' },
  { dir: 'answers', label: 'Respostas arquivadas' },
];

// Pages per screen in a folder list, and the size of Visão geral's sections.
const PAGE_SIZE = 50;
const OVERVIEW_ATTENTION = 8;
const OVERVIEW_RECENT = 6;
const OVERVIEW_CONNECTED = 8;
const NATUREZA_LABEL = { sistema_atual: 'Sistema atual', pedido_novo: 'Pedido novo', ambos: 'Ambos' };

const GROUP_ICONS = { index: 'layers', sources: 'fileText', entities: 'inbox', concepts: 'zap', answers: 'checkCircle' };
const GROUP_DESCRIPTIONS = {
  index: 'Visão geral e navegação do conhecimento consolidado.',
  sources: 'Sínteses rastreáveis dos documentos enviados.',
  entities: 'Pessoas, sistemas e organizações relevantes.',
  concepts: 'Termos, regras e ideias centrais do domínio.',
  answers: 'Respostas arquivadas para consulta posterior.',
};

// renderWikiTab owns only the middle column now (group tabs/tree + lint
// controls) — the actual page content goes to the shared reading
// pane (reading-pane.js), which persists across tab switches and is what
// the user reads from, matching the 3-column reference layout (nav | list |
// document).
export async function renderWikiTab(container, project) {
  // See tab-artefatos.js's identical flag for why this exists: "Perguntar"
  // and lint both run a workflow that can still be in flight when the user
  // switches away, and their onUpdate callback below writes into the
  // *shared* reading pane (showMarkdownDoc) once it resolves — without this
  // guard, an answer landing after the user has moved on would replace
  // whatever they're currently reading.
  let active = true;
  // Perguntar box moved to the top of the tab (was below the tree) — with
  // enough pages it used to scroll off past the bottom of the tree,
  // effectively hiding it. The tree itself is now split into sub-tabs (one
  // per GROUPS entry, plus Índice) instead of one long flat scroll with
  // inline group headers — real user-reported symptom: past a handful of
  // fontes/entidades/conceitos, the combined list became too long to
  // navigate at a glance.
  container.innerHTML = `
    <div class="collection-map-head wiki-map-head">
      <div>
        <div class="collection-map-title"><h2>Páginas da wiki</h2><span data-wiki-count>0 páginas</span></div>
        <p>Conhecimento organizado por fontes, entidades e conceitos.</p>
      </div>
      <div class="collection-map-actions">
        <button class="button tertiary small" data-lint-open hidden>${icon('fileText', 14)} Última verificação</button>
        <button class="button tertiary small" data-rebuild-btn title="Apaga a wiki e processa de novo as fontes ingeridas">${icon('refreshCw', 14)} Reprocessar</button>
        <button class="button tertiary small" data-lint-btn>${icon('checkCircle', 14)} Verificar wiki</button>
        <div class="view-toggle" data-view-toggle>
          <button class="view-toggle-btn" data-view="cards" title="Ver como cards">${icon('grid', 15)}</button>
          <button class="view-toggle-btn" data-view="table" title="Ver como tabela">${icon('list', 15)}</button>
        </div>
      </div>
    </div>
    <p class="wiki-lint-stale" data-wiki-stale hidden>${icon('alertCircle', 13)}<span data-wiki-stale-text></span></p>
    <p class="wiki-lint-stale" data-lint-stale hidden>${icon('alertCircle', 13)}<span>A wiki recebeu conteúdo depois da última verificação. Verifique de novo para fechar os alertas que as fontes novas resolveram.</span></p>
    <label class="wiki-search-box">
      ${icon('search', 14)}
      <input type="search" placeholder="Buscar por título, sinônimo ou conteúdo" aria-label="Buscar na wiki" data-wiki-search />
      <kbd>⌘K</kbd>
    </label>
    <div class="wiki-group-filters" data-tree-tabs></div>
    <div class="wiki-list-tools" data-list-tools hidden></div>
    <nav class="list-area" data-tree></nav>

    <div class="wiki-lint-report">
      <div data-lint-tracker></div>
    </div>
  `;

  // "Pergunte à sua wiki" lives in the reading pane, not in this column: the
  // same chat-style composer as a paused run's (.run-composer), pinned to
  // the pane's footer while the Índice — or an answer it produced — is
  // open. Built once per mount, so detaching it (setHeader clears the
  // footer on every page switch) keeps the input and a run's live tracker
  // intact for when the Índice is opened again.
  const askComposer = document.createElement('div');
  askComposer.className = 'run-composer wiki-ask-composer';
  askComposer.innerHTML = `
    <textarea class="run-feedback-input wiki-ask-input" rows="1" placeholder="Pergunte à wiki sobre este work-item…" data-question></textarea>
    <div data-ask-tracker></div>
    <div class="run-composer-actions">
      <div class="composer-tools">
        <span class="composer-chip static">${icon('zap', 14)} Wiki</span>
        <label class="composer-chip composer-toggle" title="Também salva a resposta como uma página nova da wiki"><input type="checkbox" data-file-answer />${icon('inbox', 14)} Arquivar resposta</label>
      </div>
      ${sendButtonHtml({ attrs: 'data-ask', label: 'Perguntar' })}
    </div>
  `;
  const syncAskComposer = enhanceComposer(askComposer, { submitOnEnter: false });

  // The one "criar página de conceito" run this tab follows (see
  // startConcept).
  // pausedRunId: the paused run an approval replaced (see approveConcept),
  // retired once the replacement has written the page.
  const concept = { run: false, title: '', tracker: null, pausedRunId: null };
  // paneView: what this tab last put in the reading pane — 'report' (última
  // verificação), 'concept' (the creation above) or null (a page, an
  // answer). A concept status change only repaints the view that is
  // actually showing, never takes the pane over.
  let paneView = null;

  const tabsEl = container.querySelector('[data-tree-tabs]');
  const toolsEl = container.querySelector('[data-list-tools]');
  const treeEl = container.querySelector('[data-tree]');
  const wikiCountEl = container.querySelector('[data-wiki-count]');
  const searchInput = container.querySelector('[data-wiki-search]');
  const lintStaleEl = container.querySelector('[data-lint-stale]');
  const lintOpenButton = container.querySelector('[data-lint-open]');
  const rebuildButton = container.querySelector('[data-rebuild-btn]');
  const wikiStaleEl = container.querySelector('[data-wiki-stale]');
  showEmpty('Selecione uma página da wiki para ler.');

  // latestByName is listProjectDir's own result, keyed by top-level name
  // (index.md, sources/, entities/, ...) — cached here so switching between
  // sub-tabs is a pure re-render (no re-fetch); buildTree() is the only
  // place that talks to the backend.
  let latestByName = {};
  let selectedGroup = 'overview'; // 'overview' | 'index' | one of GROUPS[].dir
  // List controls of a group tab (Fontes/Entidades/...): sort (remembered),
  // flag filters, natureza (fontes) and how many rows are on screen — a big
  // wiki renders in pages of PAGE_SIZE instead of one huge table.
  let sortMode = 'name';
  try {
    sortMode = localStorage.getItem('senpai-wiki-sort') || 'name';
  } catch {
    // Degrades to 'name'.
  }
  const flagFilters = new Set(); // 'alert' | 'draft' | 'isolated' | 'new'
  let naturezaFilter = '';
  let shownLimit = PAGE_SIZE;
  // "Novo" = changed since this work-item's wiki was last open (kept in the
  // browser, per project; saved when the tab unmounts).
  const seenKey = `senpai-wiki-seen:${project.id}`;
  let lastSeen = 0;
  try {
    lastSeen = Number(localStorage.getItem(seenKey)) || 0;
  } catch {
    // No "novo" badges.
  }
  let openPath = null; // currently-open page's data-path, kept across tab switches so the right row re-marks .active
  // searchIndex is wiki/html/search.json (WikiHtmlExport.search_index),
  // regenerated by every ingest/answer/lint and by the sync on mount. It
  // also gives the list its real page titles (file names are slugs).
  let searchIndex = [];
  let titleByPath = {};
  let entryByPath = {};
  let searchGroup = 'all';

  const viewButtons = [...container.querySelectorAll('[data-view]')];
  // viewMode: same default/persistence reasoning as tab-artefatos.js's own
  // (see its comment) — table by default, cards one click away. Own
  // localStorage key, not a shared one — a per-tab preference.
  let viewMode = 'table';
  try {
    if (localStorage.getItem('senpai-wiki-view') === 'cards') viewMode = 'cards';
  } catch {
    // Degrades to 'table'.
  }
  viewButtons.forEach((button) => button.classList.toggle('active', button.dataset.view === viewMode));
  function setViewMode(mode) {
    viewMode = mode;
    try {
      localStorage.setItem('senpai-wiki-view', mode);
    } catch {
      // Not persisted this time — still applies for the rest of this mount.
    }
    viewButtons.forEach((button) => button.classList.toggle('active', button.dataset.view === mode));
    renderList();
  }
  viewButtons.forEach((button) => button.addEventListener('click', () => setViewMode(button.dataset.view)));

  // A wiki agora é lida como o HTML estático gerado por WikiHtmlExport
  // (workflows/shared/wiki/wiki_html_export.mh), nunca mais como .md cru
  // renderizado no navegador — o .md continua existindo por baixo (é nele
  // que a LLM acumula fatos incrementalmente), mas o usuário nunca mais o
  // vê diretamente. allowScripts: true porque a página gerada embute sua
  // própria busca local (index.html) — conteúdo determinístico, nunca da
  // LLM, então é seguro rodar.
  function htmlRelativeFor(relative) {
    return relative === 'index.md' ? 'html/index.html' : 'html/' + relative.replace(/\.md$/, '.html');
  }

  // Links dentro da página (relacionadas, alertas, índice) não resolvem no
  // iframe srcdoc; o script embutido em cada página avisa a janela pai com o
  // caminho relativo a wiki/html (ex. "entities/plataforma.html"). Só aceita
  // o formato exato esperado — nada além de <pasta>/<slug>.html ou o índice.
  function onWikiMessage(event) {
    const target = event.data && event.data.senpaiWiki;
    if (typeof target !== 'string' || !active) return;
    if (target === 'index.html') {
      openPage('wiki', 'index.md', 'Índice');
      return;
    }
    const match = /^(sources|entities|concepts|answers)\/([a-z0-9-]+)\.html$/.exec(target);
    if (!match) return;
    // Same label the list rows use (file name without .md).
    openPage('wiki', `${match[1]}/${match[2]}.md`, match[2]);
  }
  window.addEventListener('message', onWikiMessage);

  async function openPage(root, relative, label) {
    paneView = null;
    openPath = relative;
    markActiveRow();
    await showPage(root, relative, label);
    if (active && openPath === relative && relative === 'index.md') setFooter(askComposer);
  }

  async function showPage(root, relative, label) {
    try {
      const [html, markdown] = await Promise.all([
        readProjectFile(project.id, root, htmlRelativeFor(relative)),
        // O .md é só para "ver markdown" — se faltar, a página abre sem o botão.
        readProjectFile(project.id, root, relative).catch(() => undefined),
      ]);
      showHtmlDoc(label, html, { allowScripts: true, markdown });
    } catch {
      // wiki/html pode ainda não existir pra um work-item cuja wiki foi
      // ingerida antes de sync_html existir e cujo sync no mount (abaixo)
      // falhou por algum motivo — cai pro .md cru em vez de deixar a
      // página vazia.
      try {
        const text = await readProjectFile(project.id, root, relative);
        showMarkdownDoc(label, renderMarkdown(text), { markdown: text });
      } catch (err) {
        showMarkdownDoc(label, `<p class="doc-empty">Não foi possível abrir "${escapeHtml(label)}": ${escapeHtml(String(err))}</p>`);
      }
    }
  }

  // markActiveRow covers both views' shapes: renderCardsList's inner
  // <button data-path> (selection goes on its ancestor .wiki-page-card) and
  // renderTable's own <tr data-path> (selection goes on the row itself,
  // there's no separate ancestor to reach for).
  function markActiveRow() {
    treeEl.querySelectorAll('[data-path]').forEach((el) => {
      const target = el.closest('.wiki-page-card') || el;
      target.classList.toggle('selected', el.dataset.path === openPath);
    });
  }

  // Visão geral (the default) and Índice get tabs of their own next to the
  // folders — Visão geral is the ranked entry point for a big wiki, Índice
  // the generated index page. Each folder tab shows its page count.
  function groupsWithContent() {
    const groups = [];
    const folders = GROUPS.filter((group) => latestByName[group.dir]?.children?.length > 0);
    if (folders.length > 0) groups.push({ dir: 'overview', label: 'Visão geral' });
    if (latestByName['index.md']) groups.push({ dir: 'index', label: 'Índice' });
    return groups.concat(folders.map((group) => ({ ...group, count: folderPages(group.dir).length })));
  }

  function renderTabs() {
    const groups = groupsWithContent();
    if (!groups.some((g) => g.dir === selectedGroup)) selectedGroup = groups[0]?.dir ?? 'index';
    tabsEl.innerHTML = groups
      .map((g) => `<button class="collection-filter ${g.dir === selectedGroup ? 'active' : ''}" data-group="${g.dir}">${escapeHtml(g.label)}${g.count != null ? ` <span>${g.count}</span>` : ''}</button>`)
      .join('');
    tabsEl.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', () => selectGroup(button.dataset.group));
    });
  }

  function selectGroup(dir, { flag } = {}) {
    selectedGroup = dir;
    flagFilters.clear();
    if (flag) flagFilters.add(flag);
    naturezaFilter = '';
    shownLimit = PAGE_SIZE;
    renderTabs();
    renderList();
  }

  // folderPages: every page of one folder, with the ranking signals
  // search.json carries (WikiHtmlExport.search_index) — `updated` is the
  // last "## Fatos (data)" block, else the file's own date.
  function folderPages(dir) {
    return (latestByName[dir]?.children || [])
      .filter((c) => !c.isDir)
      .map((child) => {
        const path = `${dir}/${child.name}`;
        const entry = entryByPath[path];
        const modified = child.modifiedAt ? Date.parse(child.modifiedAt) : 0;
        return {
          path,
          group: dir,
          label: titleByPath[path] || child.name.replace(/\.md$/, ''),
          modifiedAt: child.modifiedAt,
          citedBy: entry?.cited_by ?? 0,
          mentions: entry?.mentions ?? 0,
          facts: entry?.facts ?? 0,
          alerts: entry?.alerts ?? 0,
          natureza: entry?.natureza || '',
          updated: entry?.updated_at ? Date.parse(entry.updated_at) : modified,
          modified,
          hasSignals: Boolean(entry),
        };
      });
  }

  function allPages() {
    return GROUPS.flatMap((group) => folderPages(group.dir));
  }

  // Entities and concepts are the pages that should link up with the rest;
  // a source or an answer standing alone is normal.
  const LINKED_GROUPS = ['entities', 'concepts'];
  const isDraft = (page) => LINKED_GROUPS.includes(page.group) && page.hasSignals && page.facts <= 1;
  const isIsolated = (page) => LINKED_GROUPS.includes(page.group) && page.hasSignals && page.citedBy === 0 && page.mentions === 0;
  const isNew = (page) => lastSeen > 0 && page.modified > lastSeen;

  function badgesHtml(page) {
    return [
      page.alerts ? `<span class="wiki-badge wiki-badge-alert">${page.alerts} ${page.alerts === 1 ? 'alerta' : 'alertas'}</span>` : '',
      isNew(page) ? '<span class="wiki-badge wiki-badge-new">novo</span>' : '',
      isDraft(page) ? '<span class="wiki-badge">rascunho</span>' : '',
      isIsolated(page) ? '<span class="wiki-badge">isolada</span>' : '',
    ].join('');
  }

  async function loadSearchIndex() {
    try {
      const entries = JSON.parse(await readProjectFile(project.id, 'wiki', 'html/search.json'));
      searchIndex = Array.isArray(entries) ? entries.map(prepareEntry) : [];
    } catch {
      searchIndex = [];
    }
    titleByPath = Object.fromEntries(searchIndex.map((e) => [e.path, e.title]));
    entryByPath = Object.fromEntries(searchIndex.map((e) => [e.path, e]));
  }

  function query() {
    return searchInput.value.trim();
  }

  function renderSearch() {
    const results = searchWiki(searchIndex, query());
    const counts = {};
    results.forEach((r) => { counts[r.entry.group] = (counts[r.entry.group] || 0) + 1; });
    const groups = GROUPS.filter((g) => counts[g.dir]);
    if (searchGroup !== 'all' && !counts[searchGroup]) searchGroup = 'all';
    tabsEl.innerHTML = [`<button class="collection-filter ${searchGroup === 'all' ? 'active' : ''}" data-search-group="all">Todos <span>${results.length}</span></button>`]
      .concat(groups.map((g) => `<button class="collection-filter ${g.dir === searchGroup ? 'active' : ''}" data-search-group="${g.dir}">${escapeHtml(g.label)} <span>${counts[g.dir]}</span></button>`))
      .join('');
    tabsEl.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', () => {
        searchGroup = button.dataset.searchGroup;
        renderSearch();
      });
    });
    const shown = searchGroup === 'all' ? results : results.filter((r) => r.entry.group === searchGroup);
    toolsEl.hidden = true;
    treeEl.className = 'list-area wiki-search-results';
    if (shown.length === 0) {
      treeEl.innerHTML = `<div class="collection-map-empty">Nada encontrado para "${escapeHtml(query())}".${searchIndex.length ? '' : ' O índice de busca ainda não foi gerado — reabra a aba Wiki.'}</div>`;
      return;
    }
    const terms = tokens(query());
    treeEl.innerHTML = shown
      .map(({ entry, alias }) => `
        <button class="wiki-search-result ${entry.path === openPath ? 'selected' : ''}" data-path="${escapeHtml(entry.path)}" data-label="${escapeHtml(entry.title)}">
          <span class="wiki-search-kind">${icon(GROUP_ICONS[entry.group] || 'fileText', 13)}${escapeHtml(entry.label)}</span>
          <strong>${highlight(entry.title, terms)}</strong>
          ${alias ? `<small class="wiki-search-alias">também: ${highlight(alias, terms)}</small>` : ''}
          <span class="wiki-search-snippet">${highlight(snippet(entry, terms), terms)}</span>
        </button>`)
      .join('');
    treeEl.querySelectorAll('[data-path]').forEach((button) => {
      button.addEventListener('click', () => openPage('wiki', button.dataset.path, button.dataset.label).catch(() => {}));
    });
  }

  function refreshView() {
    if (query()) {
      renderSearch();
    } else {
      renderTabs();
      renderList();
    }
  }

  searchInput.addEventListener('input', () => {
    searchGroup = 'all';
    refreshView();
  });
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      searchInput.value = '';
      refreshView();
    } else if (event.key === 'Enter') {
      treeEl.querySelector('[data-path]')?.click();
    }
  });
  function onSearchShortcut(event) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && container.isConnected) {
      event.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
  }
  window.addEventListener('keydown', onSearchShortcut);

  function renderList() {
    if (selectedGroup === 'overview') {
      toolsEl.hidden = true;
      renderOverview();
      return;
    }
    if (selectedGroup === 'index') {
      toolsEl.hidden = true;
      renderPages([{ path: 'index.md', label: 'Índice', modifiedAt: latestByName['index.md']?.modifiedAt }]);
      return;
    }
    const all = folderPages(selectedGroup);
    const pages = sortPages(applyFilters(all));
    renderTools(all, pages.length);
    if (pages.length === 0) {
      treeEl.className = 'list-area';
      treeEl.innerHTML = `<div class="collection-map-empty">${all.length ? 'Nenhuma página com esses filtros.' : 'Nada aqui ainda.'}</div>`;
      return;
    }
    renderPages(pages.slice(0, shownLimit), pages.length - shownLimit);
  }

  function renderPages(pages, remaining = 0) {
    if (pages.length === 0) {
      treeEl.className = 'list-area';
      treeEl.innerHTML = '<div class="collection-map-empty">Nada aqui ainda.</div>';
      return;
    }
    if (viewMode === 'table') renderTable(pages);
    else renderCardsList(pages);
    if (remaining > 0) {
      const more = document.createElement('button');
      more.className = 'button tertiary small wiki-more';
      more.textContent = `Mostrar mais ${Math.min(remaining, PAGE_SIZE)} (${remaining} restantes)`;
      more.addEventListener('click', () => {
        shownLimit += PAGE_SIZE;
        renderList();
      });
      treeEl.appendChild(more);
    }
    markActiveRow();
  }

  function applyFilters(pages) {
    return pages.filter((page) =>
      (!flagFilters.has('alert') || page.alerts > 0) &&
      (!flagFilters.has('draft') || isDraft(page)) &&
      (!flagFilters.has('isolated') || isIsolated(page)) &&
      (!flagFilters.has('new') || isNew(page)) &&
      (!naturezaFilter || page.natureza === naturezaFilter));
  }

  function sortPages(pages) {
    const byName = (a, b) => a.label.localeCompare(b.label, 'pt-BR');
    const order = {
      name: byName,
      connected: (a, b) => b.citedBy - a.citedBy || b.mentions - a.mentions || byName(a, b),
      recent: (a, b) => b.updated - a.updated || byName(a, b),
      attention: (a, b) => b.alerts - a.alerts || Number(isIsolated(b)) - Number(isIsolated(a)) || byName(a, b),
    }[sortMode] || byName;
    return [...pages].sort(order);
  }

  // Sort + filter chips for a folder tab. A chip only shows when some page
  // in the folder has that flag, with how many.
  function renderTools(all, matching) {
    const count = (predicate) => all.filter(predicate).length;
    const flags = [
      ['alert', 'Com alerta', count((p) => p.alerts > 0)],
      ['new', 'Novos', count(isNew)],
      ['draft', 'Rascunhos', count(isDraft)],
      ['isolated', 'Isoladas', count(isIsolated)],
    ].filter(([, , n]) => n > 0 || false);
    const naturezas = selectedGroup === 'sources'
      ? [['sistema_atual', 'Sistema atual'], ['pedido_novo', 'Pedido novo'], ['ambos', 'Ambos']]
          .map(([value, label]) => [value, label, count((p) => p.natureza === value)])
          .filter(([, , n]) => n > 0)
      : [];
    const chip = (attr, value, label, n, on) => `<button class="collection-filter ${on ? 'active' : ''}" ${attr}="${value}">${label} <span>${n}</span></button>`;
    toolsEl.hidden = false;
    toolsEl.innerHTML = `
      <label class="wiki-sort">Ordenar
        <select data-sort>
          <option value="name">Nome</option>
          <option value="connected">Mais citadas</option>
          <option value="recent">Mais recentes</option>
          <option value="attention">Precisam de atenção</option>
        </select>
      </label>
      <div class="wiki-chips">
        ${flags.map(([value, label, n]) => chip('data-flag', value, label, n, flagFilters.has(value))).join('')}
        ${naturezas.map(([value, label, n]) => chip('data-natureza', value, label, n, naturezaFilter === value)).join('')}
      </div>
      <span class="wiki-list-count">${matching === all.length ? `${all.length} páginas` : `${matching} de ${all.length}`}</span>`;
    const select = toolsEl.querySelector('[data-sort]');
    select.value = sortMode;
    select.addEventListener('change', () => {
      sortMode = select.value;
      try {
        localStorage.setItem('senpai-wiki-sort', sortMode);
      } catch {
        // Not remembered — still applies now.
      }
      shownLimit = PAGE_SIZE;
      renderList();
    });
    toolsEl.querySelectorAll('[data-flag]').forEach((button) => {
      button.addEventListener('click', () => {
        const flag = button.dataset.flag;
        if (flagFilters.has(flag)) flagFilters.delete(flag);
        else flagFilters.add(flag);
        shownLimit = PAGE_SIZE;
        renderList();
      });
    });
    toolsEl.querySelectorAll('[data-natureza]').forEach((button) => {
      button.addEventListener('click', () => {
        naturezaFilter = naturezaFilter === button.dataset.natureza ? '' : button.dataset.natureza;
        shownLimit = PAGE_SIZE;
        renderList();
      });
    });
  }

  // Visão geral: what deserves a look first in a big wiki — pages with
  // review alerts or isolated, the most recently changed, and the most
  // cited (the wiki's backbone) — each short, each with a way into the
  // full, filtered folder list.
  function renderOverview() {
    const pages = allPages();
    const attention = pages
      .filter((p) => p.alerts > 0 || isIsolated(p))
      .sort((a, b) => b.alerts - a.alerts || a.label.localeCompare(b.label, 'pt-BR'));
    const recent = [...pages].sort((a, b) => b.updated - a.updated).slice(0, OVERVIEW_RECENT);
    const connected = pages
      .filter((p) => LINKED_GROUPS.includes(p.group) && p.citedBy > 0)
      .sort((a, b) => b.citedBy - a.citedBy || a.label.localeCompare(b.label, 'pt-BR'))
      .slice(0, OVERVIEW_CONNECTED);
    const kindLabel = (group) => GROUPS.find((g) => g.dir === group)?.label || '';
    const row = (page, extra = '') => `
      <li><button class="wiki-ov-row" data-path="${escapeHtml(page.path)}" data-label="${escapeHtml(page.label)}">
        <i>${icon(GROUP_ICONS[page.group] || 'fileText', 13)}</i>
        <span class="wiki-ov-title"><strong>${escapeHtml(page.label)}</strong><small>${escapeHtml(kindLabel(page.group))}${extra}</small></span>
        <span class="wiki-ov-badges">${badgesHtml(page)}</span>
      </button></li>`;
    const section = (title, hint, items, body, action = '') => `
      <section class="wiki-ov-section">
        <header><h3>${title} <span>${items}</span></h3>${action}</header>
        <p>${hint}</p>
        ${body}
      </section>`;
    const shownAttention = attention.slice(0, OVERVIEW_ATTENTION);
    treeEl.className = 'list-area wiki-overview';
    treeEl.innerHTML = [
      attention.length
        ? section('Precisam de atenção', 'Alertas da última verificação e entidades ou conceitos sem ligação com o resto da wiki.', attention.length,
            `<ul class="wiki-ov-list">${shownAttention.map((p) => row(p)).join('')}</ul>${attention.length > shownAttention.length ? `<p class="wiki-ov-more">+${attention.length - shownAttention.length} — veja em cada pasta com o filtro “Com alerta” ou “Isoladas”.</p>` : ''}`)
        : '',
      section('Atualizadas recentemente', 'Último bloco de fatos ou última mudança no arquivo.', recent.length,
        `<ul class="wiki-ov-list">${recent.map((p) => row(p, p.updated ? ` · ${escapeHtml(formatRelativeTime(p.updated))}` : '')).join('')}</ul>`),
      connected.length
        ? section('Mais citadas', 'Entidades e conceitos que mais páginas mencionam — o esqueleto da wiki.', connected.length,
            `<ul class="wiki-ov-list">${connected.map((p) => row(p, ` · citada por ${p.citedBy}`)).join('')}</ul>`,
            `<button class="button tertiary small" data-see-connected>Ver ranking completo</button>`)
        : '',
    ].join('');
    treeEl.querySelectorAll('[data-path]').forEach((button) => {
      button.addEventListener('click', () => openPage('wiki', button.dataset.path, button.dataset.label).catch(() => {}));
    });
    treeEl.querySelector('[data-see-connected]')?.addEventListener('click', () => {
      sortMode = 'connected';
      selectGroup(latestByName.entities?.children?.length ? 'entities' : 'concepts');
    });
    markActiveRow();
  }

  function renderCardsList(pages) {
    treeEl.className = 'list-area wiki-card-grid';
    treeEl.innerHTML = pages
      .map((page) => `
          <article class="wiki-page-card ${page.path === openPath ? 'selected' : ''}">
            <button data-path="${escapeHtml(page.path)}" data-label="${escapeHtml(page.label)}">
              <span class="wiki-page-kind"><i>${icon(GROUP_ICONS[selectedGroup] || 'fileText', 14)}</i>${escapeHtml(selectedGroup === 'index' ? 'Índice' : GROUPS.find((g) => g.dir === selectedGroup)?.label || 'Wiki')}</span>
              <strong>${escapeHtml(page.label)}</strong>
              <span>${escapeHtml(GROUP_DESCRIPTIONS[selectedGroup] || 'Página de conhecimento do work-item.')}</span>
              <span class="wiki-ov-badges">${badgesHtml(page)}</span>
              <footer><span class="status-dot ${page.alerts ? 'paused' : 'done'}"></span>${LINKED_GROUPS.includes(page.group) ? `citada por ${page.citedBy} · ${page.facts} ${page.facts === 1 ? 'fato' : 'fatos'}` : escapeHtml(formatRelativeTime(page.updated || null))}</footer>
            </button>
          </article>`)
      .join('');
    treeEl.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', () => openPage('wiki', button.dataset.path, button.dataset.label).catch(() => {}));
    });
  }

  // renderTable: the dense alternative to renderCardsList, same reasoning
  // as tab-artefatos.js's own table view — one row per page instead of one
  // tile, useful once a group (Fontes/Entidades/Conceitos) has grown past a
  // handful of pages. Every wiki page is always "done" (there's no
  // pending/generating state here, unlike Artefatos), so the row itself —
  // not a separate button — is the click target, same as artefatos'
  // clickable rows.
  function renderTable(pages) {
    treeEl.className = 'data-table-wrap';
    treeEl.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th></th>
            <th>Nome</th>
            <th>${selectedGroup === 'sources' ? 'Natureza' : LINKED_GROUPS.includes(selectedGroup) ? 'Citada por' : ''}</th>
            <th>Atualização</th>
          </tr>
        </thead>
        <tbody>
          ${pages
            .map((page) => {
              const when = formatRelativeTime(page.updated || (page.modifiedAt ? Date.parse(page.modifiedAt) : null));
              const signal = selectedGroup === 'sources'
                ? escapeHtml(NATUREZA_LABEL[page.natureza] || '—')
                : LINKED_GROUPS.includes(selectedGroup) ? String(page.citedBy ?? 0) : '';
              return `
                <tr class="data-row ${page.path === openPath ? 'selected' : ''}" data-path="${escapeHtml(page.path)}" data-label="${escapeHtml(page.label)}" title="Abrir ${escapeHtml(page.label)}">
                  <td class="data-row-dot"><span class="status-dot ${page.alerts ? 'paused' : 'done'}"></span></td>
                  <td class="data-row-name"><i>${icon(GROUP_ICONS[selectedGroup] || 'fileText', 14)}</i><span>${escapeHtml(page.label)}</span>${badgesHtml(page)}</td>
                  <td class="data-row-signal">${signal}</td>
                  <td class="data-row-when">${escapeHtml(when)}</td>
                </tr>
              `;
            })
            .join('')}
        </tbody>
      </table>
    `;
    treeEl.querySelectorAll('tr[data-path]').forEach((row) => {
      row.addEventListener('click', () => openPage('wiki', row.dataset.path, row.dataset.label).catch(() => {}));
    });
  }

  // Removed sources the wiki still carries content from (or the rebuild
  // running right now) — see ingest-queue.js's rebuildWiki.
  async function renderRebuildState() {
    const rebuild = ingestQueueSnapshot(project.id).rebuild;
    rebuildButton.disabled = Boolean(rebuild);
    let stale = [];
    try {
      stale = await wikiStaleSources(project.id);
    } catch (err) {
      console.error('wikiStaleSources', err);
    }
    const text = rebuild
      ? 'Reprocessando a wiki — as páginas voltam conforme cada fonte é processada de novo.'
      : stale.length
        ? `A wiki ainda contém conteúdo de ${stale.length === 1 ? 'uma fonte removida' : `${stale.length} fontes removidas`} (${stale.join(', ')}). Use "Reprocessar" para tirá-lo.`
        : '';
    wikiStaleEl.querySelector('[data-wiki-stale-text]').textContent = text;
    wikiStaleEl.hidden = !text;
  }

  async function buildTree() {
    let nodes;
    try {
      nodes = await listProjectDir(project.id, 'wiki', '');
    } catch (err) {
      tabsEl.innerHTML = '';
      treeEl.innerHTML = `<p class="doc-empty">${escapeHtml(String(err))}</p>`;
      return;
    }
    latestByName = Object.fromEntries(nodes.map((n) => [n.name, n]));
    lintStaleEl.hidden = !lintIsBehind(latestByName);
    await renderRebuildState();
    lintOpenButton.hidden = !latestByName['lint.json'] && !latestByName['lint.md'];
    const pageCount = nodes.reduce((total, node) => total + (node.isDir ? (node.children || []).filter((child) => !child.isDir).length : node.name === 'index.md' ? 1 : 0), 0);
    wikiCountEl.textContent = `${pageCount} ${pageCount === 1 ? 'página' : 'páginas'}`;
    if (groupsWithContent().length === 0) {
      tabsEl.innerHTML = '';
      treeEl.innerHTML = '<p class="doc-empty">Wiki ainda vazia.</p>';
      return;
    }
    refreshView();
  }

  await buildTree();
  if (latestByName['index.md']) {
    // Best-effort: garante que wiki/html está atual antes de abrir — se
    // falhar, openPage ainda cai pro .md cru sozinho.
    await wikiSyncHtml(project.id).catch(() => {});
    await loadSearchIndex();
    if (active) refreshView();
    await openPage('wiki', 'index.md', 'Índice');
  } else {
    showEmpty('Adicione fontes na aba "Fontes" para gerar a wiki.');
  }

  const questionInput = askComposer.querySelector('[data-question]');
  const fileAnswerCheckbox = askComposer.querySelector('[data-file-answer]');
  const askButton = askComposer.querySelector('[data-ask]');
  const askTrackerEl = askComposer.querySelector('[data-ask-tracker]');

  // Verificar e Perguntar continuam rodando no mhl quando o usuário troca de
  // aba; o runId fica em active-runs.js para a próxima montagem desta aba
  // reencontrar a execução (followRun via watchExistingRun) e mostrar o
  // resultado. O registro só é limpo quando o resultado chega a uma aba
  // aberta: se terminar com a aba fechada, a próxima montagem o exibe.
  const lintKey = `${project.id}:wiki-lint`;
  const askKey = `${project.id}:wiki-query`;

  // reattached: execução reencontrada ao montar. Se o mhl já não a conhece,
  // o registro é só limpo, sem mostrar erro de algo que o usuário não pediu
  // agora.
  function followRun(key, button, trackerEl, run, onCompleted, { reattached = false } = {}) {
    button.disabled = true;
    const tracker = createRunTracker();
    trackerEl.innerHTML = '';
    trackerEl.appendChild(tracker.element);
    const onUpdate = async (status) => {
      if (status.runId && !isFullyTerminal(status)) setActiveRun(key, status.runId);
      if (!active) return;
      tracker.update(status);
      if (!isFullyTerminal(status)) return;
      clearActiveRun(key);
      button.disabled = false;
      if (status.state === 'completed') await onCompleted((status.vars || {}).result);
    };
    run(onUpdate).catch((err) => {
      clearActiveRun(key);
      if (!active) return;
      button.disabled = false;
      if (reattached) {
        trackerEl.innerHTML = '';
        return;
      }
      tracker.update({ runId: '', state: 'failed', error: String(err) });
    });
  }

  async function showAnswer(result) {
    const answer = result || {};
    const title = answer.answer_title || questionInput.value.trim() || 'Resposta';
    paneView = null;
    openPath = null;
    markActiveRow();
    showMarkdownDoc(title, renderMarkdown(answer.answer_body || ''), { markdown: answer.answer_body || '' });
    // Keeps the composer under the answer, for a follow-up question.
    questionInput.value = '';
    syncAskComposer();
    askTrackerEl.innerHTML = '';
    setFooter(askComposer);
    if (answer.filed_as) {
      await loadSearchIndex();
      await buildTree();
    }
  }

  function ask() {
    const question = questionInput.value.trim();
    if (!question || askButton.disabled) return;
    const args = { project_id: project.id, action: 'query', question, file_answer: fileAnswerCheckbox.checked };
    followRun(askKey, askButton, askTrackerEl, (onUpdate) => startAndWatch('Wiki', args, onUpdate), showAnswer);
  }
  askButton.addEventListener('click', ask);
  // Enter pergunta; Shift+Enter quebra a linha.
  questionInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      ask();
    }
  });

  const lintButton = container.querySelector('[data-lint-btn]');
  const lintTrackerEl = container.querySelector('[data-lint-tracker]');
  const conceptKey = `${project.id}:wiki-concept`;

  // A verificação grava alertas nas páginas e regera wiki/html
  // (record_lint): recarrega a lista e o índice de busca, e abre o
  // relatório na pré-visualização — é dali que saem as ações por item.
  async function showLintReport() {
    lintTrackerEl.innerHTML = '';
    await loadSearchIndex();
    await buildTree();
    if (active) await openLintReport();
  }

  lintButton.addEventListener('click', () => {
    followRun(lintKey, lintButton, lintTrackerEl, (onUpdate) => startAndWatch('Wiki', { project_id: project.id, action: 'lint' }, onUpdate), showLintReport);
  });
  lintOpenButton.addEventListener('click', () => openLintReport());
  rebuildButton.addEventListener('click', () => confirmRebuildWiki(project.id));

  // A rebuild runs in ingest-queue.js, not here: the pages come back as each
  // source finishes, and its closing verification is followed like one this
  // tab started (same lint key, same report).
  const unsubscribeQueue = subscribeIngestQueue(project.id, async (event) => {
    if (!active) return;
    if (event.type === 'rebuild' && event.runId && !lintButton.disabled) {
      followRun(lintKey, lintButton, lintTrackerEl, (onUpdate) => watchExistingRun(event.runId, onUpdate), showLintReport, { reattached: true });
    }
    if (event.type === 'rebuild' || event.type === 'done') {
      await loadSearchIndex();
      if (active) await buildTree();
    }
  });

  // "Última verificação": wiki/lint.json (gravado por WikiLint.apply) vira
  // o relatório com ações; uma wiki verificada antes do lint.json existir
  // só tem o lint.md, mostrado como texto.
  async function openLintReport() {
    paneView = 'report';
    openPath = null;
    markActiveRow();
    let report = null;
    try {
      report = JSON.parse(await readProjectFile(project.id, 'wiki', 'lint.json'));
    } catch {
      try {
        const text = await readProjectFile(project.id, 'wiki', 'lint.md');
        if (active) showMarkdownDoc('Última verificação', renderMarkdown(text), { markdown: text });
      } catch {
        if (active) showEmpty('A wiki ainda não foi verificada.');
      }
      return;
    }
    if (!active) return;
    const when = report.generated_at ? formatRelativeTime(Date.parse(report.generated_at)) : '';
    const body = beginCustom('Última verificação', 'verificação');
    body.classList.add('lint-doc');
    body.innerHTML = renderLintReport(report, { conceptState, when, titleOf: (ref) => titleByPath[`${ref}.md`] });
    body.querySelector('[data-open-index]')?.addEventListener('click', () => openPage('wiki', 'index.md', 'Índice'));
    body.querySelectorAll('[data-jump]').forEach((el) => {
      el.addEventListener('click', () => body.querySelector(`#${el.dataset.jump}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    });
    body.querySelectorAll('[data-open-page]').forEach((el) => {
      el.addEventListener('click', () => openPage('wiki', `${el.dataset.openPage}.md`, titleByPath[`${el.dataset.openPage}.md`] || el.dataset.openPage));
    });
    body.querySelectorAll('[data-create-concept]').forEach((el) => {
      const item = report.missing_concepts[Number(el.dataset.createConcept)];
      el.addEventListener('click', () => (concept.run ? showConcept() : startConcept(item)));
    });
  }

  // conceptState says what the report can offer for a missing concept: a
  // page that already exists (ingested since, or created here), the one
  // creation in flight, or "Criar página".
  function conceptState(title) {
    const key = fold(title).trim();
    const page = searchIndex.find((e) => e.group === 'concepts' && (fold(e.title).trim() === key || e.aliases.some((a) => fold(a).trim() === key)));
    if (page) return { kind: 'exists', path: page.path.replace(/\.md$/, '') };
    if (concept.run && fold(concept.title).trim() === key) return { kind: 'running', state: concept.tracker?.status?.state };
    return { kind: concept.run ? 'busy' : 'create' };
  }

  // Criar página de conceito (Wiki action create_concept): a LLM escreve a
  // página só com o que a wiki já diz, e a run pausa (buddy) para o revisor
  // aprovar, pedir mudança (Regerar) ou cancelar — o mesmo composer dos
  // artefatos. Uma criação por vez; o runId fica em active-runs.js para a
  // próxima montagem da aba reencontrar a revisão pendente.
  function newConceptTracker() {
    return createRunTracker({
      onUpdate: onConceptUpdate,
      onApprove: approveConcept,
      onCancel: () => {
        clearActiveRun(conceptKey);
        concept.run = false;
        concept.tracker = null;
        if (active && paneView !== null) openLintReport();
      },
    });
  }

  // Aprovar starts a fresh commit-only run carrying the reviewed draft
  // (approval_data) instead of resuming the paused one: a resume fails
  // whenever the Wiki workflow changed after the pause was checkpointed
  // ("checkpoint was written for a different pipeline definition"). Same
  // approach as tab-artefatos.js's approvePendingDocument.
  async function approveConcept(paused) {
    const draft = paused.vars?.pending_concept;
    if (!draft) throw new Error('Rascunho da página não encontrado na execução pausada.');
    concept.pausedRunId = paused.runId;
    const args = { project_id: project.id, action: 'create_concept', concept_title: concept.title || draft.title, buddy: true, approved: true, approval_data: draft };
    await startAndWatch('Wiki', args, onConceptUpdate);
  }

  function startConcept(item) {
    concept.run = true;
    concept.title = item.title;
    concept.tracker = newConceptTracker();
    showConcept();
    const where = item.pages?.length ? ` Citado em: ${item.pages.join(', ')}.` : '';
    const args = { project_id: project.id, action: 'create_concept', concept_title: item.title, concept_description: `${item.description || ''}${where}`, buddy: true };
    startAndWatch('Wiki', args, onConceptUpdate).catch((err) => onConceptUpdate({ runId: '', state: 'failed', error: String(err) }));
  }

  async function onConceptUpdate(status) {
    if (status.runId && !isFullyTerminal(status)) setActiveRun(conceptKey, status.runId);
    const title = (status.vars?.current_artifact || '').replace(/^concept:/, '');
    if (title) concept.title = title;
    if (!concept.tracker) return;
    const before = concept.tracker.status?.state;
    concept.tracker.update(status);
    if (isFullyTerminal(status)) {
      clearActiveRun(conceptKey);
      concept.run = false;
      if (concept.pausedRunId) {
        // Written: the replaced pause can go. Failed: it still holds the
        // only copy of the draft, so the next mount finds it again.
        if (status.state === 'completed') cancelRun(concept.pausedRunId).catch(() => {});
        else setActiveRun(conceptKey, concept.pausedRunId);
        concept.pausedRunId = null;
      }
    }
    if (!active) return;
    if (status.state === 'completed') {
      const slug = status.vars?.result?.slug;
      concept.tracker = null;
      await loadSearchIndex();
      await buildTree();
      if (slug && paneView === 'concept') await openPage('wiki', `concepts/${slug}.md`, status.vars.result.title || slug);
      else if (paneView === 'report') await openLintReport();
      return;
    }
    if (status.state === before) return;
    if (paneView === 'concept') showConcept();
    else if (paneView === 'report') await openLintReport();
  }

  // showConcept: the creation in the reading pane — the live tracker while
  // the LLM writes, then the proposed page with Aprovar in the toolbar and
  // the Regerar/Cancelar composer pinned below it.
  function showConcept() {
    const tracker = concept.tracker;
    if (!tracker) return;
    openPath = null;
    markActiveRow();
    paneView = 'concept';
    const body = beginCustom(`Novo conceito: ${concept.title}`, 'revisão');
    body.appendChild(tracker.element);
    const status = tracker.status;
    if (status?.state === 'paused') {
      setFooter(tracker.composer);
      setToolbarAction(tracker.approveAction);
      const draft = status.vars?.pending_concept;
      if (draft) {
        const preview = document.createElement('div');
        preview.className = 'wiki-doc concept-preview';
        preview.innerHTML = `
          <h1>${escapeHtml(draft.title)}</h1>
          ${draft.aliases?.length ? `<p class="concept-preview-aliases">Também: ${draft.aliases.map(escapeHtml).join(', ')}</p>` : ''}
          <h2>Fatos</h2>
          <ul>${(draft.facts || []).map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>`;
        body.appendChild(preview);
      }
    }
  }

  {
    const runId = getActiveRun(conceptKey);
    if (runId) {
      concept.run = true;
      concept.tracker = newConceptTracker();
      watchExistingRun(runId, onConceptUpdate).catch(() => {
        clearActiveRun(conceptKey);
        concept.run = false;
        concept.tracker = null;
      });
    }
  }

  for (const [key, button, trackerEl, onCompleted] of [
    [lintKey, lintButton, lintTrackerEl, showLintReport],
    [askKey, askButton, askTrackerEl, showAnswer],
  ]) {
    const runId = getActiveRun(key);
    if (runId) followRun(key, button, trackerEl, (onUpdate) => watchExistingRun(runId, onUpdate), onCompleted, { reattached: true });
  }

  return () => {
    active = false;
    unsubscribeQueue();
    try {
      localStorage.setItem(seenKey, String(Date.now()));
    } catch {
      // "Novo" just won't advance.
    }
    window.removeEventListener('message', onWikiMessage);
    window.removeEventListener('keydown', onSearchShortcut);
  };
}

// Busca local da wiki: compara sem acento nem caixa. Título pesa mais que
// sinônimo, que pesa mais que resumo e texto; com vários termos, a pontuação
// é proporcional aos termos encontrados, então quem casa todos sobe, mas um
// título que casa bem um deles não some.
const FIELD_WEIGHTS = { title: 8, aliases: 5, summary: 2, text: 1 };

function fold(text) {
  return String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function tokens(text) {
  return fold(text).split(/\s+/).filter(Boolean);
}

function prepareEntry(entry) {
  const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];
  return {
    ...entry,
    aliases,
    path: `${entry.group}/${entry.slug}.md`,
    folded: {
      title: fold(entry.title),
      aliases: fold(aliases.join(' | ')),
      summary: fold(entry.summary),
      text: fold(entry.text),
    },
  };
}

function searchWiki(index, text) {
  const terms = tokens(text);
  if (terms.length === 0) return [];
  const results = [];
  for (const entry of index) {
    let score = 0;
    let matched = 0;
    for (const term of terms) {
      let best = 0;
      for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
        const value = entry.folded[field];
        if (!value.includes(term)) continue;
        const bonus = field === 'title' && value.startsWith(term) ? 4 : 0;
        best = Math.max(best, weight + bonus);
      }
      if (best > 0) matched += 1;
      score += best;
    }
    if (matched === 0) continue;
    if (entry.folded.title === fold(text)) score += 20;
    score *= matched / terms.length;
    const alias = entry.aliases.find((a) => terms.some((t) => fold(a).includes(t)) && !terms.every((t) => entry.folded.title.includes(t)));
    results.push({ entry, score, alias });
  }
  return results.sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title, 'pt-BR'));
}

// Trecho do texto em volta do primeiro termo encontrado; sem ocorrência no
// texto, o resumo.
function snippet(entry, terms) {
  const text = entry.text || '';
  const folded = fold(text);
  const at = terms.map((t) => folded.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (at === undefined) return entry.summary || '';
  const start = Math.max(0, at - 60);
  const end = Math.min(text.length, at + 140);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

// Escapa e marca os termos. fold() preserva o comprimento de cada caractere
// pré-composto do português, então o índice no texto dobrado vale no original.
function highlight(text, terms) {
  const value = String(text ?? '');
  const folded = fold(value);
  if (folded.length !== value.length || terms.length === 0) return escapeHtml(value);
  const marks = new Array(value.length).fill(false);
  for (const term of terms) {
    let from = 0;
    for (let i = folded.indexOf(term, from); i >= 0; i = folded.indexOf(term, from)) {
      for (let j = i; j < i + term.length; j += 1) marks[j] = true;
      from = i + term.length;
    }
  }
  let out = '';
  let open = false;
  for (let i = 0; i < value.length; i += 1) {
    if (marks[i] && !open) { out += '<mark>'; open = true; }
    if (!marks[i] && open) { out += '</mark>'; open = false; }
    out += escapeChar(value[i]);
  }
  return open ? `${out}</mark>` : out;
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeChar(c) {
  return HTML_ESCAPES[c] || c;
}

// lintIsBehind says whether the wiki changed after the last "Verificar wiki".
// wiki/index.md is rewritten by every ingest and filed answer, never by the
// verification itself (which writes the pages' alert blocks and lint.md), so
// an index newer than lint.md means content the alerts haven't seen yet. No
// lint.md means the wiki was never verified: nothing to be behind.
function lintIsBehind(byName) {
  const lint = Date.parse(byName['lint.md']?.modifiedAt ?? '');
  const index = Date.parse(byName['index.md']?.modifiedAt ?? '');
  return !Number.isNaN(lint) && !Number.isNaN(index) && index > lint;
}

// renderLintReport shows the last verification (wiki/lint.json, written by
// workflows/shared/wiki/wiki_lint.mh) in the reading pane, laid out like the
// wiki's own pages (WikiHtmlExport.page_css: crumbs, category + title, stat
// tiles, sections of cards, alert tags) — rendered as app DOM rather than an
// iframe because its buttons drive the app (open a page, create a concept).
// The findings themselves were already written into the affected pages as
// "Alertas da revisão". A missing concept gets its action from conceptState.
const CONCEPT_RUN_LABEL = { paused: 'Revisar página', working: 'Gerando…', queued: 'Na fila…' };
const LINT_KIND_LABEL = { sources: 'Fonte', entities: 'Entidade', concepts: 'Conceito', answers: 'Resposta' };

function renderLintReport(result, { conceptState, when, titleOf }) {
  if (!result) return '';
  const resolved = result.resolved_contradictions || [];
  const pill = (ref) => {
    const kind = LINT_KIND_LABEL[ref.split('/')[0]] || 'Página';
    return `<li><button class="lp-pill" data-open-page="${escapeHtml(ref)}"><span class="lp-kind">${kind}</span>${escapeHtml(titleOf(ref) || ref)}</button></li>`;
  };
  const pills = (refs) => `<ul class="lp-links">${refs.map(pill).join('')}</ul>`;
  const alertCard = (kind, tag, text, refs) => `
    <li class="lp-alert lp-alert-${kind}">
      <span class="lp-tag">${tag}</span>
      <div class="lp-alert-text">${escapeHtml(text)}</div>
      ${pills(refs)}
    </li>`;
  const section = (id, title, items, empty, inner) => `
    <section class="lp-section" id="${id}">
      <h2>${title} <span class="lp-count">${items.length}</span></h2>
      ${items.length ? inner(items) : `<p class="lp-empty">${empty}</p>`}
    </section>`;
  const conceptAction = (c, i) => {
    const state = conceptState(c.title);
    if (state.kind === 'exists') return `<button class="button tertiary small" data-open-page="${escapeHtml(state.path)}">${icon('checkCircle', 13)} Abrir página</button>`;
    if (state.kind === 'running') return `<button class="button secondary small" data-create-concept="${i}">${CONCEPT_RUN_LABEL[state.state] || 'Ver criação'}</button>`;
    if (state.kind === 'busy') return `<button class="button tertiary small" disabled title="Outra página de conceito está sendo criada">${icon('plus', 13)} Criar página</button>`;
    return `<button class="button primary small" data-create-concept="${i}" title="A LLM escreve a página só com o que a wiki já diz; você revisa antes de gravar">${icon('plus', 13)} Criar página</button>`;
  };
  const stats = [
    ['lp-contradicoes', result.contradictions.length, 'contradições'],
    ['lp-superados', result.stale_claims.length, 'trechos superados'],
    ['lp-conceitos', result.missing_concepts.length, 'conceitos sem página'],
    ['lp-isoladas', result.orphan_pages.length, 'páginas isoladas'],
  ];
  const pending = result.contradictions.length + result.stale_claims.length;
  const subtitle = [when ? `Gerada ${when}` : null, pending ? `${result.pages_annotated} página(s) receberam alertas da revisão` : 'Nenhuma inconsistência encontrada'].filter(Boolean).join(' · ');
  return `
    <div class="lint-page">
      <nav class="lp-crumbs"><button data-open-index>Wiki</button><span>›</span><span>Verificação</span></nav>
      <header class="lp-head">
        <span class="lp-category">Verificação da wiki</span>
        <h1>Última verificação</h1>
        <p>${escapeHtml(subtitle)}</p>
      </header>
      <div class="lp-stats">
        ${stats.map(([id, n, label]) => `<button class="lp-stat ${n ? 'lp-stat-hot' : ''}" data-jump="${id}"><strong>${n}</strong><span>${label}</span></button>`).join('')}
      </div>
      ${result.notes ? `<aside class="lp-notes"><h2>Observações</h2><p>${escapeHtml(result.notes)}</p></aside>` : ''}
      ${section('lp-contradicoes', 'Contradições pendentes', result.contradictions, 'Nenhuma contradição pendente.', (items) => `
        <ul class="lp-list">${items.map((c) => alertCard('contradiction', 'Contradição', c.description, c.evidence.map((e) => e.page))).join('')}</ul>`)}
      ${resolved.length ? section('lp-resolvidas', 'Resolvidas por fonte mais nova', resolved, '', (items) => `
        <ul class="lp-list">${items.map((c) => alertCard('resolved', 'Resolvida', c.description, [...c.evidence.map((e) => e.page), ...c.resolved_by])).join('')}</ul>`) : ''}
      ${section('lp-superados', 'Trechos superados', result.stale_claims, 'Nenhum trecho superado.', (items) => `
        <ul class="lp-list">${items.map((c) => alertCard('stale', 'Superado', c.description, [c.page, c.superseded_by])).join('')}</ul>`)}
      ${section('lp-conceitos', 'Conceitos sem página', result.missing_concepts, 'Todo conceito citado tem página.', (items) => `
        <ul class="lp-list">${items.map((c, i) => `
          <li class="lp-card lp-concept">
            <div class="lp-concept-head">
              <div><strong>${escapeHtml(c.title)}</strong><small>${escapeHtml(c.description)}</small></div>
              ${conceptAction(c, i)}
            </div>
            ${c.pages?.length ? `<div class="lp-concept-pages"><span class="lp-kind">Citado em ${c.pages.length} páginas</span>${pills(c.pages)}</div>` : ''}
          </li>`).join('')}</ul>`)}
      ${section('lp-isoladas', 'Páginas isoladas', result.orphan_pages, 'Nenhuma página isolada.', (items) => `
        <p class="lp-hint">Nenhuma outra página aponta para estas.</p>${pills(items)}`)}
      ${result.discarded ? `<p class="lp-footnote">${result.discarded} achado(s) descartado(s) na verificação: sem trecho verificável, termo genérico ou conceito que já tem página.</p>` : ''}
    </div>`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}
