import { ToggleMaximise, LogFrontendError } from '../../wailsjs/go/main/App';
import {
  workItemList,
  localProjectList,
  ensureReady,
  mcpStatus,
  reconnectMCP,
  retryStartup,
  getAgent,
  setAgent,
  showWarningDialog,
  listDevinModels,
  getDevinModel,
  getDevinCostSummary,
  setDevinModel,
  listCodexModels,
  getCodexModel,
  setCodexModel,
  listClaudeModels,
  getClaudeModel,
  setClaudeModel,
  appVersion,
  importProject,
} from '../api.js';
import { openNewWorkItemModal } from './new-workitem.js';
import { renderWorkItemView } from './workitem-view.js';
import { getState, setState, subscribe } from '../state.js';
import { mountReadingPane } from '../reading-pane.js';
import { icon } from '../icons.js';
import { getPaneWidth, setPaneWidth } from '../preferences.js';
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
            <button class="icon-btn" aria-label="Importar projeto" title="Importar projeto (.zip)" data-import>${icon('upload', 15)}</button>
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
        <div class="sidebar-agent-block" data-model-row hidden>
          <div class="sidebar-agent">
            <label for="model-select">Modelo</label>
            <select id="model-select" data-model-select>
              <option value="">Carregando…</option>
            </select>
          </div>
          <div class="sidebar-agent-block" data-model-custom-row hidden>
            <input type="text" id="model-custom-input" data-model-custom-input placeholder="nome do modelo" />
            <button class="button secondary small" data-model-custom-apply>Aplicar</button>
          </div>
          <small class="sidebar-agent-hint" data-model-cost></small>
        </div>
        <div class="sidebar-status" data-mcp-status></div>
        <div class="sidebar-version" data-app-version>Senpai</div>
      </aside>
      <div class="pane-resizer" data-pane-resizer="sidebar" role="separator" aria-orientation="vertical" aria-label="Redimensionar menu lateral" tabindex="0"></div>
      <main class="main" data-main></main>
      <div class="pane-resizer" data-pane-resizer="reading-pane" role="separator" aria-orientation="vertical" aria-label="Redimensionar área de pré-visualização" tabindex="0"></div>
      <article class="document reading-pane" data-reading-pane></article>
    </div>
  `;

  const shellEl = root.querySelector('.shell');
  const sidebarEl = root.querySelector('.sidebar');
  const readingPaneEl = root.querySelector('[data-reading-pane]');
  const navList = root.querySelector('[data-nav-list]');
  const filterInput = root.querySelector('[data-filter]');
  const mainEl = root.querySelector('[data-main]');
  const mcpStatusEl = root.querySelector('[data-mcp-status]');
  const agentSelectEl = root.querySelector('[data-agent-select]');
  const modelRow = root.querySelector('[data-model-row]');
  const modelSelectEl = root.querySelector('[data-model-select]');
  const modelCostEl = root.querySelector('[data-model-cost]');
  const modelCustomRow = root.querySelector('[data-model-custom-row]');
  const modelCustomInputEl = root.querySelector('[data-model-custom-input]');
  const modelCustomApplyEl = root.querySelector('[data-model-custom-apply]');
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

  mountReadingPane(readingPaneEl);

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
  // navError: mensagem quando a lista não pôde ser carregada (sem conexão
  // com o mhl, na abertura ou depois). Enquanto existir, renderNav mostra o
  // erro com "Tentar novamente" em vez de "Nenhum work-item ainda." — que
  // seria falso. A lista também é recarregada sozinha quando a conexão
  // volta (onMcpStatus).
  let navError = null;
  let retrying = false;
  let mainStarted = false;

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
    const reconnectButton = `<button class="icon-btn sidebar-status-reconnect${reconnecting ? ' is-spinning' : ''}" data-mcp-reconnect ${reconnecting ? 'disabled' : ''} aria-label="Reconectar ao mhl" title="${reconnecting ? 'Reconectando…' : 'Reiniciar a conexão com o mhl'}">${icon('refreshCw', 14)}</button>`;
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
          onMcpStatus(next);
        } catch (err) {
          reconnecting = false;
          renderMcpStatus({ ready: false, error: String(err) });
          LogFrontendError(`reconnectMCP: failed: ${err && err.stack ? err.stack : err}`).catch(() => {});
        }
      });
    }
  }

  // Conexão de volta com a lista em erro: recarrega sem esperar o clique.
  function onMcpStatus(status) {
    if (status.ready && navError && !retrying) retryProjects();
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
    onMcpStatus(status);
  }
  setInterval(refreshMcpStatus, MCP_STATUS_POLL_MS);

  // Agent picker — changing it needs a fresh mhl process to take effect
  // (SENPAI_AGENT is only read at mhl's own startup, see mhlbridge.Start),
  // so this reuses the exact same reconnect + status-render path as the
  // "Reconectar" button above rather than a separate one.
  //
  // MODEL_CUSTOM_VALUE is a synthetic <option> that reveals the free-text
  // input instead of applying anything itself — every backend accepts it:
  // Codex's list comes from an undocumented `codex debug models` subcommand
  // (see app.go's ListCodexModels doc comment) that may stop returning data
  // in a future CLI version, and Claude has no list command at all (only a
  // fixed set of documented aliases) — `--model` itself always accepts any
  // slug/alias/full name typed directly, so the picker must never be the
  // only way in.
  const MODEL_CUSTOM_VALUE = '__custom__';

  // Keyed by model id so the hint under the select (Devin's cost summary,
  // Codex's description) can be looked up again on every change without
  // another round trip to the list call.
  let modelsById = new Map();

  // set()'s signature differs only for Devin, which also persists the
  // pricing snapshot alongside the model id (see app.go's SetDevinModel);
  // Codex/Claude take just the id.
  const MODEL_PICKERS = {
    devin: {
      list: listDevinModels,
      get: getDevinModel,
      set: (id, model) => setDevinModel(id, model?.costSummary || ''),
      grouped: true,
    },
    codex: { list: listCodexModels, get: getCodexModel, set: (id) => setCodexModel(id), grouped: false },
    claude: { list: listClaudeModels, get: getClaudeModel, set: (id) => setClaudeModel(id), grouped: false },
  };

  function renderModelOptions(models) {
    return models
      .map(
        (model) =>
          `<option value="${escapeAttribute(model.id)}" title="${escapeAttribute(model.costSummary || model.description || '')}">${escapeHtml(model.label)}</option>`,
      )
      .join('');
  }

  function renderGroupedModelOptions(models) {
    const groups = new Map();
    models.forEach((model) => {
      const family = model.familyLabel || 'Outros';
      if (!groups.has(family)) groups.set(family, []);
      groups.get(family).push(model);
    });
    return Array.from(
      groups,
      ([family, variants]) => `<optgroup label="${escapeAttribute(family)}">${renderModelOptions(variants)}</optgroup>`,
    ).join('');
  }

  function updateModelCost() {
    const model = modelsById.get(modelSelectEl.value);
    modelCostEl.textContent = model ? model.costSummary || model.description || '' : '';
  }

  // Applies `id` (from the dropdown or the free-text field) as the current
  // agent's model. Shared by both, so a custom value goes through the exact
  // same reconnect + status-render path as picking a listed one.
  async function applyModel(id) {
    const picker = MODEL_PICKERS[agentSelectEl.value];
    if (!picker || !id) return;
    modelSelectEl.disabled = true;
    modelCustomApplyEl.disabled = true;
    reconnecting = true;
    renderMcpStatus({ ready: false, error: 'Trocando modelo…' });
    try {
      const next = await picker.set(id, modelsById.get(id));
      renderMcpStatus(next);
    } catch (err) {
      renderMcpStatus({ ready: false, error: String(err) });
      LogFrontendError(`setModel(${agentSelectEl.value}): failed: ${err && err.stack ? err.stack : err}`).catch(() => {});
    } finally {
      reconnecting = false;
      modelSelectEl.disabled = false;
      modelCustomApplyEl.disabled = false;
    }
  }

  async function refreshModelPicker() {
    const picker = MODEL_PICKERS[agentSelectEl.value];
    modelRow.hidden = !picker;
    if (!picker) return;

    modelSelectEl.disabled = true;
    modelSelectEl.innerHTML = '<option value="">Carregando…</option>';
    modelCostEl.textContent = '';
    modelCustomRow.hidden = true;

    const selected = await picker.get().catch(() => '');

    let models = [];
    try {
      models = await picker.list();
      modelsById = new Map(models.map((model) => [model.id, model]));
      modelSelectEl.innerHTML = [
        '<option value="">Selecione um modelo…</option>',
        picker.grouped ? renderGroupedModelOptions(models) : renderModelOptions(models),
        `<option value="${MODEL_CUSTOM_VALUE}">Personalizado…</option>`,
      ].join('');
    } catch (err) {
      // The list itself failing (Codex's debug subcommand disappearing, no
      // network, ...) must not take the free-text fallback down with it.
      modelsById = new Map();
      modelSelectEl.innerHTML = [
        '<option value="">Não foi possível listar modelos</option>',
        `<option value="${MODEL_CUSTOM_VALUE}">Personalizado…</option>`,
      ].join('');
      LogFrontendError(`listModels(${agentSelectEl.value}): failed: ${err && err.stack ? err.stack : err}`).catch(() => {});
    }

    if (models.some((model) => model.id === selected)) {
      modelSelectEl.value = selected;
    } else if (selected) {
      // Already-persisted value isn't one of the listed models — either it
      // was set as free text before, or the list changed underneath it.
      // Show it as-is rather than silently reverting the picker's choice.
      modelSelectEl.value = MODEL_CUSTOM_VALUE;
      modelCustomInputEl.value = selected;
      modelCustomRow.hidden = false;
    } else {
      modelSelectEl.value = '';
    }
    modelSelectEl.disabled = false;
    updateModelCost();

    // Devin-only: the cost snapshot the app persisted alongside the model
    // id can go stale (Devin republishes pricing over time) — re-apply so
    // the ledger's pricing reference stays current without a manual pick.
    if (agentSelectEl.value === 'devin' && selected) {
      const savedCostSummary = await getDevinCostSummary().catch(() => '');
      const selectedModel = modelsById.get(selected);
      if (selectedModel && selectedModel.costSummary !== savedCostSummary) {
        const next = await setDevinModel(selected, selectedModel.costSummary || '').catch(() => null);
        if (next) renderMcpStatus(next);
      }
    }
  }

  agentSelectEl.value = (await getAgent().catch(() => '')) || AGENT_OPTIONS[0].value;
  // Listing models invokes an external CLI (Devin/Codex) and may take up to
  // its 30-second backend timeout. It must not sit on the startup critical
  // path: the sidebar, work-item list and selected project are all usable
  // while this picker independently finishes loading (or reports its own
  // error).
  refreshModelPicker().catch((err) => {
    LogFrontendError(`refreshModelPicker: failed: ${err && err.stack ? err.stack : err}`).catch(() => {});
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
      await refreshModelPicker();
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

  modelSelectEl.addEventListener('change', async () => {
    const chosen = modelSelectEl.value;
    updateModelCost();
    if (chosen === MODEL_CUSTOM_VALUE) {
      modelCustomRow.hidden = false;
      modelCustomInputEl.focus();
      return;
    }
    modelCustomRow.hidden = true;
    if (!chosen) return;
    await applyModel(chosen);
  });

  modelCustomApplyEl.addEventListener('click', async () => {
    const value = modelCustomInputEl.value.trim();
    if (!value) return;
    await applyModel(value);
  });
  modelCustomInputEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      modelCustomApplyEl.click();
    }
  });

  navList.innerHTML = '<p class="empty-nav">Carregando…</p>';

  let projects = [];
  let filterText = '';

  async function loadProjects() {
    try {
      projects = await workItemList();
      navError = null;
      // Logged on the happy path too (not just failures) — the only way to
      // tell "the call never ran"/"it ran and returned 0" apart from a
      // rendering-only bug once this is the packaged app, with no console.
      LogFrontendError(`loadProjects: ok, ${projects.length} project(s)`).catch(() => {});
    } catch (err) {
      navError = `Erro ao listar work-items: ${String(err)}`;
      LogFrontendError(`loadProjects: failed: ${err && err.stack ? err.stack : err}`).catch(() => {});
    }
    renderNav();
  }

  // Lista lida direto do disco (App.LocalProjects), sem o mhl: na abertura
  // a barra lateral e o work-item restaurado aparecem enquanto o mhl ainda
  // compila os workflows (~5s). O que precisa dele (resumo, abas, gerar)
  // espera sozinho em api.js (ensureReady). Uma falha aqui não é erro de
  // tela: a lista do mhl, logo em seguida, é a que vale.
  async function loadLocalProjects() {
    try {
      projects = await localProjectList();
      LogFrontendError(`loadLocalProjects: ok, ${projects.length} project(s)`).catch(() => {});
    } catch (err) {
      LogFrontendError(`loadLocalProjects: failed: ${err && err.stack ? err.stack : err}`).catch(() => {});
      return;
    }
    renderNav();
  }

  // Conexão, lista e área principal: a abertura do app e cada nova
  // tentativa passam por aqui, então uma falha na abertura também se
  // recupera (antes, a área principal nunca chegava a ser montada).
  async function startShell() {
    if (!mainStarted && projects.length === 0) {
      await loadLocalProjects();
      if (projects.length > 0) {
        mainStarted = true;
        // Not awaited: the work-item view waits on mhl for its summary and
        // tabs, and the official list below must not wait on that.
        renderMain().catch((err) => LogFrontendError(`renderMain (local): ${err && err.stack ? err.stack : err}`).catch(() => {}));
      }
    }
    await ensureReady();
    await loadProjects();
    if (!mainStarted) {
      mainStarted = true;
      await renderMain();
    }
  }

  async function retryProjects() {
    if (retrying) return;
    retrying = true;
    renderNav();
    try {
      await retryStartup();
      await startShell();
    } catch (err) {
      navError = `Erro ao iniciar: ${String(err)}`;
      LogFrontendError(`retryProjects: failed: ${err && err.stack ? err.stack : err}`).catch(() => {});
    } finally {
      retrying = false;
      renderNav();
      refreshMcpStatus();
    }
  }

  function renderNavError() {
    navList.innerHTML = `
      <div class="empty-nav nav-error">
        <p>${escapeHtml(navError)}</p>
        <button class="button secondary small" data-nav-retry ${retrying ? 'disabled' : ''}>${icon('refreshCw', 13)} ${retrying ? 'Tentando…' : 'Tentar novamente'}</button>
      </div>`;
    navList.querySelector('[data-nav-retry]').addEventListener('click', retryProjects);
  }

  function renderNav() {
    if (navError) {
      renderNavError();
      return;
    }
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

  // Mirrors workitem-view.js's disposeTab: a generation or wiki question
  // started under one work-item keeps running (and writing into the shared
  // reading pane once it resolves) even after the user switches to a
  // different work-item entirely — disposeView() tells the outgoing
  // work-item's view to stop before the next one takes over.
  let disposeView = null;

  async function renderMain(initialTab) {
    renderNav();
    disposeView?.();
    disposeView = null;
    const state = getState();
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

  // pane-resizer: drag either divider (VS Code-style — its own left sidebar
  // and right panel both drag against the editor in between) to resize the
  // pane right next to it. `.main` on either side never gets its own width
  // set directly, it just flexes into whatever space the drag leaves (see
  // style.css's .shell comment). `side` is which way a rightward mouse
  // move/ArrowRight press grows `paneEl`: +1 when the resizer sits on the
  // pane's right edge (sidebar), -1 when it sits on the pane's left edge
  // (reading-pane). Persisted per pane (preferences.js's getPaneWidth/
  // setPaneWidth) so a drag survives a restart, same as sidebar-collapsed/
  // theme below. `max` is a function, not a fixed number — it's evaluated
  // fresh on every move/apply so a window resize between drags is reflected
  // without this needing its own resize listener.
  function initPaneResizer(name, { resizerEl, paneEl, side, min, max }) {
    function applyWidth(px) {
      if (px == null) {
        paneEl.style.flexBasis = '';
        return;
      }
      paneEl.style.flexBasis = `${Math.min(max(), Math.max(min, px))}px`;
    }

    let dragging = false;
    let startX = 0;
    let startWidth = 0;

    function onMouseMove(event) {
      if (!dragging) return;
      applyWidth(startWidth + (event.clientX - startX) * side);
    }

    function stopDragging() {
      if (!dragging) return;
      dragging = false;
      resizerEl.classList.remove('resizing');
      document.body.classList.remove('pane-resizing');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', stopDragging);
      setPaneWidth(name, paneEl.getBoundingClientRect().width);
    }

    resizerEl.addEventListener('mousedown', (event) => {
      event.preventDefault();
      dragging = true;
      startX = event.clientX;
      startWidth = paneEl.getBoundingClientRect().width;
      resizerEl.classList.add('resizing');
      document.body.classList.add('pane-resizing');
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', stopDragging);
    });

    // Keyboard equivalent (role="separator" — see the markup above) — the
    // resizer is a real focusable control, not mouse-only.
    resizerEl.addEventListener('keydown', (event) => {
      const STEP = 24;
      let steps = 0;
      if (event.key === 'ArrowLeft') steps = -1;
      else if (event.key === 'ArrowRight') steps = 1;
      else return;
      event.preventDefault();
      const width = paneEl.getBoundingClientRect().width + steps * STEP * side;
      applyWidth(width);
      setPaneWidth(name, paneEl.getBoundingClientRect().width);
    });

    return { applyWidth };
  }

  const sidebarResizer = initPaneResizer('sidebar', {
    resizerEl: root.querySelector('[data-pane-resizer="sidebar"]'),
    paneEl: sidebarEl,
    side: 1,
    min: 180,
    max: () => Math.min(480, shellEl.clientWidth - 320 - 12),
  });
  const readingPaneResizer = initPaneResizer('reading-pane', {
    resizerEl: root.querySelector('[data-pane-resizer="reading-pane"]'),
    paneEl: readingPaneEl,
    side: -1,
    min: 380,
    max: () => Math.round(shellEl.clientWidth * 0.7),
  });
  readingPaneResizer.applyWidth(getPaneWidth('reading-pane'));

  // Collapsed sidebar: a narrow rail with the brand, the action buttons and
  // each work-item as an icon (name in its tooltip), so navigating still
  // works without expanding it. A standing layout preference, so it's
  // persisted like the theme; localStorage failing just means it starts
  // expanded next time.
  // Two toggle buttons, one per state: expanded, it sits in the top strip
  // right of the macOS window buttons (the brand row has no room left);
  // collapsed, the strip is all window buttons, so it moves into the rail's
  // action column. CSS shows whichever matches.
  //
  // sidebarResizer.applyWidth(null) below clears any dragged width so the
  // collapsed rail falls back to CSS's own fixed 88px (.shell.sidebar-
  // collapsed .sidebar) instead of the inline style (which would otherwise
  // always win over it, dragged-width-or-not) pinning it at whatever the
  // user last dragged. Expanding restores that same dragged width, if any.
  const sidebarToggleEls = [...root.querySelectorAll('[data-toggle-sidebar]')];
  function applySidebarCollapsed(collapsed) {
    shellEl.classList.toggle('sidebar-collapsed', collapsed);
    sidebarToggleEls.forEach((el) => el.setAttribute('aria-expanded', String(!collapsed)));
    sidebarResizer.applyWidth(collapsed ? null : getPaneWidth('sidebar'));
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


  root.querySelector('[data-import]').addEventListener('click', async () => {
    try {
      const imported = await importProject();
      if (!imported) return;
      await loadProjects();
      openWorkItem(imported.project_id, 'fontes');
      if (imported.copied) {
        showWarningDialog(
          'Projeto importado como cópia',
          `Já existe um work-item com o id ${imported.original_id}; o pacote foi importado como "${imported.name}".`,
        );
      }
    } catch (err) {
      showWarningDialog('Não foi possível importar o projeto', String(err.message || err));
    }
  });

  subscribe(() => renderNav());

  try {
    await startShell();
  } catch (err) {
    navError = `Erro ao iniciar: ${String(err)}`;
    renderNav();
    LogFrontendError(`waitUntilReady: failed: ${err && err.stack ? err.stack : err}`).catch(() => {});
  }
  refreshMcpStatus();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

function escapeAttribute(text) {
  return escapeHtml(text).replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
