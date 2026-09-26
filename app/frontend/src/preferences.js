// App-level user preferences kept in localStorage — a failing storage
// (private window, disabled storage) just falls back to the default.

const AUTO_REVIEW_KEY = 'senpai-autorrevisao';

// Autorrevisão (workflows/shared/artifacts/auto_review.mh): when a generated
// artifact fails its deterministic checks, the workflow makes ONE extra LLM
// call asking for the fix before pausing for review. On by default.
export function getAutoReview() {
  try {
    return localStorage.getItem(AUTO_REVIEW_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setAutoReview(enabled) {
  try {
    localStorage.setItem(AUTO_REVIEW_KEY, enabled ? '1' : '0');
  } catch {
    // Not persisted — the toggle still reflects the choice for this session.
  }
}

// getPaneWidth/setPaneWidth: a dragged pane's own width in px (see shell.js's
// pane-resizer, mounted once per pane name — "sidebar" and "reading-pane"
// today), or null from the getter when the user never dragged that one —
// the caller then leaves the pane at its default proportional flex-basis
// (style.css's .shell .sidebar/.main/.reading-pane) instead of forcing a
// fixed size on a first run.
function paneWidthKey(name) {
  return `senpai-pane-width-${name}`;
}

export function getPaneWidth(name) {
  try {
    const raw = localStorage.getItem(paneWidthKey(name));
    const width = raw === null ? NaN : Number(raw);
    return Number.isFinite(width) && width > 0 ? width : null;
  } catch {
    return null;
  }
}

export function setPaneWidth(name, widthPx) {
  try {
    localStorage.setItem(paneWidthKey(name), String(Math.round(widthPx)));
  } catch {
    // Not persisted — the drag still applies for this session.
  }
}
