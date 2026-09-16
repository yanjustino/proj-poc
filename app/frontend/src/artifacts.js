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
  { artifact: 'features', deps: ['requisitos', 'adr', 'diagramas'], dir: 'features', collectionKind: 'folders', itemFile: 'feature.html', category: 'Features' },
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
