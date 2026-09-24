// Dependency graphs extracted directly from the workflows' own fail() gates
// (workflows/discovery/discovery.mh, workflows/delivery/delivery.mh) — not
// from the prose in PLANO-MACRO-MHL-SENPAI.md, which describes the same
// thing more narratively. If a workflow's gating logic ever changes, this
// file must change with it (there is no runtime endpoint that reports the
// dependency order — see the plan's §4.1 "não existe como documento").
//
// Each entry's `deps` lists the OTHER artifacts (by name in this same
// sequence) whose file must already exist under artifacts/ before this one
// can be generated. `path` says where to find the generated file (or `dir`
// for a folder of many files) relative to artifacts/, used to check
// "already exists" and to know what to read back for preview.

// `category` groups rows in the UI's artifact list (tab-artefatos.js) under
// a shared section header — purely presentational, doesn't affect ordering
// or dependency gating (that's still `sequence` order and `deps`).
//
// `dir` entries additionally carry `collectionKind` once they hold more than
// one generated document instead of a single file — `'files'` (children are
// the documents themselves, e.g. one .html per ADR) or `'folders'` (children
// are folders, each holding a fixed-name document, e.g. `feature.html`
// inside a Features folder — `itemFile` names that fixed filename). This is
// what lets tab-artefatos.js expand ANY of them into real per-item rows with
// one generic code path instead of a hand-written branch per artifact — see
// its buildItemRows().
export const DISCOVERY_SEQUENCE = [
  { artifact: 'brief', deps: [], path: 'brief.html', category: 'Discovery' },
  { artifact: 'atributos', deps: ['brief'], path: 'atributos.html', category: 'Discovery' },
  { artifact: 'requisitos', deps: ['brief'], path: 'requisitos.html', category: 'Discovery' },
  { artifact: 'adr', deps: ['requisitos', 'atributos'], dir: 'adr', collectionKind: 'files', category: 'Decisões e modelos' },
  { artifact: 'der', deps: ['requisitos', 'atributos'], path: 'der.html', category: 'Decisões e modelos' },
  { artifact: 'diagramas', deps: ['requisitos', 'atributos'], dir: 'diagramas', collectionKind: 'files', category: 'Diagramas' },
  // der is real context for features when present, but never blocks it —
  // deliberately left out of `deps` (see discovery.mh's FeaturesGenerate).
  { artifact: 'features', deps: ['atributos', 'requisitos', 'adr', 'diagramas'], dir: 'features', collectionKind: 'folders', itemFile: 'feature.html', category: 'Backlog da solução' },
  // dependencias reads every feature already committed under features/ (see
  // discovery.partial.backlog.mh's DependenciasGenerate) — an LLM call, not
  // a client-side guess, replacing an earlier from-scratch heuristic that
  // tried to fuzzy-match feature titles in tab-artefatos.js and got it
  // wrong often enough to be worse than nothing.
  { artifact: 'dependencias', deps: ['features'], path: 'dependencias.html', category: 'Backlog da solução' },
  // historias has no fixed `deps` entry here — it's per-feature and only
  // exists once `features` produced at least one folder; see
  // artifactsForProject()/listFeatureIds() below.
];

export const DELIVERY_SEQUENCE = [
  // brief and requisitos are each other's only almost-dependency, and it's
  // optional both ways (brief missing just means a placeholder context, see
  // delivery.mh's NoAtributos-style handling) — neither blocks the other.
  { artifact: 'brief', deps: [], path: 'brief.html', category: 'Contexto' },
  { artifact: 'requisitos', deps: [], path: 'requisitos.html', category: 'Contexto' },
  { artifact: 'adr', deps: ['requisitos'], dir: 'adr', collectionKind: 'files', category: 'Decisões e modelos' },
  { artifact: 'der', deps: ['requisitos'], path: 'der.html', category: 'Decisões e modelos' },
  { artifact: 'diagramas', deps: ['requisitos'], dir: 'diagramas', collectionKind: 'files', category: 'Diagramas' },
  // `final`'s real artifact name is the project's own mode ("feature" or
  // "historia") — resolved by finalArtifactName() below, never hardcoded.
  { artifact: 'final', deps: ['requisitos'], path: null, category: 'Entrega' },
  // historias only applies when mode === "feature"; see sequenceFor().
  { artifact: 'historias', deps: ['final'], dir: 'historias', collectionKind: 'folders', itemFile: 'historia.html', category: 'Entrega' },
];

// finalArtifactName resolves Delivery's `mode`-shaped final artifact
// ("feature" or "historia") to the exact string StartRun's `artifact` input
// and the on-disk filename both use — they're the same word.
export function finalArtifactName(mode) {
  return mode; // "feature" | "historia" — deliberately the identity function, named for clarity at call sites.
}

// sequenceFor returns the ordered artifact list for a work-item, resolving
// Delivery's `final`/`historias` placeholders against the project's own
// `mode` (project.type) and level.
export function sequenceFor(project) {
  if (project.level === 'discovery') {
    return DISCOVERY_SEQUENCE;
  }
  const mode = project.type; // "feature" | "historia"
  const name = finalArtifactName(mode);
  // Every entry's `deps` is remapped too, not just the "final" entry's own
  // `artifact` field — `historias`' deps: ['final'] must become
  // deps: [name], or isReady()/doneNames (keyed by the real artifact name,
  // "feature"/"historia") would never see it as satisfied.
  return DELIVERY_SEQUENCE
    .filter((entry) => entry.artifact !== 'historias' || mode === 'feature')
    .map((entry) => ({
      ...entry,
      artifact: entry.artifact === 'final' ? name : entry.artifact,
      path: entry.artifact === 'final' ? `${name}.html` : entry.path,
      deps: entry.deps.map((dep) => (dep === 'final' ? name : dep)),
    }));
}

// isReady says whether every dependency of `entry` already has a generated
// file, given the set of artifact names already present (`doneNames`, e.g.
// {"brief","requisitos"}).
export function isReady(entry, doneNames) {
  return entry.deps.every((dep) => doneNames.has(dep));
}

// missingDeps lists which dependencies of `entry` are not yet in
// doneNames — used to render a clear "gere '<dep>' antes" tooltip, mirroring
// the workflow's own fail() message wording.
export function missingDeps(entry, doneNames) {
  return entry.deps.filter((dep) => !doneNames.has(dep));
}

// STALE_EPSILON_MS guards against flagging an artifact stale purely from
// filesystem timestamp granularity or clock jitter between two writes that
// are really part of the same moment (some filesystems only keep 1s
// resolution) — a dependency has to be measurably newer than the artifact
// that reads it, not just newer by a rounding error.
const STALE_EPSILON_MS = 2000;

// latestMtimeOf reads the "when was this artifact actually last touched"
// timestamp for one sequence entry out of a listProjectDir() tree
// (byName === Object.fromEntries(nodes.map(n => [n.name, n])), same shape
// refreshDoneState() in tab-artefatos.js already builds). A single-file
// entry (entry.path) uses that file's own mtime; a collection entry
// (entry.dir) uses the MAX mtime across its committed children, never the
// directory inode's own mtime — a dir's mtime only reflects entries being
// added/removed/renamed inside it, not a child file being rewritten in
// place, so a regenerated ADR batch could otherwise look unchanged. Returns
// null when the artifact doesn't exist yet (doneNames already gates entries
// this is called for, but this stays defensive so a caller never has to
// double-check).
function latestMtimeOf(entry, byName) {
  if (entry.dir) {
    const node = byName[entry.dir];
    const children = node && node.children ? node.children : [];
    let latest = null;
    for (const child of children) {
      // Mirrors refreshDoneState()'s own committed-document rule: a
      // 'folders' collection's real content is itemFile inside each child
      // folder (the folder itself is never touched again after creation),
      // a 'files' collection's real content is each child file directly.
      const files =
        entry.collectionKind === 'folders'
          ? (child.children || []).filter((f) => !f.isDir && f.name === entry.itemFile)
          : child.isDir
            ? []
            : [child];
      for (const file of files) {
        if (!file.modifiedAt) continue;
        const t = Date.parse(file.modifiedAt);
        if (!Number.isNaN(t) && (latest === null || t > latest)) latest = t;
      }
    }
    return latest;
  }
  if (entry.path) {
    const node = byName[entry.path];
    if (!node || !node.modifiedAt) return null;
    const t = Date.parse(node.modifiedAt);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

// computeStaleness is the dependency-staleness matrix: for every entry in
// `sequence` that's already generated (doneNames), it checks whether any of
// its OWN deps (artifacts.js's own dependency graph, the same one
// isReady()/missingDeps() read) was touched more recently than this entry
// itself — i.e. this entry was built from an older version of that
// dependency and is now out of sync with it. This is deliberately about
// real timestamps, not "does a downstream artifact merely exist" (the
// earlier, broader warning tab-artefatos.js's downstreamWarningFor used to
// give): right after a normal first pass — brief, then atributos/
// requisitos, then adr/der/diagramas, then features, then dependencias, each
// generated strictly after the one before it — every entry is always NEWER
// than its own deps, so nothing here comes out stale. Staleness only shows
// up once a predecessor is genuinely regenerated (via "Solicitar mudança")
// after its dependents already exist, which is exactly the case worth
// flagging.
//
// Returns a Map keyed by artifact name -> { stale: boolean, staleDeps:
// string[] } (staleDeps names exactly which dependency is newer, for a
// precise tooltip instead of a generic "something changed").
export function computeStaleness(sequence, doneNames, byName) {
  const mtimeByArtifact = new Map();
  for (const entry of sequence) {
    if (!doneNames.has(entry.artifact)) continue;
    mtimeByArtifact.set(entry.artifact, latestMtimeOf(entry, byName));
  }

  const result = new Map();
  for (const entry of sequence) {
    if (!doneNames.has(entry.artifact)) continue;
    const ownMtime = mtimeByArtifact.get(entry.artifact);
    const staleDeps = [];
    if (ownMtime !== null) {
      for (const dep of entry.deps) {
        if (!doneNames.has(dep)) continue;
        const depMtime = mtimeByArtifact.get(dep);
        if (depMtime !== null && depMtime - ownMtime > STALE_EPSILON_MS) staleDeps.push(dep);
      }
    }
    result.set(entry.artifact, { stale: staleDeps.length > 0, staleDeps });
  }
  return result;
}

// featureIdOf extracts the feature_id ArtifactId.find_feature_dir expects
// (the prefix before the first "-") from a folder name like
// "FT001-nome-da-feature".
export function featureIdOf(folderName) {
  const dash = folderName.indexOf('-');
  return dash === -1 ? folderName : folderName.slice(0, dash);
}

export function featureTitleOf(folderName) {
  const dash = folderName.indexOf('-');
  return dash === -1 ? folderName : folderName.slice(dash + 1).replace(/-/g, ' ');
}

// computeCategoryProgress groups sequenceFor(project) by `category` and
// counts how many entries in each already have a generated file, given a
// listProjectDir(project.id, 'artifacts', '') tree — feeds
// workitem-view.js's "progresso por fase" summary card. Mirrors
// tab-artefatos.js's own refreshDoneState() "is this entry done" rule (a
// collection dir needs at least one committed child; a single-file entry
// needs its exact path) as a second, small, read-only implementation
// rather than sharing that file's larger tracker/run bookkeeping, which
// this has no need to touch.
//
// Discovery's per-feature "historias" isn't its own sequence entry (see
// DISCOVERY_SEQUENCE's own comment on why) — folded in here as its own
// unit count under the "Features" category, one per feature folder that
// has committed at least one história, out of every feature folder that
// exists. This is also what fixes the old flat "doneCount/expectedCount"
// count entirely ignoring histórias in its denominator.
export function computeCategoryProgress(project, artifactNodes) {
  const sequence = sequenceFor(project);
  const byName = Object.fromEntries(artifactNodes.map((n) => [n.name, n]));

  function isDone(entry) {
    if (entry.dir) {
      const node = byName[entry.dir];
      const children = node && node.children ? node.children : [];
      return entry.collectionKind === 'folders'
        ? children.some((child) => child.isDir && (child.children || []).some((file) => !file.isDir && file.name === entry.itemFile))
        : children.some((child) => !child.isDir && child.name.endsWith('.html'));
    }
    if (entry.path) return Boolean(byName[entry.path]);
    return false;
  }

  const order = [];
  const byCategory = new Map();
  function bucketFor(category) {
    if (!byCategory.has(category)) {
      byCategory.set(category, { category, done: 0, total: 0 });
      order.push(category);
    }
    return byCategory.get(category);
  }

  for (const entry of sequence) {
    const bucket = bucketFor(entry.category);
    bucket.total += 1;
    if (isDone(entry)) bucket.done += 1;
  }

  if (project.level === 'discovery') {
    const featuresNode = byName.features;
    const featureFolders = featuresNode && featuresNode.children ? featuresNode.children.filter((c) => c.isDir) : [];
    if (featureFolders.length > 0) {
      const historiasNode = byName.historias;
      const historiasChildren = historiasNode && historiasNode.children ? historiasNode.children : [];
      const doneFeatureFolderNames = new Set(
        historiasChildren
          .filter(
            (child) =>
              child.isDir &&
              (child.children || []).some(
                (storyFolder) =>
                  storyFolder.isDir && (storyFolder.children || []).some((file) => !file.isDir && file.name === 'historia.html'),
              ),
          )
          .map((child) => child.name),
      );
      const bucket = bucketFor('Features');
      bucket.total += featureFolders.length;
      bucket.done += featureFolders.filter((f) => doneFeatureFolderNames.has(f.name)).length;
    }
  }

  const byCategoryList = order.map((c) => byCategory.get(c));
  const doneCount = byCategoryList.reduce((sum, c) => sum + c.done, 0);
  const totalCount = byCategoryList.reduce((sum, c) => sum + c.total, 0);
  return { byCategory: byCategoryList, doneCount, totalCount };
}
