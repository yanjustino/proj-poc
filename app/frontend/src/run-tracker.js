// A small, self-contained widget for one run's live state — reused by the
// Fontes tab (one per uploaded file being ingested) and the Artefatos tab
// (one per artifact being generated). Owns its own <div> and re-renders it
// on every status update; the caller just mounts `.element` and forwards
// startAndWatch/resumeAndWatch's onUpdate callback into `.update(status)`.
import { resumeAndWatch, cancelRun } from './api.js';
import { dotClass } from './status.js';

export const STATE_LABEL = {
  working: 'gerando',
  queued: 'na fila',
  paused: 'aguarda aprovação',
  completed: 'concluído',
  failed: 'falhou',
  canceled: 'cancelado',
};

// onCancel: called after a paused run is canceled on the backend, instead of
// the tracker showing its own "cancelado" state — lets the host (Artefatos
// tab) drop the tracker entirely and fall back to "pronto para gerar", since
// canceling here abandons the draft rather than leaving a record of it (see
// tab-artefatos.js's onRunCancel). Left unset, the tracker shows "cancelado"
// itself — fine for a host (Fontes' ingest) that never actually pauses.
export function createRunTracker({ resumeArgs = { approved: true }, onCancel } = {}) {
  const element = document.createElement('div');
  element.className = 'run-tracker';
  // Kept as a second, separate root (not just a child of `element`) so a
  // host with a persistent action-bar slot — the reading pane's
  // setFooter/.doc-footer, pinned below the scrollable document instead of
  // scrolling away with it — can mount it there instead of wherever
  // `element` itself ends up. A host with no such slot (Fontes' compact
  // source-card tracker) just appends both, one after the other, same as
  // before this existed.
  const composer = document.createElement('div');
  composer.className = 'run-composer';
  composer.hidden = true;
  // approveAction is Aprovar's own root, separate from `composer` — the
  // reading pane mounts it in the header toolbar (reading-pane.js's
  // setToolbarAction) instead of the footer, while Cancelar/Regenerar stay in
  // `composer` below. Same reasoning as `composer` itself: rebuilt wholesale
  // on every render(), so a host just re-mounts it once and never needs to
  // track it across renders.
  const approveAction = document.createElement('div');
  approveAction.className = 'run-approve-action';
  approveAction.hidden = true;
  let status = null;
  // Which paused-state action is in flight, if any — drives both the
  // clicked button's own "…ing" label and disabling every control in the
  // composer (typing a new comment mid-request wouldn't be reflected in the
  // request already sent).
  let busyAction = null; // null | 'approve' | 'regenerate' | 'cancel'
  // Kept across re-renders (not just read from the DOM at submit time) so a
  // stray render() mid-typing — shouldn't happen while genuinely paused
  // (nothing pushes a new status until resumed), but cheap to be correct
  // about — never wipes what the user already typed.
  let feedbackText = '';

  function tokensLine(s) {
    const vars = s.vars || {};
    const tokensIn = vars.tokens_in;
    const tokensOut = vars.tokens_out;
    if (tokensIn == null && tokensOut == null) return '';
    return `<span class="run-tokens">${tokensIn ?? 0} → ${tokensOut ?? 0} tokens</span>`;
  }

  function render() {
    if (!status) {
      element.innerHTML = '';
      composer.innerHTML = '';
      composer.hidden = true;
      approveAction.innerHTML = '';
      approveAction.hidden = true;
      return;
    }
    const s = status;
    const label = STATE_LABEL[s.state] || s.state;
    const stepLine =
      s.state === 'working' && s.step
        ? `<span class="run-step">${escapeHtml(s.step)}${s.stepTotal ? ` · passo ${s.stepIndex}/${s.stepTotal}` : ''}</span>`
        : '';
    const errorLine = s.state === 'failed' && s.error ? `<span class="run-error">${escapeHtml(s.error)}</span>` : '';
    // s.reason is pause()'s own message (e.g. "revise o conteudo de 'brief'
    // antes de gravar em artifacts/") — see mhlbridge.RunStatus.Reason's doc
    // comment for why this was silently dropped before it.
    const reasonLine = s.state === 'paused' && s.reason ? `<span class="run-reason">${escapeHtml(s.reason)}</span>` : '';
    const busy = busyAction !== null;

    element.innerHTML = `
      <div class="run-status-row">
        <span class="status-dot ${dotClass(s.state)}"></span>
        <span class="run-label">${label}</span>
        ${stepLine}
        ${tokensLine(s)}
      </div>
      ${reasonLine}
      ${errorLine}
    `;

    // Chat-style composer for the paused state: the feedback field sits on
    // top (like a message draft), Cancelar/Regenerar live in one row below
    // it. "Solicitar mudanças" (Regenerar) resumes the SAME paused run with
    // approved:false + feedback instead of true; Gate (see
    // discovery.mh/delivery.mh) treats that as "go back to *Generate with
    // this comment attached", not "pause again" — a real regeneration, not a
    // cosmetic note. Cancelar calls mhl_run_cancel and, when the host gave us
    // one, hands off to onCancel instead of rendering a "cancelado" state
    // here — see this file's createRunTracker doc comment for why. Lives in
    // its own root (see `composer` above `element`) so a host can pin it
    // below the scrollable document instead of letting it scroll away with
    // the rest of `element`.
    //
    // Aprovar lives in `approveAction`, a separate root the host mounts in
    // the reading pane's header toolbar instead of down here (see
    // reading-pane.js's setToolbarAction) — Modo Buddy's primary action reads
    // better next to "ver fonte"/expand than buried below a long preview.
    if (s.state !== 'paused') {
      composer.innerHTML = '';
      composer.hidden = true;
      approveAction.innerHTML = '';
      approveAction.hidden = true;
    } else {
      composer.hidden = false;
      composer.innerHTML = `
        <textarea class="run-feedback-input" placeholder="Pedir uma mudança nesta versão (opcional) — a próxima geração considera isto." ${busy ? 'disabled' : ''}>${escapeHtml(feedbackText)}</textarea>
        <div class="run-composer-actions">
          <button class="button tertiary small run-cancel" ${busy ? 'disabled' : ''}>${busyAction === 'cancel' ? 'Cancelando…' : 'Cancelar'}</button>
          <div class="run-composer-actions-right">
            <button class="button secondary small run-feedback-submit" ${busy ? 'disabled' : ''}>${busyAction === 'regenerate' ? 'Enviando…' : 'Regenerar'}</button>
          </div>
        </div>
      `;
      approveAction.hidden = false;
      approveAction.innerHTML = `<button class="button primary small run-approve" ${busy ? 'disabled' : ''}>${busyAction === 'approve' ? 'Aplicando…' : 'Aprovar'}</button>`;
    }

    const approveButton = approveAction.querySelector('.run-approve');
    if (approveButton) {
      approveButton.addEventListener('click', async () => {
        busyAction = 'approve';
        render();
        try {
          await resumeAndWatch(s.runId, resumeArgs, (next) => update(next));
        } catch (err) {
          busyAction = null;
          status = { ...s, state: 'failed', error: String(err) };
          render();
        }
      });
    }

    const feedbackInput = composer.querySelector('.run-feedback-input');
    if (feedbackInput) {
      feedbackInput.addEventListener('input', () => {
        feedbackText = feedbackInput.value;
      });
    }

    const feedbackSubmit = composer.querySelector('.run-feedback-submit');
    if (feedbackSubmit) {
      feedbackSubmit.addEventListener('click', async () => {
        const text = feedbackText.trim();
        if (!text) return;
        busyAction = 'regenerate';
        render();
        try {
          await resumeAndWatch(s.runId, { approved: false, feedback: text }, (next) => update(next));
        } catch (err) {
          busyAction = null;
          status = { ...s, state: 'failed', error: String(err) };
          render();
        }
      });
    }

    const cancelButton = composer.querySelector('.run-cancel');
    if (cancelButton) {
      cancelButton.addEventListener('click', async () => {
        busyAction = 'cancel';
        render();
        try {
          await cancelRun(s.runId);
          if (onCancel) {
            onCancel();
          } else {
            busyAction = null;
            status = { ...s, state: 'canceled' };
            render();
          }
        } catch (err) {
          busyAction = null;
          status = { ...s, state: 'failed', error: String(err) };
          render();
        }
      });
    }
  }

  function update(next) {
    status = next;
    busyAction = null;
    feedbackText = '';
    render();
  }

  return { element, composer, approveAction, update, get status() { return status; } };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
