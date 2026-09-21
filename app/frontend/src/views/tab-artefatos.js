import {
  artifactPreview,
  exportProject,
  exportProjectFile,
  isFullyTerminal,
  listProjectDir,
  readProjectFile,
  startAndWatch,
  watchExistingRun,
} from '../api.js';
import { sequenceFor, isReady, missingDeps, featureIdOf, featureTitleOf } from '../artifacts.js';
import { createRunTracker } from '../run-tracker.js';
import { inlineMermaid, hasMermaidDiagram } from '../mermaid-inline.js';
import { beginCustom, buildDocFrame, showHtmlDoc, showEmpty, showAction, showLoading, setFooter, setToolbarAction } from '../reading-pane.js';
import { setActiveRun, getActiveRun, clearActiveRun } from '../active-runs.js';
import { dotClass } from '../status.js';
import { icon } from '../icons.js';

const LABELS = {
  brief: 'Brief',
  atributos: 'Atributos de qualidade',
  requisitos: 'Requisitos',
  adr: 'ADRs',
  der: 'DER',
  diagramas: 'Diagramas C4',
  features: 'Features',
  dependencias: 'Mapa de dependências',
  historias: 'Histórias',
  feature: 'Detalhamento da feature',
  historia: 'Detalhamento da história',
};

function labelFor(name) {
  return LABELS[name] || name;
}

const ARTIFACT_DESCRIPTIONS = {
  brief: 'Visão executiva, contexto e objetivos que orientam o trabalho.',
  atributos: 'Critérios não funcionais que moldam a qualidade da solução.',
  requisitos: 'Necessidades funcionais, regras de negócio e resultados esperados.',
  adr: 'Escolhas arquiteturais registradas com contexto e consequências.',
  der: 'Entidades, atributos e relacionamentos essenciais do domínio.',
  diagramas: 'Visões dos componentes, limites e principais fluxos do sistema.',
  features: 'Capacidades de negócio conectadas aos requisitos e objetivos.',
  dependencias: 'Grafo de dependências entre features e ordem de execução sugerida.',
  historias: 'Histórias detalhadas para implementação e validação.',
  feature: 'Detalhamento funcional da entrega e seus critérios de aceite.',
  historia: 'Comportamento esperado, regras e critérios de aceite da história.',
};

const ARTIFACT_ICONS = {
  brief: 'zap', atributos: 'checkCircle', requisitos: 'fileText', adr: 'layers', der: 'inbox',
  diagramas: 'maximize', features: 'layers', dependencias: 'layers', historias: 'fileText', feature: 'layers', historia: 'fileText',
};

function descriptionFor(row) {
  if (row.groupKey) return `Documento da coleção ${labelFor(row.entry.artifact)}.`;
  if (row.featureId) return `Histórias vinculadas à feature ${row.featureId}.`;
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
// gerar" for something that's actually already underway. What's still
// session-scoped only (lost on an app restart) is exactly that registry —
// see active-runs.js for why it can't be reconstructed from mhl_run_list
// alone.
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
        <button class="button secondary small" data-export-all title="Exportar toda a Wiki e todos os Artefatos">${icon('download', 14)} Exportar tudo</button>
        <div class="artifact-filters">
          <button class="artifact-filter active" data-filter="all">Todos</button>
          <button class="artifact-filter" data-filter="ready">Prontos</button>
          <button class="artifact-filter" data-filter="pending">Pendentes</button>
        </div>
      </div>
    </div>
    <div class="artifact-category-filters" data-category-filters></div>
    <div class="export-status" data-export-status hidden></div>
    <div class="artifact-card-grid" data-list></div>
  `;

  const listEl = container.querySelector('[data-list]');
  const countEl = container.querySelector('[data-artifact-count]');
  const filterButtons = [...container.querySelectorAll('[data-filter]')];
  const categoryFiltersEl = container.querySelector('[data-category-filters]');
  const exportAllButton = container.querySelector('[data-export-all]');
  const exportStatusEl = container.querySelector('[data-export-status]');
  showEmpty('Selecione um artefato para ler ou gerar.');

  let doneNames = new Set();
  // One entry per collection-type artifact (adr/diagramas/features/Delivery's
  // historias) — its children once that artifact's dir has any (files for
  // collectionKind 'files', folders for 'folders'). Keyed by entry.artifact,
  // populated generically in refreshDoneState() from each sequence entry's
  // own `dir`/`collectionKind` — adding a new collection-type artifact later
  // needs zero new code here, just its own entry in artifacts.js.
  let collectionChildren = {};
  let historiasDoneFeatureIds = new Set();
  const trackers = new Map(); // key -> { element, update, status }
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

  exportAllButton.addEventListener('click', async () => {
    exportAllButton.disabled = true;
    try {
      const destination = await exportProject(project.id);
      if (destination) showExportStatus(`Wiki e artefatos exportados para ${destination}`);
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
      return {
        key: `${entry.artifact}-item:${itemId}`,
        label,
        entry,
        groupKey: entry.artifact,
        category: entry.category,
        previewPath,
      };
    });
  }

  // rowsToRender expands every collection entry that turned out to hold more
  // than one generated document into one row per document (see
  // buildItemRows). Discovery's Features is one such collection, but each
  // Feature additionally owns its *own* Histórias collection — that one gets
  // a browsable index instead of flattening here (see renderHistoriasIndex's
  // comment for why), so it's built separately below rather than through the
  // generic path.
  function rowsToRender() {
    const rows = [];
    for (const entry of sequence) {
      if (entry.artifact === 'historias' && project.level === 'discovery') continue;
      if (entry.collectionKind && doneNames.has(entry.artifact)) {
        rows.push(...buildItemRows(entry));
        continue;
      }
      rows.push({ key: entry.artifact, label: labelFor(entry.artifact), entry, category: entry.category });
    }
    if (project.level === 'discovery' && doneNames.has('features')) {
      for (const folder of collectionChildren.features || []) {
        const featureId = featureIdOf(folder.name);
        rows.push({
          key: 'historias:' + featureId,
          label: `Histórias — ${folderTitle(folder.name)}`,
          entry: { artifact: 'historias', deps: ['features'] },
          featureId, // short id ("FT003") — what the workflow's own feature_id argument expects
          featureFolder: folder.name, // full folder name ("FT003-slug...") — historias/ mirrors features/'s folder naming, and only the full name is a real path
          category: 'Features',
        });
      }
    }
    return rows;
  }

  async function refreshDoneState() {
    let nodes;
    try {
      nodes = await listProjectDir(project.id, 'artifacts', '');
    } catch {
      nodes = [];
    }
    const byName = Object.fromEntries(nodes.map((n) => [n.name, n]));
    doneNames = new Set();
    for (const entry of sequence) {
      if (entry.artifact === 'historias' && project.level === 'discovery') continue;
      if (entry.dir) {
        const node = byName[entry.dir];
        if (node && node.children && node.children.length > 0) doneNames.add(entry.artifact);
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
      collectionChildren[entry.artifact] = entry.collectionKind === 'folders' ? children.filter((c) => c.isDir) : children.filter((c) => !c.isDir);
    }
    const historiasNode = byName.historias;
    historiasDoneFeatureIds = new Set();
    if (project.level === 'discovery' && historiasNode && historiasNode.children) {
      for (const child of historiasNode.children) {
        // isRowDone() looks this set up by the *short* feature id
        // (featureIdOf(folder.name), e.g. "FT001") — storing the full folder
        // name here instead ("FT001-contratacao-...") meant this set could
        // never match, so a per-feature "Histórias — X" row could never be
        // marked done even with real histórias already on disk: every
        // completed/approved generation fell straight back to "Gerar".
        if (child.isDir && child.children && child.children.length > 0) historiasDoneFeatureIds.add(featureIdOf(child.name));
      }
    }
  }

  function isRowDone(row) {
    if (row.groupKey) return true; // expanded item rows only ever exist once their group is done
    if (row.featureId) return historiasDoneFeatureIds.has(row.featureId);
    return doneNames.has(row.key);
  }

  function isRowReady(row) {
    if (row.groupKey) return true;
    if (row.featureId) return true; // features already done, per rowsToRender's gating
    return isReady(row.entry, doneNames);
  }

  function renderList() {
    const rows = rowsToRender();
    const visibleRows = rows.filter((row) => {
      if (activeCategory !== 'all' && row.category !== activeCategory) return false;
      if (activeFilter === 'all') return true;
      return activeFilter === 'ready' ? isRowDone(row) : !isRowDone(row);
    });
    if (!selectedKey || !visibleRows.some((r) => r.key === selectedKey)) selectedKey = visibleRows[0]?.key ?? null;
    countEl.textContent = `${rows.length} ${rows.length === 1 ? 'item' : 'itens'}`;

    if (visibleRows.length === 0) {
      listEl.innerHTML = '<div class="artifact-map-empty">Nenhum artefato neste filtro.</div>';
      return;
    }

    listEl.innerHTML = visibleRows
      .map((row) => {
        const tracker = trackers.get(row.key);
        const done = isRowDone(row);
        const ready = isRowReady(row);
        const state = tracker && tracker.status ? tracker.status.state : done ? 'completed' : null;
        const dot = state ? dotClass(state) : '';
        const statusText = state
          ? state === 'completed'
            ? 'gerado'
            : state
          : ready
            ? 'pronto para gerar'
            : `depende de: ${missingDeps(row.entry, doneNames).map(labelFor).join(', ')}`;
        // Only exactly the "pronto para gerar" case (ready, not done, no
        // tracker running/failed) gets the inline button — a failed/paused
        // row already has its own action in the reading pane (Tentar
        // novamente / Aprovar e continuar), right next to the content that
        // explains why.
        const showGenerate = ready && !done && !state;
        const exportPath = done ? row.previewPath || row.entry.path : '';
        const artifactName = row.entry.artifact;
        const kindClass = ['adr', 'der'].includes(artifactName)
          ? 'decision'
          : artifactName === 'diagramas'
            ? 'diagram'
            : ['features', 'feature', 'historias', 'historia'].includes(artifactName)
              ? 'feature'
              : 'discovery';
        return `
          <article class="artifact-card ${kindClass} ${row.key === 'brief' ? 'featured' : ''} ${row.key === selectedKey ? 'selected' : ''} ${!done ? 'pending' : ''}">
            <button class="artifact-card-main" data-key="${escapeHtml(row.key)}" ${!ready && !done && !state ? 'disabled' : ''} title="${escapeHtml(statusText)}">
              <span class="artifact-card-kind"><i>${icon(ARTIFACT_ICONS[artifactName] || 'fileText', 14)}</i>${escapeHtml(row.category || labelFor(artifactName))}</span>
              <strong>${escapeHtml(row.label)}</strong>
              <span class="artifact-card-description">${escapeHtml(descriptionFor(row))}</span>
            </button>
            <footer class="artifact-card-foot">
              <span class="status-dot ${dot}"></span><span>${escapeHtml(statusText)}</span>
              ${exportPath ? `<button class="artifact-card-export" data-export-file="${escapeAttribute(exportPath)}" title="Exportar ${escapeAttribute(row.label)}">${icon('download', 12)} Exportar</button>` : ''}
              ${showGenerate ? `<button class="artifact-card-generate" data-generate="${escapeHtml(row.key)}" title="Gerar ${escapeHtml(row.label)}">Gerar →</button>` : ''}
            </footer>
          </article>
        `;
      })
      .join('');

    listEl.querySelectorAll('.artifact-card-main').forEach((button) => {
      button.addEventListener('click', () => {
        selectedKey = button.dataset.key;
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

  async function renderDetail() {
    const row = currentRow();
    if (!row) {
      showEmpty('Nenhum artefato disponível.');
      return;
    }

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

    if (ready) {
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
    showHtmlDoc(row.label, html, { mermaid: hasMermaidDiagram(html), inlineMermaid });
  }

  // renderHistoriasIndex is the one collection that gets a browsable index
  // instead of a flat row-per-item: a Discovery feature can hold many
  // histórias, and flattening every feature's every história into the same
  // middle-column list would make it explode (N features × M histórias each).
  // Clicking "Histórias — <feature>" lists its histórias here instead;
  // clicking one of those opens its actual content in the same pane.
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
    const folders = nodes.filter((n) => n.isDir);
    const body = beginCustom(row.label);
    if (folders.length === 0) {
      body.innerHTML = '<p class="doc-empty">Nenhuma história gerada ainda.</p>';
      return;
    }
    body.innerHTML = `<ul class="doc-index">${folders
      .map((f) => `<li><button class="doc-index-item" data-folder="${escapeHtml(f.name)}">${escapeHtml(codedHistoriaTitle(row.featureFolder, f.name))}</button></li>`)
      .join('')}</ul>`;
    body.querySelectorAll('[data-folder]').forEach((button) => {
      button.addEventListener('click', () => openHistoria(row.featureFolder, button.dataset.folder));
    });
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
            const firstChild = rowsToRender().find((r) => r.groupKey === row.key);
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
    clearActiveRun(key);
    trackers.get(row.key)?.dispose();
    trackers.delete(row.key);
    if (!active) return;
    renderList();
    if (selectedKey === row.key) renderDetail();
  }

  function generate(row) {
    const key = activeKey(row);
    // onUpdate: Aprovar/Regenerar (run-tracker.js's own composer) resume
    // this run directly, bypassing startAndWatch entirely — without this,
    // their pushes only repainted the tracker widget itself, never reaching
    // onRunUpdate's refreshDoneState()/renderList()/renderDetail(). Real bug
    // this fixes: approving a paused run wrote the artifact correctly, but
    // the screen kept showing the paused composer, then fell back to
    // "pronto para gerar" on the next unrelated re-render, as if the
    // approval had never happened.
    const tracker = createRunTracker({ onCancel: () => onRunCancel(row, key), onUpdate: (status) => onRunUpdate(row, tracker, key, status), fillHeight: true });
    trackers.set(row.key, tracker);
    // Seed a non-null "working" status right away — App.StartRun's own
    // response is still an unresolved promise at this point, so without
    // this, the renderDetail() call a few lines down (before that promise
    // settles) sees tracker.status still null and falls through straight
    // back to the "Gerar" button, as if the click had done nothing.
    tracker.update({ runId: '', state: 'working' });

    // buddy: true always — this screen used to let a "Modo Buddy" checkbox
    // toggle it, but the checkbox itself (not the pause-for-review gate it
    // controlled) was what wasn't earning its keep: dropping the checkbox
    // without pinning buddy to true left it on discovery.mh/delivery.mh's
    // own default (`input buddy: bool = false`), which skips the pause
    // entirely and writes straight to artifacts/ — every generation looked
    // "auto-approved" with no Aprovar step at all. Pinning it here keeps the
    // review gate always on, just without a toggle to accidentally turn off.
    const args =
      workflow === 'Discovery'
        ? { project_id: project.id, artifact: row.featureId ? 'historias' : row.key, buddy: true, ...(row.featureId ? { feature_id: row.featureId } : {}) }
        : { project_id: project.id, mode: project.type, artifact: row.key, buddy: true };

    startAndWatch(workflow, args, (status) => onRunUpdate(row, tracker, key, status)).catch((err) =>
      onRunError(row, tracker, key, err),
    );

    renderList();
    renderDetail();
  }

  // Runs once at mount, before the first render: anything still active()
  // in the registry for this project genuinely is still running on the
  // backend (mhl doesn't stop just because the tab remounted) — reattach a
  // fresh tracker + event subscription to each instead of letting it look
  // like nothing is happening.
  function reattachActiveRuns() {
    for (const row of rowsToRender()) {
      const key = activeKey(row);
      const runId = getActiveRun(key);
      if (!runId) continue;
      const tracker = createRunTracker({ onCancel: () => onRunCancel(row, key), onUpdate: (status) => onRunUpdate(row, tracker, key, status), fillHeight: true });
      trackers.set(row.key, tracker);
      tracker.update({ runId, state: 'working' });
      selectedKey = row.key; // jump straight to the progress the user left running
      watchExistingRun(runId, (status) => onRunUpdate(row, tracker, key, status)).catch((err) =>
        onRunError(row, tracker, key, err),
      );
    }
  }

  await refreshDoneState();
  reattachActiveRuns();
  renderList();
  await renderDetail();

  return () => {
    active = false;
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
