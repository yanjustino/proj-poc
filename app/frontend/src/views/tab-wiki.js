import { listProjectDir, readProjectFile, startAndWatch, watchExistingRun, isFullyTerminal, wikiSyncHtml } from '../api.js';
import { setActiveRun, getActiveRun, clearActiveRun } from '../active-runs.js';
import { renderMarkdown } from '../markdown.js';
import { createRunTracker } from '../run-tracker.js';
import { showMarkdownDoc, showHtmlDoc, showEmpty } from '../reading-pane.js';
import { icon } from '../icons.js';
import { formatRelativeTime } from '../time-format.js';

const GROUPS = [
  { dir: 'sources', label: 'Fontes' },
  { dir: 'entities', label: 'Entidades' },
  { dir: 'concepts', label: 'Conceitos' },
  { dir: 'answers', label: 'Respostas arquivadas' },
];

const GROUP_ICONS = { index: 'layers', sources: 'fileText', entities: 'inbox', concepts: 'zap', answers: 'checkCircle' };
const GROUP_DESCRIPTIONS = {
  index: 'Visão geral e navegação do conhecimento consolidado.',
  sources: 'Sínteses rastreáveis dos documentos enviados.',
  entities: 'Pessoas, sistemas e organizações relevantes.',
  concepts: 'Termos, regras e ideias centrais do domínio.',
  answers: 'Respostas arquivadas para consulta posterior.',
};

// renderWikiTab owns only the middle column now (ask box + group tabs/tree
// + lint controls) — the actual page content goes to the shared reading
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
    <section class="wiki-query-card">
      <div class="wiki-query-heading"><span>${icon('zap', 15)}</span><div><strong>Pergunte à sua wiki</strong><small>Consulte o conhecimento consolidado neste work-item.</small></div></div>
      <div class="wiki-ask">
        <input type="text" placeholder="O que você quer saber?" data-question />
        <button class="button primary" data-ask>Perguntar</button>
      </div>
      <label class="check"><input type="checkbox" data-file-answer /> Arquivar a resposta como página nova</label>
      <div data-ask-tracker></div>
      <div class="wiki-answer" data-answer hidden></div>
    </section>

    <div class="collection-map-head wiki-map-head">
      <div>
        <div class="collection-map-title"><h2>Páginas da wiki</h2><span data-wiki-count>0 páginas</span></div>
        <p>Conhecimento organizado por fontes, entidades e conceitos.</p>
      </div>
      <div class="collection-map-actions">
        <button class="button tertiary small" data-lint-btn>${icon('checkCircle', 14)} Verificar wiki</button>
        <div class="view-toggle" data-view-toggle>
          <button class="view-toggle-btn" data-view="cards" title="Ver como cards">${icon('grid', 15)}</button>
          <button class="view-toggle-btn" data-view="table" title="Ver como tabela">${icon('list', 15)}</button>
        </div>
      </div>
    </div>
    <label class="wiki-search-box">
      ${icon('search', 14)}
      <input type="search" placeholder="Buscar por título, sinônimo ou conteúdo" aria-label="Buscar na wiki" data-wiki-search />
      <kbd>⌘K</kbd>
    </label>
    <div class="wiki-group-filters" data-tree-tabs></div>
    <nav class="list-area" data-tree></nav>

    <div class="wiki-lint-report">
      <div data-lint-tracker></div>
      <div data-lint-result></div>
    </div>
  `;

  const tabsEl = container.querySelector('[data-tree-tabs]');
  const treeEl = container.querySelector('[data-tree]');
  const wikiCountEl = container.querySelector('[data-wiki-count]');
  const searchInput = container.querySelector('[data-wiki-search]');
  showEmpty('Selecione uma página da wiki para ler.');

  // latestByName is listProjectDir's own result, keyed by top-level name
  // (index.md, sources/, entities/, ...) — cached here so switching between
  // sub-tabs is a pure re-render (no re-fetch); buildTree() is the only
  // place that talks to the backend.
  let latestByName = {};
  let selectedGroup = 'index'; // 'index' | one of GROUPS[].dir
  let openPath = null; // currently-open page's data-path, kept across tab switches so the right row re-marks .active
  // searchIndex is wiki/html/search.json (WikiHtmlExport.search_index),
  // regenerated by every ingest/answer/lint and by the sync on mount. It
  // also gives the list its real page titles (file names are slugs).
  let searchIndex = [];
  let titleByPath = {};
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
    openPath = relative;
    markActiveRow();
    try {
      const html = await readProjectFile(project.id, root, htmlRelativeFor(relative));
      showHtmlDoc(label, html, { allowScripts: true });
    } catch {
      // wiki/html pode ainda não existir pra um work-item cuja wiki foi
      // ingerida antes de sync_html existir e cujo sync no mount (abaixo)
      // falhou por algum motivo — cai pro .md cru em vez de deixar a
      // página vazia.
      try {
        const text = await readProjectFile(project.id, root, relative);
        showMarkdownDoc(label, renderMarkdown(text));
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

  // Índice gets a tab of its own (dir: "index") even though it's a single
  // page, not a directory with children — a uniform "click a tab, see a
  // list, click a row" flow beats special-casing the one entry that isn't
  // really a group.
  function groupsWithContent() {
    const groups = [];
    if (latestByName['index.md']) groups.push({ dir: 'index', label: 'Índice' });
    for (const group of GROUPS) {
      if (latestByName[group.dir]?.children?.length > 0) groups.push(group);
    }
    return groups;
  }

  function renderTabs() {
    const groups = groupsWithContent();
    if (!groups.some((g) => g.dir === selectedGroup)) selectedGroup = groups[0]?.dir ?? 'index';
    tabsEl.innerHTML = groups
      .map((g) => `<button class="collection-filter ${g.dir === selectedGroup ? 'active' : ''}" data-group="${g.dir}">${escapeHtml(g.label)}</button>`)
      .join('');
    tabsEl.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', () => {
        selectedGroup = button.dataset.group;
        renderTabs();
        renderList();
      });
    });
  }

  async function loadSearchIndex() {
    try {
      const entries = JSON.parse(await readProjectFile(project.id, 'wiki', 'html/search.json'));
      searchIndex = Array.isArray(entries) ? entries.map(prepareEntry) : [];
    } catch {
      searchIndex = [];
    }
    titleByPath = Object.fromEntries(searchIndex.map((e) => [e.path, e.title]));
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
    let pages;
    if (selectedGroup === 'index') {
      pages = [{ path: 'index.md', label: 'Índice', modifiedAt: latestByName['index.md']?.modifiedAt }];
    } else {
      const children = (latestByName[selectedGroup]?.children || []).filter((c) => !c.isDir);
      pages = children.map((child) => {
        const path = `${selectedGroup}/${child.name}`;
        return { path, label: titleByPath[path] || child.name.replace(/\.md$/, ''), modifiedAt: child.modifiedAt };
      });
      pages.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
    }
    if (pages.length === 0) {
      treeEl.className = 'list-area';
      treeEl.innerHTML = '<div class="collection-map-empty">Nada aqui ainda.</div>';
      return;
    }
    if (viewMode === 'table') renderTable(pages);
    else renderCardsList(pages);
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
              <footer><span class="status-dot done"></span>Disponível para leitura</footer>
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
            <th>Última atualização</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          ${pages
            .map((page) => {
              const when = formatRelativeTime(page.modifiedAt ? Date.parse(page.modifiedAt) : null);
              return `
                <tr class="data-row ${page.path === openPath ? 'selected' : ''}" data-path="${escapeHtml(page.path)}" data-label="${escapeHtml(page.label)}" title="Abrir ${escapeHtml(page.label)}">
                  <td class="data-row-dot"><span class="status-dot done"></span></td>
                  <td class="data-row-name"><i>${icon(GROUP_ICONS[selectedGroup] || 'fileText', 14)}</i><span>${escapeHtml(page.label)}</span></td>
                  <td class="data-row-when">${escapeHtml(when)}</td>
                  <td class="data-row-actions"><span>Abrir →</span></td>
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

  const questionInput = container.querySelector('[data-question]');
  const fileAnswerCheckbox = container.querySelector('[data-file-answer]');
  const askButton = container.querySelector('[data-ask]');
  const askTrackerEl = container.querySelector('[data-ask-tracker]');
  const answerEl = container.querySelector('[data-answer]');

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
    answerEl.hidden = false;
    answerEl.innerHTML = `<b>${escapeHtml(title)}</b><div>${renderMarkdown(answer.answer_body || '')}</div>`;
    showMarkdownDoc(title, renderMarkdown(answer.answer_body || ''));
    if (answer.filed_as) {
      await loadSearchIndex();
      await buildTree();
    }
  }

  askButton.addEventListener('click', () => {
    const question = questionInput.value.trim();
    if (!question) return;
    answerEl.hidden = true;
    const args = { project_id: project.id, action: 'query', question, file_answer: fileAnswerCheckbox.checked };
    followRun(askKey, askButton, askTrackerEl, (onUpdate) => startAndWatch('Wiki', args, onUpdate), showAnswer);
  });

  const lintButton = container.querySelector('[data-lint-btn]');
  const lintTrackerEl = container.querySelector('[data-lint-tracker]');
  const lintResultEl = container.querySelector('[data-lint-result]');

  // A verificação grava alertas nas páginas: recarrega a lista e o índice
  // de busca junto com o relatório.
  async function showLintReport(result) {
    lintResultEl.innerHTML = renderLintReport(result);
    await loadSearchIndex();
    await buildTree();
  }

  lintButton.addEventListener('click', () => {
    lintResultEl.innerHTML = '';
    followRun(lintKey, lintButton, lintTrackerEl, (onUpdate) => startAndWatch('Wiki', { project_id: project.id, action: 'lint' }, onUpdate), showLintReport);
  });

  for (const [key, button, trackerEl, onCompleted] of [
    [lintKey, lintButton, lintTrackerEl, showLintReport],
    [askKey, askButton, askTrackerEl, showAnswer],
  ]) {
    const runId = getActiveRun(key);
    if (runId) followRun(key, button, trackerEl, (onUpdate) => watchExistingRun(runId, onUpdate), onCompleted, { reattached: true });
  }

  return () => {
    active = false;
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

// renderLintReport shows the verified report Wiki's lint action returns (see
// workflows/shared/wiki/wiki_lint.mh). The same findings were already written
// into the affected pages as "Alertas da revisão" and into wiki/lint.md, so
// this is only the summary of what that run found.
function renderLintReport(result) {
  if (!result) return '';
  const section = (title, items) => `
    <h4>${title} (${items.length})</h4>
    ${items.length ? `<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>` : '<p class="modal-hint">Nenhuma.</p>'}`;
  const pages = (list) => list.map((p) => `<code>${escapeHtml(p)}</code>`).join(', ');
  const total = result.contradictions.length + result.stale_claims.length;
  return `
    <div class="lint-report">
      <p>${total
        ? `${result.pages_annotated} página(s) receberam um bloco <strong>Alertas da revisão</strong>. O relatório completo ficou em <code>wiki/lint.md</code>.`
        : 'Nenhuma inconsistência verificada.'}</p>
      ${section('Contradições', result.contradictions.map((c) => `${escapeHtml(c.description)} — ${pages(c.evidence.map((e) => e.page))}`))}
      ${section('Alegações possivelmente superadas', result.stale_claims.map((c) => `${pages([c.page])} → superada por ${pages([c.superseded_by])}: ${escapeHtml(c.description)}`))}
      ${section('Conceitos sem página', result.missing_concepts.map((c) => `<strong>${escapeHtml(c.title)}</strong>: ${escapeHtml(c.description)}`))}
      ${section('Páginas isoladas', result.orphan_pages.map((p) => pages([p])))}
      ${result.notes ? `<p>${escapeHtml(result.notes)}</p>` : ''}
      ${result.discarded ? `<p class="modal-hint">${result.discarded} achado(s) descartado(s) por não citarem um trecho verificável.</p>` : ''}
    </div>`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}
