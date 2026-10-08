// openConfirmModal: a yes/no confirmation in the same modal shell as
// confirm-delete-modal.js, resolving true on confirm and false on cancel.
// `body` is trusted HTML built by the caller (escape anything user-provided).
export function openConfirmModal({ title, body, confirmLabel, danger = false }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal">
        <h2>${escapeHtml(title)}</h2>
        ${body}
        <div class="modal-actions">
          <button class="button secondary small" data-cancel>Cancelar</button>
          <button class="button ${danger ? 'danger' : 'primary'} small" data-submit>${escapeHtml(confirmLabel)}</button>
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
    backdrop.querySelector('[data-submit]').addEventListener('click', () => close(true));
    backdrop.querySelector('[data-submit]').focus();
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}
