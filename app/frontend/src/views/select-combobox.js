import { icon } from '../icons.js';

// createSelectCombobox turns a native <select> into a searchable dropdown —
// a native select can't be filtered, and Devin lists far too many models to
// scroll through. The <select> stays in the DOM (hidden) as the single
// source of truth: options are read from it every time the popover opens,
// and picking an item sets its value and dispatches a real `change`, so the
// caller's existing listeners and programmatic `select.value = ...` keep
// working. Call `sync()` after changing the select's value in code (a
// programmatic assignment fires no event); options and `disabled` are
// tracked automatically.
//
// The popover opens upward: the model picker sits at the bottom of the
// sidebar, which clips anything overflowing below it.
export function createSelectCombobox(selectEl, { searchPlaceholder = 'Filtrar…', emptyText = 'Nenhum resultado' } = {}) {
  const root = document.createElement('div');
  root.className = 'combo';
  root.innerHTML = `
    <button type="button" class="combo-trigger" aria-haspopup="listbox" aria-expanded="false">
      <span class="combo-value"></span>
      <span class="combo-caret">${icon('chevronRight', 12)}</span>
    </button>
    <div class="combo-popover" hidden>
      <div class="combo-search">${icon('search', 13)}<input type="text" autocomplete="off" spellcheck="false" placeholder="${searchPlaceholder}" /></div>
      <div class="combo-list" role="listbox"></div>
      <div class="combo-footer"></div>
    </div>
  `;
  selectEl.after(root);
  selectEl.hidden = true;
  if (selectEl.id) {
    // The visible control takes over the <label for=...>.
    const trigger = root.querySelector('.combo-trigger');
    trigger.id = `${selectEl.id}-combo`;
    document.querySelector(`label[for="${selectEl.id}"]`)?.setAttribute('for', trigger.id);
  }

  const trigger = root.querySelector('.combo-trigger');
  const valueEl = root.querySelector('.combo-value');
  const popover = root.querySelector('.combo-popover');
  const input = root.querySelector('.combo-search input');
  const list = root.querySelector('.combo-list');
  const footer = root.querySelector('.combo-footer');
  let visible = []; // options currently shown, in order
  let highlighted = -1;

  const normalize = (text) =>
    String(text || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();

  // Every selectable option, with its optgroup (Devin's model family) —
  // the empty-value placeholder ("Selecione um modelo…") is not an item.
  function readOptions() {
    return [...selectEl.querySelectorAll('option')]
      .filter((option) => option.value !== '')
      .map((option) => ({
        value: option.value,
        label: option.textContent,
        title: option.title || '',
        group: option.parentElement.tagName === 'OPTGROUP' ? option.parentElement.label : '',
      }));
  }

  function sync() {
    const option = selectEl.selectedOptions[0];
    valueEl.textContent = option ? option.textContent : '';
    trigger.title = option?.title || option?.textContent || '';
    trigger.disabled = selectEl.disabled;
    if (selectEl.disabled) close();
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Wraps each matched term in <mark> so it's clear why an item matched.
  function highlightHtml(label, terms) {
    if (terms.length === 0) return escapeHtml(label);
    const normalized = normalize(label);
    const marks = new Array(label.length).fill(false);
    for (const term of terms) {
      let from = normalized.indexOf(term);
      while (from !== -1) {
        for (let i = from; i < from + term.length; i++) marks[i] = true;
        from = normalized.indexOf(term, from + term.length);
      }
    }
    let html = '';
    let open = false;
    for (let i = 0; i < label.length; i++) {
      if (marks[i] && !open) { html += '<mark>'; open = true; }
      if (!marks[i] && open) { html += '</mark>'; open = false; }
      html += escapeHtml(label[i]);
    }
    return open ? `${html}</mark>` : html;
  }

  function renderList() {
    const all = readOptions();
    // Every space-separated term must match label, id or family, in any
    // order: "opus 4" finds "Claude Opus 4.1".
    const terms = normalize(input.value).split(/\s+/).filter(Boolean);
    visible = all.filter((option) => {
      const haystack = normalize(`${option.label} ${option.value} ${option.group}`);
      return terms.every((term) => haystack.includes(term));
    });
    // "Personalizado…"-style escape hatches stay reachable whatever is typed.
    const pinned = all.filter((option) => option.value.startsWith('__') && !visible.includes(option));
    visible.push(...pinned);

    let lastGroup = null;
    list.innerHTML = visible
      .map((option, index) => {
        const header = option.group && option.group !== lastGroup ? `<div class="combo-group">${escapeHtml(option.group)}</div>` : '';
        lastGroup = option.group || lastGroup;
        const selected = option.value === selectEl.value;
        return `${header}<div class="combo-option ${selected ? 'selected' : ''}" role="option" aria-selected="${selected}" data-index="${index}" title="${escapeHtml(option.title)}">
          <span class="combo-option-label">${highlightHtml(option.label, terms)}</span>
          ${selected ? `<span class="combo-check">${icon('checkCircle', 13)}</span>` : ''}
        </div>`;
      })
      .join('');
    const realCount = visible.filter((option) => !option.value.startsWith('__')).length;
    const total = all.filter((option) => !option.value.startsWith('__')).length;
    if (realCount === 0) list.insertAdjacentHTML('afterbegin', `<div class="combo-empty">${escapeHtml(emptyText)}</div>`);
    footer.textContent = terms.length ? `${realCount} de ${total}` : `${total} ${total === 1 ? 'item' : 'itens'}`;

    const selectedIndex = visible.findIndex((option) => option.value === selectEl.value);
    setHighlight(terms.length ? (realCount > 0 ? 0 : -1) : selectedIndex);
  }

  function setHighlight(index) {
    highlighted = index;
    list.querySelectorAll('.combo-option').forEach((el) => {
      const on = Number(el.dataset.index) === index;
      el.classList.toggle('highlighted', on);
      if (on) el.scrollIntoView({ block: 'nearest' });
    });
  }

  function choose(index) {
    const option = visible[index];
    if (!option) return;
    close();
    trigger.focus();
    if (option.value === selectEl.value && !option.value.startsWith('__')) return;
    selectEl.value = option.value;
    sync();
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function open() {
    if (trigger.disabled || !popover.hidden) return;
    popover.hidden = false;
    root.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    input.value = '';
    renderList();
    input.focus();
    document.addEventListener('mousedown', onOutside, true);
  }

  function close() {
    if (popover.hidden) return;
    popover.hidden = true;
    root.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onOutside, true);
  }

  function onOutside(event) {
    if (!root.contains(event.target)) close();
  }

  trigger.addEventListener('click', () => (popover.hidden ? open() : close()));
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      open();
    }
  });
  input.addEventListener('input', renderList);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight(Math.min(visible.length - 1, highlighted + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight(Math.max(0, highlighted - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(highlighted);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
      trigger.focus();
    }
  });
  list.addEventListener('mousedown', (event) => event.preventDefault()); // keep focus in the search box
  list.addEventListener('click', (event) => {
    const el = event.target.closest('.combo-option');
    if (el) choose(Number(el.dataset.index));
  });
  list.addEventListener('mousemove', (event) => {
    const el = event.target.closest('.combo-option');
    if (el && Number(el.dataset.index) !== highlighted) setHighlight(Number(el.dataset.index));
  });

  selectEl.addEventListener('change', sync);
  // Options rebuilt via innerHTML, or `disabled` toggled, by the caller.
  new MutationObserver(sync).observe(selectEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  sync();

  return { sync, close };
}
