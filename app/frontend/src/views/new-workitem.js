import { workItemCreate } from '../api.js';

// openNewWorkItemModal renders a small modal into document.body and resolves
// with the created project once WorkItem action:"create" completes, or null
// if the user cancels. item_type is one of the 3 literals the workflow
// actually validates (WorkItemActions.level_for) — labels are Portuguese,
// values are the exact strings the bridge call needs.
export function openNewWorkItemModal() {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal">
        <h2>Novo work-item</h2>
        <label for="wi-name">Nome</label>
        <input id="wi-name" type="text" placeholder="ex.: Checkout renovado" autofocus />
        <label for="wi-type">Tipo</label>
        <select id="wi-type">
          <option value="oportunidade">Oportunidade (Discovery)</option>
          <option value="feature">Feature (Delivery)</option>
          <option value="historia">História (Delivery)</option>
        </select>
        <div class="modal-error" data-error hidden></div>
        <div class="modal-actions">
          <button class="button secondary small" data-cancel>Cancelar</button>
          <button class="button primary small" data-submit>Criar</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const close = (result) => {
      backdrop.remove();
      resolve(result);
    };

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close(null);
    });
    backdrop.querySelector('[data-cancel]').addEventListener('click', () => close(null));

    const submit = backdrop.querySelector('[data-submit]');
    const errorEl = backdrop.querySelector('[data-error]');
    submit.addEventListener('click', async () => {
      const name = backdrop.querySelector('#wi-name').value.trim();
      const itemType = backdrop.querySelector('#wi-type').value;
      if (!name) {
        errorEl.textContent = 'Informe um nome.';
        errorEl.hidden = false;
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Criando…';
      try {
        const project = await workItemCreate(name, itemType);
        close(project);
      } catch (err) {
        errorEl.textContent = String(err.message || err);
        errorEl.hidden = false;
        submit.disabled = false;
        submit.textContent = 'Criar';
      }
    });
  });
}
