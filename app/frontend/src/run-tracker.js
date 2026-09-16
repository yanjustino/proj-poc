// A small, self-contained widget for one run's live state — reused by the
// Fontes tab (one per uploaded file being ingested) and the Artefatos tab
// (one per artifact being generated). Owns its own <div> and re-renders it
// on every status update; the caller just mounts `.element` and forwards
// startAndWatch/resumeAndWatch's onUpdate callback into `.update(status)`.
import { resumeAndWatch } from './api.js';
import { dotClass } from './status.js';

const STATE_LABEL = {
  working: 'gerando',
  queued: 'na fila',
  paused: 'aguarda aprovação',
  completed: 'concluído',
  failed: 'falhou',
  canceled: 'cancelado',
};

export function createRunTracker({ resumeArgs = { approved: true } } = {}) {
  const element = document.createElement('div');
  element.className = 'run-tracker';
  let status = null;
  let resuming = false;
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
    const approveButton =
      s.state === 'paused'
        ? `<button class="button primary small run-approve" ${resuming ? 'disabled' : ''}>${resuming ? 'Aplicando…' : 'Aprovar e continuar'}</button>`
        : '';
    // Solicitar mudanças: an alternative to approving — resumes the SAME
    // paused run with approved:false + feedback instead of true. Gate (see
    // discovery.mh/delivery.mh) treats that as "go back to *Generate with
    // this comment attached", not "pause again" — a real regeneration, not
    // a cosmetic note. flex-basis:100% on .run-feedback (in .run-tracker's
    // wrapping flex row) puts it on its own line without a wrapper element.
    const feedbackForm =
      s.state === 'paused'
        ? `<div class="run-feedback">
            <textarea class="run-feedback-input" placeholder="Pedir uma mudança nesta versão (opcional) — a próxima geração considera isto." ${resuming ? 'disabled' : ''}>${escapeHtml(feedbackText)}</textarea>
            <button class="button secondary small run-feedback-submit" ${resuming ? 'disabled' : ''}>Enviar e regenerar</button>
          </div>`
        : '';

    element.innerHTML = `
      <span class="status-dot ${dotClass(s.state)}"></span>
      <span class="run-label">${label}</span>
      ${stepLine}
      ${tokensLine(s)}
      ${reasonLine}
      ${errorLine}
      ${approveButton}
      ${feedbackForm}
    `;

    const button = element.querySelector('.run-approve');
    if (button) {
      button.addEventListener('click', async () => {
        resuming = true;
        render();
        try {
          await resumeAndWatch(s.runId, resumeArgs, (next) => update(next));
        } catch (err) {
          resuming = false;
          status = { ...s, state: 'failed', error: String(err) };
          render();
        }
      });
    }

    const feedbackInput = element.querySelector('.run-feedback-input');
    if (feedbackInput) {
      feedbackInput.addEventListener('input', () => {
        feedbackText = feedbackInput.value;
      });
    }

    const feedbackSubmit = element.querySelector('.run-feedback-submit');
    if (feedbackSubmit) {
      feedbackSubmit.addEventListener('click', async () => {
        const text = feedbackText.trim();
        if (!text) return;
        resuming = true;
        render();
        try {
          await resumeAndWatch(s.runId, { approved: false, feedback: text }, (next) => update(next));
        } catch (err) {
          resuming = false;
          status = { ...s, state: 'failed', error: String(err) };
          render();
        }
      });
    }
  }

  function update(next) {
    status = next;
    resuming = false;
    feedbackText = '';
    render();
  }

  return { element, update, get status() { return status; } };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
