import { icon } from '../icons.js';
import { SOURCE_KINDS, sourceKind } from './source-kinds.js';

// openAddSourcePicker: the "o que você quer trazer?" gallery. Step 1 is a
// grid of source kinds ("quero inserir um PDF", ...); picking one shows what
// that kind contributes and how to prepare it, plus the ways to add it.
// Resolves { kind, action } (action: 'files' | 'paste' | 'url' | 'any') or
// null if cancelled — actually adding the source stays the caller's job, so
// this module never touches raw/.
//
// initialKindId opens straight on that kind's detail (the empty-state cards
// in tab-fontes.js already were the step-1 choice).
export function openAddSourcePicker(initialKindId = null) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = '<div class="modal modal-picker" role="dialog" aria-modal="true"></div>';
    document.body.appendChild(backdrop);
    const modal = backdrop.querySelector('.modal');

    const close = (result) => {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      resolve(result);
    };
    function onKey(event) {
      if (event.key === 'Escape') close(null);
    }
    document.addEventListener('keydown', onKey);
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close(null);
    });

    function showGallery() {
      modal.innerHTML = `
        <header class="picker-head">
          <div>
            <h2>O que você quer trazer?</h2>
            <p>Cada tipo de fonte ensina algo diferente à wiki. Escolha um para ver dicas de preparo.</p>
          </div>
          <button class="icon-btn" data-close title="Fechar">${icon('x', 16)}</button>
        </header>
        <div class="source-kind-grid">${SOURCE_KINDS.map(kindCardHtml).join('')}</div>
        <footer class="picker-foot">
          <button class="picker-link" data-any>${icon('folderOpen', 13)} Ou escolha arquivos de qualquer tipo</button>
        </footer>
      `;
      modal.querySelector('[data-close]').addEventListener('click', () => close(null));
      modal.querySelector('[data-any]').addEventListener('click', () => close({ kind: null, action: 'any' }));
      modal.querySelectorAll('[data-kind]').forEach((card) => {
        card.addEventListener('click', () => showKind(sourceKind(card.dataset.kind)));
      });
      modal.querySelector('[data-kind]')?.focus();
    }

    function showKind(kind) {
      modal.innerHTML = `
        <header class="picker-head">
          <button class="picker-back" data-back>${icon('chevronRight', 14)} Todos os tipos</button>
          <button class="icon-btn" data-close title="Fechar">${icon('x', 16)}</button>
        </header>
        <div class="source-kind-detail">
          <div class="source-kind-hero">
            <i>${icon(kind.icon, 22)}</i>
            <div>
              <span class="eyebrow">${escapeHtml(kind.label)}</span>
              <h2>${escapeHtml(kind.wish)}</h2>
            </div>
          </div>
          <section>
            <h3>${icon('zap', 13)} Por que isso ajuda</h3>
            <p>${escapeHtml(kind.why)}</p>
          </section>
          <section>
            <h3>${icon('checkCircle', 13)} Como preparar</h3>
            <ul>${kind.tips.map((tip) => `<li>${escapeHtml(tip)}</li>`).join('')}</ul>
          </section>
          ${kind.extensions.length ? `
            <section>
              <h3>${icon('fileText', 13)} Formatos aceitos</h3>
              <div class="ext-chips">${kind.extensions.map((ext) => `<code>${escapeHtml(ext)}</code>`).join('')}</div>
            </section>` : ''}
        </div>
        <div class="modal-actions">
          ${kind.actions.map((action, index) => actionButtonHtml(kind, action, index === 0)).join('')}
        </div>
      `;
      modal.querySelector('[data-close]').addEventListener('click', () => close(null));
      modal.querySelector('[data-back]').addEventListener('click', showGallery);
      modal.querySelectorAll('[data-action]').forEach((button) => {
        button.addEventListener('click', () => close({ kind, action: button.dataset.action }));
      });
      modal.querySelector('[data-action]')?.focus();
    }

    const initial = initialKindId ? sourceKind(initialKindId) : null;
    if (initial) showKind(initial);
    else showGallery();
  });
}

// kindCardHtml is shared with tab-fontes.js's empty state, which renders the
// same cards inline (as <button data-kind>) before any source exists.
export function kindCardHtml(kind) {
  return `
    <button class="source-kind-card" data-kind="${kind.id}">
      <i>${icon(kind.icon, 18)}</i>
      <strong>${escapeHtml(kind.wish)}</strong>
      <span>${escapeHtml(kind.teaser)}</span>
    </button>
  `;
}

const ACTION_LABELS = {
  files: (kind) => [icon('upload', 14), kind.id === 'pdf' ? 'Escolher PDFs' : 'Escolher arquivos'],
  paste: (kind) => [icon('edit', 14), kind.id === 'note' || kind.id === 'markdown' ? 'Escrever' : 'Colar texto'],
  url: () => [icon('link', 14), 'Informar link'],
};

function actionButtonHtml(kind, action, primary) {
  const [glyph, label] = ACTION_LABELS[action](kind);
  return `<button class="button ${primary ? 'primary' : 'secondary'} small" data-action="${action}">${glyph} ${label}</button>`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
