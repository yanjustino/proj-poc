import { icon } from './icons.js';

// Shared look and behavior of the app's chat-style composers (.run-composer):
// a paused run's feedback (run-tracker.js), "Pergunte à wiki" (tab-wiki.js)
// and Artefatos' "Regerar" (tab-artefatos.js). Each caller keeps its own
// handlers; this only provides the send button markup and the chat-app
// behaviors they all share.

// sendButtonHtml: the round arrow button at the composer's bottom-right.
// `className`/`attrs` carry the caller's own hook, `busy` swaps the
// arrow for a spinner while the request is in flight.
export function sendButtonHtml({ className = '', attrs = '', label, busy = false, disabled = false }) {
  return `<button class="composer-send ${className} ${busy ? 'busy' : ''}" ${attrs} aria-label="${label}" title="${label}" ${disabled ? 'disabled' : ''}>${icon(busy ? 'loader' : 'arrowUp', 16)}</button>`;
}

// enhanceComposer wires what every composer does the same way:
// - the textarea grows with its content (up to the CSS max-height);
// - `.is-empty` on the composer greys the send button out while there's
//   nothing typed (unless allowEmpty — Artefatos regenerates with no text);
// - with `submitOnEnter`, Enter clicks the send button and Shift+Enter
//   breaks the line (tab-wiki.js already handles its own Enter).
// Safe to call again after the caller re-renders the composer's innerHTML.
export function enhanceComposer(composer, { allowEmpty = false, submitOnEnter = true } = {}) {
  const textarea = composer.querySelector('textarea');
  const send = composer.querySelector('.composer-send');
  if (!textarea) return;

  const sync = () => {
    composer.classList.toggle('is-empty', !allowEmpty && textarea.value.trim() === '');
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  };
  textarea.addEventListener('input', sync);
  if (submitOnEnter && send) {
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        if (!send.disabled) send.click();
      }
    });
  }
  // Clicking the card's padding focuses the field, like a chat box. Bound
  // once per composer: callers re-render its innerHTML, not the root.
  if (!composer.dataset.composerEnhanced) {
    composer.dataset.composerEnhanced = '1';
    composer.addEventListener('mousedown', (event) => {
      const field = composer.querySelector('textarea');
      if (event.target === composer && field) {
        event.preventDefault();
        field.focus();
      }
    });
  }
  sync();
  // Hidden/detached on first call (scrollHeight 0) — size it once shown.
  requestAnimationFrame(sync);
  return sync;
}
