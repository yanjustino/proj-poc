// Minimal app-level store — just enough to drive "which work-item is open"
// across the rail/nav and the main content area. Anything scoped to a
// single screen (active tab, in-flight runs, upload progress) lives as
// local state inside that view instead of here; re-rendering the whole app
// on every run status tick would be wasteful and would blow away DOM state
// (scroll position, open <details>, iframe content) that has nothing to do
// with which work-item is selected.
const state = {
  view: 'list', // 'list' | 'workitem'
  projectId: null,
};

const listeners = new Set();

export function getState() {
  return state;
}

export function setState(patch) {
  Object.assign(state, patch);
  for (const listener of listeners) listener(state);
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
