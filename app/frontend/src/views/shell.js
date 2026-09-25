import { ToggleMaximise, LogFrontendError } from '../../wailsjs/go/main/App';
import {
  workItemList,
  waitUntilReady,
  mcpStatus,
  reconnectMCP,
  getAgent,
  setAgent,
  showWarningDialog,
  listDevinModels,
  getDevinModel,
  getDevinCostSummary,
  setDevinModel,
  appVersion,
} from '../api.js';
import { openNewWorkItemModal } from './new-workitem.js';
import { renderWorkItemView } from './workitem-view.js';
import { renderLogsView } from './logs-view.js';
import { getState, setState, subscribe } from '../state.js';
import { mountReadingPane } from '../reading-pane.js';
import { icon } from '../icons.js';
import brandSymbol from '../assets/images/senpai-symbol.png';

const LEVEL_SHORT = { discovery: 'Discovery', delivery: 'Delivery' };

// AGENT_OPTIONS mirrors workflows/shared/agents/agents.mh's AgentSelector —
// the 3 backends Writer.generate can pick. "" (mhl's own default) isn't
// offered as a fourth choice here: the select always sends one of these 3
// explicit values, defaulting to "codex" (AgentSelector.pick's own default)
// when getAgent() comes back "" (nothing chosen yet).
const AGENT_OPTIONS = [
  { value: 'codex', label: 'Codex' },
  { value: 'claude', label: 'Claude' },
  { value: 'devin', label: 'Devin' },
];

// mountShell builds the whole app chrome once into `root` — left sidebar
// (work-items nav), middle content (whatever's selected: hero, tabs, the
// list/tree for the active tab), and a dedicated reading pane on the right
// (shared across tabs — see reading-pane.js) — then reacts to app-level
// state changes (which work-item is selected) without ever throwing away
// the sidebar DOM.
export async function mountShell(root) {
  root.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="drag-strip">
          <button class="icon-btn sidebar-toggle-expanded" aria-label="Recolher menu lateral" title="Recolher menu lateral" data-toggle-sidebar>${icon('panelLeft', 15)}</button>
        </div>
        <div class="sidebar-top">
          <div class="brand">
            <span class="brand-mark"><img src="${brandSymbol}" alt="" /></span>
            <span class="brand-copy"><span class="brand-name">Senpai</span><small>Refiner</small></span>
          </div>
          <div class="sidebar-top-actions">
            <button class="icon-btn sidebar-toggle-collapsed" aria-label="Expandir menu lateral" title="Expandir menu lateral" data-toggle-sidebar>${icon('panelLeft', 15)}</button>
            <button class="icon-btn" aria-label="Novo work-item" title="Novo work-item" data-create>${icon('plus', 15)}</button>
            <button class="icon-btn" aria-label="Ver logs de execução" title="Ver logs de execução" data-open-logs>${icon('terminal', 15)}</button>
            <button class="icon-btn" aria-label="Maximizar janela" title="Maximizar/restaurar janela" data-toggle-maximise>${icon('maximize', 15)}</button>
            <button class="icon-btn" aria-label="Usar tema claro" title="Usar tema claro" data-theme-toggle>${icon('sun', 15)}</button>
          </div>
        </div>
        <div class="nav-search">${icon('search', 14)}<input placeholder="Buscar work-item..." data-filter /></div>
        <div class="nav-section">Work-items</div>
        <div class="nav-list" data-nav-list></div>
        <div class="sidebar-agent">
          <label for="agent-select">Agente</label>
          <select id="agent-select" data-agent-select>
            ${AGENT_OPTIONS.map((opt) => `<option value="${opt.value}">${opt.label}</option>`).join('')}
          </select>
        </div>
        <div class="sidebar-agent-block" data-devin-model-row hidden>
          <div class="sidebar-agent">
            <label for="devin-model-select">Modelo</label>
            <select id="devin-model-select" data-devin-model-select>
              <option value="">Carregando…</option>
            </select>
          </div>
          <small class="sidebar-agent-hint" data-devin-model-cost></small>
        </div>
        <div class="sidebar-status" data-mcp-status></div>
        <div class="sidebar-version" data-app-version>Senpai</div>
      </aside>
      <main class="main" data-main></main>
      <article class="document reading-pane" data-reading-pane></article>
    </div>
  `;

  const shellEl = root.querySelector('.shell');
  const navList = root.querySelector('[data-nav-list]');
  const filterInput = root.querySelector('[data-filter]');
  const mainEl = root.querySelector('[data-main]');
  const mcpStatusEl = root.querySelector('[data-mcp-status]');
  const agentSelectEl = root.querySelector('[data-agent-select]');
  const devinModelRow = root.querySelector('[data-devin-model-row]');
  const devinModelSelectEl = root.querySelector('[data-devin-model-select]');
  const devinModelCostEl = root.querySelector('[data-devin-model-cost]');
  const appVersionEl = root.querySelector('[data-app-version]');
  const themeToggleEl = root.querySelector('[data-theme-toggle]');

  function renderThemeToggle() {
    const isLight = document.documentElement.dataset.theme === 'light';
    const label = isLight ? 'Usar tema escuro' : 'Usar tema claro';
    themeToggleEl.innerHTML = icon(isLight ? 'moon' : 'sun', 15);
    themeToggleEl.setAttribute('aria-label', label);
    themeToggleEl.title = label;
    themeToggleEl.setAttribute('aria-pressed', String(isLight));
  }

  renderThemeToggle();
  themeToggleEl.addEventListener('click', () => {
    const nextTheme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = nextTheme;
    try {
      localStorage.setItem('senpai-theme', nextTheme);
    } catch {
      // A troca continua válida para a sessão mesmo sem armazenamento local.
    }
    renderThemeToggle();
  });

  appVersionEl.textContent = `Senpai ${await appVersion().catch(() => 'versão desconhecida')}`;

  mountReadingPane(root.querySelector('[data-reading-pane]'));

  // Refreshed on a timer (not just once at startup) because "ready" here is
  // a live /healthz probe, not a cached flag — the mhl child process can die
  // mid-session (see app/mhlbridge/mhlbridge.go's Info doc comment for a
  // real crash this project already hit) with nothing else in the UI
  // surfacing that. No cleanup on unmount: mountShell runs once for the
  // whole app lifetime (see main.js), same as active-runs.js's registry.
  const MCP_STATUS_POLL_MS = 20000;
  // Guards the interval poll from clobbering the "Reconectando…" button
  // state if a 20s tick lands mid-attempt — reconnectMCP() itself already
  // returns the fresh status, so renderMcpStatus below never needs the poll
  // to resolve what a click already knows.
  let reconnecting = false;

  function renderMcpStatus(status) {
    const dot = status.ready ? 'done' : 'failed';
    const plain = status.ready ? `${status.name || 'mhl'} ${status.version || ''}`.trim() : status.error || 'MCP indisponível';
    const html = status.ready ? `<b>${escapeHtml(status.name || 'mhl')}</b> ${escapeHtml(status.version || '')}` : escapeHtml(plain);
    // Shown even when status.ready is true, not just on a detected failure —
    // real gap this closes: /healthz is a plain GET, and Go's own
    // net/http.Transport transparently retries a GET on a fresh connection
    // when the pooled one turns out dead, but does the same for a POST only
    // when it never reached the wire — every mhlbridge RPC call is a POST
    // (JSON-RPC needs a body), so a broken pooled connection can fail real
    // actions with "decode response: EOF" while /healthz keeps reporting
    // ready right through it, hiding the one button that fixes it exactly
    // when it's needed. Always-visible costs nothing when things are fine
    // (reconnectMCP() respawning a healthy mhl is just a brief blip) and
    // guarantees a way out when the probe and reality disagree.
    const reconnectButton = `<button class="button secondary small sidebar-status-reconnect" data-mcp-reconnect ${reconnecting ? 'disabled' : ''} title="Reiniciar a conexão com o mhl">${reconnecting ? 'Reconectando…' : 'Reconectar'}</button>`;
    mcpStatusEl.title = plain; // the only readable status when the sidebar is collapsed to a dot
    mcpStatusEl.innerHTML = `<span class="status-dot ${dot}"></span><span class="sidebar-status-copy" title="${escapeHtml(plain)}">${html}</span>${reconnectButton}`;

    const button = mcpStatusEl.querySelector('[data-mcp-reconnect]');
    if (button) {
      button.addEventListener('click', async () => {
        reconnecting = true;
        renderMcpStatus(status);
        try {
          const next = await reconnectMCP();
          reconnecting = false;
          renderMcpStatus(next);
        } catch (err) {
          reconnecting = false;
          renderMcpStatus({ ready: false, error: String(err) });
          LogFrontendError(`reconnectMCP: failed: ${err && err.stack ? err.stack : err}`).catch(() => {});
        }
      });
    }
  }

  async function refreshMcpStatus() {
    if (reconnecting) return;
    let status;
    try {
      status = await mcpStatus();
    } catch (err) {
      status = { ready: false };
      LogFrontendError(`refreshMcpStatus: failed: ${err && err.stack ? err.stack : err}`).catch(() => {});
    }
    renderMcpStatus(status);
  }
  setInterval(refreshMcpStatus, MCP_STATUS_POLL_MS);

  // Agent picker — changing it needs a fresh mhl process to take effect
  // (SENPAI_AGENT is only read at mhl's own startup, see mhlbridge.Start),
  // so this reuses the exact same reconnect + status-render path as the
  // "Reconectar" button above rather than a separate one.
  // Keyed by model id so the "custo" hint under the select can be looked up
  // again on every change without another round trip to ListDevinModels.
  let devinModelsById = new Map();

  function updateDevinModelCost() {
    const model = devinModelsById.get(devinModelSelectEl.value);
    devinModelCostEl.textContent = model && model.costSummary ? model.costSummary : '';
  }

  async function refreshDevinModels() {
    const isDevin = agentSelectEl.value === 'devin';
    devinModelRow.hidden = !isDevin;
    if (!isDevin) return;

    devinModelSelectEl.disabled = true;
    devinModelSelectEl.innerHTML = '<option value="">Carregando…</option>';
    devinModelCostEl.textContent = '';
    try {
      const [models, selected, savedCostSummary] = await Promise.all([
        listDevinModels(),
        getDevinModel(),
        getDevinCostSummary(),
      ]);
      devinModelsById = new Map(models.map((model) => [model.id, model]));
      const groups = new Map();
      models.forEach((model) => {
        const family = model.familyLabel || 'Outros';
        if (!groups.has(family)) groups.set(family, []);
        groups.get(family).push(model);
      });
      devinModelSelectEl.innerHTML = [
        '<option value="">Selecione um modelo…</option>',
        ...Array.from(groups, ([family, variants]) =>
          `<optgroup label="${escapeAttribute(family)}">${variants
            .map(
              (model) =>
                `<option value="${escapeAttribute(model.id)}" title="${escapeAttribute(model.costSummary || '')}">${escapeHtml(model.label)}</option>`,
            )
            .join('')}</optgroup>`,
        ),
      ].join('');
      devinModelSelectEl.value = models.some((model) => model.id === selected) ? selected : '';
      devinModelSelectEl.disabled = false;
      updateDevinModelCost();
      const selectedModel = devinModelsById.get(selected);
      if (selectedModel && selectedModel.costSummary !== savedCostSummary) {
        const next = await setDevinModel(selected, selectedModel.costSummary || '');
        renderMcpStatus(next);
      }
    } catch (err) {
      devinModelSelectEl.innerHTML = '<option value="">Não foi possível listar</option>';
      LogFrontendError(`listDevinModels: failed: ${err && err.stack ? err.stack : err}`).catch(() => {});
    }
  }

  agentSelectEl.value = (await getAgent().catch(() => '')) || AGENT_OPTIONS[0].value;
  // Listing Devin models invokes an external CLI and may take up to its
  // 30-second backend timeout. It must not sit on the startup critical path:
  // the sidebar, work-item list and selected project are all usable while
  // this picker independently finishes loading (or reports its own error).
  refreshDevinModels().catch((err) => {
    LogFrontendError(`refreshDevinModels: failed: ${err && err.stack ? err.stack : err}`).catch(() => {});
  });
  agentSelectEl.addEventListener('change', async () => {
    const previous = await getAgent().catch(() => '');
    const chosen = agentSelectEl.value;
    agentSelectEl.disabled = true;
    reconnecting = true;
    renderMcpStatus({ ready: false, error: `Trocando para ${chosen}…` });
    try {
      const next = await setAgent(chosen);
      renderMcpStatus(next);
      await refreshDevinModels();
    } catch (err) {
      // SetAgent refuses to swap while a run is active (see app.go) rather
      // than silently killing it — nothing actually changed backend-side,
      // so the picker must not keep showing `chosen` as if it had.
      agentSelectEl.value = previous || AGENT_OPTIONS[0].value;
      // The sidebar status line alone was too easy to miss — it's a small,
      // low-key indicator people read as "is mhl up", not as feedback on
      // the click they just made, so a rejection buried there went
      // unnoticed. A plain window.alert() doesn't fix that here: Wails'
      // macOS webview never wires up the JS alert dialog, so it silently
      // no-ops (confirmed against this build) — showWarningDialog goes
      // through app.go's native runtime.MessageDialog instead, which
      // actually raises something the user sees.
      showWarningDialog('Não foi possível trocar o agente', String(err));
      // Nothing was actually touched — SetAgent refused before reconnecting
      // — so restore the real, still-current status instead of the
      // fabricated ready:false above, which would wrongly read as "the
      // bridge just broke" when it never moved.
      renderMcpStatus(await mcpStatus().catch((statusErr) => ({ ready: false, error: String(statusErr) })));
      LogFrontendError(`setAgent: failed: ${err && err.stack ? err.stack : err}`).catch(() => {});
    } finally {
      reconnecting = false;
      agentSelectEl.disabled = false;
    }
  });

  devinModelSelectEl.addEventListener('change', async () => {
    const chosen = devinModelSelectEl.value;
    updateDevinModelCost();
    if (!chosen) return;
    devinModelSelectEl.disabled = true;
    reconnecting = true;
    renderMcpStatus({ ready: false, error: 'Trocando modelo do Devin…' });
    try {
      const selectedModel = devinModelsById.get(chosen);
      const next = await setDevinModel(chosen, selectedModel?.costSummary || '');
      renderMcpStatus(next);
    } catch (err) {
      renderMcpStatus({ ready: false, error: String(err) });
      LogFrontendError(`setDevinModel: failed: ${err && err.stack ? err.stack : err}`).catch(() => {});
    } finally {
      reconnecting = false;
      devinModelSelectEl.disabled = false;
    }
  });

  navList.innerHTML = '<p class="empty-nav">Carregando…</p>';

  let projects = [];
  let filterText = '';

  async function loadProjects() {
    try {
      projects = await workItemList();
      // Logged on the happy path too (not just failures) — the only way to
      // tell "the call never ran"/"it ran and returned 0" apart from a
      // rendering-only bug once this is the packaged app, with no console.
      LogFrontendError(`loadProjects: ok, ${projects.length} project(s)`).catch(() => {});
    } catch (err) {
      navList.innerHTML = `<p class="empty-nav">Erro ao listar work-items: ${escapeHtml(String(err))}</p>`;
      LogFrontendError(`loadProjects: failed: ${err && err.stack ? err.stack : err}`).catch(() => {});
      return;
    }
    renderNav();
  }

  function renderNav() {
    const state = getState();
    const active = projects.filter((p) => !p.archived);
    const filtered = filterText
      ? active.filter((p) => p.name.toLowerCase().includes(filterText.toLowerCase()))
      : active;

    if (filtered.length === 0) {
      navList.innerHTML = '<p class="empty-nav">Nenhum work-item ainda.</p>';
      return;
    }
    navList.innerHTML = filtered
      .map(
        (p) => `
        <button class="work ${p.id === state.projectId ? 'active' : ''}" data-id="${p.id}" title="${escapeHtml(p.name)}">
          <span class="work-icon">${icon('fileText', 13)}</span>
          <span class="work-copy"><strong>${escapeHtml(p.name)}</strong><span>${LEVEL_SHORT[p.level] || p.level}</span></span>
        </button>
      `,
      )
      .join('');
    navList.querySelectorAll('.work').forEach((button) => {
      button.addEventListener('click', () => openWorkItem(button.dataset.id));
    });
  }

  function openWorkItem(projectId, initialTab) {
    setState({ view: 'workitem', projectId });
    renderMain(initialTab);
  }

  function openLogs() {
    setState({ view: 'logs' });
    renderMain();
  }

  // Mirrors workitem-view.js's disposeTab: a generation or wiki question
  // started under one work-item keeps running (and writing into the shared
  // reading pane once it resolves) even after the user switches to a
  // different work-item entirely — disposeView() tells the outgoing
  // work-item's view to stop before the next one takes over. Also covers
  // switching away from the Logs screen (clears its polling intervals).
  let disposeView = null;

  async function renderMain(initialTab) {
    renderNav();
    disposeView?.();
    disposeView = null;
    const state = getState();
    // A coluna de leitura (reading-pane) so faz sentido junto de um
    // work-item aberto — na tela de Logs ela so mostrava o placeholder da
    // aba anterior ("Fontes não usa a coluna de leitura..."), sobrando
    // largura inútil ao lado do painel de log. Escondida via classe (não
    // desmontada) porque mountReadingPane roda uma vez só, pro app inteiro.
    shellEl.classList.toggle('logs-open', state.view === 'logs');
    if (state.view === 'logs') {
      disposeView = renderLogsView(mainEl);
      return;
    }
    if (!state.projectId) {
      mainEl.innerHTML = '<div class="center">Selecione um work-item ou crie um novo para começar.</div>';
      return;
    }
    let project = projects.find((p) => p.id === state.projectId);
    if (!project) {
      try {
        projects = await workItemList();
        project = projects.find((p) => p.id === state.projectId);
      } catch {
        // fall through to the not-found message below
      }
    }
    if (!project) {
      mainEl.innerHTML = '<div class="center">Work-item não encontrado.</div>';
      return;
    }
    disposeView = await renderWorkItemView(mainEl, project, {
      ...(initialTab ? { initialTab } : {}),
      onDeleted: async () => {
        await loadProjects();
        setState({ view: 'list', projectId: null });
        await renderMain();
      },
    });
  }

  filterInput.addEventListener('input', () => {
    filterText = filterInput.value;
    renderNav();
  });

  // Collapsed sidebar: a narrow rail with the brand, the action buttons and
  // each work-item as an icon (name in its tooltip), so navigating still
  // works without expanding it. A standing layout preference, so it's
  // persisted like the theme; localStorage failing just means it starts
  // expanded next time.
  // Two toggle buttons, one per state: expanded, it sits in the top strip
  // right of the macOS window buttons (the brand row has no room left);
  // collapsed, the strip is all window buttons, so it moves into the rail's
  // action column. CSS shows whichever matches.
  const sidebarToggleEls = [...root.querySelectorAll('[data-toggle-sidebar]')];
  function applySidebarCollapsed(collapsed) {
    shellEl.classList.toggle('sidebar-collapsed', collapsed);
    sidebarToggleEls.forEach((el) => el.setAttribute('aria-expanded', String(!collapsed)));
  }
  let sidebarCollapsed = false;
  try {
    sidebarCollapsed = localStorage.getItem('senpai-sidebar-collapsed') === '1';
  } catch {
    // Starts expanded.
  }
  applySidebarCollapsed(sidebarCollapsed);
  sidebarToggleEls.forEach((el) =>
    el.addEventListener('click', () => {
      sidebarCollapsed = !sidebarCollapsed;
      applySidebarCollapsed(sidebarCollapsed);
      try {
        localStorage.setItem('senpai-sidebar-collapsed', sidebarCollapsed ? '1' : '0');
      } catch {
        // Not persisted — still applies for this session.
      }
    }),
  );

  root.querySelector('[data-toggle-maximise]').addEventListener('click', () => {
    ToggleMaximise().catch((err) => console.error('ToggleMaximise failed', err));
  });

  root.querySelector('[data-create]').addEventListener('click', async () => {
    const project = await openNewWorkItemModal();
    if (!project) return;
    await loadProjects();
    openWorkItem(project.id, 'fontes');
  });

  root.querySelector('[data-open-logs]').addEventListener('click', () => openLogs());

  subscribe(() => renderNav());

  try {
    await waitUntilReady();
  } catch (err) {
    navList.innerHTML = `<p class="empty-nav">Erro ao iniciar: ${escapeHtml(String(err))}</p>`;
    LogFrontendError(`waitUntilReady: failed: ${err && err.stack ? err.stack : err}`).catch(() => {});
    refreshMcpStatus();
    return;
  }
  refreshMcpStatus();
  await loadProjects();
  await renderMain();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

function escapeAttribute(text) {
  return escapeHtml(text).replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
