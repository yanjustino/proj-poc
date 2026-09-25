import { workItemChangesLog } from '../api.js';
import { formatRelativeTime } from '../time-format.js';

// LABELS mirrors tab-artefatos.js's own map — kept as its own small copy
// here rather than importing that file's internal constant, since this tab
// only ever needs display names, never the dependency graph that comes
// bundled with them there.
const LABELS = {
  brief: 'Brief',
  atributos: 'Atributos de qualidade',
  requisitos: 'Requisitos',
  adr: 'ADRs',
  der: 'DER',
  diagramas: 'Diagramas C4',
  features: 'Backlog da solução',
  dependencias: 'Mapa de dependências',
  historias: 'Histórias',
  feature: 'Detalhamento da feature/enabler',
  historia: 'Detalhamento da história',
};

function labelFor(name) {
  return LABELS[name] || name;
}

// groupKeyOf/groupLabelOf: a plain artifact ("adr") is its own group, but
// Discovery's per-feature histórias need the feature_id folded in too
// ("historias:FT001" as its own group, separate from "historias:FT002") —
// otherwise every feature's own change history would show up mixed
// together under one generic "Histórias" filter, exactly the cross-feature
// leak ChangesBlock.for_artifact itself was built to prevent server-side
// (see changes_log.mh) — this is the same care applied to how the tab
// displays it.
function groupKeyOf(entry) {
  return entry.feature_id ? `${entry.artifact}:${entry.feature_id}` : entry.artifact;
}
function groupLabelOf(entry) {
  return entry.feature_id ? `${labelFor(entry.artifact)} — ${entry.feature_id}` : labelFor(entry.artifact);
}

// renderMudancasTab shows the persisted, cumulative history behind
// ChangesBlock.for_artifact (workflows/shared/artifacts/changes_log.mh) —
// read-only, purely informational: every "Solicitar mudança" ever
// submitted on this work-item, grouped by which artifact it targeted, most
// recent first. Real gap this closes: that history already drives every
// regeneration from now on (each *Generate reads it back as a directive
// list), but until this tab existed there was nowhere in the UI to see
// what had actually accumulated — the only way to know was to infer it
// from the artifact's own content.
export async function renderMudancasTab(container, project) {
  container.innerHTML = `
    <div class="collection-map-head">
      <div>
        <div class="collection-map-title"><h2>Mudanças solicitadas</h2><span data-count>0 pedidos</span></div>
        <p>Todo pedido de "Solicitar mudança" já feito neste work-item, por artefato — é isso que cada geração seguinte aplica.</p>
      </div>
    </div>
    <div class="collection-filters" data-filters></div>
    <div class="list-area" data-list></div>
  `;

  const countEl = container.querySelector('[data-count]');
  const filtersEl = container.querySelector('[data-filters]');
  const listEl = container.querySelector('[data-list]');

  let entries = [];
  let activeFilter = 'all';

  try {
    entries = await workItemChangesLog(project.id);
  } catch (err) {
    listEl.innerHTML = `<p class="doc-empty">Erro ao carregar mudanças: ${escapeHtml(String(err))}</p>`;
    return;
  }

  // Newest first for display — format_changes_log (actions.mh) sorts
  // oldest-first because that's the order *Generate needs to apply
  // directives in (see ChangesBlock's own "a mais recente vale" rule), but
  // a person scanning a changelog wants to see their latest request at the
  // top, not scroll to the bottom for it.
  entries = [...entries].reverse();

  function render() {
    const groups = [...new Map(entries.map((e) => [groupKeyOf(e), groupLabelOf(e)])).entries()];
    filtersEl.innerHTML = ['all', ...groups.map(([key]) => key)]
      .map((key) => {
        const label = key === 'all' ? 'Todos' : groups.find(([k]) => k === key)[1];
        return `<button class="collection-filter ${key === activeFilter ? 'active' : ''}" data-filter="${escapeAttribute(key)}">${escapeHtml(label)}</button>`;
      })
      .join('');
    filtersEl.querySelectorAll('[data-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        activeFilter = button.dataset.filter;
        render();
      });
    });

    const visible = activeFilter === 'all' ? entries : entries.filter((e) => groupKeyOf(e) === activeFilter);
    countEl.textContent = `${entries.length} ${entries.length === 1 ? 'pedido' : 'pedidos'}`;

    if (visible.length === 0) {
      listEl.className = 'list-area';
      listEl.innerHTML = '<div class="collection-map-empty">Nenhuma mudança solicitada ainda — "Solicitar mudança"/"Atualizar" num artefato já aprovado (aba Artefatos) começa esse histórico.</div>';
      return;
    }

    listEl.className = 'list-area data-table-wrap';
    listEl.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Artefato</th>
            <th>Pedido</th>
            <th>Quando</th>
          </tr>
        </thead>
        <tbody>
          ${visible
            .map(
              (entry) => `
                <tr class="data-row static">
                  <td class="data-row-category">${escapeHtml(groupLabelOf(entry))}</td>
                  <td class="data-row-feedback">${escapeHtml(entry.feedback)}</td>
                  <td class="data-row-when">${escapeHtml(formatRelativeTime(Date.parse(entry.at)))}</td>
                </tr>
              `,
            )
            .join('')}
        </tbody>
      </table>
    `;
  }

  render();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}
function escapeAttribute(text) {
  return escapeHtml(text).replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
