import { ToggleMaximise, LogFrontendError } from '../../wailsjs/go/main/App';
import { workItemList, waitUntilReady, mcpStatus, reconnectMCP, getAgent, setAgent } from '../api.js';
import { openNewWorkItemModal } from './new-workitem.js';
import { renderWorkItemView } from './workitem-view.js';
import { getState, setState, subscribe } from '../state.js';
import { mountReadingPane } from '../reading-pane.js';
import { icon } from '../icons.js';

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
        <div class="drag-strip"></div>
        <div class="sidebar-top">
          <div class="brand"><span class="brand-mark">S</span><span class="brand-name">Senpai</span></div>
          <div class="sidebar-top-actions">
            <button class="icon-btn" aria-label="Novo work-item" title="Novo work-item" data-create>${icon('plus', 15)}</button>
            <button class="icon-btn" aria-label="Maximizar janela" title="Maximizar/restaurar janela" data-toggle-maximise>${icon('maximize', 15)}</button>
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
        <div class="sidebar-status" data-mcp-status></div>
      </aside>
      <main class="main" data-main></main>
      <article class="document reading-pane" data-reading-pane></article>
    </div>
  `;

  const navList = root.querySelector('[data-nav-list]');
  const filterInput = root.querySelector('[data-filter]');
  const mainEl = root.querySelector('[data-main]');
  const mcpStatusEl = root.querySelector('[data-mcp-status]');
  const agentSelectEl = root.querySelector('[data-agent-select]');

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
    const reconnectButton = !status.ready
      ? `<button class="button secondary small sidebar-status-reconnect" data-mcp-reconnect ${reconnecting ? 'disabled' : ''}>${reconnecting ? 'Reconectando…' : 'Reconectar'}</button>`
      : '';
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
  agentSelectEl.value = (await getAgent().catch(() => '')) || AGENT_OPTIONS[0].value;
  agentSelectEl.addEventListener('change', async () => {
    const chosen = agentSelectEl.value;
    agentSelectEl.disabled = true;
    reconnecting = true;
    renderMcpStatus({ ready: false, error: `Trocando para ${chosen}…` });
    try {
      const next = await setAgent(chosen);
      renderMcpStatus(next);
    } catch (err) {
      renderMcpStatus({ ready: false, error: String(err) });
      LogFrontendError(`setAgent: failed: ${err && err.stack ? err.stack : err}`).catch(() => {});
    } finally {
      reconnecting = false;
      agentSelectEl.disabled = false;
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
        <button class="work ${p.id === state.projectId ? 'active' : ''}" data-id="${p.id}">
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

  root.querySelector('[data-toggle-maximise]').addEventListener('click', () => {
    ToggleMaximise().catch((err) => console.error('ToggleMaximise failed', err));
  });

  root.querySelector('[data-create]').addEventListener('click', async () => {
    const project = await openNewWorkItemModal();
    if (!project) return;
    await loadProjects();
    openWorkItem(project.id, 'fontes');
  });

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
