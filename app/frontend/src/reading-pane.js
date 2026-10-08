// The shared right-hand reading pane (§ "coluna de leitura" per the user's
// reference screenshot) — a single instance owned by shell.js, mounted
// once, then driven by whichever tab currently has something to show
// (a wiki page, an artifact preview, a live generation/upload tracker, or a
// "gerar" call-to-action). Centralizing this avoids duplicating the same
// header (title/type + tools + expand-to-fullscreen) in every tab that
// reads something, and keeps "where does the document go" consistent
// regardless of which tab is active.
import { icon } from './icons.js';
import { OpenHTMLInBrowser } from '../wailsjs/go/main/App';
import { inlineMermaidStandalone } from './mermaid-inline.js';
import artifactShellTemplate from '../../../workflows/shared/artifacts/page_shell.prompt.md?raw';

let els = null;
let fullscreenTarget = null;
// externalHtml holds a full standalone HTML document for whatever is
// currently shown, or null when nothing shown has one (showEmpty,
// beginCustom/showAction/showLoading's custom bodies, a paused run's live
// tracker) — set by showMarkdownDoc/showHtmlDoc, reset by setHeader (the
// same choke point clearFooter already uses), and read by the "abrir no
// navegador" button's click handler.
let externalHtml = null;

export function mountReadingPane(container) {
  container.innerHTML = `
    <header class="doc-head">
      <div class="doc-head-title">
        <span class="doc-title" data-rp-title></span>
        <span class="doc-type" data-rp-type></span>
      </div>
      <div class="doc-tools">
        <span data-rp-tools></span>
        <button class="button tertiary small icon-only" data-rp-open-external title="Abrir no navegador">${icon('externalLink', 14)}</button>
        <button class="button tertiary small icon-only" data-rp-expand title="Expandir para tela cheia">${icon('maximize', 14)}</button>
      </div>
    </header>
    <div class="doc-body" data-rp-body></div>
    <div class="doc-footer" data-rp-footer hidden></div>
  `;
  els = {
    container,
    titleEl: container.querySelector('[data-rp-title]'),
    typeEl: container.querySelector('[data-rp-type]'),
    tools: container.querySelector('[data-rp-tools]'),
    body: container.querySelector('[data-rp-body]'),
    footer: container.querySelector('[data-rp-footer]'),
    expandBtn: container.querySelector('[data-rp-expand]'),
    openExternalBtn: container.querySelector('[data-rp-open-external]'),
  };
  fullscreenTarget = container;
  els.expandBtn.addEventListener('click', () => {
    const expanded = fullscreenTarget.classList.toggle('pane-fullscreen');
    els.expandBtn.innerHTML = icon(expanded ? 'x' : 'maximize', 14);
    els.expandBtn.title = expanded ? 'Sair da tela cheia' : 'Expandir para tela cheia';
  });
  els.openExternalBtn.addEventListener('click', () => {
    if (!externalHtml) return;
    OpenHTMLInBrowser(externalHtml).catch((err) => console.error('OpenHTMLInBrowser failed', err));
  });
  showEmpty();
}

function setHeader(title, type) {
  els.titleEl.textContent = title || '';
  els.typeEl.textContent = type || '';
  // Every show*/beginCustom call below routes through here first — the one
  // choke point where "the pane now shows something else" is known, so it's
  // also where a stale footer (a paused run's composer left over from
  // whatever was open before) gets dropped. A caller that still wants one
  // calls setFooter() again right after.
  clearFooter();
  setExternalHtml(null);
}

function setExternalHtml(html) {
  externalHtml = html;
  els.openExternalBtn.disabled = !html;
}

// setFooter mounts a persistent action bar below .doc-body — its own flex
// child of .document (see .doc-footer in style.css), not part of .doc-body's
// scrolling content, so it stays visible at the bottom of the pane
// regardless of how far the document above it is scrolled. Built for
// run-tracker.js's paused-state composer (tab-artefatos.js's "Aprovar" /
// "Regenerar" / "Cancelar" bar used to scroll out of view above a long
// preview — see that tab's renderDetail()) but generic to any single
// element a caller wants pinned there.
export function setFooter(element) {
  els.footer.innerHTML = '';
  els.footer.hidden = false;
  els.footer.appendChild(element);
}

export function clearFooter() {
  els.footer.innerHTML = '';
  els.footer.hidden = true;
}

// setToolbarAction mounts a single element into the header toolbar
// (.doc-tools), alongside "ver fonte"/expand — for a primary action that
// belongs in the top bar instead of the footer (run-tracker.js's "Aprovar",
// see tab-artefatos.js's renderDetail()). No separate clear function: every
// show*/beginCustom call already resets `els.tools.innerHTML` up front (same
// as setHeader already does for the footer), so the next document shown
// drops this automatically.
export function setToolbarAction(element) {
  els.tools.innerHTML = '';
  els.tools.appendChild(element);
}

// prependToolbarAction adds `element` before the toolbar's current buttons
// (showHtmlDoc's Editar/ver fonte) instead of replacing them.
export function prependToolbarAction(element) {
  els.tools.prepend(element);
}

export function showEmpty(message) {
  setHeader('', '');
  els.tools.innerHTML = '';
  els.body.className = 'doc-body';
  els.body.innerHTML = `<p class="doc-empty">${escapeHtml(message || 'Selecione um artefato ou uma página da wiki para ler.')}</p>`;
}

// beginCustom clears the pane down to an empty body (still under the
// shared title/expand header) and hands back the body element — for
// content shapes that don't fit showMarkdownDoc/showHtmlDoc (a live run
// tracker, a query/lint result).
export function beginCustom(title, type = '') {
  setHeader(title, type);
  els.tools.innerHTML = '';
  els.body.className = 'doc-body';
  els.body.innerHTML = '';
  return els.body;
}

// showAction is beginCustom plus a primary action button living in the
// header toolbar (next to "ver fonte"/expand) instead of floating in the
// middle of the body — matches the reference's convention of keeping every
// action in the top toolbar. Used for "Gerar"/"Tentar novamente"; the body
// itself is still the caller's to fill (a description, a live tracker, ...).
export function showAction(title, actionLabel, onAction) {
  setHeader(title, '');
  els.body.className = 'doc-body';
  els.body.innerHTML = '';
  els.tools.innerHTML = `<button class="button primary small" data-rp-action>${escapeHtml(actionLabel)}</button>`;
  els.tools.querySelector('[data-rp-action]').addEventListener('click', onAction);
  return els.body;
}

// showLoading renders the document skeleton (a centered "page" card over a
// cream ground, with a small floating status label) used while a generated
// artifact's HTML is being fetched — see renderPreview/renderHistoriasIndex/
// openHistoria in tab-artefatos.js — in place of the plain ".doc-empty" text
// that used to sit there.
export function showLoading(title, message = 'Carregando…') {
  setHeader(title, '');
  els.tools.innerHTML = '';
  els.body.className = 'doc-body doc-loading';
  els.body.innerHTML = `
    <div class="doc-loading-card">
      <div class="doc-skel doc-skel-title"></div>
      <div class="doc-skel" style="width:88%"></div>
      <div class="doc-skel" style="width:72%"></div>
      <div class="doc-skel" style="width:80%"></div>
      <div class="doc-skel doc-skel-accent"></div>
      <div class="doc-skel-rule"></div>
      <div class="doc-skel" style="width:65%"></div>
      <div class="doc-skel" style="width:50%"></div>
    </div>
    <span class="doc-loading-label">${escapeHtml(message)}</span>
  `;
  return els.body;
}

export function showMarkdownDoc(title, html) {
  setHeader(title, 'MD');
  els.tools.innerHTML = '';
  els.body.className = 'doc-body wiki-doc';
  els.body.innerHTML = html;
  setExternalHtml(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title || '')}</title></head><body>${html}</body></html>`);
}

// Every artifact's own HTML has a fixed body{max-width:...} baked in at
// generation time (workflows/shared/artifacts/page_shell.prompt.md) — that
// template got widened too, but the fix only reaches artifacts generated
// AFTER the change, since the CSS is inlined into each saved .html file,
// not loaded from anywhere external. Rather than make "the preview looks
// narrow" depend on regenerating (a real LLM call) every already-generated
// artifact, override it from here for every artifact regardless of when it
// was generated — a same-specificity rule appended after the artifact's own
// <style> block wins the cascade by source order, no !important needed.
// `rawHtml` itself (what "Ver fonte" shows) is left untouched — only the
// rendered iframe gets this.
//
// No absolute pixel cap here (unlike page_shell.prompt.md's own, meant for
// the standalone file opened outside the app on an arbitrary monitor) —
// this only ever renders inside the app's own reading pane or its
// fullscreen overlay (.pane-fullscreen), both bounded by the actual window,
// so there's no runaway-width case to guard against; a fixed cap here (a
// first attempt used 1040px) just made the pane stop growing well before it
// used the space it actually had, especially in fullscreen.
const WIDE_READING_OVERRIDE = '<style>body{max-width:96%;box-sizing:border-box}</style>';
function widenReadingWidth(html) {
  return html.includes('</head>') ? html.replace('</head>', WIDE_READING_OVERRIDE + '</head>') : WIDE_READING_OVERRIDE + html;
}

// Same problem as the width above, but for the whole look: every artifact's
// <style> block is a frozen copy of page_shell.prompt.md from whenever it
// was generated, so a visual refresh of that template would otherwise only
// reach artifacts regenerated afterwards. Swap the stored block for the
// template's current one at render time — read straight from the workflow
// file (Vite ?raw), so there's a single source of truth for the CSS.
// Only PageShell output carries the `<div class="meta">` footer, which is
// what keeps the wiki's own exported pages (also shown via showHtmlDoc) out
// of this. `rawHtml` on disk (and "Ver fonte") is left untouched.
const STYLE_BLOCK = /<style>[\s\S]*?<\/style>/;
const ARTIFACT_STYLE = STYLE_BLOCK.exec(artifactShellTemplate)?.[0] ?? '';
function restyleArtifact(html) {
  if (!ARTIFACT_STYLE || !html.includes('<div class="meta">')) return html;
  return html.replace(STYLE_BLOCK, () => ARTIFACT_STYLE);
}

// buildDocFrame builds the sandboxed iframe every rendered-HTML view uses
// (a finished artifact via showHtmlDoc below, or a paused run's live
// preview via tab-artefatos.js/ArtifactPreview) — pulled out so both get
// the same wide-reading-pane override and mermaid handling instead of two
// copies that could drift.
//
// autoHeight: false (default) fills the pane (height:100%, own internal
// scroll) — right for the normal one-frame-per-pane case. true instead
// sizes the frame to its own content and lets the PANE scroll, for
// tab-artefatos.js's paused-collection preview, which stacks one frame per
// pending item (diagrama/feature/historia/decisão) — several height:100%
// frames in a row would each fight for the whole pane instead of reading as
// a list of documents. Sized via a `load` listener rather than CSS because
// iframe content height isn't a CSS-computable property of the frame
// itself; `allow-same-origin` (set unconditionally below) is what makes
// contentDocument reachable from here despite the sandbox.
// allowScripts is a second, independent reason to enable 'allow-scripts' on
// the sandbox — for content we generated ourselves deterministically (never
// raw LLM output) that needs its own inline <script> to work, e.g. the wiki's
// static HTML export embedding a local search box (tab-wiki.js). Kept apart
// from `mermaid` because that flag also controls the inlineMermaid rewrite,
// which a caller like this has no use for.
export function buildDocFrame(rawHtml, { mermaid, inlineMermaid, autoHeight, allowScripts } = {}) {
  const widened = widenReadingWidth(restyleArtifact(rawHtml));
  const iframe = document.createElement('iframe');
  iframe.className = autoHeight ? 'doc-frame doc-frame-auto' : 'doc-frame';
  iframe.setAttribute('sandbox', mermaid || allowScripts ? 'allow-scripts allow-same-origin' : 'allow-same-origin');
  iframe.srcdoc = mermaid ? inlineMermaid(widened) : widened;
  if (autoHeight) {
    iframe.addEventListener('load', () => {
      try {
        iframe.style.height = iframe.contentDocument.documentElement.scrollHeight + 'px';
      } catch {
        // Same-origin access failed for some reason — the CSS min-height
        // fallback (style.css's .doc-frame-auto) still leaves it readable.
      }
    });
  }
  return iframe;
}

// showHtmlDoc renders a generated artifact's HTML in a sandboxed iframe
// (srcdoc, never the artifact's raw markup as our own DOM) with a
// "ver fonte" toggle. `mermaid` inlines the bundled mermaid.min.js in place
// of the artifact's asset-relative <script> (see mermaid-inline.js) so a
// diagram renders inside the app without depending on any file on disk.
export function showHtmlDoc(title, rawHtml, { mermaid, inlineMermaid, allowScripts, onEdit } = {}) {
  setHeader(title, 'HTML');
  // A standalone file opened by an external browser process can't resolve
  // the Blob URL buildDocFrame's own inlineMermaid produces below (scoped to
  // this app's webview) — inline the actual mermaid source into this copy
  // instead, the one setExternalHtml hands to "abrir no navegador".
  const restyled = restyleArtifact(rawHtml);
  setExternalHtml(mermaid ? inlineMermaidStandalone(restyled) : restyled);
  let showingSource = false;

  function render() {
    els.body.className = 'doc-body';
    if (showingSource) {
      els.body.innerHTML = `<pre class="doc-source">${escapeHtml(rawHtml)}</pre>`;
      return;
    }
    els.body.innerHTML = '';
    els.body.appendChild(buildDocFrame(rawHtml, { mermaid, inlineMermaid, allowScripts }));
  }

  function toggleLabel() {
    return showingSource ? `${icon('eye', 14)} Ver preview` : `${icon('code', 14)} Ver fonte`;
  }

  // onEdit: artefatos editaveis ganham o lapis ao lado de "ver fonte".
  els.tools.innerHTML = `${onEdit ? `<button class="button tertiary small" data-rp-edit title="Editar este artefato">${icon('edit', 14)} Editar</button>` : ''}<button class="button tertiary small" data-rp-toggle-source>${toggleLabel()}</button>`;
  if (onEdit) els.tools.querySelector('[data-rp-edit]').addEventListener('click', onEdit);
  els.tools.querySelector('[data-rp-toggle-source]').addEventListener('click', (event) => {
    showingSource = !showingSource;
    event.currentTarget.innerHTML = toggleLabel();
    render();
  });
  render();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}
