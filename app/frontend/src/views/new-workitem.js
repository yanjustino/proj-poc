import { workItemCreate } from '../api.js';

// openNewWorkItemModal renders a small modal into document.body and resolves
// with the created project once WorkItem action:"create" completes, or null
// if the user cancels. item_type is one of the 4 literals the workflow
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
          <option value="feature">Feature ou enabler (Delivery)</option>
          <option value="historia">História (Delivery)</option>
          <option value="comite">Comitê de Arquitetura (WAR)</option>
        </select>
        <p class="modal-hint" data-hint></p>
        <div data-continuidade>
          <label for="wi-continuidade">Continuidade de (opcional)</label>
          <textarea id="wi-continuidade" rows="2" placeholder="ex.: Checkout atual — apenas o fluxo de pagamento PIX. Deixe em branco numa iniciativa nova."></textarea>
        </div>
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

    // The committee's sources are meeting transcripts, not a system being
    // evolved — "Continuidade de" doesn't apply and is hidden (and not sent).
    const typeSelect = backdrop.querySelector('#wi-type');
    const hintEl = backdrop.querySelector('[data-hint]');
    const continuidadeEl = backdrop.querySelector('[data-continuidade]');
    const syncType = () => {
      const comite = typeSelect.value === 'comite';
      hintEl.textContent = comite
        ? 'Comitê de Arquitetura: adicione as transcrições das reuniões como fontes. Gera Demanda, RFCs, ADRs, artefatos executáveis e métricas, com export em Markdown.'
        : 'Discovery explora uma oportunidade nova. Delivery detalha a continuidade de um sistema já existente — não assuma greenfield.';
      continuidadeEl.hidden = comite;
    };
    typeSelect.addEventListener('change', syncType);
    syncType();

    const submit = backdrop.querySelector('[data-submit]');
    const errorEl = backdrop.querySelector('[data-error]');
    submit.addEventListener('click', async () => {
      const name = backdrop.querySelector('#wi-name').value.trim();
      const itemType = backdrop.querySelector('#wi-type').value;
      const continuidadeDe = itemType === 'comite' ? '' : backdrop.querySelector('#wi-continuidade').value.trim();
      if (!name) {
        errorEl.textContent = 'Informe um nome.';
        errorEl.hidden = false;
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Criando…';
      try {
        const project = await workItemCreate(name, itemType, continuidadeDe);
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
