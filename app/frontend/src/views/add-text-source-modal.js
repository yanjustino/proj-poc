import { addRawText } from '../api.js';

// openAddTextSourceModal lets the user type or paste a source instead of
// picking a file. Resolves { name, ingest } once the text was registered in
// raw/ (ingest = the user also asked for it to be ingested right away), or
// null if cancelled. Ingesting stays the caller's job — same split as the
// file flow: this only registers.
//
// variant (a source kind's `paste` block, see source-kinds.js) adapts the
// copy to what is being pasted; `language` adds a field and wraps the
// content in a fenced code block, `preface` is prepended to the content.
export function openAddTextSourceModal(project, variant = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal modal-wide">
        <h2>${escapeHtml(variant.heading || 'Nova fonte manual')}</h2>
        <label for="src-title">Título</label>
        <input id="src-title" type="text" autofocus autocomplete="off" placeholder="${escapeHtml(variant.titlePlaceholder || 'Ex.: Ata da reunião de alinhamento')}" />
        ${variant.language ? `
          <label for="src-language">Linguagem (opcional)</label>
          <input id="src-language" type="text" autocomplete="off" placeholder="Ex.: go, python, csharp" />` : ''}
        <label for="src-content">Conteúdo</label>
        <textarea id="src-content" rows="12" ${variant.language ? 'class="mono" spellcheck="false"' : ''} placeholder="${escapeHtml(variant.contentPlaceholder || 'Cole ou escreva o texto da fonte (Markdown ou texto puro)')}"></textarea>
        ${variant.hint ? `<p class="modal-hint">${escapeHtml(variant.hint)}</p>` : ''}
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
          const name = await addRawText(project.id, title.value.trim(), composeContent(variant, content.value, backdrop));
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

function composeContent(variant, text, root) {
  let body = text;
  if (variant.language) {
    const language = root.querySelector('#src-language').value.trim().replace(/[^\w+#.-]/g, '');
    const fence = body.includes('```') ? '~~~~' : '```';
    body = `${fence}${language}\n${body.replace(/\n+$/, '')}\n${fence}\n`;
  }
  return (variant.preface || '') + body;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML.replaceAll('"', '&quot;');
}
