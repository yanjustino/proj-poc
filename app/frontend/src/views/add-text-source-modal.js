import { addRawText } from '../api.js';

// openAddTextSourceModal lets the user type or paste a source instead of
// picking a file. Resolves { name, ingest } once the text was registered in
// raw/ (ingest = the user also asked for it to be ingested right away), or
// null if cancelled. Ingesting stays the caller's job — same split as the
// file flow: this only registers.
export function openAddTextSourceModal(project) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal modal-wide">
        <h2>Nova fonte manual</h2>
        <label for="src-title">Título</label>
        <input id="src-title" type="text" autofocus autocomplete="off" placeholder="Ex.: Ata da reunião de alinhamento" />
        <label for="src-content">Conteúdo</label>
        <textarea id="src-content" rows="12" placeholder="Cole ou escreva o texto da fonte (Markdown ou texto puro)"></textarea>
        <div class="modal-error" data-error hidden></div>
        <div class="modal-actions">
          <button class="button secondary small" data-cancel>Cancelar</button>
          <button class="button tertiary small" data-submit="register" disabled>Apenas registrar</button>
          <button class="button primary small" data-submit="ingest" disabled>Registrar e ingerir</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const close = (result) => {
      backdrop.remove();
      resolve(result);
    };
    const title = backdrop.querySelector('#src-title');
    const content = backdrop.querySelector('#src-content');
    const errorEl = backdrop.querySelector('[data-error]');
    const submitButtons = [...backdrop.querySelectorAll('[data-submit]')];

    const validate = () => {
      const ok = title.value.trim() !== '' && content.value.trim() !== '';
      submitButtons.forEach((button) => { button.disabled = !ok; });
    };
    title.addEventListener('input', validate);
    content.addEventListener('input', validate);

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close(null);
    });
    backdrop.querySelector('[data-cancel]').addEventListener('click', () => close(null));

    submitButtons.forEach((button) => {
      button.addEventListener('click', async () => {
        const ingest = button.dataset.submit === 'ingest';
        submitButtons.forEach((candidate) => { candidate.disabled = true; });
        errorEl.hidden = true;
        try {
          const name = await addRawText(project.id, title.value.trim(), content.value);
          close({ name, ingest });
        } catch (err) {
          errorEl.textContent = String(err.message || err);
          errorEl.hidden = false;
          validate();
        }
      });
    });
  });
}
