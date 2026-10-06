import {
  artifactPreview,
  workItemChangesLog,
  exportProject,
  exportProjectFile,
  attachHistoriaFiles,
  removeHistoriaAttachment,
  exportHandoff,
  buildHandoff,
  workItemReadiness,
  workItemFeatureReview,
  getRunStatus,
  isFullyTerminal,
  listProjectDir,
  readProjectFile,
  cancelRun,
  startAndWatch,
  watchExistingRun,
} from '../api.js';
import { sequenceFor, isReady, missingDeps, featureIdOf, featureTitleOf, computeStaleness, latestMtimeOf, staleHistoriaFeatureIds } from '../artifacts.js';
import { createRunTracker } from '../run-tracker.js';
import { inlineMermaid, hasMermaidDiagram } from '../mermaid-inline.js';
import { beginCustom, buildDocFrame, showHtmlDoc, showEmpty, showAction, showLoading, setFooter, setToolbarAction } from '../reading-pane.js';
import { setActiveRun, getActiveRun, clearActiveRun } from '../active-runs.js';
import { dotClass } from '../status.js';
import { icon } from '../icons.js';
import { sendButtonHtml, enhanceComposer } from '../composer.js';
import { isEditable, isEditorOpen, mountArtifactEditor } from '../artifact-editor.js';
import { approvalRecoveryArgs, waitForRecoveryTerminal } from '../checkpoint-recovery.js';
import { enqueueLlmRun, llmJob, cancelQueuedLlmJob, subscribeLlmJobs } from '../llm-queue.js';
import { formatRelativeTime } from '../time-format.js';

const LABELS = {
  brief: 'Brief',
  atributos: 'Atributos de qualidade',
  requisitos: 'Requisitos',
  adr: 'ADRs',
  der: 'DER',
  modelo: 'Modelo arquitetural',
  diagramas: 'Diagramas C4',
  features: 'Backlog da solução',
  dependencias: 'Mapa de dependências',
  historias: 'Histórias',
  feature: 'Detalhamento da feature / enabler',
  historia: 'Detalhamento da história',
  plano: 'Plano de implementação',
};

function labelFor(name) {
  return LABELS[name] || name;
}

// Shared with tab-logs.js, which titles a run by the artifact it generated.
export { LABELS as ARTIFACT_LABELS };

// Texto do aviso "Desatualizado": artefatos regenerados e/ou a wiki com
// conteúdo novo depois deste artefato.
function staleMessage(staleDeps) {
  const artifacts = staleDeps.filter((d) => d !== 'wiki');
  const parts = [];
  if (artifacts.length) parts.push(`${artifacts.map(labelFor).join(', ')} ${artifacts.length > 1 ? 'foram regenerados' : 'foi regenerado'}`);
  if (staleDeps.includes('wiki')) parts.push('a wiki recebeu conteúdo novo');
  return `Desatualizado: ${parts.join(' e ')} depois deste artefato.`;
}

const ARTIFACT_DESCRIPTIONS = {
  brief: 'Visão executiva, contexto e objetivos que orientam o trabalho.',
  atributos: 'Critérios não funcionais que moldam a qualidade da solução.',
  requisitos: 'Necessidades funcionais, regras de negócio e resultados esperados.',
  adr: 'Escolhas arquiteturais registradas com contexto e consequências.',
  der: 'Entidades, atributos e relacionamentos essenciais do domínio.',
  modelo: 'Pessoas, sistemas externos, contêineres e relações — a fonte dos diagramas de contexto e de contêiner. Edite para redesenhá-los.',
  diagramas: 'Visões dos componentes, limites e principais fluxos do sistema.',
  features: 'Features de negócio e enablers conectados aos requisitos e objetivos.',
  dependencias: 'Grafo de dependências entre itens do backlog e ordem de execução sugerida, gerado junto com o Backlog da solução.',
  historias: 'Histórias detalhadas para implementação e validação.',
  feature: 'Detalhamento da entrega, classificação e critérios de aceite.',
  historia: 'Comportamento esperado, regras e critérios de aceite da história.',
  plano: 'Componentes, dados, fluxo, tarefas e testes para implementar a história.',
};

// GROUP_DESCRIPTIONS: the card description for a synthetic category-group
// row (see groupRowFor) — written by hand instead of falling back to
// ARTIFACT_DESCRIPTIONS[row.entry.artifact] because "Decisões e modelos"
// combines two different artifacts (ADRs + DER) that no single existing
// description covers accurately.
const GROUP_DESCRIPTIONS = {
  'Decisões e modelos': 'Decisões arquiteturais (ADRs) e o modelo de entidades e relacionamentos (DER) da solução.',
  Diagramas: 'O modelo arquitetural e as visões dos componentes, limites e principais fluxos do sistema.',
};

const ARTIFACT_ICONS = {
  brief: 'zap', atributos: 'checkCircle', requisitos: 'fileText', adr: 'layers', der: 'inbox', modelo: 'grid',
  diagramas: 'maximize', features: 'layers', dependencias: 'layers', historias: 'fileText', feature: 'layers', historia: 'fileText', plano: 'list',
};

// ENABLER_SUBTYPE_LABELS: pt-BR display names for a feature's own
// subtipo_enabler enum (workflows/discovery/schemas/features.schema.json,
// mirrored in workflows/delivery/schemas/feature.schema.json for Delivery's
// single "final" feature doc) — "nao_aplicavel" (the default for a
// feature_negocio, or an old checkpoint predating this field — see
// artifact_body.mh's ArtifactBody.feature) is deliberately left out, it
// means "no subtype", not a fourth kind of enabler.
const ENABLER_SUBTYPE_LABELS = {
  exploracao: 'Exploração',
  arquitetura: 'Arquitetura',
  infraestrutura: 'Infraestrutura',
  conformidade: 'Conformidade',
};

// classificationLabelOf turns a {tipoItem, subtipoEnabler} pair (see
// loadFeatureClassifications below) into the pt-BR label the card/table
// shows — "Feature de negócio", "Enabler", or "Enabler — Arquitetura" once
// a subtype is set. Same wording ArtifactHtml.feature_classification
// (workflows/shared/artifacts/artifact_html.mh) already renders INSIDE the
// generated document itself — kept in sync by hand since that's mhl-side
// template code this app can't import, not duplicated by accident.
function classificationLabelOf(classification) {
  if (!classification) return null;
  if (classification.tipoItem !== 'enabler') return 'Feature de negócio';
  const sub = classification.subtipoEnabler !== 'nao_aplicavel' ? ENABLER_SUBTYPE_LABELS[classification.subtipoEnabler] : null;
  return sub ? `Enabler — ${sub}` : 'Enabler';
}

function descriptionFor(row) {
  if (row.isCategoryGroup) return GROUP_DESCRIPTIONS[row.category] || 'Documento gerado a partir do contexto do work-item.';
  if (row.groupKey) return `Documento da coleção ${labelFor(row.entry.artifact)}.`;
  if (row.featureId) return `Histórias vinculadas ao item ${row.featureId}.`;
  if (row.plan) return 'Plano de implementação da história — componentes, tarefas e testes.';
  if (row.historiasRow) return `História vinculada ao item ${row.historiasRow.featureId}.`;
  return ARTIFACT_DESCRIPTIONS[row.entry.artifact] || 'Documento gerado a partir do contexto do work-item.';
}

// PENDING_COLLECTION maps a collection artifact's row key to where its
// pending items live in vars.pending_data (`dataKey`, matching each
// *Generate step's json.parse shape in discovery.mh/delivery.mh — 'adr'
// alone parses to `data.decisions`, everything else matches its own row
// key) and which singular ArtifactPreview artifact renders one item
// standalone (workflows/artifact_preview/artifact_preview.mh's
// Decisao/Diagrama/Feature/Historia steps). Used by appendPausedPreview to
// show a paused batch as N separate documents instead of one concatenated
// page — see that function's comment.
const PENDING_COLLECTION = {
  adr: { dataKey: 'decisions', itemArtifact: 'decisao' },
  diagramas: { dataKey: 'diagramas', itemArtifact: 'diagrama' },
  features: { dataKey: 'features', itemArtifact: 'feature' },
  historias: { dataKey: 'historias', itemArtifact: 'historia' },
};

// itemTitleFromFilename turns a generated file's own basename into a display
// title — "ADR-001-delegar-o-processamento-de-cartoes-ao-payfast.html"
// becomes "ADR-001 — delegar o processamento de cartões ao payfast" (an id
// prefix survives, everything after it just loses its dashes); a diagram's
// filename has no id prefix ("contexto-do-checkout....html") and falls
// through to the plain dash-to-space form.
function itemTitleFromFilename(filename) {
  const base = filename.replace(/\.html$/i, '');
  const match = base.match(/^([A-Za-z]+-\d+)-(.+)$/);
  if (match) return `${match[1]} — ${match[2].replace(/-/g, ' ')}`;
  return base.replace(/-/g, ' ');
}

// folderTitle is itemTitleFromFilename's counterpart for folder-based
// collections (Features, and Delivery's flat Historias) — featureIdOf/
// featureTitleOf already split "FT003-nome-da-feature" into code + title,
// this just recombines them in the same "CODE — title" shape
// itemTitleFromFilename uses, instead of the code silently getting dropped
// (real complaint: the Features cards and the Histórias index showed only
// the title, with no way to tell "US0001" in one feature from "US0001" in
// another — see codedHistoriaTitle below for the composite id that fixes
// that specific case).
function folderTitle(folderName) {
  return `${featureIdOf(folderName)} — ${featureTitleOf(folderName)}`;
}

// codedHistoriaTitle is folderTitle's variant for a história folder nested
// under one feature (Discovery only) — a bare "US0001" repeats across every
// feature's own histórias/ (each feature restarts its own numbering), so
// the id shown/used here is the feature's own code prefixed on, same
// "FT003-US0001" shape the workflow itself would need to disambiguate one
// história from another with the same number in a different feature.
function codedHistoriaTitle(featureFolderName, historiaFolderName) {
  return `${featureIdOf(featureFolderName)}-${featureIdOf(historiaFolderName)} — ${featureTitleOf(historiaFolderName)}`;
}


// renderArtefatosTab owns only the middle-column artifact map — a
// dependency-gated card grid with live status dots. Whatever is
// selected (a live generation, a "gerar" call-to-action, or a finished
// artifact's preview) renders in the shared reading pane (reading-pane.js)
// on the right, matching the 3-column reference layout.
//
// The local `trackers` Map is thrown away on every remount (switching tabs,
// or away from the work-item and back) — but a generation already running
// on the backend keeps running regardless, so on mount this checks
// active-runs.js for anything still in flight for this project and
// reattaches to it (watchExistingRun) instead of showing "pronto para
// gerar" for something that's actually already underway. That registry
// persists across an app restart too (active-runs.js), not just a remount —
// mhl_run_list itself can't be used to rediscover it (session-scoped), but
// mhl_run_status can, by runId alone, once the registry hands one over.
export async function renderArtefatosTab(container, project, { onChanged }) {
  // A generation started here keeps running on the backend regardless of
  // what the user does in the UI (see reattachActiveRuns' comment) — its
  // startAndWatch/watchExistingRun onUpdate callback below outlives this
  // mount whenever the user switches tabs or work-items before the run
  // finishes. Without this flag that callback kept calling renderDetail(),
  // which writes into the *shared* reading pane (reading-pane.js) — so a
  // still-running generation would periodically punch through whatever
  // document the user had since opened elsewhere and replace it with its
  // own progress view. `active` is flipped off by the dispose() this
  // function returns, which workitem-view.js calls before mounting
  // anything else in its place.
  let active = true;
  const sequence = sequenceFor(project);
  const workflow = project.level === 'discovery' ? 'Discovery' : 'Delivery';
  // Fixed for the lifetime of this mount (sequenceFor's own order — Brief/
  // Contexto first, Entrega/Features last), unlike doneNames/collectionChildren
  // below: category is a static property of each sequence entry, not
  // something that depends on what's actually been generated yet, so the
  // category filter's own option list never needs to be recomputed.
  const categories = [...new Set(sequence.map((entry) => entry.category))];

  container.innerHTML = `
    <div class="artifact-map-head">
      <div>
        <div class="artifact-map-title"><h2>Mapa de artefatos</h2><span data-artifact-count>0 itens</span></div>
        <p>Explore, gere e revise os documentos deste work-item.</p>
      </div>
      <div class="artifact-map-controls">
        <span class="dor-summary" data-dor-summary hidden></span>
        <button class="button secondary small" data-handoff hidden title="Gera o pacote de handoff (specs, planos, tarefas, contratos, ADRs e arquitetura) com todas as histórias — as que ainda não estão prontas entram marcadas, não ficam de fora — e exporta para uma pasta, para levar ao repositório de código.">${icon('layers', 14)} Pacote de handoff</button>
        <button class="button secondary small" data-export-all title="Exportar o projeto (fontes, wiki, artefatos, histórico e uso) em um .zip">${icon('download', 14)} Exportar tudo</button>
        <div class="view-toggle" data-view-toggle>
          <button class="view-toggle-btn" data-view="cards" title="Ver como cards">${icon('grid', 15)}</button>
          <button class="view-toggle-btn" data-view="table" title="Ver como tabela">${icon('list', 15)}</button>
        </div>
      </div>
    </div>
    <div class="artifact-filters-row">
      <div class="artifact-category-filters" data-category-filters></div>
      <div class="artifact-filters">
        <button class="artifact-filter active" data-filter="all">Todos</button>
        <button class="artifact-filter" data-filter="ready">Prontos</button>
        <button class="artifact-filter" data-filter="pending">Pendentes</button>
        <button class="artifact-filter" data-filter="stale">Desatualizados</button>
      </div>
    </div>
    <div class="export-status" data-export-status hidden></div>
    <div class="list-area" data-list></div>
  `;

  const listEl = container.querySelector('[data-list]');
  const countEl = container.querySelector('[data-artifact-count]');
  const filterButtons = [...container.querySelectorAll('[data-filter]')];
  const categoryFiltersEl = container.querySelector('[data-category-filters]');
  const exportAllButton = container.querySelector('[data-export-all]');
  const handoffButton = container.querySelector('[data-handoff]');
  const dorSummaryEl = container.querySelector('[data-dor-summary]');
  const exportStatusEl = container.querySelector('[data-export-status]');
  const viewButtons = [...container.querySelectorAll('[data-view]')];
  showEmpty('Selecione um artefato para ler ou gerar.');

  // viewMode: 'table' (default) or 'cards' — table is the default because a
  // work-item with every category filled out (Discovery: Brief, Atributos,
  // Requisitos, N ADRs, DER, N Diagramas, N Features, Dependências, N
  // Histórias per feature) makes the card grid tall enough that scanning
  // for one specific document, or for which ones are stale, means a lot of
  // scrolling — a real complaint once artifact volume grew; the dense table
  // is what most work-items should land on first, cards stay one click
  // away for whoever prefers browsing tiles. Persisted (not per-mount only)
  // since it's a standing preference, same reasoning as shell.js's theme
  // toggle; localStorage failing (private window, disabled storage, ...)
  // just degrades to always defaulting back to 'table'.
  let viewMode = 'table';
  try {
    if (localStorage.getItem('senpai-artifact-view') === 'cards') viewMode = 'cards';
  } catch {
    // Degrades to 'table' — see comment above.
  }
  viewButtons.forEach((button) => button.classList.toggle('active', button.dataset.view === viewMode));
  function setViewMode(mode) {
    viewMode = mode;
    try {
      localStorage.setItem('senpai-artifact-view', mode);
    } catch {
      // Not persisted this time — still applies for the rest of this mount.
    }
    viewButtons.forEach((button) => button.classList.toggle('active', button.dataset.view === mode));
    renderList();
  }
  viewButtons.forEach((button) => button.addEventListener('click', () => setViewMode(button.dataset.view)));

  let doneNames = new Set();
  // One entry per collection-type artifact (adr/diagramas/features/Delivery's
  // historias) — its children once that artifact's dir has any (files for
  // collectionKind 'files', folders for 'folders'). Keyed by entry.artifact,
  // populated generically in refreshDoneState() from each sequence entry's
  // own `dir`/`collectionKind` — adding a new collection-type artifact later
  // needs zero new code here, just its own entry in artifacts.js.
  let collectionChildren = {};
  let historiasDoneFeatureIds = new Set();
  // historiasByFeatureId: short feature id ("FT001") -> { dir, folders } —
  // `dir` is the real historias/<folder> name on disk, `folders` every
  // história folder under it that already has its historia.html committed.
  // Feeds the nested história rows under each feature (historiaItemRowsFor).
  let historiasByFeatureId = new Map();
  // staleHistoriaFeatures: feature ids whose histórias predate the current
  // version of their feature (artifacts.js's staleHistoriaFeatureIds).
  let staleHistoriaFeatures = new Set();
  // expandedFeatures: feature row keys whose nested história rows are
  // showing. Collapsed by default — N features × M histórias each would
  // otherwise bury the rest of the map — and expanded automatically when a
  // generation for that feature starts (generate/reattach), so progress is
  // never hidden behind a closed row.
  const expandedFeatures = new Set();
  // childCounts: parent row key -> how many nested rows it has after the
  // current filters — recomputed by renderList() before each render, read
  // by rowViewModel to decide whether a feature row gets its toggle.
  let childCounts = new Map();
  // statusHeaderCounts: status header key -> how many of its features the
  // current filters show (renderList).
  let statusHeaderCounts = new Map();
  // staleness: artifacts.js's computeStaleness() output — artifact name ->
  // { stale, staleDeps } — real mtimes, not "does a downstream artifact
  // merely exist" (see that function's own comment). Drives both the
  // per-card "desatualizado" badge and downstreamWarningFor's note below.
  let staleness = new Map();
  // lastByName: the raw listProjectDir() tree from the most recent
  // refreshDoneState() call, keyed by top-level name — kept around (not
  // just used locally inside that function) so the table view's "Última
  // geração" column can call artifacts.js's own latestMtimeOf() directly,
  // the exact same function computeStaleness() uses, instead of a second
  // implementation that could quietly disagree with it.
  let lastByName = {};
  // artefato -> quantas edicoes manuais (ArtifactSave) ja constam em
  // changes.jsonl. Regenerar um artefato editado reaplica essas edicoes como
  // instrucoes, entao a tela avisa antes.
  let manualEdits = new Map();
  // featureClassifications: folder name (Discovery, e.g. "FT001-checkout")
  // or the fixed key 'feature' (Delivery's single "final" doc, mode ===
  // 'feature') -> {tipoItem, subtipoEnabler} — populated by
  // loadFeatureClassifications() below. Unlike doneNames/staleness (derived
  // straight from the listProjectDir() tree refreshDoneState() already
  // fetches), this needs each feature's own feature.json read individually
  // — tipo_item/subtipo_enabler aren't filesystem metadata, they're inside
  // the generated document's data — so it's populated separately,
  // fire-and-forget, instead of blocking refreshDoneState() on N extra
  // reads every time it runs.
  let featureClassifications = new Map();
  // featureReviews: Discovery feature folder name ("FT001-checkout") ->
  // {status: 'pendente'|'aprovada'|'rejeitada', motivo} — read from each
  // feature's own status.json (workflows/shared/artifacts/feature_review.mh;
  // no file means "pendente") by loadFeatureReviews(). Awaited inside
  // refreshDoneState(), unlike featureClassifications: the backlog rows are
  // grouped by this status, so rendering before it lands would show every
  // feature under "Pendentes" and then jump.
  let featureReviews = new Map();
  // reviewBusy: feature folder names with an approve/reject/reopen call in
  // flight — disables that feature's review buttons until it settles.
  const reviewBusy = new Set();
  // rejectingKey: the feature row whose reading pane should open with the
  // rejection form already expanded (set by the list's "Rejeitar").
  let rejectingKey = null;
  // readiness: Definition of Ready per história, keyed by its folder path
  // relative to artifacts/ ("" for Delivery's single story) — loaded like
  // featureClassifications, fire-and-forget after each refreshDoneState().
  let readiness = new Map();
  const trackers = new Map(); // key -> { element, update, status }
  // relativeTimeCache: freezes each row's "Última geração" text the first
  // time it's computed against a given lastGeneratedAt(row), keyed by
  // row.key. Without this, tableRowHtml() re-ran formatRelativeTime() (and
  // the whole table re-rendered) on every renderList() call — including the
  // ones onRunUpdate fires for every WatchRun poll tick (500ms, app.go's
  // runPollInterval) while ANY row is generating, whether or not this row's
  // own timestamp actually changed. That's a lot of wasted recompute for
  // text that's only supposed to move forward once real time passes, not on
  // every heartbeat — and reads as the column visibly "ticking". Scoped to
  // this mount (a fresh Map every renderArtefatosTab() call), so leaving and
  // re-entering the tab is exactly when the text is allowed to catch up;
  // within one mount it only updates when the underlying timestamp itself
  // does (a real new generation — see whenLabelFor below).
  const relativeTimeCache = new Map(); // key -> { ms, text }
  let selectedKey = sequence[0]?.artifact ?? null;
  let activeFilter = 'all';
  let activeCategory = 'all';

  // Same disclosure pattern as tab-wiki.js's own group tabs (Fontes/
  // Entidades/Conceitos, .collection-filter) — one pill button per category,
  // built once here since (unlike Wiki's tabs) the category list is static
  // for this mount, not something that grows as content gets generated.
  categoryFiltersEl.innerHTML = ['all', ...categories]
    .map((c) => `<button class="artifact-filter ${c === 'all' ? 'active' : ''}" data-category="${escapeAttribute(c)}">${c === 'all' ? 'Todas' : escapeHtml(c)}</button>`)
    .join('');
  const categoryButtons = [...categoryFiltersEl.querySelectorAll('[data-category]')];
  categoryButtons.forEach((button) => {
    button.addEventListener('click', () => {
      activeCategory = button.dataset.category;
      categoryButtons.forEach((candidate) => candidate.classList.toggle('active', candidate === button));
      renderList();
      renderDetail();
    });
  });

  function showExportStatus(message, state = 'success') {
    exportStatusEl.hidden = false;
    exportStatusEl.className = `export-status ${state}`;
    exportStatusEl.textContent = message;
  }

  // Pacote de handoff: regenerate from the current artifacts, then export.
  handoffButton.addEventListener('click', async () => {
    handoffButton.disabled = true;
    try {
      const summary = await buildHandoff(project.id);
      const destination = await exportHandoff(project.id);
      if (destination) {
        const naoProntas = summary?.nao_prontas ? ` (${summary.nao_prontas} ainda não pronta(s), marcada(s) em cada spec.md e no README)` : '';
        showExportStatus(`Pacote de handoff exportado para ${destination} — ${summary?.total ?? 0} história(s)${naoProntas}.`);
      }
    } catch (err) {
      showExportStatus(`Não foi possível gerar o pacote de handoff: ${String(err.message || err)}`, 'error');
    } finally {
      handoffButton.disabled = false;
    }
  });

  exportAllButton.addEventListener('click', async () => {
    exportAllButton.disabled = true;
    try {
      const destination = await exportProject(project.id);
      if (destination) showExportStatus(`Projeto exportado para ${destination}`);
    } catch (err) {
      showExportStatus(`Não foi possível exportar: ${String(err.message || err)}`, 'error');
    } finally {
      exportAllButton.disabled = false;
    }
  });

  // buildItemRows expands one collection-type entry into its real per-item
  // rows once its dir has children — replacing the single group row that
  // used to hide everything but whichever child happened to sort first.
  // `groupKey` names the entry it came from — onRunUpdate uses it to know
  // where to jump once that entry's own row disappears the moment its
  // children appear.
  function buildItemRows(entry) {
    const children = collectionChildren[entry.artifact] || [];
    return children.map((child) => {
      const previewPath =
        entry.collectionKind === 'folders' ? `${entry.dir}/${child.name}/${entry.itemFile}` : `${entry.dir}/${child.name}`;
      const label = entry.collectionKind === 'folders' ? folderTitle(child.name) : itemTitleFromFilename(child.name);
      const itemId = entry.collectionKind === 'folders' ? featureIdOf(child.name) : child.name;
      // modifiedAt: this exact item's own timestamp for the table view's
      // "Última geração" column — a 'folders' collection's real content is
      // itemFile INSIDE the child folder (the folder itself is only ever
      // touched at creation, same reasoning as artifacts.js's own
      // latestMtimeOf), a 'files' collection's real content is the child
      // file directly.
      const modifiedAt =
        entry.collectionKind === 'folders'
          ? (child.children || []).find((f) => !f.isDir && f.name === entry.itemFile)?.modifiedAt
          : child.modifiedAt;
      return {
        key: `${entry.artifact}-item:${itemId}`,
        label,
        entry,
        groupKey: entry.artifact,
        category: entry.category,
        previewPath,
        modifiedAt,
        // folderName: the real on-disk folder ("FT001-checkout", not just
        // "FT001") — only classificationFor's features lookup needs it
        // (featureClassifications is keyed by this, see loadFeatureClassifications),
        // left undefined for a 'files' collection (adr/diagramas) where
        // there's no folder at all.
        folderName: entry.collectionKind === 'folders' ? child.name : undefined,
      };
    });
  }

  // rowsToRender expands every collection entry that turned out to hold more
  // than one generated document into one row per document (see
  // buildItemRows). Discovery's Features additionally nest each feature's
  // own histórias right under that feature's row (historiasChildRowsFor) —
  // collapsed by default, see expandedFeatures.
  // hasActiveGroupRegeneration: true while a collection artifact (adr/
  // diagramas/features/Delivery's historias) is being regenerated as a
  // WHOLE batch — "Solicitar mudança" fired from inside one of its already-
  // approved items (buildRequestChangesComposer, via canonicalGroupRow).
  // rowsToRender() checks this to temporarily stop expanding that
  // collection into per-item rows while it's true: the group's own row key
  // (entry.artifact, e.g. "adr") is exactly what the regeneration's tracker
  // is keyed under (generate() uses row.key as the trackers Map key), so
  // without this check that in-flight tracker would have no row to attach
  // to in currentRow()/renderDetail() — rowsToRender() would only ever
  // offer the OLD per-item rows, none of them keyed "adr". Deliberately
  // excludes a terminal tracker (completed/failed/canceled): once the
  // regeneration is done, this must go back to false so the collection
  // returns to its normal always-expanded-when-done view — a completed
  // tracker sitting in `trackers` forever (never deleted, see onRunUpdate)
  // would otherwise pin this true permanently after the very first use.
  function hasActiveGroupRegeneration(artifact) {
    const tracker = trackers.get(artifact);
    return Boolean(tracker && tracker.status && !['completed', 'failed', 'canceled'].includes(tracker.status.state));
  }

  // historiasRowFor builds the synthetic per-feature "Histórias" row — the
  // generation target for "Gerar histórias" on a feature row, and the row a
  // running/paused/failed generation shows up as (nested under its feature)
  // until real histórias land on disk. It's never a top-level row anymore:
  // one standalone "Histórias — X" row per feature doubled the length of
  // the backlog for something that's really an action on the feature.
  function historiasRowFor(featureRow) {
    const featureId = featureIdOf(featureRow.folderName);
    return {
      key: 'historias:' + featureId,
      label: `Histórias — ${featureRow.label}`,
      nestedLabel: 'Histórias',
      entry: { artifact: 'historias', deps: ['features'] },
      featureId, // short id ("FT003") — what the workflow's own feature_id argument expects
      featureFolder: featureRow.folderName, // full folder name ("FT003-slug...") — historias/ mirrors features/'s folder naming, and only the full name is a real path
      category: featureRow.category,
      parentKey: featureRow.key,
    };
  }

  // historiaItemRowsFor: one nested row per already-committed história of
  // this feature, each opening its own historia.html directly. `historiasRow`
  // is what "Solicitar mudança" on one of them regenerates — the whole
  // per-feature batch, same reasoning as canonicalGroupRow.
  function historiaItemRowsFor(featureRow, historiasRow) {
    const stories = historiasByFeatureId.get(historiasRow.featureId);
    if (!stories) return [];
    return stories.folders.map((story) => {
      const row = {
        key: `historia-item:${historiasRow.featureId}:${story.name}`,
        label: codedHistoriaTitle(featureRow.folderName, story.name),
        entry: { artifact: 'historia', deps: [] },
        category: featureRow.category,
        previewPath: `historias/${stories.dir}/${story.name}/historia.html`,
        modifiedAt: fileMtime(story.children, 'historia.html'),
        parentKey: featureRow.key,
        historiasRow,
        devFiles: fileNames(story.children),
      };
      row.planRow = planRowFor(row, {
        base: `historias/${stories.dir}/${story.name}`,
        files: story.children,
        featureId: historiasRow.featureId,
        historiaId: featureIdOf(story.name),
        parentKey: featureRow.key,
        deep: true,
      });
      return row;
    });
  }

  function fileNames(files) {
    return (files || []).filter((f) => !f.isDir).map((f) => f.name);
  }

  function fileMtime(files, name) {
    return (files || []).find((f) => !f.isDir && f.name === name)?.modifiedAt;
  }

  // planRowFor: the "Plano de implementação" row of one história — plano.html
  // lives next to its historia.html (`base`, "" for Delivery's single story at
  // the artifacts root). It's only rendered once the plan exists or is being
  // generated (see planChildRows); before that the história row offers
  // "Gerar plano" instead, so N histórias don't add N placeholder rows.
  // `plan` carries what the workflow needs: Discovery takes feature_id +
  // historia_id, Delivery only historia_id ("" for the single story).
  function planRowFor(historiaRow, { base, files, featureId, historiaId, parentKey, deep }) {
    const planModifiedAt = fileMtime(files, 'plano.html');
    return {
      key: `plano:${featureId || '-'}:${historiaId || '-'}`,
      label: `Plano — ${historiaRow.label}`,
      nestedLabel: 'Plano de implementação',
      entry: { artifact: 'plano', deps: [] },
      category: historiaRow.category,
      previewPath: base ? `${base}/plano.html` : 'plano.html',
      modifiedAt: planModifiedAt,
      historiaModifiedAt: fileMtime(files, 'historia.html'),
      planDone: Boolean(planModifiedAt),
      radahn: fileNames(files).includes('radahn.yaml'),
      parentKey,
      deep,
      plan: { featureId: featureId || '', historiaId: historiaId || '' },
    };
  }

  // planChildRows: the plan row to nest right after a história row — when
  // the plan exists, or while its generation hasn't completed (the tracker is
  // keyed by the plan row's own key).
  function planChildRows(historiaRow) {
    const planRow = historiaRow.planRow;
    if (!planRow) return [];
    const tracker = trackers.get(planRow.key);
    const inFlight = tracker && tracker.status && tracker.status.state !== 'completed';
    return planRow.planDone || inFlight ? [planRow] : [];
  }

  // allPlanRows: every história's plan row, rendered or not — what a queued/
  // reattached plan generation resolves its key against (rowForKey,
  // reattachActiveRuns) before its row appears in rowsToRender().
  function allPlanRows() {
    return rowsToRender()
      .filter((r) => r.planRow)
      .map((r) => r.planRow);
  }

  // historiasChildRowsFor: everything nested under one feature row — the
  // in-flight generation row (while its tracker hasn't completed), then the
  // committed histórias themselves (hidden while a regeneration of the same
  // batch is running, same as hasActiveGroupRegeneration does for a
  // top-level collection, since that batch is about to be replaced).
  function historiasChildRowsFor(featureRow) {
    const historiasRow = historiasRowFor(featureRow);
    const children = [];
    const tracker = trackers.get(historiasRow.key);
    if (tracker && tracker.status && tracker.status.state !== 'completed') children.push(historiasRow);
    if (!hasActiveGroupRegeneration(historiasRow.key)) {
      for (const historiaRow of historiaItemRowsFor(featureRow, historiasRow)) {
        children.push(historiaRow, ...planChildRows(historiaRow));
      }
    }
    return children;
  }

  // featureRowsForHistorias: the feature rows histórias can hang off of —
  // Discovery only, and only while Features isn't mid-regeneration. Real
  // bug that gate fixes: *Generate always returns the WHOLE batch fresh
  // (FeaturesCommit wipes features/ and features/historias/ together and
  // mints IDs from scratch), so a "Gerar histórias" fired during that window
  // could target a feature_id that won't exist once the batch lands.
  function featureRowsForHistorias() {
    if (project.level !== 'discovery' || !doneNames.has('features') || hasActiveGroupRegeneration('features')) return [];
    const entry = sequence.find((e) => e.artifact === 'features');
    return entry ? buildItemRows(entry) : [];
  }

  function rowsToRender() {
    const rows = [];
    for (const entry of sequence) {
      if (entry.artifact === 'historias' && project.level === 'discovery') continue;
      if (entry.collectionKind && doneNames.has(entry.artifact) && !hasActiveGroupRegeneration(entry.artifact)) {
        // Discovery's features are collected as blocks (feature + its nested
        // rows) and emitted grouped by review status below.
        const featureBlocks = project.level === 'discovery' && entry.artifact === 'features' ? [] : null;
        for (const itemRow of buildItemRows(entry)) {
          // Delivery's histórias: each one can have its implementation plan,
          // nested under the história itself.
          if (project.level !== 'discovery' && entry.artifact === 'historias') {
            const child = (collectionChildren.historias || []).find((c) => c.name === itemRow.folderName);
            itemRow.devFiles = fileNames(child?.children);
            itemRow.planRow = planRowFor(itemRow, {
              base: `historias/${itemRow.folderName}`,
              files: child?.children,
              featureId: '',
              historiaId: featureIdOf(itemRow.folderName),
              parentKey: itemRow.key,
              deep: false,
            });
          }
          // Nested rows always follow their parent directly — renderList's
          // filtering and both renderers rely on that order.
          if (featureBlocks) {
            featureBlocks.push([itemRow, ...historiasChildRowsFor(itemRow)]);
            continue;
          }
          rows.push(itemRow, ...planChildRows(itemRow));
        }
        if (featureBlocks) rows.push(...groupFeaturesByStatus(featureBlocks));
        continue;
      }
      const row = { key: entry.artifact, label: labelFor(entry.artifact), entry, category: entry.category };
      // Delivery in "historia" mode: the project's single story, at the
      // artifacts root, gets its plan (plano.html) there too.
      if (entry.artifact === 'historia' && doneNames.has('historia')) {
        const rootFiles = Object.values(lastByName).filter((n) => !n.isDir);
        row.devFiles = fileNames(rootFiles);
        row.planRow = planRowFor(row, { base: '', files: rootFiles, featureId: '', historiaId: '', parentKey: row.key, deep: false });
      }
      rows.push(row, ...planChildRows(row));
    }
    return groupCategories(rows);
  }

  // FEATURE_STATUS_GROUPS: the order Discovery's backlog rows are grouped
  // in (featureStatusOf). Within a group the features keep the dependency
  // map's execution order (orderFeaturesByExecution).
  const FEATURE_STATUS_GROUPS = [
    { status: 'pendente', label: 'Pendentes' },
    { status: 'em_aprovacao', label: 'Em aprovação' },
    { status: 'aprovada', label: 'Aprovadas' },
    { status: 'rejeitada', label: 'Rejeitadas' },
  ];

  // groupFeaturesByStatus emits one header row (isStatusHeader) per
  // non-empty status group, followed by that group's feature blocks. The
  // header is only a divider, not a parent: feature rows stay top-level
  // (no parentKey), so their own histórias/plan nesting, the status filters
  // and expand/collapse all keep working exactly as before. renderList drops
  // a header whose features were all filtered out.
  function groupFeaturesByStatus(blocks) {
    const out = [];
    for (const group of FEATURE_STATUS_GROUPS) {
      const members = blocks.filter(([featureRow]) => featureStatusOf(featureRow) === group.status);
      if (members.length === 0) continue;
      out.push({
        key: 'feature-status:' + group.status,
        label: group.label,
        status: group.status,
        category: members[0][0].category,
        entry: { artifact: 'features', deps: [] },
        isStatusHeader: true,
      });
      for (const block of members) out.push(...block);
    }
    return out;
  }

  // GROUPED_CATEGORIES: categories whose flat, top-level rows collapse
  // behind one synthetic "<categoria>" parent row (badge shows the item
  // count) instead of each item showing directly in the top-level list —
  // same chevron/expand mechanism as a Feature's own histórias
  // (expandedFeatures, childCounts), just grouping by category instead of by
  // a single artifact's own sub-items. Requested specifically for "Decisões
  // e modelos" (ADR-001..N + DER — two different `sequence` entries sharing
  // one category) and "Diagramas" (one collection entry). Discovery's own
  // category (Brief/Atributos/Requisitos) and "Backlog da solução"
  // (Features, already nested one-by-one, plus "Mapa de dependências") are
  // deliberately left flat — nobody asked to collapse those, and Backlog
  // already has its own per-feature nesting.
  const GROUPED_CATEGORIES = new Set(['Decisões e modelos', 'Diagramas']);

  // GROUP_REPRESENTATIVE_ARTIFACT: which existing entry.artifact each
  // grouped category borrows for its icon/color/description (see
  // groupRowFor) — reuses ARTIFACT_ICONS/kindClass/ARTIFACT_DESCRIPTIONS'
  // existing entries instead of a second synthetic dictionary to keep in
  // sync. "Decisões e modelos" borrows 'adr' (its own kindClass is already
  // 'decision', same as 'der') rather than a made-up name.
  const GROUP_REPRESENTATIVE_ARTIFACT = { 'Decisões e modelos': 'adr', Diagramas: 'diagramas' };

  // groupRowFor fabricates the category's own parent row — no real artifact
  // behind it, never itself done/ready/stale/generatable on its own (see
  // isRowDone/isRowReady/staleInfoFor's `row.isCategoryGroup` branches and
  // rowViewModel's `clickable` below); just a label plus a place for
  // childCounts/expandedFeatures to hang off of, exactly like a Feature row
  // is for its own histórias.
  function groupRowFor(category) {
    return {
      key: 'group:' + category,
      label: category,
      category,
      entry: { artifact: GROUP_REPRESENTATIVE_ARTIFACT[category], deps: [] },
      isCategoryGroup: true,
    };
  }

  // groupCategories collapses each GROUPED_CATEGORIES category's flat,
  // top-level, ALREADY-GENERATED rows behind one synthetic group-header row
  // per category — a post-pass over the already-built flat list, so it
  // doesn't disturb how adr/der/diagramas are each still constructed as
  // separate sequence entries above; it only regroups their OUTPUT rows.
  // Deliberately excludes a row that isn't done yet (isRowDone(row) false —
  // the collection's own "pronto para gerar"/"depende de..." placeholder,
  // e.g. before any ADR exists) or is mid-regeneration
  // (hasActiveGroupRegeneration(row.key) — the flat in-flight row a whole-
  // batch "Solicitar mudança" replaces its items with, see rowsToRender's
  // own top branch): either one is exactly the row a user needs to see and
  // act on directly, not hidden behind a collapsed parent. Already-nested
  // rows (row.parentKey set, e.g. a feature's histórias) are left untouched
  // — grouping only ever applies one level up, at the top level.
  function groupCategories(rows) {
    const out = [];
    const groups = new Map(); // category -> its group row, first time it's seen
    for (const row of rows) {
      const groupable = !row.parentKey && GROUPED_CATEGORIES.has(row.category) && isRowDone(row) && !hasActiveGroupRegeneration(row.key);
      if (!groupable) {
        out.push(row);
        continue;
      }
      let group = groups.get(row.category);
      if (!group) {
        group = groupRowFor(row.category);
        groups.set(row.category, group);
        out.push(group);
      }
      row.parentKey = group.key;
      out.push(row);
    }
    return out;
  }

  // Data do wiki/index.md — ver computeStaleness (artifacts.js). null se a
  // wiki ainda não existe ou não pôde ser lida: nada fica desatualizado.
  async function wikiMtime() {
    try {
      const index = (await listProjectDir(project.id, 'wiki', '')).find((n) => n.name === 'index.md');
      const t = index?.modifiedAt ? Date.parse(index.modifiedAt) : NaN;
      return Number.isNaN(t) ? null : t;
    } catch {
      return null;
    }
  }

  async function refreshDoneState() {
    let nodes;
    try {
      nodes = await listProjectDir(project.id, 'artifacts', '');
    } catch {
      nodes = [];
    }
    const byName = Object.fromEntries(nodes.map((n) => [n.name, n]));
    lastByName = byName;
    doneNames = new Set();
    for (const entry of sequence) {
      if (entry.artifact === 'historias' && project.level === 'discovery') continue;
      if (entry.dir) {
        const node = byName[entry.dir];
        const children = node && node.children ? node.children : [];
        const hasCommittedDocument =
          entry.collectionKind === 'folders'
            ? children.some((child) =>
                child.isDir && (child.children || []).some((file) => !file.isDir && file.name === entry.itemFile),
              )
            : children.some((child) => !child.isDir && child.name.endsWith('.html'));
        if (hasCommittedDocument) doneNames.add(entry.artifact);
      } else if (entry.path && byName[entry.path]) {
        doneNames.add(entry.artifact);
      }
    }
    collectionChildren = {};
    for (const entry of sequence) {
      if (!entry.collectionKind) continue;
      if (entry.artifact === 'historias' && project.level === 'discovery') continue; // Delivery-only flat historias; Discovery's own is the per-feature index below
      const node = byName[entry.dir];
      const children = node && node.children ? node.children : [];
      // Every generated document now has a semantic .json sibling for LLM
      // context and a visual .html sibling for the UI. Collections must only
      // expose HTML rows, otherwise each ADR/diagram would appear twice and
      // clicking the JSON row would try to render data as a document.
      collectionChildren[entry.artifact] =
        entry.collectionKind === 'folders'
          ? children.filter(
              (c) =>
                c.isDir && (c.children || []).some((file) => !file.isDir && file.name === entry.itemFile),
            )
          : children.filter((c) => !c.isDir && c.name.endsWith('.html'));
    }
    if (project.level === 'discovery' && collectionChildren.features && doneNames.has('dependencias')) {
      collectionChildren.features = await orderFeaturesByExecution(collectionChildren.features);
    }
    featureReviews = project.level === 'discovery' ? await loadFeatureReviews(collectionChildren.features || []) : new Map();
    const historiasNode = byName.historias;
    historiasDoneFeatureIds = new Set();
    historiasByFeatureId = new Map();
    if (project.level === 'discovery' && historiasNode && historiasNode.children) {
      for (const child of historiasNode.children) {
        // isRowDone() looks this set up by the *short* feature id
        // (featureIdOf(folder.name), e.g. "FT001") — storing the full folder
        // name here instead ("FT001-contratacao-...") meant this set could
        // never match, so a per-feature "Histórias — X" row could never be
        // marked done even with real histórias already on disk: every
        // completed/approved generation fell straight back to "Gerar".
        if (!child.isDir) continue;
        const storyFolders = (child.children || []).filter(
          (storyFolder) =>
            storyFolder.isDir &&
            (storyFolder.children || []).some((file) => !file.isDir && file.name === 'historia.html'),
        );
        if (storyFolders.length === 0) continue;
        historiasDoneFeatureIds.add(featureIdOf(child.name));
        historiasByFeatureId.set(featureIdOf(child.name), { dir: child.name, folders: storyFolders });
      }
    }
    staleness = computeStaleness(sequence, doneNames, byName, await wikiMtime());
    staleHistoriaFeatures = staleHistoriaFeatureIds(
      sequence.find((entry) => entry.artifact === 'features'),
      byName,
      historiasByFeatureId,
    );
    try {
      const log = await workItemChangesLog(project.id);
      manualEdits = new Map();
      for (const entry of log) {
        if (entry.origem === 'edicao_manual') manualEdits.set(entry.artifact, (manualEdits.get(entry.artifact) ?? 0) + 1);
      }
    } catch {
      // Sem o historico a tela so deixa de avisar; nada mais depende disto.
    }
    // Fire-and-forget, deliberately not awaited by refreshDoneState() itself
    // — see loadFeatureClassifications' own comment for why this needs its
    // own reads instead of piggybacking on the tree above.
    loadFeatureClassifications();
    loadReadiness();
  }

  // orderFeaturesByExecution sorts Discovery's feature folders by the
  // ordem_execucao in dependencias.json (the topological order the map
  // suggests), so the backlog rows read in implementation order instead of
  // by code. Awaited, unlike loadFeatureClassifications: it's a single read,
  // and rendering first would make the rows visibly jump. Features the map
  // doesn't list (or an unreadable/old dependencias.json) keep their
  // original relative order, after the ones it does.
  async function orderFeaturesByExecution(folders) {
    let ordem;
    try {
      ordem = JSON.parse(await readProjectFile(project.id, 'artifacts', 'dependencias.json'))?.ordem_execucao;
    } catch {
      return folders;
    }
    if (!Array.isArray(ordem)) return folders;
    const position = new Map(ordem.map((item, index) => [item?.feature_codigo, index]));
    const rank = (folder) => position.get(featureIdOf(folder.name)) ?? Infinity;
    return [...folders].sort((a, b) => rank(a) - rank(b));
  }

  // loadFeatureReviews reads every feature's status.json in parallel. A
  // missing or unreadable file is simply "pendente" — that's how every
  // freshly generated backlog starts (ArtifactCommit.features clears
  // features/ entirely, status files included).
  async function loadFeatureReviews(folders) {
    const entries = await Promise.all(
      folders.map((folder) =>
        readProjectFile(project.id, 'artifacts', `features/${folder.name}/status.json`)
          .then((raw) => {
            const data = JSON.parse(raw);
            const status = ['aprovada', 'rejeitada'].includes(data?.status) ? data.status : 'pendente';
            return [folder.name, { status, motivo: data?.motivo ?? '' }];
          })
          .catch(() => [folder.name, { status: 'pendente', motivo: '' }]),
      ),
    );
    return new Map(entries);
  }

  // hasPausedRunFor: a histórias or plan generation of this feature (short
  // id, "FT001") waiting for approval — what puts the feature under "Em
  // aprovação". Only the app knows about runs, so this status is never
  // written to disk.
  function hasPausedRunFor(featureId) {
    for (const [key, tracker] of trackers) {
      if (tracker?.status?.state !== 'paused') continue;
      if (key === 'historias:' + featureId || key.startsWith(`plano:${featureId}:`)) return true;
    }
    return false;
  }

  // featureStatusOf: the review status a Discovery feature row is grouped
  // under. Rejected wins over a paused run (the run can no longer be
  // approved — DiscoveryCommits refuses it); otherwise a paused run means
  // "em_aprovacao" whatever was recorded.
  function featureStatusOf(featureRow) {
    const review = featureReviews.get(featureRow.folderName);
    if (review?.status === 'rejeitada') return 'rejeitada';
    if (hasPausedRunFor(featureIdOf(featureRow.folderName))) return 'em_aprovacao';
    return review?.status === 'aprovada' ? 'aprovada' : 'pendente';
  }

  // isFeatureRejected: by short feature id ("FT001") — what the nested
  // histórias/plan rows carry (row.featureId / row.plan.featureId).
  function isFeatureRejected(featureId) {
    if (!featureId) return false;
    for (const [folderName, review] of featureReviews) {
      if (review.status === 'rejeitada' && featureIdOf(folderName) === featureId) return true;
    }
    return false;
  }

  // reviewFeature runs one approve/reject/reopen decision, then reloads the
  // tree so the row moves to its new status group right away.
  async function reviewFeature(folderName, decisao, motivo = '') {
    if (reviewBusy.has(folderName)) return;
    reviewBusy.add(folderName);
    renderList();
    try {
      await workItemFeatureReview(project.id, featureIdOf(folderName), decisao, motivo);
      if (decisao !== 'aprovar') onChanged();
    } catch (err) {
      showExportStatus(`Não foi possível atualizar ${featureIdOf(folderName)}: ${String(err.message || err)}`, 'error');
    } finally {
      reviewBusy.delete(folderName);
    }
    if (!active) return;
    await refreshDoneState();
    if (!active) return;
    renderList();
    renderDetail();
  }

  async function loadReadiness() {
    const items = await workItemReadiness(project.id).catch(() => []);
    if (!active) return;
    readiness = new Map(items.map((i) => [i.path, i]));
    renderList();
  }

  // storyDir: the folder (relative to artifacts/) of a história row, or null
  // for any other row. Discovery's nested história rows, Delivery's
  // histórias collection items, and Delivery's single story at the root.
  function storyDir(row) {
    const isStory = row.historiasRow || row.groupKey === 'historias' || (row.key === 'historia' && !row.groupKey && isRowDone(row));
    if (!isStory) return null;
    const path = row.previewPath || row.entry.path || '';
    return path.endsWith('historia.html') ? path.slice(0, -'historia.html'.length).replace(/\/$/, '') : null;
  }

  // readinessFor: the story's Definition of Ready, plus one check only the
  // app can make — a plan older than its história (file mtimes).
  function readinessFor(row) {
    const dir = storyDir(row);
    if (dir === null) return null;
    const base = readiness.get(dir);
    if (!base) return null;
    const planStale = row.planRow && staleInfoFor(row.planRow)?.stale;
    if (!planStale) return base;
    const bloqueios = [...base.bloqueios, 'Plano desatualizado — a história foi regerada depois dele; atualize o plano.'];
    return { ...base, bloqueios, status: 'nao_pronta' };
  }

  const DOR_LABEL = { pronta: 'Pronta p/ dev', pronta_com_ressalvas: 'Com ressalvas', nao_pronta: 'Não pronta' };

  // radahnBadgeHtml: the plan's Radahn assessment concluded the história can
  // be built with Radahn — radahn.yaml sits next to plano.html (written only
  // then, see RadahnModel.persist), so its presence is the signal. Shown on
  // the plan row and on its história row.
  function radahnBadgeHtml(row) {
    const applies = row.plan ? row.radahn : (row.devFiles || []).includes('radahn.yaml');
    if (!applies) return '';
    return `<span class="radahn-badge" title="O plano indica que o Radahn (motor low-code de APIs REST) pode implementar esta história — há um radahn.yaml gerado junto com o plano.">${icon('zap', 10)} Radahn</span>`;
  }

  function dorBadgeHtml(r) {
    if (!r) return '';
    const reasons = [...r.bloqueios.map((b) => `✗ ${b}`), ...r.ressalvas.map((x) => `• ${x}`)].join('\n');
    const title = `Definition of Ready: ${DOR_LABEL[r.status]}${reasons ? `\n\n${reasons}` : ''}`;
    return `<span class="dor-badge dor-${r.status}" title="${escapeAttribute(title)}">${escapeHtml(DOR_LABEL[r.status])}</span>`;
  }

  // dorReasonsHtml: the same bloqueios/ressalvas dorBadgeHtml already puts in
  // its `title` — spelled out as a visible list instead of hover-only text.
  // A card/table row has no room for this (dorBadgeHtml's tooltip stays the
  // only affordance there), but the reading pane's dev-files bar does, and
  // that's exactly where someone opens a história to find out why it's
  // "Não pronta"/"Com ressalvas" in the first place — a hint that only shows
  // up on hover is easy to never notice is even there.
  function dorReasonsHtml(r) {
    if (!r || (r.bloqueios.length === 0 && r.ressalvas.length === 0)) return '';
    const items = [
      ...r.bloqueios.map((b) => `<li class="dor-reason-bloqueio">${escapeHtml(b)}</li>`),
      ...r.ressalvas.map((x) => `<li class="dor-reason-ressalva">${escapeHtml(x)}</li>`),
    ].join('');
    return `<ul class="dor-reasons">${items}</ul>`;
  }

  function updateHandoffControls() {
    const stories = [...readiness.values()];
    handoffButton.hidden = stories.length === 0;
    dorSummaryEl.hidden = stories.length === 0;
    const prontas = stories.filter((s) => s.status !== 'nao_pronta').length;
    dorSummaryEl.textContent = `${prontas} de ${stories.length} história(s) prontas p/ dev`;
  }

  // loadFeatureClassifications reads each feature's own feature.json (the
  // semantic sibling ArtifactData.write puts next to feature.html — see
  // that file's own doc comment) to get tipo_item/subtipo_enabler for the
  // "Enabler"/"Feature de negócio" label on its card/row (classificationFor
  // below). Discovery has one per folder under features/; Delivery has
  // exactly one, at the fixed path "feature.json", only when this
  // work-item's own mode is "feature" (mode "historia" has no such doc at
  // all). Each read fails independently (its own .catch swallowing the
  // error, not a shared try/catch around the whole batch) — one missing or
  // unreadable feature.json (an old checkpoint from before this field
  // existed, say) must not blank out every other feature's label, it just
  // leaves that one without a badge. Re-renders the list once done, guarded
  // by `active` the same way every other async callback in this file is —
  // this can still be in flight after the user's navigated away from this
  // tab entirely.
  async function loadFeatureClassifications() {
    const jobs = [];
    const next = new Map();
    function load(key, jsonPath) {
      jobs.push(
        readProjectFile(project.id, 'artifacts', jsonPath)
          .then((raw) => {
            const data = JSON.parse(raw);
            next.set(key, { tipoItem: data?.tipo_item === 'enabler' ? 'enabler' : 'feature_negocio', subtipoEnabler: data?.subtipo_enabler ?? 'nao_aplicavel' });
          })
          .catch(() => {}),
      );
    }
    if (project.level === 'discovery') {
      for (const folder of collectionChildren.features || []) load(folder.name, `features/${folder.name}/feature.json`);
    } else if (project.type === 'feature' && doneNames.has('feature')) {
      load('feature', 'feature.json');
    }
    if (jobs.length === 0) {
      featureClassifications = next;
      return;
    }
    await Promise.all(jobs);
    if (!active) return;
    featureClassifications = next;
    renderList();
  }

  // classificationFor reads featureClassifications for the row this is —
  // Discovery's expanded Features rows (row.folderName, buildItemRows) and
  // Delivery's single "final" feature doc (mode === 'feature', its own row
  // has no groupKey/featureId, just entry.artifact === 'feature'). Every
  // other row (ADRs, Diagramas, Histórias, Delivery's "historia" doc, ...)
  // has no classification at all — returns null rather than guessing.
  function classificationFor(row) {
    if (row.groupKey === 'features' && row.folderName) return featureClassifications.get(row.folderName) ?? null;
    if (!row.groupKey && !row.featureId && row.entry.artifact === 'feature') return featureClassifications.get('feature') ?? null;
    return null;
  }

  function isRowDone(row) {
    if (row.isCategoryGroup) return true; // built only once it has ≥1 done child — see groupCategories
    if (row.groupKey) return true; // expanded item rows only ever exist once their group is done
    if (row.plan) return row.planDone;
    if (row.historiasRow) return true; // nested história rows only exist once committed
    if (row.featureId) return historiasDoneFeatureIds.has(row.featureId);
    return doneNames.has(row.key);
  }

  function isRowReady(row) {
    if (row.isCategoryGroup) return true;
    if (row.groupKey || row.historiasRow || row.plan) return true;
    if (row.featureId) return true; // features already done, per rowsToRender's gating
    return isReady(row.entry, doneNames);
  }

  // staleInfoFor reads the dependency-staleness matrix (computeStaleness,
  // artifacts.js) for the artifact this row represents — an expanded
  // collection item (row.groupKey) shares its group's staleness, since
  // there's no such thing as regenerating just one item (same reasoning as
  // canonicalGroupRow). Per-feature "Histórias — X" rows (row.featureId)
  // aren't in `sequence` at all (see artifacts.js's own comment on why) so
  // they have no entry here — left out rather than guessed at.
  function staleInfoFor(row) {
    // A plan is out of date once its história was regenerated after it —
    // its own files' mtimes, same 2s tolerance as artifacts.js's matrix.
    if (row.plan) {
      const plan = Date.parse(row.modifiedAt || '');
      const historia = Date.parse(row.historiaModifiedAt || '');
      const stale = row.planDone && !Number.isNaN(plan) && !Number.isNaN(historia) && historia - plan > 2000;
      return { stale, staleDeps: stale ? ['historia'] : [] };
    }
    if (row.isCategoryGroup) return null; // no single staleness verdict for a whole category — its own children carry theirs
    if (row.featureId || row.historiasRow) return null;
    const artifact = row.groupKey || row.entry.artifact;
    return staleness.get(artifact) || null;
  }

  // staleStatusFor is what actually gates the "Desatualizado" badge and the
  // "Desatualizados" filter (single source of truth for both, so they can
  // never disagree about which rows count): staleInfoFor's real-mtime data,
  // but only once the row is done AND settled — not mid-regeneration
  // ('working'/'queued'/'paused'), since a fresh generation is exactly what
  // clears staleness and flagging it while that's still in flight would
  // just be noise.
  function staleStatusFor(row) {
    if (!isRowDone(row)) return null;
    const tracker = trackers.get(row.key);
    const state = tracker && tracker.status ? tracker.status.state : 'completed';
    if (state === 'working' || state === 'queued' || state === 'paused') return null;
    return staleInfoFor(row);
  }

  // lastGeneratedAt: epoch-ms (or null) for the table view's "Última
  // geração" column — an expanded collection item (buildItemRows) already
  // carries its OWN exact modifiedAt; every other row falls back to
  // artifacts.js's latestMtimeOf against the last refreshDoneState() tree
  // (same source staleness itself reads, so this can't disagree with it).
  // A per-feature "Histórias — X" row (row.featureId) has no single file of
  // its own to point at — left as null (rendered "—") rather than guessed.
  function lastGeneratedAt(row) {
    if (row.modifiedAt) return Date.parse(row.modifiedAt);
    if (row.featureId || !isRowDone(row)) return null;
    return latestMtimeOf(row.entry, lastByName);
  }

  // whenLabelFor: relativeTimeCache's read/write side — see that Map's own
  // comment for why this doesn't just call formatRelativeTime(ms) directly
  // on every tableRowHtml() call. Recomputes only when `ms` itself moved
  // (a real new generation) or this row was never cached yet; otherwise
  // returns the frozen text from the last time it did.
  function whenLabelFor(row) {
    const ms = lastGeneratedAt(row);
    const cached = relativeTimeCache.get(row.key);
    if (cached && cached.ms === ms) return cached.text;
    const text = formatRelativeTime(ms);
    relativeTimeCache.set(row.key, { ms, text });
    return text;
  }

  // hasPendingHistorias: a Discovery feature row whose histórias haven't
  // been generated yet — counts as "Pendente" in the status filter even
  // though the feature document itself is done, since that's where the
  // "Gerar histórias" action now lives.
  function hasPendingHistorias(row) {
    return (
      project.level === 'discovery' &&
      row.groupKey === 'features' &&
      Boolean(row.folderName) &&
      !historiasDoneFeatureIds.has(featureIdOf(row.folderName)) &&
      featureReviews.get(row.folderName)?.status !== 'rejeitada'
    );
  }

  // rowViewModel computes every derived value a rendered row needs (status
  // text/dot, whether it can be generated/exported right now, its card
  // "kind" color, its staleness) ONCE, shared by both cardHtml and
  // tableRowHtml below — the two views must never quietly disagree about
  // which row is stale, ready, or done, and a single shared computation is
  // what guarantees that instead of relying on two hand-kept-in-sync copies.
  function rowViewModel(row) {
    const tracker = trackers.get(row.key);
    const done = isRowDone(row);
    const ready = isRowReady(row);
    const state = tracker && tracker.status ? tracker.status.state : done ? 'completed' : null;
    const dot = state ? dotClass(state) : '';
    const generatedWith = row.entry?.generatedWith;
    const statusText = state
      ? state === 'completed'
        ? 'gerado'
        : state
      : generatedWith
        ? `gerado com ${labelFor(generatedWith)}`
        : ready
          ? 'pronto para gerar'
          : `depende de: ${missingDeps(row.entry, doneNames).map(labelFor).join(', ')}`;
    // Only exactly the "pronto para gerar" case (ready, not done, no tracker
    // running/failed) gets the inline button — a failed/paused row already
    // has its own action in the reading pane (Tentar novamente / Aprovar e
    // continuar), right next to the content that explains why.
    // A row generated as part of another artifact (generatedWith) never
    // gets its own "Gerar" — it comes from that artifact's run.
    // A rejected feature's own histórias/plan rows never offer generation
    // (FeatureReview.ensure_not_rejected refuses it server-side too).
    const parentRejected = isFeatureRejected(row.featureId || row.plan?.featureId || row.historiasRow?.featureId);
    const showGenerate = ready && !done && !state && !generatedWith && !parentRejected;
    // A category group is never itself openable — it has no document of its
    // own, only children (see groupRowFor) — clicking it should just toggle
    // expand/collapse (data-toggle), wired independently of data-key/
    // clickable below; renderList's own selection-fallback guard keeps it
    // from ever becoming selectedKey on its own, so renderDetail never has
    // to handle it as "the current row" either.
    const clickable = !row.isCategoryGroup && (ready || done || Boolean(state));
    const exportPath = done ? row.previewPath || row.entry.path : '';
    const artifactName = row.entry.artifact;
    const kindClass = ['adr', 'der'].includes(artifactName)
      ? 'decision'
      : ['modelo', 'diagramas'].includes(artifactName)
        ? 'diagram'
        : ['features', 'feature', 'historias', 'historia'].includes(artifactName)
          ? 'feature'
          : 'discovery';
    const stale = staleStatusFor(row);
    const staleTitle = stale?.stale ? staleMessage(stale.staleDeps) : '';
    // updateTarget: the row "Atualizar" fires generate() on, only once this
    // row is both stale AND actually regenerable (updateTargetFor — null
    // for the synthetic per-feature "Histórias — X" row, which never gets a
    // staleness verdict in the first place, so this is mostly just the same
    // guard canRequestChanges/canonicalGroupRow already apply elsewhere).
    const updateTarget = stale?.stale ? updateTargetFor(row) : null;
    const classification = classificationFor(row);
    const classificationLabel = classificationLabelOf(classification);
    // Feature-row-only extras: "Gerar histórias" (no histórias yet and no
    // generation in flight — a failed/canceled one can be retried from here
    // too), how many histórias it already has, and whether it has nested
    // rows to expand at all.
    let canGenerateHistorias = false;
    let historiasCount = 0;
    if (project.level === 'discovery' && row.groupKey === 'features' && row.folderName) {
      const featureId = featureIdOf(row.folderName);
      const historiasTracker = trackers.get('historias:' + featureId);
      const historiasState = historiasTracker && historiasTracker.status ? historiasTracker.status.state : null;
      canGenerateHistorias = !historiasDoneFeatureIds.has(featureId) && (!historiasTracker || ['failed', 'canceled'].includes(historiasState));
      historiasCount = historiasByFeatureId.get(featureId)?.folders.length ?? 0;
    }
    // review: Discovery feature rows only — their approve/reject/reopen
    // actions (feature_review.mh). Reopen undoes either decision.
    let review = null;
    if (project.level === 'discovery' && row.groupKey === 'features' && row.folderName) {
      const status = featureStatusOf(row);
      const recorded = featureReviews.get(row.folderName)?.status ?? 'pendente';
      review = {
        status,
        motivo: featureReviews.get(row.folderName)?.motivo ?? '',
        busy: reviewBusy.has(row.folderName),
        canApprove: recorded === 'pendente',
        canReject: recorded !== 'rejeitada',
        canReopen: recorded !== 'pendente',
      };
      if (recorded === 'rejeitada') canGenerateHistorias = false;
    }
    // Aprovar straight from the list — the same tracker.approve() the
    // reading pane's own toolbar button calls, so the two can't disagree
    // about an approval already in flight (tracker.busyAction).
    const showApprove = state === 'paused';
    const approving = showApprove && tracker.busyAction === 'approve';
    // "Gerar plano" on a história row: no plan yet, and no plan generation in
    // flight (a failed/canceled one can be retried from here too).
    let canGeneratePlan = false;
    if (row.planRow && !row.planRow.planDone) {
      const planTracker = trackers.get(row.planRow.key);
      const planState = planTracker && planTracker.status ? planTracker.status.state : null;
      canGeneratePlan = (!planTracker || ['failed', 'canceled'].includes(planState)) && !isFeatureRejected(row.planRow.plan.featureId);
    }
    const childCount = childCounts.get(row.key) || 0;
    const expanded = expandedFeatures.has(row.key);
    return { done, ready, state, dot, statusText, showGenerate, clickable, exportPath, artifactName, kindClass, stale, staleTitle, updateTarget, classification, classificationLabel, canGenerateHistorias, canGeneratePlan, historiasCount, childCount, expanded, showApprove, approving, review };
  }

  function historiasCountLabel(count) {
    return `${count} ${count === 1 ? 'história' : 'histórias'}`;
  }

  function itemCountLabel(count) {
    return `${count} ${count === 1 ? 'item' : 'itens'}`;
  }

  function generatePlanButtonHtml(row) {
    return `<button class="artifact-card-generate" data-generate-plan="${escapeAttribute(row.key)}" title="Gerar o plano de implementação de ${escapeAttribute(row.label)}">Gerar plano →</button>`;
  }

  function generateHistoriasButtonHtml(row) {
    return `<button class="artifact-card-generate" data-generate-historias="${escapeAttribute(row.key)}" title="Gerar as histórias de ${escapeAttribute(row.label)}">Gerar histórias →</button>`;
  }

  // featureReviewButtonsHtml: a Discovery feature row's own approve/reject/
  // reopen buttons. "Rejeitar" only opens the feature in the reading pane,
  // where the reason is typed (buildFeatureReviewBar).
  function featureReviewButtonsHtml(row, vm) {
    const review = vm.review;
    if (!review) return '';
    const disabled = review.busy ? 'disabled' : '';
    const folder = escapeAttribute(row.folderName);
    return [
      review.canApprove ? `<button class="artifact-card-approve" data-feature-approve="${folder}" title="Aprovar a feature ${escapeAttribute(row.label)}" ${disabled}>${icon('checkCircle', 12)} Aprovar</button>` : '',
      review.canReject ? `<button class="artifact-card-reject" data-feature-reject="${escapeAttribute(row.key)}" title="Rejeitar a feature ${escapeAttribute(row.label)} (pede um motivo)" ${disabled}>${icon('x', 12)} Rejeitar</button>` : '',
      review.canReopen ? `<button class="artifact-card-reopen" data-feature-reopen="${folder}" title="Voltar ${escapeAttribute(row.label)} para Pendente" ${disabled}>${icon('refreshCw', 12)} Reabrir</button>` : '',
    ].join('');
  }

  function rejectedBadgeHtml(vm) {
    if (vm.review?.status !== 'rejeitada') return '';
    return `<span class="feature-review-badge rejeitada" title="${escapeAttribute(vm.review.motivo ? `Motivo: ${vm.review.motivo}` : 'Feature rejeitada')}">Rejeitada</span>`;
  }

  function approveButtonHtml(row, vm) {
    return `<button class="artifact-card-approve" data-approve="${escapeAttribute(row.key)}" title="Aprovar ${escapeAttribute(row.label)}" ${vm.approving ? 'disabled' : ''}>${icon('checkCircle', 12)} ${vm.approving ? 'Aplicando…' : 'Aprovar'}</button>`;
  }

  function cardHtml(row, vm) {
    return `
      <article class="artifact-card ${vm.kindClass} ${row.key === 'brief' ? 'featured' : ''} ${row.key === selectedKey ? 'selected' : ''} ${!vm.done ? 'pending' : ''} ${vm.stale?.stale ? 'stale' : ''} ${row.parentKey ? 'nested' : ''} ${row.deep ? 'nested-deep' : ''}">
        <button class="artifact-card-main" data-key="${escapeHtml(row.key)}" ${!vm.clickable ? 'disabled' : ''} title="${escapeHtml(vm.statusText)}">
          <span class="artifact-card-kind"><i>${icon(ARTIFACT_ICONS[vm.artifactName] || 'fileText', 14)}</i>${escapeHtml(row.category || labelFor(vm.artifactName))}</span>
          <strong>${escapeHtml(row.parentKey ? row.nestedLabel || row.label : row.label)}</strong>
          ${vm.classificationLabel ? `<span class="artifact-card-classification ${vm.classification.tipoItem === 'enabler' ? 'enabler' : 'business'}">${escapeHtml(vm.classificationLabel)}</span>` : ''}
          ${dorBadgeHtml(readinessFor(row))}${radahnBadgeHtml(row)}${rejectedBadgeHtml(vm)}
          <span class="artifact-card-description">${escapeHtml(descriptionFor(row))}</span>
          ${vm.stale?.stale ? `<span class="artifact-card-stale" title="${escapeAttribute(vm.staleTitle)}">${icon('alertCircle', 12)} Desatualizado</span>` : ''}
        </button>
        <footer class="artifact-card-foot">
          <span class="status-dot ${vm.dot}"></span><span>${escapeHtml(vm.statusText)}</span>
          <div class="artifact-card-foot-actions">
            ${vm.childCount ? `<button class="artifact-card-toggle ${vm.expanded ? 'expanded' : ''}" data-toggle="${escapeAttribute(row.key)}" aria-expanded="${vm.expanded}" title="${vm.expanded ? 'Recolher' : 'Expandir'} ${row.isCategoryGroup ? 'itens' : 'histórias'}">${icon('chevronRight', 12)} ${escapeHtml(row.isCategoryGroup ? itemCountLabel(vm.childCount) : vm.historiasCount || row.groupKey === 'features' ? historiasCountLabel(vm.historiasCount || vm.childCount) : 'Plano')}</button>` : ''}
            ${vm.canGenerateHistorias ? generateHistoriasButtonHtml(row) : ''}
            ${vm.canGeneratePlan ? generatePlanButtonHtml(row) : ''}
            ${vm.showApprove ? approveButtonHtml(row, vm) : ''}
            ${featureReviewButtonsHtml(row, vm)}
            ${vm.exportPath ? `<button class="artifact-card-export" data-export-file="${escapeAttribute(vm.exportPath)}" title="Exportar ${escapeAttribute(row.label)}">${icon('download', 12)} Exportar</button>` : ''}
            ${vm.updateTarget ? `<button class="artifact-card-update" data-update="${escapeHtml(row.key)}" title="Regenerar ${escapeAttribute(row.label)} a partir da versão atual da dependência">${icon('refreshCw', 12)} Atualizar</button>` : ''}
            ${vm.showGenerate ? `<button class="artifact-card-generate" data-generate="${escapeHtml(row.key)}" title="Gerar ${escapeHtml(row.label)}">Gerar →</button>` : ''}
          </div>
        </footer>
      </article>
    `;
  }

  // tableRowHtml: the dense alternative to cardHtml for a work-item whose
  // artifact volume grew past what a scrolling card grid scans well — one
  // row per artifact, sortable-at-a-glance by category/status/recency
  // instead of a grid of tiles. `data-key` only appears when the row is
  // actually clickable (mirrors cardHtml's `disabled` button — a `<tr>` has
  // no native disabled state, so the click listener below simply never
  // attaches to an unclickable one instead).
  function tableRowHtml(row, vm) {
    const when = whenLabelFor(row);
    return `
      <tr class="data-row ${row.key === selectedKey ? 'selected' : ''} ${!vm.done ? 'pending' : ''} ${vm.stale?.stale ? 'stale' : ''} ${!vm.clickable ? 'not-ready' : ''} ${row.parentKey ? 'nested' : ''} ${row.deep ? 'nested-deep' : ''}" ${vm.clickable ? `data-key="${escapeHtml(row.key)}"` : ''} title="${escapeHtml(vm.statusText)}">
        <td class="data-row-dot"><span class="status-dot ${vm.dot}"></span></td>
        <td class="data-row-name">
          ${
            vm.childCount
              ? `<button class="data-row-toggle ${vm.expanded ? 'expanded' : ''}" data-toggle="${escapeAttribute(row.key)}" aria-expanded="${vm.expanded}" title="${vm.expanded ? 'Recolher' : 'Expandir'} ${row.isCategoryGroup ? 'itens' : 'histórias'}">${icon('chevronRight', 12)}</button>`
              : row.groupKey === 'features' && project.level === 'discovery'
                ? '<span class="data-row-toggle-spacer"></span>'
                : ''
          }
          <i>${icon(ARTIFACT_ICONS[vm.artifactName] || 'fileText', 14)}</i>
          <span>${escapeHtml(row.parentKey ? row.nestedLabel || row.label : row.label)}</span>
          ${row.isCategoryGroup ? `<span class="data-row-count">${escapeHtml(itemCountLabel(vm.childCount))}</span>` : vm.historiasCount ? `<span class="data-row-count">${escapeHtml(historiasCountLabel(vm.historiasCount))}</span>` : ''}
          ${vm.stale?.stale ? `<span class="artifact-card-stale" title="${escapeAttribute(vm.staleTitle)}">${icon('alertCircle', 12)} Desatualizado</span>` : ''}
        </td>
        <td class="data-row-classification">${vm.classificationLabel ? `<span class="artifact-card-classification ${vm.classification.tipoItem === 'enabler' ? 'enabler' : 'business'}">${escapeHtml(vm.classificationLabel)}</span>` : ''}${dorBadgeHtml(readinessFor(row))}${radahnBadgeHtml(row)}${rejectedBadgeHtml(vm)}</td>
        <td class="data-row-category">${escapeHtml(row.category || labelFor(vm.artifactName))}</td>
        <td class="data-row-status">${escapeHtml(vm.statusText)}</td>
        <td class="data-row-when">${escapeHtml(when)}</td>
        <td class="data-row-actions">
          ${vm.canGenerateHistorias ? generateHistoriasButtonHtml(row) : ''}
          ${vm.canGeneratePlan ? generatePlanButtonHtml(row) : ''}
          ${vm.showApprove ? approveButtonHtml(row, vm) : ''}
          ${featureReviewButtonsHtml(row, vm)}
          ${vm.exportPath ? `<button class="artifact-card-export" data-export-file="${escapeAttribute(vm.exportPath)}" title="Exportar ${escapeAttribute(row.label)}">${icon('download', 12)}</button>` : ''}
          ${vm.updateTarget ? `<button class="artifact-card-update" data-update="${escapeHtml(row.key)}" title="Regenerar ${escapeAttribute(row.label)} a partir da versão atual da dependência">${icon('refreshCw', 12)} Atualizar</button>` : ''}
          ${vm.showGenerate ? `<button class="artifact-card-generate" data-generate="${escapeHtml(row.key)}" title="Gerar ${escapeHtml(row.label)}">Gerar →</button>` : ''}
        </td>
      </tr>
    `;
  }

  // statusHeaderRowHtml/statusHeaderCardHtml: the divider above one review
  // status group of Discovery's backlog (groupFeaturesByStatus).
  function statusHeaderLabel(row) {
    const count = statusHeaderCounts.get(row.key) || 0;
    return `${row.label} · ${count} ${count === 1 ? 'feature' : 'features'}`;
  }

  function statusHeaderRowHtml(row) {
    return `<tr class="data-row feature-status-header ${escapeAttribute(row.status)}"><td colspan="7"><span class="feature-review-dot ${escapeAttribute(row.status)}"></span>${escapeHtml(statusHeaderLabel(row))}</td></tr>`;
  }

  function statusHeaderCardHtml(row) {
    return `<div class="artifact-status-header ${escapeAttribute(row.status)}"><span class="feature-review-dot ${escapeAttribute(row.status)}"></span>${escapeHtml(statusHeaderLabel(row))}</div>`;
  }

  function renderCards(visibleRows) {
    listEl.className = 'list-area artifact-card-grid';
    // visibleRows is already grouped by category in array order — every
    // *_SEQUENCE in artifacts.js declares same-category entries contiguously,
    // and buildItemRows()/the per-feature "Histórias — X" push both expand
    // in place without disturbing that order — so a header only needs to
    // fire when this row's category differs from the row right before it,
    // no separate grouping/sorting pass needed.
    listEl.innerHTML = visibleRows
      .map((row, index) => {
        const headerHtml =
          index === 0 || row.category !== visibleRows[index - 1].category
            ? `<div class="artifact-group-header"><h3>${escapeHtml(row.category || labelFor(row.entry.artifact))}</h3></div>`
            : '';
        if (row.isStatusHeader) return headerHtml + statusHeaderCardHtml(row);
        return headerHtml + cardHtml(row, rowViewModel(row));
      })
      .join('');
  }

  function renderTable(visibleRows) {
    listEl.className = 'list-area data-table-wrap';
    listEl.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th></th>
            <th>Nome</th>
            <th>Classificação</th>
            <th>Categoria</th>
            <th>Status</th>
            <th>Última geração</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          ${visibleRows.map((row) => (row.isStatusHeader ? statusHeaderRowHtml(row) : tableRowHtml(row, rowViewModel(row)))).join('')}
        </tbody>
      </table>
    `;
  }

  function renderList() {
    const rows = rowsToRender();
    function passesFilter(row) {
      if (activeCategory !== 'all' && row.category !== activeCategory) return false;
      if (activeFilter === 'all') return true;
      if (activeFilter === 'stale') return Boolean(staleStatusFor(row)?.stale);
      return activeFilter === 'ready' ? isRowDone(row) : !isRowDone(row) || hasPendingHistorias(row);
    }
    // Filters apply to top-level rows only — a nested row (a feature's
    // histórias) is shown exactly when its parent is, so the status filter
    // never leaves an orphan história floating without its feature.
    // rowsToRender() always emits a parent before its children, so one pass
    // is enough.
    const shownParents = new Set();
    const passedRows = rows.filter((row) => {
      if (row.isStatusHeader) return true;
      if (row.parentKey) return shownParents.has(row.parentKey);
      if (!passesFilter(row)) return false;
      shownParents.add(row.key);
      return true;
    });
    // A status header (groupFeaturesByStatus) survives only if at least one
    // of its features did; statusHeaderCounts is how many did.
    statusHeaderCounts = new Map();
    let currentHeader = null;
    for (const row of passedRows) {
      if (row.isStatusHeader) currentHeader = row.key;
      else if (row.parentKey) continue;
      else if (currentHeader && row.groupKey === 'features') statusHeaderCounts.set(currentHeader, (statusHeaderCounts.get(currentHeader) || 0) + 1);
      else currentHeader = null;
    }
    const filteredRows = passedRows.filter((row) => !row.isStatusHeader || statusHeaderCounts.has(row.key));
    childCounts = new Map();
    for (const row of filteredRows) {
      if (row.parentKey) childCounts.set(row.parentKey, (childCounts.get(row.parentKey) || 0) + 1);
    }
    const visibleRows = filteredRows.filter((row) => !row.parentKey || expandedFeatures.has(row.parentKey));
    // Checked against filteredRows, not visibleRows: a selected história
    // inside a feature the user just collapsed is still a valid selection.
    // Never falls back onto a category-group row (isCategoryGroup) — it has
    // no document of its own to show in the reading pane; it's never
    // clickable either (rowViewModel), so this is the only other path that
    // could otherwise assign it to selectedKey.
    if (!selectedKey || !filteredRows.some((r) => r.key === selectedKey)) {
      selectedKey = visibleRows.find((r) => !r.isCategoryGroup && !r.isStatusHeader)?.key ?? null;
    }
    const topLevelCount = rows.filter((row) => !row.parentKey && !row.isStatusHeader).length;
    countEl.textContent = `${topLevelCount} ${topLevelCount === 1 ? 'item' : 'itens'}`;
    updateHandoffControls();

    if (visibleRows.length === 0) {
      listEl.className = 'list-area';
      listEl.innerHTML = '<div class="artifact-map-empty">Nenhum artefato neste filtro.</div>';
      return;
    }

    if (viewMode === 'table') renderTable(visibleRows);
    else renderCards(visibleRows);

    // [data-key] is the row's own click target — cardHtml's <button> or
    // tableRowHtml's <tr> — so this one listener covers both views; a
    // row that isn't clickable (rowViewModel's `clickable`) simply carries
    // no data-key at all in table mode, or a real `disabled` button in card
    // mode, so neither ever reaches here.
    listEl.querySelectorAll('[data-key]').forEach((el) => {
      el.addEventListener('click', () => {
        selectedKey = el.dataset.key;
        renderList();
        renderDetail();
      });
    });

    listEl.querySelectorAll('[data-toggle]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const key = button.dataset.toggle;
        if (expandedFeatures.has(key)) expandedFeatures.delete(key);
        else expandedFeatures.add(key);
        renderList();
      });
    });

    listEl.querySelectorAll('[data-generate-historias]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const featureRow = rowsToRender().find((r) => r.key === button.dataset.generateHistorias);
        if (!featureRow) return;
        const row = historiasRowFor(featureRow);
        selectedKey = row.key;
        generate(row);
      });
    });

    listEl.querySelectorAll('[data-generate-plan]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const historiaRow = rowsToRender().find((r) => r.key === button.dataset.generatePlan);
        if (!historiaRow?.planRow) return;
        selectedKey = historiaRow.planRow.key;
        generate(historiaRow.planRow);
      });
    });

    listEl.querySelectorAll('[data-approve]').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        const key = button.dataset.approve;
        const tracker = trackers.get(key);
        if (!tracker) return;
        const approval = tracker.approve();
        // tracker.approve() already repaints the tracker itself (and the
        // reading pane's own Aprovar, if this row is open there) — the list
        // needs its own repaint for "Aplicando…", and again once it settles:
        // a failed approval only updates the tracker's internal status, it
        // never reaches onRunUpdate.
        renderList();
        await approval;
        if (!active) return;
        renderList();
        if (selectedKey === key) renderDetail();
      });
    });

    listEl.querySelectorAll('[data-feature-approve]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        reviewFeature(button.dataset.featureApprove, 'aprovar');
      });
    });

    listEl.querySelectorAll('[data-feature-reopen]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        reviewFeature(button.dataset.featureReopen, 'reabrir');
      });
    });

    // "Rejeitar" opens the feature with the reason form already showing —
    // the reason lives in the reading pane, which renderList's frequent
    // repaints never touch, so a half-typed reason isn't lost.
    listEl.querySelectorAll('[data-feature-reject]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        selectedKey = button.dataset.featureReject;
        rejectingKey = selectedKey;
        renderList();
        renderDetail();
      });
    });

    listEl.querySelectorAll('[data-generate]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const row = rowsToRender().find((r) => r.key === button.dataset.generate);
        if (!row) return;
        // Jump the reading pane to this row's progress right away — a
        // "Gerar" click from the list, on a row that wasn't already
        // selected, would otherwise start a real generation with no visible
        // feedback anywhere (the list dot animates, but the pane keeps
        // showing whatever was open before).
        selectedKey = row.key;
        generate(row);
      });
    });

    // "Atualizar" is a plain re-generation, no feedback text — the one-click
    // counterpart to "Solicitar mudança" for the specific case this button
    // only ever appears in (rowViewModel's `updateTarget`, gated on
    // staleStatusFor): the artifact is demonstrably out of sync with a
    // dependency that changed after it was built, so "just regenerate it
    // from the current context" needs no explanation typed in — unlike a
    // genuine content edit, which still goes through the composer.
    listEl.querySelectorAll('[data-update]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const row = rowsToRender().find((r) => r.key === button.dataset.update);
        const target = row && updateTargetFor(row);
        if (!target) return;
        // Atualizar regenera com um clique; se o alvo tem edicoes manuais, a
        // primeira vez so pede confirmacao (sem dialogo: o proprio botao muda).
        if (manualEdits.has(target.entry.artifact) && button.dataset.confirming !== 'true') {
          button.dataset.confirming = 'true';
          button.title = manualEditNoteFor(target.entry.artifact);
          button.innerHTML = `${icon('alertCircle', 12)} Confirmar: reaplica edições manuais`;
          setTimeout(() => {
            if (!button.isConnected) return;
            delete button.dataset.confirming;
            button.innerHTML = `${icon('refreshCw', 12)} Atualizar`;
          }, 5000);
          return;
        }
        selectedKey = target.key;
        generate(target);
      });
    });

    listEl.querySelectorAll('[data-export-file]').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        button.disabled = true;
        try {
          const destination = await exportProjectFile(project.id, 'artifacts', button.dataset.exportFile);
          if (destination) showExportStatus(`Artefato exportado para ${destination}`);
        } catch (err) {
          showExportStatus(`Não foi possível exportar o artefato: ${String(err.message || err)}`, 'error');
        } finally {
          button.disabled = false;
        }
      });
    });
  }

  filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      activeFilter = button.dataset.filter;
      filterButtons.forEach((candidate) => candidate.classList.toggle('active', candidate === button));
      renderList();
      renderDetail();
    });
  });

  function currentRow() {
    return rowsToRender().find((r) => r.key === selectedKey) || null;
  }

  // openEditor troca o painel de leitura pelo editor guiado. Ao fechar (salvo
  // ou cancelado) o painel volta a ser desenhado pelo fluxo normal; salvar
  // antes recarrega o estado em disco, e e isso que marca os dependentes como
  // "Desatualizado".
  function editorKey(row) {
    return `${project.id}:${row.entry.artifact}`;
  }
  function openEditor(row, artifact, original) {
    const body = beginCustom(row.label);
    mountArtifactEditor(body, {
      projectId: project.id,
      artifact,
      draftKey: editorKey(row),
      original,
      onSaved: async () => {
        await refreshDoneState();
        if (active) renderList();
        // ArtifactSave records the edit in changes.jsonl — the summary's
        // "pedidos de mudança" (and última atividade) must count it now,
        // not only on the next remount.
        onChanged();
      },
      onClose: () => {
        if (active) renderDetail();
      },
    });
  }

  async function renderDetail() {
    const row = currentRow();
    if (!row) {
      showEmpty('Nenhum artefato disponível.');
      return;
    }
    // Atualizacoes de runs redesenham o painel varias vezes por segundo; nao
    // podem apagar um editor aberto no meio de uma edicao.
    if (isEditorOpen(editorKey(row))) return;

    const tracker = trackers.get(row.key);
    if (tracker && tracker.status && !['completed', 'failed', 'canceled'].includes(tracker.status.state)) {
      // While working/queued, mhl_run_status is polled every 500ms
      // (app.go's runPollInterval) and pushes a status regardless of
      // whether anything actually changed — onRunUpdate calls renderDetail()
      // on every single one of those. beginCustom() below clears the pane's
      // body outright (.innerHTML = ''), so re-appending the SAME
      // tracker.element right after still detaches-then-reattaches it from
      // the browser's point of view — which restarts every CSS animation
      // inside it (run-tracker.js's orbit) before it ever got a single
      // frame in, even though nothing here actually needed to change. If
      // this exact element is already sitting in the pane, skip the
      // clear+reappend entirely; run-tracker.js's own update() already
      // repaints tracker.element in place for whatever *did* change.
      const isActive = tracker.status.state === 'working' || tracker.status.state === 'queued';
      const alreadyMounted = tracker.element.isConnected && tracker.element.parentElement && tracker.element.parentElement.classList.contains('doc-body');
      if (isActive && alreadyMounted) return;

      const body = beginCustom(row.label);
      body.appendChild(tracker.element);
      // Modo Buddy's whole point is a human reading the draft before it's
      // written to disk — showing only the tracker (a dot + "aguarda
      // aprovação") here meant "Aprovar e continuar" had to be clicked
      // blind. Render it as the real HTML the artifact will end up as
      // (async, appended below) instead of nothing.
      if (tracker.status.state === 'paused') {
        // Pinned below the scrollable preview (reading-pane.js's
        // .doc-footer) instead of appended inline into `body` — a long
        // preview (several ADRs/features stacked, see appendPausedPreview)
        // used to push Aprovar/Regenerar/Cancelar out of view above it, so
        // approving meant scrolling back up to find them blind.
        setFooter(tracker.composer);
        setToolbarAction(tracker.approveAction);
        appendPausedPreview(row, tracker, body);
      }
      return;
    }

    if (isRowDone(row)) {
      if (row.featureId) {
        await renderHistoriasIndex(row);
      } else {
        await renderPreview(row);
      }
      return;
    }

    const ready = isRowReady(row);
    const description = ready
      ? 'Pronto para gerar.'
      : `Depende de: ${missingDeps(row.entry, doneNames).map(labelFor).join(', ')}`;

    if (tracker && tracker.status && ['failed', 'canceled'].includes(tracker.status.state)) {
      // A just-failed run for a not-yet-done artifact: show its last state
      // (including the error) instead of silently reverting to "Gerar" —
      // action button becomes "Tentar novamente", still in the header.
      // Deliberately excludes "completed": right when a run finishes, this
      // renders once before refreshDoneState() (called by generate()'s own
      // onUpdate) has updated doneNames — checking the state explicitly
      // avoids a false "Tentar novamente" flash on a run that just
      // succeeded, in the moment before isRowDone(row) catches up.
      const body = showAction(row.label, 'Tentar novamente', () => generate(row));
      body.appendChild(tracker.element);
      return;
    }

    if (row.entry.generatedWith) {
      const body = beginCustom(row.label);
      body.innerHTML = `<p class="doc-empty">Gerado junto com ${escapeHtml(labelFor(row.entry.generatedWith))}.</p>`;
    } else if (ready) {
      const body = showAction(row.label, 'Gerar', () => generate(row));
      body.innerHTML = `<p class="doc-empty">${description}</p>`;
    } else {
      const body = beginCustom(row.label);
      body.innerHTML = `<p class="doc-empty">${description}</p>`;
    }
  }

  // appendPausedPreview renders vars.pending_data through the SAME
  // ArtifactBody/PageShell templates the real *Commit step will eventually
  // use (workflows/artifact_preview/artifact_preview.mh, called via
  // api.js's artifactPreview) — real HTML, not a guess, and with no side
  // effect (never writes to disk, never consumes a collection artifact's
  // real id sequence — that only happens for real at Commit, after
  // approval). Falls back to the raw JSON dump (buildPendingPreview below)
  // if the call fails for any reason — still readable, never worse than
  // before this existed.
  //
  // A collection artifact (adr/diagramas/features/historias — see
  // PENDING_COLLECTION) renders one ArtifactPreview call PER pending item
  // instead of a single call over the whole batch: reviewing 6 ADRs or 4
  // features run together on one page (one scroll, one set of headings that
  // all look the same) made Modo Buddy's whole point — read the draft
  // before it's written — harder than reading the real, already-split
  // files after Commit. Each item becomes its own titled, bordered,
  // auto-sized frame (reading-pane.js's buildDocFrame autoHeight) stacked in
  // the pane, so a paused batch previews exactly like the finished one will
  // once approved and split into real per-item rows. Falls back to the old
  // single whole-batch call if `data` doesn't have the expected array
  // (still correct, just concatenated, exactly like before this existed).
  //
  // Each item's call is handled independently (its own try/catch inside the
  // Promise.all below, not a shared "any fails, all are lost") — one item
  // failing (a shape ArtifactBody didn't expect, say) must not blank out
  // the N-1 items that rendered fine and dump the whole batch back to raw
  // JSON; it shows an inline error in just that item's slot instead.
  // Verified against a real paused run where exactly this happened: 2 of 3
  // histórias previewed successfully and one call hung, and the
  // all-or-nothing version was silently discarding the two good ones.
  //
  // Firing these in parallel (Promise.all) used to crash mhl outright —
  // "decode response: EOF", a "404 Not Found" polling status — root-caused
  // to several requests in flight at once on this app's one shared MCP
  // session (measured: 9/40 failures sharing a session under this same
  // load, 0/40 giving each concurrent call its own session — see
  // mhlbridge.go's postRPC comment). That's now fixed at the actual source
  // — postRPC serializes every request on that session — so this can fire
  // in parallel again rather than working around it with a client-side
  // queue here; a from-scratch queue in this one caller would leave every
  // OTHER concurrent-call site (run status polling racing a user action,
  // for instance) with the same unfixed risk.
  //
  // Fire-and-forget from the caller on purpose (renderDetail() doesn't
  // await this) — the guards below (`active`, `selectedKey`, and the
  // tracker identity check) are what keep a slow response from painting a
  // pane the user has since navigated away from, or a stale response from
  // a now-superseded generation attempt on the very same row.
  async function appendPausedPreview(row, tracker, body) {
    const loading = document.createElement('p');
    loading.className = 'doc-empty';
    loading.textContent = 'Carregando pré-visualização…';
    body.appendChild(loading);

    const stillCurrent = () => active && selectedKey === row.key && trackers.get(row.key) === tracker;
    const data = tracker.status && tracker.status.vars && tracker.status.vars.pending_data;
    const collection = PENDING_COLLECTION[row.entry.artifact];
    const items = collection && data ? data[collection.dataKey] : null;

    if (Array.isArray(items) && items.length > 0) {
      const results = await Promise.all(
        items.map((item) =>
          artifactPreview(collection.itemArtifact, item)
            .then((html) => ({ ok: true, html }))
            .catch((err) => ({ ok: false, error: err }))
        )
      );

      // Retry each failure once, sequentially, after the concurrent batch
      // above has fully settled. Root cause (see output/mhl-bug-report.md
      // bug #2): mhl's own writeLatest shares one fixed .tmp filename per
      // pipeline, so N concurrent ArtifactPreview sessions for this same
      // pipeline (exactly what the Promise.all above fires) can collide on
      // os.Rename to the same destination — "no such file or directory" on
      // macOS/Linux, "Acesso negado" on Windows (same race, OS-specific
      // rename error). That's a bug in mhl itself, not fixable from here.
      // By the time we retry, every session from the initial burst has
      // already finished, so a lone retry has no sibling to race against
      // and reliably clears the transient failure.
      if (stillCurrent()) {
        for (let i = 0; i < results.length; i++) {
          if (results[i].ok) continue;
          try {
            results[i] = { ok: true, html: await artifactPreview(collection.itemArtifact, items[i]) };
          } catch (err) {
            results[i] = { ok: false, error: err };
          }
          if (!stillCurrent()) return;
        }
      }

      if (!stillCurrent()) return;
      loading.remove();
      results.forEach((result, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'doc-pending-item';
        const title = document.createElement('div');
        title.className = 'doc-pending-item-title';
        title.textContent = items[i].titulo || `Item ${i + 1}`;
        wrap.appendChild(title);
        if (result.ok) {
          wrap.appendChild(buildDocFrame(result.html, { mermaid: hasMermaidDiagram(result.html), inlineMermaid, autoHeight: true }));
        } else {
          const err = document.createElement('p');
          err.className = 'doc-empty';
          err.textContent = `Não foi possível pré-visualizar este item: ${result.error}`;
          wrap.appendChild(err);
        }
        body.appendChild(wrap);
      });
      // Features carry their dependency map in the same draft (see
      // ArtifactCommit.features) — shown last, as it will be written.
      if (row.entry.artifact === 'features' && data.dependencias) await appendPendingDependencias(data.dependencias, body, stillCurrent);
      return;
    }

    let html = null;
    if (data != null) {
      try {
        html = await artifactPreview(row.entry.artifact, data);
      } catch {
        html = null; // fall through to the JSON dump below
      }
    }

    if (!stillCurrent()) return;
    loading.remove();
    if (html) {
      body.appendChild(buildDocFrame(html, { mermaid: hasMermaidDiagram(html), inlineMermaid }));
    } else {
      body.appendChild(buildPendingPreview(tracker.status));
    }
  }

  async function appendPendingDependencias(mapa, body, stillCurrent) {
    let html = null;
    try {
      html = await artifactPreview('dependencias', mapa);
    } catch {
      html = null;
    }
    if (!stillCurrent()) return;
    const wrap = document.createElement('div');
    wrap.className = 'doc-pending-item';
    const title = document.createElement('div');
    title.className = 'doc-pending-item-title';
    title.textContent = labelFor('dependencias');
    wrap.appendChild(title);
    if (html) {
      wrap.appendChild(buildDocFrame(html, { mermaid: hasMermaidDiagram(html), inlineMermaid, autoHeight: true }));
    } else {
      const err = document.createElement('p');
      err.className = 'doc-empty';
      err.textContent = 'Não foi possível pré-visualizar o mapa de dependências.';
      wrap.appendChild(err);
    }
    body.appendChild(wrap);
  }

  // buildPendingPreview is appendPausedPreview's fallback — a plain
  // formatted JSON dump of vars.pending_data, used only when the real
  // preview call above fails. Same "dump readable JSON, don't build a
  // bespoke view" choice tab-wiki.js already makes for its lint result.
  function buildPendingPreview(status) {
    const wrap = document.createElement('div');
    const data = status.vars && status.vars.pending_data;
    if (data == null) return wrap; // nothing generated yet to show — stay quiet rather than render an empty box
    const heading = document.createElement('div');
    heading.className = 'doc-subhead';
    heading.textContent = 'Rascunho gerado — ainda não gravado';
    const pre = document.createElement('pre');
    pre.className = 'doc-source';
    pre.textContent = JSON.stringify(data, null, 2);
    wrap.appendChild(heading);
    wrap.appendChild(pre);
    return wrap;
  }

  // canRequestChanges: whether an already-approved row can offer "Solicitar
  // mudança" (see buildRequestChangesComposer below). Excludes an expanded
  // collection item (row.groupKey — e.g. one ADR out of several) and a
  // still-pending collection group row: the underlying *Generate for adr/
  // diagramas/features/historias(Delivery) always produces the WHOLE batch
  // in one call, never a single item, and once done a collection's group
  // row (row.key === entry.artifact) no longer exists in rowsToRender() at
  // all — buildItemRows replaces it with per-item rows, so there'd be
  // nowhere for currentRow()/renderDetail() to find an in-flight tracker
  // keyed by that artifact name. Every single-document row (brief/
  // atributos/requisitos/der/the Delivery final doc) and Discovery's
  // per-feature "Histórias — X" row (row.featureId — its own key survives
  // regardless of done state, see rowsToRender's unconditional push for it)
  // don't have that problem, so those are exactly what's supported here.
  // downstreamOf walks `sequence`'s own `deps` graph forward — every
  // artifact that depends on `artifact`, directly or transitively (e.g.
  // "requisitos" → adr → features → dependencias, so
  // downstreamOf('requisitos') includes all three). This IS the dependency
  // matrix (artifacts.js's own doc comment: extracted straight from the
  // workflows' fail() gates) read in reverse.
  function downstreamOf(artifact) {
    const result = new Set();
    let frontier = new Set([artifact]);
    while (frontier.size > 0) {
      const next = new Set();
      for (const entry of sequence) {
        if (result.has(entry.artifact) || frontier.has(entry.artifact)) continue;
        if (entry.deps.some((dep) => frontier.has(dep))) {
          result.add(entry.artifact);
          next.add(entry.artifact);
        }
      }
      frontier = next;
    }
    return [...result];
  }

  // downstreamWarningFor used to list EVERY already-generated artifact
  // downstream of `artifact`, unconditionally — which meant it fired on
  // every single view of an approved document with any downstream content
  // at all, even right after a normal first pass where nothing is actually
  // out of sync yet (brief generated, then requisitos, then adr, each
  // strictly after the one before it — nothing stale, but the composer
  // warned anyway, every time). Real gap that caused, reported directly:
  // the composer sits in the footer of every approved-artifact preview
  // (renderPreview), not just when someone is about to submit a change, so
  // that blanket note read as noise rather than signal. Now it only lists
  // what's ALREADY stale (artifacts.js's computeStaleness, real mtimes —
  // the same matrix behind each card's own "Desatualizado" badge, see
  // staleInfoFor) — i.e. `artifact` was already regenerated more recently
  // than that downstream artifact, on some earlier edit, and nobody's
  // caught up yet. In the common case (freshly generated, nothing stale)
  // this returns '' and the composer shows no note at all; the forward-
  // looking "editing this WILL make downstream stale" concern is now
  // handled by the fact that submitting this edit bumps `artifact`'s own
  // mtime, so on the very next render every genuinely-affected downstream
  // card lights up its own badge — right where the person will actually go
  // looking, not as upfront speculation before they've even decided to
  // submit.
  //
  // Discovery's per-feature "historias" isn't its own `sequence` entry (see
  // artifacts.js's own comment on why), so it isn't in `staleness`. It used
  // to be appended here unconditionally whenever any história existed and
  // "features" was this artifact or downstream of it — which put "Histórias
  // está desatualizado" under the Brief (and every other upstream preview)
  // even with every história already up to date. Now it follows the same
  // real-mtime rule as everything else, per feature: listed only when some
  // feature was regenerated after a história built from it
  // (staleHistoriaFeatureIds, computed in refreshDoneState).
  function manualEditNoteFor(artifact) {
    const count = manualEdits.get(artifact) ?? 0;
    if (count === 0) return '';
    return `${labelFor(artifact)} tem ${count === 1 ? 'uma edição manual' : `${count} edições manuais`}. Ao regenerar, elas são enviadas à LLM como instruções e devem ser mantidas, mas o restante do texto é gerado de novo.`;
  }

  function downstreamWarningFor(artifact) {
    const downstream = downstreamOf(artifact);
    const labels = downstream.filter((name) => doneNames.has(name) && staleness.get(name)?.stale).map(labelFor);
    if (
      workflow === 'Discovery' &&
      (artifact === 'features' || downstream.includes('features')) &&
      staleHistoriaFeatures.size > 0
    ) {
      labels.push('Histórias');
    }
    if (labels.length === 0) return '';
    const verb = labels.length > 1 ? 'estão desatualizados' : 'está desatualizado';
    return `${labels.join(', ')} ${verb} em relação a uma versão mais recente de uma dependência — considere regenerá-los.`;
  }

  // canonicalGroupRow reconstructs the plain group-level row an expanded
  // item's row.groupKey points back to — same shape rowsToRender() builds
  // for a collection entry before doneNames marks it done (row.entry is
  // already that same collection entry object, shared with every one of
  // its item rows — see buildItemRows). This is the row "Solicitar
  // mudança" actually targets when fired from inside one item: the
  // underlying *Generate for adr/diagramas/features/historias(Delivery)
  // always produces the WHOLE batch in one call, never a single item, so
  // there's no such thing as regenerating just one ADR — only "regenerate
  // every decision in this ADR batch, informed by this comment".
  function canonicalGroupRow(row) {
    return { key: row.groupKey, label: labelFor(row.groupKey), entry: row.entry, category: row.category };
  }

  // generatedWithRow: the row that actually produces a `generatedWith`
  // document (artifacts.js) — the dependency map only exists as part of the
  // Features run, so changing or updating it regenerates the whole backlog.
  function generatedWithRow(row) {
    const entry = sequence.find((e) => e.artifact === row.entry.generatedWith);
    return { key: entry.artifact, label: labelFor(entry.artifact), entry, category: entry.category };
  }

  // canRequestChanges: whether THIS exact row is a single document that can
  // be regenerated directly (feedback -> that same row). An expanded
  // collection item (row.groupKey set) is handled separately in
  // renderPreview via canonicalGroupRow — it still gets the composer, just
  // targeting the group, with an explicit note about the batch scope.
  function canRequestChanges(row) {
    return !row.groupKey && !row.entry.collectionKind && !row.entry.generatedWith;
  }

  // updateTargetFor: which row a stale row's own "Atualizar" button
  // (rowViewModel's `updateTarget`, rendered in cardHtml/tableRowHtml)
  // actually regenerates — same target resolution "Solicitar mudança"
  // already uses (a plain single-doc row regenerates itself; an expanded
  // collection item regenerates its whole batch via canonicalGroupRow,
  // since *Generate never produces just one item — see that function's own
  // comment). Returns null for a row that can't be regenerated at all (the
  // synthetic per-feature "Histórias — X" row, or a still-collapsed
  // collection group row) — staleInfoFor/staleStatusFor already return null
  // for the first case, so this mostly just guards the second.
  function updateTargetFor(row) {
    if (canRequestChanges(row)) return row;
    if (row.groupKey) return canonicalGroupRow(row);
    if (row.entry?.generatedWith) return generatedWithRow(row);
    return null;
  }

  // buildRequestChangesComposer lets you ask for changes to an artifact
  // that's ALREADY approved and written to artifacts/ — the same feedback
  // mechanism Modo Buddy's "Solicitar mudanças" already offers while a run
  // is still paused for review, just reachable after the fact too. Real gap
  // this closes: once approved, there was previously no way back into the
  // conversation for that artifact short of deleting it and starting the
  // whole generation over. Fires a brand-new generate() with `feedback`
  // attached — discovery.mh/delivery.mh's Dispatch step consumes it before
  // the first *Generate call (see that input's own comment), so this costs
  // exactly one LLM call, informed by the comment from the very first
  // attempt, then pauses for review like any other generation (buddy stays
  // true) rather than the two calls a Gate-driven loop-back would cost if
  // this piggybacked on that path instead of a fresh run.
  //
  // `targetRow` (optional) is what actually gets regenerated when it
  // differs from the row currently on screen — an expanded collection item
  // (row.groupKey set) passes its own canonicalGroupRow() here, since
  // there's no such thing as regenerating just that one item (see
  // canonicalGroupRow's own comment); `note` is shown above the textarea to
  // make that batch scope explicit instead of silently surprising whoever
  // regenerates "one ADR" and gets all of them rewritten.
  function buildRequestChangesComposer(row, { targetRow = row, note = '' } = {}) {
    // `note` renders as its own amber banner ABOVE the composer card, not
    // squeezed inside it as small muted text — matches the reference the
    // user pointed at (Claude Code's own "used 86% of your weekly limit"
    // banner sitting right above its message input): a warning worth
    // noticing needs its own visual weight, separate from the input it
    // sits above, not buried as a caption easy to skim past. Both pieces
    // still travel as one element (setFooter only takes one), wrapped in
    // .run-composer-warning-wrap.
    const wrap = document.createElement('div');
    wrap.className = 'run-composer-warning-wrap';

    if (note) {
      const warning = document.createElement('div');
      warning.className = 'run-composer-warning';
      warning.setAttribute('role', 'alert');
      warning.innerHTML = `
        <span class="run-composer-warning-icon">${icon('alertCircle', 16)}</span>
        <span class="run-composer-warning-message">${escapeHtml(note)}</span>
        <button class="run-composer-warning-dismiss" aria-label="Dispensar aviso" title="Dispensar">${icon('x', 14)}</button>
      `;
      warning.querySelector('.run-composer-warning-dismiss').addEventListener('click', () => warning.remove());
      wrap.appendChild(warning);
    }

    const composer = document.createElement('div');
    composer.className = 'run-composer';
    composer.innerHTML = `
      <textarea class="run-feedback-input" rows="1" placeholder="Pedir uma mudança neste artefato (opcional)…"></textarea>
      <div class="run-composer-actions">
        <div class="composer-tools">
          <span class="composer-chip static" data-mode title="Sem texto, regera a partir do contexto atual (wiki e artefatos anteriores)">${icon('refreshCw', 14)} <span data-mode-label>Regerar</span></span>
        </div>
        ${sendButtonHtml({ attrs: 'data-submit', label: 'Regerar' })}
      </div>
    `;
    const textarea = composer.querySelector('textarea');
    const button = composer.querySelector('[data-submit]');
    const modeLabel = composer.querySelector('[data-mode-label]');
    enhanceComposer(composer, { allowEmpty: true });
    // Texto opcional: sem ele, é uma regeneração simples (como "Atualizar"),
    // sem registrar diretiva no histórico de mudanças.
    textarea.addEventListener('input', () => {
      const label = textarea.value.trim() ? 'Solicitar mudança' : 'Regerar';
      modeLabel.textContent = label;
      button.title = label;
      button.setAttribute('aria-label', label);
    });
    button.addEventListener('click', () => {
      const text = textarea.value.trim();
      button.disabled = true;
      textarea.disabled = true;
      selectedKey = targetRow.key; // jump the view to the regeneration that's about to start
      if (text) generate(targetRow, text);
      else generate(targetRow);
    });
    wrap.appendChild(composer);

    return wrap;
  }

  // renderPreview shows a single generated document — either one of the
  // simple, always-one-document entries (brief/atributos/requisitos/der/the
  // Delivery "final" doc, via entry.path) or one member of an expanded
  // collection (adr-item/diagrama-item/feature-item/historia-item, via the
  // previewPath rowsToRender() already resolved when it built the row — no
  // "guess the first child" step needed anymore, since every row now names
  // its own exact file).
  async function renderPreview(row) {
    showLoading(row.label);
    const relativePath = row.previewPath || row.entry.path;
    if (!relativePath) {
      beginCustom(row.label).innerHTML = '<p class="doc-empty">Nada para pré-visualizar ainda.</p>';
      return;
    }
    let html;
    try {
      html = await readProjectFile(project.id, 'artifacts', relativePath);
    } catch (err) {
      beginCustom(row.label).innerHTML = `<p class="doc-empty">Erro ao abrir artefato: ${escapeHtml(String(err))}</p>`;
      return;
    }
    // Edicao guiada: so artefatos de documento unico, e so quando o JSON
    // semantico existe ao lado do HTML (artefatos antigos, gerados antes do
    // ArtifactData, ficam sem o botao em vez de abrir um formulario vazio).
    const editableArtifact = row.entry.artifact;
    let onEdit;
    if (isEditable(editableArtifact) && !row.groupKey && !row.historiasRow && relativePath === `${editableArtifact}.html`) {
      try {
        const original = JSON.parse(await readProjectFile(project.id, 'artifacts', `${editableArtifact}.json`));
        onEdit = () => openEditor(row, editableArtifact, original);
      } catch {
        onEdit = undefined;
      }
    }
    showHtmlDoc(row.label, html, { mermaid: hasMermaidDiagram(html), inlineMermaid, onEdit });
    let footer = null;
    if (row.historiasRow) {
      // One história out of a feature's batch — same batch-scope caveat as
      // a collection item below: HistoriasGenerate always rewrites every
      // história of that feature in one call.
      footer = buildRequestChangesComposer(row, {
        targetRow: row.historiasRow,
        note: `Isto regenera todas as histórias de ${row.historiasRow.featureId}, não só esta. Os complementos anexados ficam na história de mesmo código.`,
      });
    } else if (canRequestChanges(row)) {
      footer = buildRequestChangesComposer(row, { note: [manualEditNoteFor(row.key), downstreamWarningFor(row.key)].filter(Boolean).join(' ') });
    } else if (row.entry?.generatedWith) {
      const target = generatedWithRow(row);
      footer = buildRequestChangesComposer(row, {
        targetRow: target,
        note: [`Isto regenera todo o lote de "${target.label}", junto com este documento.`, downstreamWarningFor(target.key)].filter(Boolean).join(' '),
      });
    } else if (row.groupKey) {
      // One item out of a collection (an ADR, a diagram, a feature, a
      // história) — the composer still shows here (real gap this closes:
      // ADRs/Diagramas/Histórias had no path back into the conversation at
      // all before this), it just regenerates the WHOLE batch this item
      // belongs to, not this item alone — see canonicalGroupRow's comment
      // for why that's the only thing *Generate can actually do.
      const notes = [
        `Isto regenera todo o lote de "${labelFor(row.groupKey)}", não só este item.`,
        downstreamWarningFor(row.groupKey),
      ].filter(Boolean);
      footer = buildRequestChangesComposer(row, {
        targetRow: canonicalGroupRow(row),
        note: notes.join(' '),
      });
    }
    // A história também mostra o que vai para o desenvolvimento: a Definition
    // of Ready e os arquivos gerados ao lado dela (contratos, cenários, plano).
    const devBar = storyDir(row) !== null ? buildDevFilesBar(row) : null;
    const reviewBar = project.level === 'discovery' && row.groupKey === 'features' && row.folderName ? buildFeatureReviewBar(row) : null;
    if (devBar || reviewBar || footer) {
      const wrap = document.createElement('div');
      if (reviewBar) wrap.appendChild(reviewBar);
      if (devBar) wrap.appendChild(devBar);
      if (footer) wrap.appendChild(footer);
      setFooter(wrap);
    }
  }

  // FEATURE_STATUS_LABELS: singular labels for one feature's own status, as
  // the reading pane's review bar shows it.
  const FEATURE_STATUS_LABELS = { pendente: 'Pendente', em_aprovacao: 'Em aprovação', aprovada: 'Aprovada', rejeitada: 'Rejeitada' };

  // buildFeatureReviewBar: a Discovery feature's review status and its
  // approve/reject/reopen actions, above the reading pane's composer.
  // Rejecting needs a reason (FeatureReview.decide refuses an empty one), so
  // "Rejeitar" first expands a textarea; the list's own "Rejeitar" opens the
  // pane with it already expanded (rejectingKey).
  function buildFeatureReviewBar(row) {
    const vm = rowViewModel(row);
    const review = vm.review;
    const bar = document.createElement('div');
    bar.className = 'feature-review-bar';
    bar.innerHTML = `
      <div class="feature-review-head">
        <span class="feature-review-dot ${escapeAttribute(review.status)}"></span>
        <strong>${escapeHtml(FEATURE_STATUS_LABELS[review.status])}</strong>
        ${review.status === 'rejeitada' && review.motivo ? `<span class="feature-review-reason">Motivo: ${escapeHtml(review.motivo)}</span>` : ''}
        ${review.status === 'rejeitada' ? '<span class="feature-review-note">Sem histórias nem planos e fora do pacote de handoff até ser reaberta.</span>' : ''}
        <div class="feature-review-actions">${featureReviewButtonsHtml(row, vm)}</div>
      </div>
      <div class="feature-review-form" hidden>
        <textarea class="run-feedback-input" rows="2" placeholder="Motivo da rejeição (obrigatório)…"></textarea>
        <div class="feature-review-form-actions">
          <button class="button secondary small" data-cancel>Cancelar</button>
          <button class="button small danger" data-confirm disabled>Rejeitar feature</button>
        </div>
      </div>
    `;
    const form = bar.querySelector('.feature-review-form');
    const textarea = form.querySelector('textarea');
    const confirm = form.querySelector('[data-confirm]');
    function openForm() {
      form.hidden = false;
      textarea.focus();
    }
    bar.querySelector('[data-feature-approve]')?.addEventListener('click', () => reviewFeature(row.folderName, 'aprovar'));
    bar.querySelector('[data-feature-reopen]')?.addEventListener('click', () => reviewFeature(row.folderName, 'reabrir'));
    bar.querySelector('[data-feature-reject]')?.addEventListener('click', openForm);
    textarea.addEventListener('input', () => {
      confirm.disabled = !textarea.value.trim();
    });
    form.querySelector('[data-cancel]').addEventListener('click', () => {
      form.hidden = true;
      textarea.value = '';
      confirm.disabled = true;
    });
    confirm.addEventListener('click', () => {
      const motivo = textarea.value.trim();
      if (!motivo) return;
      confirm.disabled = true;
      textarea.disabled = true;
      reviewFeature(row.folderName, 'rejeitar', motivo);
    });
    if (rejectingKey === row.key && review.canReject) {
      rejectingKey = null;
      setTimeout(openForm, 0);
    }
    return bar;
  }

  // buildDevFilesBar: "Arquivos para desenvolvimento" of a história — each
  // file generated next to it (openapi.json, asyncapi.json, historia.feature,
  // plano.html) exportable on its own, plus its Definition of Ready. The
  // full package — every story, ready or not, each one's own spec.md
  // showing its Definition of Ready and (if blocked) why — comes from
  // "Pacote de handoff".
  // anexosOf: the attachment names under <história>/anexos/, read from the
  // last listProjectDir() tree (refreshDoneState) — `dir` relative to
  // artifacts/, "" for Delivery's single story at the root.
  function anexosOf(dir) {
    let nodes = Object.values(lastByName);
    for (const segment of [...(dir ? dir.split('/') : []), 'anexos']) {
      const node = nodes.find((n) => n.isDir && n.name === segment);
      if (!node) return [];
      nodes = node.children || [];
    }
    return nodes.filter((n) => !n.isDir).map((n) => n.name);
  }

  // reloadAfterAttachmentChange: the bar is rebuilt from the tree, so a
  // fresh listing must land before the pane is redrawn.
  async function reloadAfterAttachmentChange() {
    await refreshDoneState();
    if (!active) return;
    renderList();
    renderDetail();
  }

  function buildDevFilesBar(row) {
    const dir = storyDir(row);
    const bar = document.createElement('div');
    bar.className = 'dev-files-bar';
    const r = readinessFor(row);
    const files = ['openapi.json', 'asyncapi.json', 'historia.feature', 'plano.html', 'radahn.yaml'];
    const present = files.filter((f) => (row.devFiles || []).includes(f));
    const anexos = anexosOf(dir);
    bar.innerHTML = `
      <div class="dev-files-bar-row">
        <span class="dev-files-title">Arquivos para desenvolvimento</span>
        ${dorBadgeHtml(r)}${radahnBadgeHtml(row)}
        ${present.length ? present.map((f) => `<button class="button tertiary small" data-dev-file="${escapeAttribute(f)}">${icon('download', 12)} ${escapeHtml(f)}</button>`).join('') : '<span class="dev-files-empty">Nenhum arquivo gerado — regere a história (e gere o plano).</span>'}
      </div>
      <div class="dev-files-bar-row">
        <span class="dev-files-title" title="Arquivos que cobrem dependências da feature que a história pode não refletir por completo. Vão junto com a história no pacote de handoff e são mantidos ao regerar as histórias (na história de mesmo código).">Complementos anexados</span>
        ${
          anexos.length
            ? anexos
                .map(
                  (name) => `<span class="dev-attachment"><button class="button tertiary small" data-anexo-export="${escapeAttribute(name)}" title="Exportar ${escapeAttribute(name)}">${icon('download', 12)} ${escapeHtml(name)}</button><button class="dev-attachment-remove" data-anexo-remove="${escapeAttribute(name)}" title="Remover ${escapeAttribute(name)}" aria-label="Remover ${escapeAttribute(name)}">${icon('x', 12)}</button></span>`,
                )
                .join('')
            : '<span class="dev-files-empty">Nenhum — anexe o que a história não cobre das dependências da feature; vai junto no handoff.</span>'
        }
        <button class="button secondary small" data-anexo-add>${icon('plus', 12)} Anexar arquivo</button>
      </div>
      ${dorReasonsHtml(r)}
    `;
    bar.querySelector('[data-anexo-add]').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const names = await attachHistoriaFiles(project.id, dir);
        if (names.length) showExportStatus(`${names.length === 1 ? 'Arquivo anexado' : `${names.length} arquivos anexados`} à história: ${names.join(', ')}`);
      } catch (err) {
        showExportStatus(`Não foi possível anexar: ${String(err.message || err)}`, 'error');
      } finally {
        button.disabled = false;
      }
      await reloadAfterAttachmentChange();
    });
    bar.querySelectorAll('[data-anexo-export]').forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const path = `${dir ? `${dir}/` : ''}anexos/${button.dataset.anexoExport}`;
          const destination = await exportProjectFile(project.id, 'artifacts', path);
          if (destination) showExportStatus(`Arquivo exportado para ${destination}`);
        } catch (err) {
          showExportStatus(`Não foi possível exportar: ${String(err.message || err)}`, 'error');
        } finally {
          button.disabled = false;
        }
      });
    });
    // Remover pede confirmação no próprio botão (sem diálogo), como o
    // "Atualizar" com edições manuais: o anexo não pode ser regerado.
    bar.querySelectorAll('[data-anexo-remove]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (button.dataset.confirming !== 'true') {
          button.dataset.confirming = 'true';
          button.classList.add('confirming');
          button.textContent = 'Remover?';
          setTimeout(() => {
            if (!button.isConnected) return;
            delete button.dataset.confirming;
            button.classList.remove('confirming');
            button.innerHTML = icon('x', 12);
          }, 4000);
          return;
        }
        button.disabled = true;
        try {
          await removeHistoriaAttachment(project.id, dir, button.dataset.anexoRemove);
        } catch (err) {
          showExportStatus(`Não foi possível remover: ${String(err.message || err)}`, 'error');
        }
        await reloadAfterAttachmentChange();
      });
    });
    bar.querySelectorAll('[data-dev-file]').forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const path = dir ? `${dir}/${button.dataset.devFile}` : button.dataset.devFile;
          const destination = await exportProjectFile(project.id, 'artifacts', path);
          if (destination) showExportStatus(`Arquivo exportado para ${destination}`);
        } catch (err) {
          showExportStatus(`Não foi possível exportar: ${String(err.message || err)}`, 'error');
        } finally {
          button.disabled = false;
        }
      });
    });
    return bar;
  }

  // renderHistoriasIndex lists one feature's histórias in the reading pane —
  // only reached now through the nested "Histórias" generation row when a
  // regeneration of an already-generated batch failed (the committed
  // histórias themselves are nested rows of their own, collapsed under the
  // feature by default so N features × M histórias don't explode the list).
  // Clicking one of those opens its actual content in the same pane.
  async function renderHistoriasIndex(row) {
    showLoading(row.label);
    let nodes;
    try {
      // row.featureId is the short id ("FT003") the workflow's own argument
      // expects — but the historias/ folder on disk (mirroring features/'s
      // own naming) is the *full* slug ("FT003-operacao-..."). Listing by
      // the short id alone doesn't error (ListProjectDir treats a missing
      // dir as an empty listing, Go-side), it just silently finds nothing —
      // which read as "Nenhuma história gerada ainda." even right after a
      // successful generation.
      nodes = await listProjectDir(project.id, 'artifacts', `historias/${row.featureFolder}`);
    } catch (err) {
      beginCustom(row.label).innerHTML = `<p class="doc-empty">Erro ao listar histórias: ${escapeHtml(String(err))}</p>`;
      return;
    }
    const folders = nodes.filter(
      (n) =>
        n.isDir && (n.children || []).some((file) => !file.isDir && file.name === 'historia.html'),
    );
    const body = beginCustom(row.label);
    if (folders.length === 0) {
      body.innerHTML = '<p class="doc-empty">Nenhuma história gerada ainda.</p>';
      return;
    }
    // Each item's "Como ..., quero ..., para ..." comes from its own
    // historia.html (ArtifactHtml.story_statement renders it as the doc's
    // one <blockquote> — see workflows/shared/artifacts/artifact_html.mh).
    // Read the rendered HTML because the index previews exactly the wording
    // presented to the user. The adjacent JSON is deliberately reserved for
    // LLM context; a folder whose HTML read fails still shows its title.
    const items = await Promise.all(folders.map(async (f) => ({
      folder: f.name,
      title: codedHistoriaTitle(row.featureFolder, f.name),
      statement: await storyStatementOf(project.id, row.featureFolder, f.name),
    })));
    body.innerHTML = `<ul class="doc-index">${items
      .map((it) => `<li><button class="doc-index-item" data-folder="${escapeHtml(it.folder)}">
        <span class="doc-index-icon">${icon('fileText', 18)}</span>
        <span class="doc-index-copy">
          <strong class="doc-index-title">${escapeHtml(it.title)}</strong>
          ${it.statement ? `<span class="doc-index-statement">${escapeHtml(it.statement)}</span>` : ''}
        </span>
      </button></li>`)
      .join('')}</ul>`;
    body.querySelectorAll('[data-folder]').forEach((button) => {
      button.addEventListener('click', () => openHistoria(row.featureFolder, button.dataset.folder));
    });
    // Regenerates the WHOLE per-feature batch (HistoriasGenerate produces
    // every história for this feature in one call, same as the initial
    // generation) — canRequestChanges(row) doesn't gate this one (its
    // synthetic entry has no collectionKind), it's fine on its own terms.
    setFooter(buildRequestChangesComposer(row));
  }

  // storyStatementOf reads one história's rendered HTML and pulls out the
  // plain-text "Como ..., quero ..., para ..." blockquote — the only place
  // that statement is stored (see renderHistoriasIndex's comment above).
  // Swallows read/parse errors: a missing or malformed file just means no
  // preview text under that item's title, not a broken index.
  async function storyStatementOf(projectId, featureFolder, folderName) {
    try {
      const html = await readProjectFile(projectId, 'artifacts', `historias/${featureFolder}/${folderName}/historia.html`);
      const blockquote = new DOMParser().parseFromString(html, 'text/html').querySelector('blockquote');
      return blockquote ? blockquote.textContent.trim().replace(/\s+/g, ' ') : '';
    } catch {
      return '';
    }
  }

  async function openHistoria(featureFolder, folderName) {
    const label = codedHistoriaTitle(featureFolder, folderName);
    showLoading(label);
    try {
      const html = await readProjectFile(project.id, 'artifacts', `historias/${featureFolder}/${folderName}/historia.html`);
      showHtmlDoc(label, html, { mermaid: hasMermaidDiagram(html), inlineMermaid });
    } catch (err) {
      beginCustom(label).innerHTML = `<p class="doc-empty">Erro ao abrir história: ${escapeHtml(String(err))}</p>`;
    }
  }


  // Keyed by project + artifact (not just artifact) so this stays correct
  // even though active-runs.js's registry is a single app-wide map shared
  // by every work-item's Artefatos tab.
  function activeKey(row) {
    return `${project.id}:${row.key}`;
  }

  // onRunUpdate is the one place that reacts to a status update, shared by
  // both a freshly-started generate() and a reattachActiveRuns() call —
  // keeping them identical is what makes "switch tabs mid-generation and
  // come back" behave exactly like "never left" from the user's side.
  function onRunUpdate(row, tracker, key, status) {
    tracker.update(status);
    if (status.runId) setActiveRun(key, status.runId);
    if (isFullyTerminal(status)) {
      clearActiveRun(key);
      if (status.state === 'completed') {
        // Deliberately skip the immediate render below for this one case —
        // doneNames/historiasDoneFeatureIds are still stale here (this fires
        // synchronously, before refreshDoneState()'s listProjectDir call
        // resolves), so isRowDone(row) would read false and renderDetail()
        // would render "Gerar" again for an artifact that in fact just
        // finished — a real, always-reproducible bug, not just a timing
        // fluke, since nothing else was scheduled to correct it if this
        // callback never got invoked again. Render only once, after
        // refreshDoneState() below has fresh data.
        refreshDoneState().then(() => {
          if (!active) return;
          // The group's own row (e.g. "adr") disappears the moment its
          // children exist (see rowsToRender) — if that's what was selected,
          // jump to the first child instead of leaving renderList()'s own
          // "selection vanished" fallback to pick whatever sorts first
          // overall, which would yank the view to an unrelated artifact
          // right as this one finishes.
          if (!rowsToRender().some((r) => r.key === selectedKey)) {
            const firstChild = rowsToRender().find((r) => r.groupKey === row.key || r.historiasRow?.key === row.key);
            if (firstChild) selectedKey = firstChild.key;
          }
          renderList();
          renderDetail();
          onChanged();
        });
        return;
      }
    }
    if (active) {
      renderList();
      if (selectedKey === row.key) renderDetail();
    }
  }

  function onRunError(row, tracker, key, err) {
    clearActiveRun(key);
    tracker.update({ runId: '', state: 'failed', error: String(err) });
    if (!active) return;
    renderList();
    if (selectedKey === row.key) renderDetail();
  }

  // onRunCancel is run-tracker.js's onCancel hook for a paused run's
  // "Cancelar" — the whole point of canceling here is abandoning the draft,
  // not leaving a "cancelado" row behind (unlike a run that fails on its
  // own). Dropping the tracker entirely means renderDetail()'s tracker
  // lookup comes back empty, so the row falls straight back through to
  // isRowDone (still false, nothing was ever committed to artifacts/) into
  // the plain "pronto para gerar" / "Gerar" state — exactly like the draft,
  // and the pending_data it lived in, never existed.
  function onRunCancel(row, key) {
    cancelQueuedLlmJob(key);
    clearActiveRun(key);
    trackers.get(row.key)?.dispose();
    trackers.delete(row.key);
    if (!active) return;
    renderList();
    if (selectedKey === row.key) renderDetail();
  }

  // Approval is a publication command over the reviewed pending_data, not a
  // request to continue executing the old pipeline. Always start the current
  // workflow in its commit-only path; this works for both unchanged and old
  // checkpoints and never gives mhl a chance to invalidate the draft merely
  // because the pipeline definition changed between sessions.
  async function approvePendingDocument(row, tracker, key, pausedStatus) {
    const args = approvalRecoveryArgs({
      workflow,
      projectId: project.id,
      projectType: project.type,
      row,
      status: pausedStatus,
    });
    let finalStatus = null;
    try {
      const started = await startAndWatch(workflow, args, (status) => {
        finalStatus = status;
        onRunUpdate(row, tracker, key, status);
      });
      const replacementRunId = started?.runId || finalStatus?.runId || '';
      finalStatus = await waitForRecoveryTerminal({
        runId: replacementRunId,
        initialStatus: finalStatus || started,
        getStatus: getRunStatus,
        onUpdate: (status) => onRunUpdate(row, tracker, key, status),
      });
    } catch (recoveryError) {
      // Keep the original paused run discoverable after a remount: it still
      // owns the only durable copy of pending_data if the fresh Commit failed
      // before writing the artifact.
      setActiveRun(key, pausedStatus.runId);
      throw recoveryError;
    }

    if (!finalStatus || finalStatus.state !== 'completed') {
      setActiveRun(key, pausedStatus.runId);
      throw new Error(finalStatus?.error || 'Não foi possível persistir o documento pendente com o workflow atual.');
    }

    // The replacement run committed successfully. The incompatible paused
    // checkpoint is now superseded and can be retired best-effort; approval
    // itself must stay successful even if old-state cleanup is unavailable.
    cancelRun(pausedStatus.runId).catch(() => {});
    return true;
  }

  function createArtifactTracker(row, key) {
    let tracker;
    tracker = createRunTracker({
      onCancel: () => onRunCancel(row, key),
      onUpdate: (status) => onRunUpdate(row, tracker, key, status),
      onApprove: (pausedStatus) => approvePendingDocument(row, tracker, key, pausedStatus),
      fillHeight: true,
    });
    return tracker;
  }

  // feedback (optional): non-empty when this generate() is really "Solicitar
  // mudança" on an already-approved row (buildRequestChangesComposer above)
  // rather than a first-time "Gerar" — forwarded to StartRun as-is;
  // discovery.mh/delivery.mh's Dispatch step is what actually consumes it
  // before the first *Generate call (see that input's own comment for why
  // that matters — one LLM call informed from the start, not two).
  function generate(row, feedback) {
    const key = activeKey(row);
    reattachedKeys.delete(key); // a new run for this key reports through the queue again
    if (row.parentKey) expandedFeatures.add(row.parentKey); // never hide a starting generation behind a collapsed feature
    // onUpdate: Aprovar/Regenerar (run-tracker.js's own composer) resume
    // this run directly, bypassing startAndWatch entirely — without this,
    // their pushes only repainted the tracker widget itself, never reaching
    // onRunUpdate's refreshDoneState()/renderList()/renderDetail(). Real bug
    // this fixes: approving a paused run wrote the artifact correctly, but
    // the screen kept showing the paused composer, then fell back to
    // "pronto para gerar" on the next unrelated re-render, as if the
    // approval had never happened.
    const tracker = createArtifactTracker(row, key);
    trackers.set(row.key, tracker);
    // Seed a non-null "queued" status right away — the run only starts once
    // llm-queue.js has a free LLM slot (see that file for why generations
    // are capped), so without this the renderDetail() call a few lines down
    // sees tracker.status still null and falls straight back to the "Gerar"
    // button, as if the click had done nothing.
    tracker.update({ runId: '', state: 'queued' });

    // buddy: true always — this screen used to let a "Modo Buddy" checkbox
    // toggle it, but the checkbox itself (not the pause-for-review gate it
    // controlled) was what wasn't earning its keep: dropping the checkbox
    // without pinning buddy to true left it on discovery.mh/delivery.mh's
    // own default (`input buddy: bool = false`), which skips the pause
    // entirely and writes straight to artifacts/ — every generation looked
    // "auto-approved" with no Aprovar step at all. Pinning it here keeps the
    // review gate always on, just without a toggle to accidentally turn off.
    // autorrevisao: true always, for the same reason — an internal step, not
    // a user choice (the sidebar toggle is gone). The workflow makes at most
    // one extra LLM call when the draft fails its checks, before the pause.
    const args = { ...runTargetArgs(row), buddy: true, autorrevisao: true, ...(feedback ? { feedback } : {}) };

    // Status arrives through onLlmJobUpdate (subscribed at mount), not a
    // callback bound to this mount — the job may start after the tab has
    // been remounted, and the new mount must be the one that renders it.
    enqueueLlmRun(key, workflow, args);

    renderList();
    renderDetail();
  }

  // runTargetArgs: which artifact a row generates, in the workflow's own
  // inputs — shared by generate() and approval recovery (checkpoint-
  // recovery.js mirrors it for a paused draft). A feature's "Histórias" row
  // needs its feature_id; a plan row, the história it belongs to.
  function runTargetArgs(row) {
    if (workflow === 'Discovery') {
      if (row.plan) return { project_id: project.id, artifact: 'plano', feature_id: row.plan.featureId, historia_id: row.plan.historiaId };
      if (row.featureId) return { project_id: project.id, artifact: 'historias', feature_id: row.featureId };
      return { project_id: project.id, artifact: row.key };
    }
    if (row.plan) return { project_id: project.id, mode: project.type, artifact: 'plano', historia_id: row.plan.historiaId };
    return { project_id: project.id, mode: project.type, artifact: row.key };
  }

  // rowForKey resolves an active-runs/llm-queue key back to the row it
  // belongs to — including rows rowsToRender() doesn't offer right now: a
  // collection's group row while it regenerates as a batch, or a feature's
  // "Histórias" row before its tracker exists.
  function rowForKey(key) {
    const prefix = `${project.id}:`;
    if (!key.startsWith(prefix)) return null;
    const rowKey = key.slice(prefix.length);
    const visible = rowsToRender().find((r) => r.key === rowKey);
    if (visible) return visible;
    const entry = sequence.find((e) => e.artifact === rowKey);
    if (entry) return { key: entry.artifact, label: labelFor(entry.artifact), entry, category: entry.category };
    return (
      featureRowsForHistorias().map(historiasRowFor).find((r) => r.key === rowKey) ??
      allPlanRows().find((r) => r.key === rowKey) ??
      null
    );
  }

  // Keys this mount follows through watchExistingRun (reattachActiveRuns) —
  // their updates already arrive that way, so the queue's broadcast of the
  // same run is ignored instead of applied twice.
  const reattachedKeys = new Set();

  function onLlmJobUpdate(key, status) {
    if (!active || reattachedKeys.has(key)) return;
    const row = rowForKey(key);
    if (!row) return;
    let tracker = trackers.get(row.key);
    if (!tracker) {
      tracker = createArtifactTracker(row, key);
      trackers.set(row.key, tracker);
    }
    onRunUpdate(row, tracker, key, status);
  }
  const unsubscribeLlmJobs = subscribeLlmJobs(onLlmJobUpdate);

  // Runs once at mount, before the first render: anything still active()
  // in the registry for this project genuinely is still running on the
  // backend (mhl doesn't stop just because the tab remounted) — reattach a
  // fresh tracker + event subscription to each instead of letting it look
  // like nothing is happening.
  function reattachActiveRuns() {
    function reattach(row) {
      const key = activeKey(row);
      // Still owned by llm-queue.js (waiting for a slot, or started and not
      // yet paused): show its latest status; the queue keeps broadcasting.
      const queued = llmJob(key);
      if (queued) {
        const tracker = createArtifactTracker(row, key);
        trackers.set(row.key, tracker);
        tracker.update(queued);
        return;
      }
      const runId = getActiveRun(key);
      if (!runId) return;
      reattachedKeys.add(key);
      const tracker = createArtifactTracker(row, key);
      trackers.set(row.key, tracker);
      tracker.update({ runId, state: 'working' });
      selectedKey = row.key; // jump straight to the progress the user left running
      if (row.parentKey) expandedFeatures.add(row.parentKey);
      watchExistingRun(runId, (status) => onRunUpdate(row, tracker, key, status)).catch((err) =>
        onRunError(row, tracker, key, err),
      );
    }

    // Collection-level regenerations ("Solicitar mudança" fired from inside
    // an already-approved item — see hasActiveGroupRegeneration/
    // canonicalGroupRow) are keyed by the collection's OWN artifact name
    // (e.g. "adr"), which rowsToRender() doesn't offer as a row at all once
    // the collection is done, UNLESS a tracker for that exact key already
    // exists — that's the whole point of hasActiveGroupRegeneration. On a
    // fresh mount `trackers` starts empty, so the loop below (which only
    // ever iterates rowsToRender()'s CURRENT output) would never even look
    // up activeKey for that collection and silently fail to reattach a
    // regeneration still running from before this remount. Running this
    // pass first, against every collectionKind entry's own group-level row
    // directly, means by the time the loop below calls rowsToRender() the
    // collection is already correctly un-expanded back to its group row.
    for (const entry of sequence) {
      if (!entry.collectionKind || !doneNames.has(entry.artifact)) continue;
      reattach({ key: entry.artifact, label: labelFor(entry.artifact), entry, category: entry.category });
    }

    for (const row of rowsToRender()) {
      reattach(row);
    }

    // Per-feature histórias generations only appear in rowsToRender() once
    // their tracker exists, so the loop above never sees them on a fresh
    // mount — look each one up explicitly (after that loop, so none is
    // reattached twice).
    for (const featureRow of featureRowsForHistorias()) {
      reattach(historiasRowFor(featureRow));
    }
    // Same for a plan still being generated (its row only renders once a
    // tracker exists) — skipping plans the loop above already reattached.
    for (const planRow of allPlanRows()) {
      if (!trackers.has(planRow.key)) reattach(planRow);
    }
  }

  await refreshDoneState();
  reattachActiveRuns();
  renderList();
  await renderDetail();

  return () => {
    active = false;
    unsubscribeLlmJobs();
    // A tracker still working/queued when this tab unmounts owns a ticking
    // setInterval (run-tracker.js's elapsed-time display) — nothing else
    // ever references it again to clear it, so this must, even though the
    // generation itself keeps running on the backend regardless (see this
    // function's own doc comment on `active`).
    for (const tracker of trackers.values()) tracker.dispose();
  };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

function escapeAttribute(text) {
  return escapeHtml(text).replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
