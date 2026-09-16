import { deleteProject } from '../api.js';

// openConfirmDeleteModal renders a confirmation modal into document.body and
// resolves true once the project was actually deleted (App.DeleteProject
// succeeded), or false if the user cancels. Deletion is irreversible — this
// is the only prompt standing between a click and os.RemoveAll on the Go
// side (see app/app.go's DeleteProject) — so the confirm button requires
// typing the project's exact name back, same discipline GitHub uses for
// "delete repository".
export function openConfirmDeleteModal(project) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal">
        <h2>Excluir work-item</h2>
        <p>Isso apaga permanentemente <strong>${escapeHtml(project.name)}</strong> — fontes, wiki e artefatos. Essa ação não pode ser desfeita.</p>
        <label for="wi-delete-confirm">Digite <strong>${escapeHtml(project.name)}</strong> para confirmar</label>
        <input id="wi-delete-confirm" type="text" autofocus autocomplete="off" />
        <div class="modal-error" data-error hidden></div>
        <div class="modal-actions">
          <button class="button secondary small" data-cancel>Cancelar</button>
          <button class="button danger small" data-submit disabled>Excluir</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const close = (result) => {
      backdrop.remove();
      resolve(result);
    };

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close(false);
    });
    backdrop.querySelector('[data-cancel]').addEventListener('click', () => close(false));

    const input = backdrop.querySelector('#wi-delete-confirm');
    const submit = backdrop.querySelector('[data-submit]');
    const errorEl = backdrop.querySelector('[data-error]');
    input.addEventListener('input', () => {
      submit.disabled = input.value.trim() !== project.name;
    });

    submit.addEventListener('click', async () => {
      if (input.value.trim() !== project.name) return;
      submit.disabled = true;
      submit.textContent = 'Excluindo…';
      try {
        await deleteProject(project.id);
        close(true);
      } catch (err) {
        errorEl.textContent = String(err.message || err);
        errorEl.hidden = false;
        submit.disabled = false;
        submit.textContent = 'Excluir';
      }
    });
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}
