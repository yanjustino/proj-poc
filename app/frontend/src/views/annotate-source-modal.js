import { setRawAnnotation } from '../api.js';

// openAnnotateSourceModal lets the person record corrections to a source —
// inaccuracies, contradictions or misconceptions in its text. The annotation
// is saved in raw/.annotations.json (app/source_annotations.go) and wins over
// the source's own text when the wiki takes it in: an ingest reads it, and
// for a source already ingested Wiki's "annotate" action applies it.
//
// Resolves { annotations, apply } once saved (apply = the person also asked
// to take it to the wiki right away — ingest it, or apply it if the source
// was already ingested), or null if cancelled. Starting the run stays the
// caller's job, same split as add-text-source-modal.js.
export function openAnnotateSourceModal(project, name, { annotation = null, ingested = false } = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const hint = ingested
      ? 'Esta fonte já está na wiki. Aplicar a anotação grava os fatos corrigidos, citando esta fonte, e roda uma verificação que marca como superado o que a anotação desmente.'
      : 'A anotação entra na ingestão desta fonte e prevalece sobre o texto dela onde os dois divergem.';
    const removeNote = annotation?.applied
      ? '<p class="modal-hint">Remover a anotação não desfaz a correção já aplicada: ela continua na wiki até você reprocessá-la.</p>'
      : '';
    backdrop.innerHTML = `
      <div class="modal modal-wide">
        <h2>Anotar fonte</h2>
        <p class="modal-subtitle" title="${escapeHtml(name)}">${escapeHtml(name)}</p>
        <label for="annotation-text">Anotação</label>
        <textarea id="annotation-text" rows="10" autofocus placeholder="Aponte o que a fonte diz de errado ou contraditório e qual é a versão correta. Ex.: O documento diz que a liquidação ocorre em D+1, mas o prazo vigente é D+2."></textarea>
        <p class="modal-hint">${escapeHtml(hint)}</p>
        ${removeNote}
        <div class="modal-error" data-error hidden></div>
        <div class="modal-actions">
          ${annotation ? '<button class="button secondary small danger-text" data-remove>Remover anotação</button>' : ''}
          <button class="button secondary small" data-cancel>Cancelar</button>
          <button class="button tertiary small" data-submit="save" disabled>Apenas salvar</button>
          <button class="button primary small" data-submit="apply" disabled>${ingested ? 'Salvar e aplicar na wiki' : 'Salvar e ingerir'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const close = (result) => {
      backdrop.remove();
      resolve(result);
    };
    const text = backdrop.querySelector('#annotation-text');
    text.value = annotation?.text ?? '';
    const errorEl = backdrop.querySelector('[data-error]');
    const submitButtons = [...backdrop.querySelectorAll('[data-submit]')];
    const removeButton = backdrop.querySelector('[data-remove]');

    // Saving the same text again is allowed only while it is not applied —
    // "Salvar e aplicar" is also how a failed application is retried.
    const validate = () => {
      const value = text.value.trim();
      const unchanged = annotation?.applied && value === annotation.text;
      submitButtons.forEach((button) => { button.disabled = value === '' || unchanged; });
    };
    text.addEventListener('input', validate);
    validate();

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close(null);
    });
    backdrop.querySelector('[data-cancel]').addEventListener('click', () => close(null));

    async function save(value, apply) {
      submitButtons.forEach((candidate) => { candidate.disabled = true; });
      if (removeButton) removeButton.disabled = true;
      errorEl.hidden = true;
      try {
        const annotations = await setRawAnnotation(project.id, name, value);
        close({ annotations, apply });
      } catch (err) {
        errorEl.textContent = String(err.message || err);
        errorEl.hidden = false;
        if (removeButton) removeButton.disabled = false;
        validate();
      }
    }

    submitButtons.forEach((button) => {
      button.addEventListener('click', () => save(text.value.trim(), button.dataset.submit === 'apply'));
    });
    if (removeButton) removeButton.addEventListener('click', () => save('', false));
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML.replaceAll('"', '&quot;');
}
