// Interface zoom, VS Code style: Cmd (macOS) / Ctrl (Windows, Linux) with
// "+" / "-" / "0" zooms in, out and resets. Wails v2 has no cross-platform
// webview zoom API (only a Windows-only ZoomFactor), so this scales the page
// with CSS `zoom` on <html> and persists the level like the theme.
//
// CSS zoom multiplies every length, viewport units included, and engines
// disagree on the details (WKWebView/WebKitGTK vs. WebView2's standardized
// zoom). Rather than guessing per engine, visualScale() measures it: a
// probe styled 100px wide is read back in screen pixels. Two things depend
// on it:
// - --app-height: .shell/body height in the page's own px, so a zoomed
//   100vh doesn't overflow the window (style.css falls back to 100vh);
// - shell.js's pane resizer, which converts mouse deltas (screen px) and
//   measured widths back into the px it writes to flex-basis.
//
// Iframes (artifact/wiki previews, all srcdoc — reading-pane.js's
// buildDocFrame) take the zoom when created, but WKWebView never updates
// one already loaded: measured on macOS 26 with a real WKWebView, an
// existing frame stayed at 100% after <html> went to 150%, while a frame
// created afterwards, or one whose srcdoc was reassigned, rendered at 150%
// (toggling display didn't help). refreshFrames() therefore reloads every
// open frame on a zoom change, keeping its scroll position.
const STORAGE_KEY = 'senpai-zoom';
// Same ladder browsers use — VS Code's own 1.2^n steps jump too far for
// a dense UI like this one.
const LEVELS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const DEFAULT_INDEX = LEVELS.indexOf(1);

let index = DEFAULT_INDEX;
let probe = null;
let indicator = null;
let indicatorTimer = null;
const listeners = new Set();

function readSavedIndex() {
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    const found = LEVELS.indexOf(saved);
    return found === -1 ? DEFAULT_INDEX : found;
  } catch {
    return DEFAULT_INDEX;
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, String(LEVELS[index]));
  } catch {
    // Not persisted — still applies for this session.
  }
}

// visualScale: screen px per page px under the current zoom (1 at 100%).
export function visualScale() {
  if (LEVELS[index] === 1) return 1;
  if (!probe) {
    probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:100px;height:1px;visibility:hidden;pointer-events:none;';
  }
  if (!probe.isConnected) document.body.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  return width > 0 ? width / 100 : LEVELS[index];
}

export function currentZoom() {
  return LEVELS[index];
}

// subscribeZoom: called after every zoom change (pane widths may need to be
// re-clamped). Returns the unsubscribe function.
export function subscribeZoom(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function syncViewportHeight() {
  const root = document.documentElement;
  if (LEVELS[index] === 1) {
    root.style.removeProperty('--app-height');
    return;
  }
  root.style.setProperty('--app-height', `${window.innerHeight / visualScale()}px`);
}

function refreshFrames() {
  for (const frame of document.querySelectorAll('iframe')) {
    let scroll = null;
    try {
      const win = frame.contentWindow;
      scroll = { x: win.scrollX, y: win.scrollY, height: win.document.documentElement.scrollHeight };
    } catch {
      // Cross-origin frame — reload without restoring the scroll.
    }
    if (scroll && (scroll.x || scroll.y)) {
      frame.addEventListener(
        'load',
        () => {
          try {
            const win = frame.contentWindow;
            // Restore by proportion: the content's height changes with the zoom.
            const height = win.document.documentElement.scrollHeight;
            win.scrollTo(scroll.x, scroll.height ? (scroll.y / scroll.height) * height : scroll.y);
          } catch {
            // Best effort.
          }
        },
        { once: true },
      );
    }
    if (frame.hasAttribute('srcdoc')) {
      frame.srcdoc = frame.srcdoc;
    } else if (frame.src) {
      frame.src = frame.src;
    }
  }
}

function apply({ announce }) {
  const zoom = LEVELS[index];
  document.documentElement.style.zoom = zoom === 1 ? '' : String(zoom);
  syncViewportHeight();
  if (announce) refreshFrames();
  if (announce) showIndicator(zoom);
  listeners.forEach((listener) => listener(zoom));
}

function setIndex(next) {
  const clamped = Math.max(0, Math.min(LEVELS.length - 1, next));
  if (clamped === index) {
    showIndicator(LEVELS[index]);
    return;
  }
  index = clamped;
  save();
  apply({ announce: true });
}

export function zoomIn() {
  setIndex(index + 1);
}

export function zoomOut() {
  setIndex(index - 1);
}

export function resetZoom() {
  setIndex(DEFAULT_INDEX);
}

// A short "110%" pill, like a browser's zoom bubble — otherwise a step of
// 10% is easy to miss and the person can't tell where they are.
function showIndicator(zoom) {
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.className = 'zoom-indicator';
    indicator.setAttribute('role', 'status');
  }
  if (!indicator.isConnected) document.body.appendChild(indicator);
  indicator.textContent = `Zoom ${Math.round(zoom * 100)}%`;
  indicator.classList.add('visible');
  clearTimeout(indicatorTimer);
  indicatorTimer = setTimeout(() => indicator.classList.remove('visible'), 1200);
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function onKeyDown(event) {
  const modifier = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!modifier || event.altKey) return;
  // event.code covers keyboard layouts where "+" needs Shift (and the
  // numpad); event.key covers layouts where "=" isn't on that physical key.
  if (event.key === '+' || event.key === '=' || event.code === 'Equal' || event.code === 'NumpadAdd') {
    zoomIn();
  } else if (event.key === '-' || event.key === '_' || event.code === 'Minus' || event.code === 'NumpadSubtract') {
    zoomOut();
  } else if (event.key === '0' || event.code === 'Digit0' || event.code === 'Numpad0') {
    resetZoom();
  } else {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
}

// initZoom: restore the saved level and start listening. Call once, before
// mounting the shell, so the first paint is already at the right size.
export function initZoom() {
  index = readSavedIndex();
  apply({ announce: false });
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', syncViewportHeight);
}
