import { listProjectDir, readProjectFile, startAndWatch, wikiSyncHtml } from '../api.js';
import { renderMarkdown } from '../markdown.js';
import { createRunTracker } from '../run-tracker.js';
import { showMarkdownDoc, showHtmlDoc, showEmpty } from '../reading-pane.js';
import { icon } from '../icons.js';

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
      <button class="button tertiary small" data-lint-btn>${icon('checkCircle', 14)} Verificar wiki</button>
    </div>
    <div class="wiki-group-filters" data-tree-tabs></div>
    <nav class="wiki-card-grid" data-tree></nav>

    <div class="wiki-lint-report">
      <div data-lint-tracker></div>
      <div data-lint-result></div>
    </div>
  `;

  const tabsEl = container.querySelector('[data-tree-tabs]');
  const treeEl = container.querySelector('[data-tree]');
  const wikiCountEl = container.querySelector('[data-wiki-count]');
  showEmpty('Selecione uma página da wiki para ler.');

  // latestByName is listProjectDir's own result, keyed by top-level name
  // (index.md, sources/, entities/, ...) — cached here so switching between
  // sub-tabs is a pure re-render (no re-fetch); buildTree() is the only
  // place that talks to the backend.
  let latestByName = {};
  let selectedGroup = 'index'; // 'index' | one of GROUPS[].dir
  let openPath = null; // currently-open page's data-path, kept across tab switches so the right row re-marks .active

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

  function markActiveRow() {
    treeEl.querySelectorAll('[data-path]').forEach((button) => {
      button.closest('.wiki-page-card')?.classList.toggle('selected', button.dataset.path === openPath);
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

  function renderList() {
    let pages;
    if (selectedGroup === 'index') {
      pages = [{ path: 'index.md', label: 'Índice' }];
    } else {
      const children = (latestByName[selectedGroup]?.children || []).filter((c) => !c.isDir);
      pages = children.map((child) => ({ path: `${selectedGroup}/${child.name}`, label: child.name.replace(/\.md$/, '') }));
    }
    treeEl.innerHTML = pages.length
      ? pages.map((page) => `
          <article class="wiki-page-card ${page.path === openPath ? 'selected' : ''}">
            <button data-path="${escapeHtml(page.path)}" data-label="${escapeHtml(page.label)}">
              <span class="wiki-page-kind"><i>${icon(GROUP_ICONS[selectedGroup] || 'fileText', 14)}</i>${escapeHtml(selectedGroup === 'index' ? 'Índice' : GROUPS.find((g) => g.dir === selectedGroup)?.label || 'Wiki')}</span>
              <strong>${escapeHtml(page.label)}</strong>
              <span>${escapeHtml(GROUP_DESCRIPTIONS[selectedGroup] || 'Página de conhecimento do work-item.')}</span>
              <footer><span class="status-dot done"></span>Disponível para leitura</footer>
            </button>
          </article>`).join('')
      : '<div class="collection-map-empty">Nada aqui ainda.</div>';
    treeEl.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', () => openPage('wiki', button.dataset.path, button.dataset.label).catch(() => {}));
    });
    markActiveRow();
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
    renderTabs();
    renderList();
  }

  await buildTree();
  if (latestByName['index.md']) {
    // Best-effort: garante que wiki/html está atual antes de abrir — se
    // falhar, openPage ainda cai pro .md cru sozinho.
    await wikiSyncHtml(project.id).catch(() => {});
    await openPage('wiki', 'index.md', 'Índice');
  } else {
    showEmpty('Adicione fontes na aba "Fontes" para gerar a wiki.');
  }

  const questionInput = container.querySelector('[data-question]');
  const fileAnswerCheckbox = container.querySelector('[data-file-answer]');
  const askButton = container.querySelector('[data-ask]');
  const askTrackerEl = container.querySelector('[data-ask-tracker]');
  const answerEl = container.querySelector('[data-answer]');

  askButton.addEventListener('click', async () => {
    const question = questionInput.value.trim();
    if (!question) return;
    askButton.disabled = true;
    answerEl.hidden = true;
    const tracker = createRunTracker();
    askTrackerEl.innerHTML = '';
    askTrackerEl.appendChild(tracker.element);
    try {
      await startAndWatch(
        'Wiki',
        { project_id: project.id, action: 'query', question, file_answer: fileAnswerCheckbox.checked },
        async (status) => {
          if (!active) return;
          tracker.update(status);
          if (status.state === 'completed') {
            const result = (status.vars || {}).result || {};
            answerEl.hidden = false;
            answerEl.innerHTML = `<b>${escapeHtml(result.answer_title || question)}</b><div>${renderMarkdown(result.answer_body || '')}</div>`;
            showMarkdownDoc(result.answer_title || question, renderMarkdown(result.answer_body || ''));
            if (result.filed_as) await buildTree();
          }
        },
      );
    } catch (err) {
      if (active) tracker.update({ runId: '', state: 'failed', error: String(err) });
    } finally {
      if (active) askButton.disabled = false;
    }
  });

  const lintButton = container.querySelector('[data-lint-btn]');
  const lintTrackerEl = container.querySelector('[data-lint-tracker]');
  const lintResultEl = container.querySelector('[data-lint-result]');

  lintButton.addEventListener('click', async () => {
    lintButton.disabled = true;
    const tracker = createRunTracker();
    lintTrackerEl.innerHTML = '';
    lintTrackerEl.appendChild(tracker.element);
    lintResultEl.innerHTML = '';
    try {
      await startAndWatch('Wiki', { project_id: project.id, action: 'lint' }, (status) => {
        if (!active) return;
        tracker.update(status);
        if (status.state === 'completed') {
          const result = (status.vars || {}).result;
          lintResultEl.innerHTML = `<pre>${escapeHtml(JSON.stringify(result, null, 2))}</pre>`;
        }
      });
    } catch (err) {
      if (active) tracker.update({ runId: '', state: 'failed', error: String(err) });
    } finally {
      if (active) lintButton.disabled = false;
    }
  });

  return () => {
    active = false;
  };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}
