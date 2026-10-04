import { addRawURL } from '../api.js';

// openAddUrlSourceModal registers a web page as a source: the backend
// (AddRawURL in app/url_source.go) downloads it, converts the HTML to
// Markdown and saves it in raw/. Resolves { name, ingest } like
// openAddTextSourceModal — ingesting stays the caller's job — or null if
// cancelled.
export function openAddUrlSourceModal(project) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal modal-wide">
        <h2>Nova fonte por link</h2>
        <label for="src-url">URL</label>
        <input id="src-url" type="url" autofocus autocomplete="off" placeholder="https://exemplo.com/documentacao" />
        <label for="src-url-title">Título (opcional)</label>
        <input id="src-url-title" type="text" autocomplete="off" placeholder="Usa o título da página se ficar em branco" />
        <p class="modal-hint">A página é baixada e convertida em texto. Páginas que só carregam conteúdo via JavaScript ou exigem login não são suportadas.</p>
        <div class="modal-error" data-error hidden></div>
        <div class="modal-actions">
          <button class="button secondary small" data-cancel>Cancelar</button>
          <button class="button tertiary small" data-submit="register" disabled>Apenas registrar</button>
          <button class="button primary small" data-submit="ingest" disabled>Registrar e ingerir</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    let busy = false;
    const close = (result) => {
      backdrop.remove();
      resolve(result);
    };
    const urlInput = backdrop.querySelector('#src-url');
    const titleInput = backdrop.querySelector('#src-url-title');
    const errorEl = backdrop.querySelector('[data-error]');
    const cancelButton = backdrop.querySelector('[data-cancel]');
    const submitButtons = [...backdrop.querySelectorAll('[data-submit]')];

    const validate = () => {
      const ok = !busy && urlInput.value.trim() !== '';
      submitButtons.forEach((button) => { button.disabled = !ok; });
    };
    urlInput.addEventListener('input', validate);

    // Closing mid-download would resolve null while the backend still
    // writes the file — keep the modal up until the fetch settles.
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop && !busy) close(null);
    });
    cancelButton.addEventListener('click', () => { if (!busy) close(null); });

    submitButtons.forEach((button) => {
      button.addEventListener('click', async () => {
        const ingest = button.dataset.submit === 'ingest';
        const label = button.textContent;
        busy = true;
        cancelButton.disabled = true;
        button.textContent = 'Baixando…';
        validate();
        errorEl.hidden = true;
        try {
          const name = await addRawURL(project.id, urlInput.value.trim(), titleInput.value.trim());
          close({ name, ingest });
        } catch (err) {
          errorEl.textContent = String(err.message || err);
          errorEl.hidden = false;
          busy = false;
          cancelButton.disabled = false;
          button.textContent = label;
          validate();
        }
      });
    });
  });
}
