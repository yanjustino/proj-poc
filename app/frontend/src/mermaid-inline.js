// Diagram artifacts (§3.5 of the plan) embed a `<pre class="mermaid">` block
// plus `<script src="./assets/mermaid.min.js">` — a relative path that only
// resolves once Fase 7 vendors that asset next to the packaged artifact.
// Until then, previewing a diagram inside this app's own webview would show
// raw Mermaid source instead of a rendered diagram. This module inlines the
// same mermaid build this frontend already depends on (bundled into the
// app itself via Vite's `?raw` import — not the Fase 7 vendoring story,
// which is about the artifact file itself when opened outside the app).
import mermaidSource from 'mermaid/dist/mermaid.min.js?raw';

// Different artifact templates sit at different folder depths (DER at
// artifacts/der.html uses "./assets/…"; a C4 diagram at
// artifacts/diagramas/<nome>.html is one level deeper and uses
// "../assets/…") — (?:\.\.?/)+ matches either, and any deeper nesting, not
// just the one depth that happened to get tested first.
const ASSET_SCRIPT_TAG = /<script\s+src=["'](?:\.\.?\/)+assets\/mermaid\.min\.js["']\s*>\s*<\/script>/i;

export function hasMermaidDiagram(html) {
  return /<pre[^>]*class=["'][^"']*\bmermaid\b[^"']*["']/i.test(html ?? '');
}

// mermaid.min.js is ~5.5MB minified. Every diagram artifact view used to
// splice that whole source in as literal inline <script> text — meaning the
// browser had to re-tokenize a ~5.5MB HTML document and re-parse that much
// JS from scratch on every single open, synchronously, on the same JS thread
// the sandboxed iframe shares with the rest of the app window (WKWebView
// doesn't run iframes out-of-process) — a real, measured multi-hundred-ms
// full-window freeze per view (worse on a bigger diagram or slower
// machine), reported as "a página de DER tá travando a aplicação".
//
// A Blob URL built once and reused turns this into a normal `<script src>`
// load instead of inline source text — smaller HTML for the parser to
// tokenize on every view, and a stable URL the engine can reuse its own
// script/bytecode cache for across repeated views in the same session,
// instead of treating every view as brand new source.
let cachedMermaidScriptUrl = null;
function mermaidScriptUrl() {
  if (!cachedMermaidScriptUrl) {
    const blob = new Blob([mermaidSource], { type: 'text/javascript' });
    cachedMermaidScriptUrl = URL.createObjectURL(blob);
  }
  return cachedMermaidScriptUrl;
}

// inlineMermaid replaces the artifact's asset-relative <script> with one
// pointing at the cached mermaid Blob URL, so the diagram renders inside an
// `iframe srcdoc` with no dependency on any file existing on disk. Returns
// the input unchanged if there's no such tag to replace (e.g. the artifact
// isn't a diagram, or already changed shape) or the input isn't a string.
export function inlineMermaid(html) {
  if (typeof html !== 'string') return html;
  if (!ASSET_SCRIPT_TAG.test(html)) return html;
  // A replacer function, not a template string: String.replace treats a
  // string replacement's own "$&", "$`", "$'", "$$" etc. as substitution
  // patterns, and mermaidScriptUrl()'s blob: URL is short but that gotcha
  // still applies on principle — a function's return value is spliced in
  // verbatim, no exceptions.
  return html.replace(ASSET_SCRIPT_TAG, () => `<script src="${mermaidScriptUrl()}"></script>`);
}

// inlineMermaidStandalone embeds mermaid's actual source instead of a Blob
// URL — reading-pane.js's "abrir no navegador" writes the artifact out to
// its own temp file for an external browser process to open, where a
// blob: URL (scoped to this app's own webview) can't resolve at all, unlike
// inlineMermaid's use inside this app's own iframe.
export function inlineMermaidStandalone(html) {
  if (typeof html !== 'string') return html;
  if (!ASSET_SCRIPT_TAG.test(html)) return html;
  // Must be a replacer FUNCTION here, not a template string handed to
  // .replace() as its second argument: mermaidSource is ~5.5MB of minified
  // JS almost certain to contain a "$&"/"$`"/"$'"/"$<digit>" byte sequence
  // somewhere, and String.replace treats those specially in a STRING
  // replacement — splicing in random surrounding-context text at that
  // point and corrupting the embedded script (confirmed: this silently
  // produced a script tag mermaid.min.js could no longer parse as valid
  // JS, which is why `mermaid` came back undefined at the init call right
  // after it, even though replacement "succeeded" with no error). A
  // function's return value is inserted as-is, with no such interpretation.
  return html.replace(ASSET_SCRIPT_TAG, () => `<script>${mermaidSource}</script>`);
}
