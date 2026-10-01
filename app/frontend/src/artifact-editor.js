// Editor guiado dos artefatos de documento unico (brief, atributos,
// requisitos). O usuario nunca ve JSON nem HTML: o formulario e montado a
// partir do JSON semantico que ja mora ao lado do .html (ArtifactData), e a
// previa vem do mesmo workflow ArtifactPreview que o Modo Buddy usa. Salvar
// chama ArtifactSave, que regrava JSON + HTML pelos mesmos templates dos
// *Commit — por isso a estrutura (chaves de topo) nunca muda aqui: so valores
// de texto e itens de lista.
import { artifactPreview, saveArtifact } from './api.js';
import { buildDocFrame } from './reading-pane.js';
import { icon } from './icons.js';

const MUDANCA = [
  ['novo', 'Novo'],
  ['modificado', 'Modificado'],
  ['as_is', 'Sem mudança'],
  ['removido', 'Removido'],
];
const PRIORIDADE = [['Must', 'Must'], ['Should', 'Should'], ['Could', 'Could']];
const PRIORIDADE_W = [...PRIORIDADE, ['Won\'t', 'Won\'t']];

// f(key, label, opts): campo de texto (long => textarea maior) ou select.
const f = (key, label, opts = {}) => ({ key, label, ...opts });
const id = () => f('id', 'ID', { type: 'id' });
const mudanca = () => f('mudanca', 'Mudança', { type: 'select', options: MUDANCA, initial: 'novo' });
const texto = [f('texto', 'Texto', { long: true })];

// Cada secao: `text` (um paragrafo + suas fontes) ou `items` (lista de cartoes).
const SPECS = {
  brief: [
    { key: 'resumo_executivo', label: 'Resumo executivo', text: true, fontes: 'resumo_fontes' },
    { key: 'contexto_negocio', label: 'Contexto de negócio', text: true, fontes: 'contexto_fontes' },
    { key: 'objetivos', label: 'Metas e objetivos', noun: 'objetivo', fields: [f('objetivo', 'Objetivo', { long: true }), f('resultado_esperado', 'Resultado esperado', { long: true })] },
    { key: 'em_escopo', label: 'Em escopo', noun: 'item', fields: texto },
    { key: 'fora_escopo', label: 'Fora de escopo', noun: 'item', fields: texto },
    { key: 'stakeholders', label: 'Stakeholders', noun: 'stakeholder', fields: [f('stakeholder', 'Stakeholder'), f('papel_interesse', 'Papel e interesse', { long: true })] },
    { key: 'metricas_sucesso', label: 'Métricas de sucesso', noun: 'métrica', fields: [f('metrica', 'Métrica'), f('meta', 'Meta')] },
    { key: 'cronograma_marcos', label: 'Cronograma e marcos', noun: 'marco', fields: [f('marco', 'Marco'), f('data_alvo', 'Data alvo'), f('notas', 'Notas', { long: true })] },
    { key: 'riscos_dependencias', label: 'Riscos e dependências', noun: 'risco', fields: [f('risco_dependencia', 'Risco / dependência', { long: true }), f('probabilidade', 'Probabilidade'), f('impacto', 'Impacto'), f('mitigacao', 'Mitigação', { long: true })] },
    { key: 'perguntas_abertas', label: 'Perguntas abertas', noun: 'pergunta', fields: texto },
  ],
  atributos: [
    { key: 'contexto', label: 'Contexto', text: true, fontes: 'contexto_fontes' },
    { key: 'requisitos_nao_funcionais', label: 'Requisitos não funcionais', noun: 'requisito', idPrefix: 'NFR', fields: [id(), f('categoria', 'Categoria'), f('prioridade', 'Prioridade', { type: 'select', options: PRIORIDADE, initial: 'Must' }), f('requisito', 'Requisito', { long: true }), mudanca()] },
    { key: 'restricoes_arquiteturais', label: 'Restrições arquiteturais', noun: 'restrição', idPrefix: 'AC', fields: [id(), f('restricao', 'Restrição', { long: true }), f('justificativa', 'Justificativa', { long: true }), mudanca()] },
    { key: 'compliance', label: 'Compliance', noun: 'obrigação', idPrefix: 'CO', fields: [id(), f('obrigacao', 'Obrigação', { long: true }), f('orgao_padrao', 'Órgão ou padrão'), mudanca()] },
    { key: 'exclusoes', label: 'Exclusões', noun: 'exclusão', fields: texto },
    { key: 'perguntas_abertas', label: 'Perguntas abertas', noun: 'pergunta', fields: texto },
  ],
  requisitos: [
    { key: 'contexto', label: 'Contexto', text: true, fontes: 'contexto_fontes' },
    { key: 'funcionais', label: 'Requisitos funcionais', noun: 'requisito', idPrefix: 'FR', fields: [id(), f('titulo', 'Título'), f('prioridade', 'Prioridade', { type: 'select', options: PRIORIDADE_W, initial: 'Must' }), f('descricao', 'Descrição', { long: true }), f('criterios_aceitacao', 'Critérios de aceitação', { long: true }), mudanca()] },
    { key: 'integracoes', label: 'Integrações', noun: 'integração', idPrefix: 'IR', fields: [id(), f('sistema_origem', 'Sistema de origem'), f('sistema_destino', 'Sistema de destino'), f('interacao', 'Interação', { long: true }), mudanca()] },
    { key: 'dados', label: 'Dados', noun: 'dado', idPrefix: 'DR', fields: [id(), f('elemento_dado', 'Elemento de dado'), f('formato', 'Formato'), f('volume_frequencia', 'Volume e frequência'), mudanca()] },
    { key: 'negocio', label: 'Requisitos de negócio', noun: 'requisito', idPrefix: 'BR', fields: [id(), f('titulo', 'Título'), f('prioridade', 'Prioridade', { type: 'select', options: PRIORIDADE_W, initial: 'Must' }), f('capacidade', 'Capacidade', { long: true }), f('justificativa_negocio', 'Justificativa de negócio', { long: true }), mudanca()] },
    { key: 'regras_negocio', label: 'Regras de negócio', noun: 'regra', idPrefix: 'RN', fields: [id(), f('regra', 'Regra', { long: true }), f('impacto', 'Impacto', { long: true }), mudanca()] },
    { key: 'exclusoes', label: 'Exclusões', noun: 'exclusão', fields: texto },
    { key: 'gaps', label: 'Lacunas', noun: 'lacuna', fields: texto },
    { key: 'perguntas_abertas', label: 'Perguntas abertas', noun: 'pergunta', fields: texto },
  ],
};

export function isEditable(artifact) {
  return Object.hasOwn(SPECS, artifact);
}

// Rascunhos nao salvos sobrevivem a troca de artefato/aba (chave = work-item + arquivo).
const drafts = new Map();
const openEditors = new Map(); // chave -> elemento raiz (.ae) do editor montado

// Um editor aberto precisa sobreviver aos repaints do painel (run updates);
// tab-artefatos.js consulta isto antes de redesenhar o painel.
export function isEditorOpen(key) {
  // O corpo do painel e reaproveitado por outros artefatos (innerHTML = ''),
  // entao "aberto" significa que o editor ainda esta no DOM.
  return openEditors.get(key)?.isConnected === true;
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const esc = (text) => {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
};

function nextId(list, prefix) {
  let max = 0;
  for (const item of list) {
    const m = /^[A-Z]+-(\d+)$/.exec(item.id ?? '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

// Texto legivel de cada secao alterada, gravado como diretiva de regeneracao.
// Secoes de lista entram inteiras: adicionar, remover e editar itens mudam a
// lista toda, e a geracao seguinte so enxerga este texto.
function describeChanges(sections, source) {
  return sections.map((section) => {
    if (section.text) return { titulo: section.label, conteudo: String(source[section.key] ?? '') };
    const items = source[section.key].map((item) =>
      `- ${section.fields.map((fl) => `${fl.label}: ${item[fl.key] ?? ''}`).join('; ')}`,
    );
    return { titulo: section.label, conteudo: items.join('\n') || '(sem itens)' };
  });
}

function blankItem(section, list) {
  const item = {};
  for (const field of section.fields) item[field.key] = field.type === 'select' ? field.initial : '';
  if (section.idPrefix) item.id = nextId(list, section.idPrefix);
  item.fontes = ['gap'];
  return item;
}

// mountArtifactEditor monta o editor em `host` (o corpo do painel de leitura).
// Resolve ao fechar: true se salvou, false se cancelou.
export function mountArtifactEditor(host, { projectId, artifact, draftKey, original, onSaved, onClose }) {
  const spec = SPECS[artifact];
  const saved = clone(original);
  const restored = drafts.get(draftKey);
  const data = restored ? clone(restored) : clone(original);
  let previewTimer = null;
  let previewSeq = 0;
  let saving = false;
  let confirmingDiscard = false;
  let error = '';

  host.className = 'doc-body ae-host';
  host.innerHTML = `
    <div class="ae">
      <div class="ae-top">
        <nav class="ae-nav" aria-label="Seções"></nav>
        <div class="ae-view" role="group" aria-label="Modo"><button type="button" data-view="form" aria-pressed="true">Editar</button><button type="button" data-view="preview" aria-pressed="false">Prévia</button></div>
      </div>
      <div class="ae-main">
        <div class="ae-form"></div>
        <div class="ae-preview"><div class="ae-preview-tag">Prévia</div><div class="ae-preview-frame"></div></div>
      </div>
      <div class="ae-bar">
        <span class="ae-status" aria-live="polite"></span>
        <span class="ae-discard" hidden>Descartar as alterações? <button type="button" class="button secondary small" data-keep>Continuar editando</button><button type="button" class="button danger small" data-discard>Descartar</button></span>
        <button type="button" class="button tertiary small" data-cancel>Cancelar</button>
        <button type="button" class="button primary small" data-save>Salvar alterações</button>
      </div>
    </div>`;
  const $ = (sel) => host.querySelector(sel);
  const formEl = $('.ae-form');
  const ae = $('.ae');
  openEditors.set(draftKey, ae);

  // ---- formulario ----
  function chips(path, list) {
    return `<div class="ae-chips" data-chips="${path}">${list
      .map((src, i) => `<span class="ae-chip${src === 'gap' ? ' gap' : ''}">${esc(src)}<button type="button" data-rmchip="${i}" aria-label="Remover fonte ${esc(src)}">×</button></span>`)
      .join('')}<input class="ae-chip-add" placeholder="+ fonte" aria-label="Adicionar fonte" data-addchip></div>`;
  }
  function control(path, field, value) {
    const base = `data-path="${path}" id="ae-${path.replaceAll('.', '-')}"`;
    if (field.type === 'select') {
      return `<select class="ae-field" ${base}>${field.options.map(([v, l]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    }
    if (field.type === 'id') return `<input class="ae-field ae-id" ${base} value="${esc(value)}" readonly title="O ID é usado como referência por outros artefatos e não muda">`;
    return `<textarea class="ae-field" rows="${field.long ? 2 : 1}" ${base}>${esc(value)}</textarea>`;
  }
  function sectionHTML(section) {
    if (section.text) {
      return `<section class="ae-sec" id="ae-s-${section.key}" data-sec="${section.key}"><h3>${section.label}</h3>
        ${control(section.key, { long: true }, data[section.key])}
        <div><span class="ae-lbl">Fontes</span>${chips(section.fontes, data[section.fontes])}</div></section>`;
    }
    const items = data[section.key].map((item, i) => {
      const path = `${section.key}.${i}`;
      const cols = section.fields.map((fl) => `<div class="ae-col${fl.long ? ' wide' : ''}"><label class="ae-lbl" for="ae-${path.replaceAll('.', '-')}-${fl.key}">${fl.label}</label>${control(`${path}.${fl.key}`, fl, item[fl.key])}</div>`).join('');
      return `<div class="ae-card"><button type="button" class="ae-rm" data-rmrow="${section.key}.${i}" title="Remover ${section.noun}" aria-label="Remover ${section.noun}">${icon('trash', 14)}</button><div class="ae-cols">${cols}</div><div><span class="ae-lbl">Fontes</span>${chips(`${path}.fontes`, item.fontes)}</div></div>`;
    });
    return `<section class="ae-sec" id="ae-s-${section.key}" data-sec="${section.key}"><h3>${section.label}<span class="ae-count">${data[section.key].length}</span></h3>
      ${items.join('') || '<p class="ae-empty">Nenhum item ainda.</p>'}
      <button type="button" class="ae-add" data-add="${section.key}">${icon('plus', 13)} Adicionar ${section.noun}</button></section>`;
  }
  function buildForm() {
    const scroll = formEl.scrollTop;
    formEl.innerHTML = `<datalist id="ae-sources"></datalist>` + spec.map(sectionHTML).join('');
    formEl.querySelectorAll('.ae-chip-add').forEach((el) => el.setAttribute('list', 'ae-sources'));
    formEl.querySelectorAll('textarea').forEach(autosize);
    formEl.scrollTop = scroll;
  }
  function autosize(el) {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }

  function path(pathStr) {
    const parts = pathStr.split('.');
    const last = parts.pop();
    return [parts.reduce((o, k) => o[k], data), last];
  }
  const dirtySections = () => spec.filter((s) => !same(sectionData(data, s), sectionData(saved, s)));
  function sectionData(source, s) {
    return s.text ? [source[s.key], source[s.fontes]] : source[s.key];
  }

  function refreshChrome() {
    const dirty = dirtySections();
    const keys = new Set(dirty.map((s) => s.key));
    $('.ae-nav').innerHTML = spec.map((s) => `<button type="button" data-go="${s.key}">${s.label}${keys.has(s.key) ? '<i class="ae-dot" title="Alterada"></i>' : ''}</button>`).join('');
    const status = $('.ae-status');
    status.textContent = error || (dirty.length ? `${dirty.length} ${dirty.length > 1 ? 'seções alteradas' : 'seção alterada'}${restored ? ' · rascunho restaurado' : ''}` : 'Nenhuma alteração');
    status.classList.toggle('error', Boolean(error));
    $('[data-save]').disabled = !dirty.length || saving;
    $('[data-save]').textContent = saving ? 'Salvando…' : 'Salvar alterações';
    if (dirty.length) drafts.set(draftKey, clone(data));
    else drafts.delete(draftKey);
    schedulePreview();
  }

  // ---- previa ----
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 450);
  }
  async function renderPreview() {
    const frame = $('.ae-preview-frame');
    if (!frame || !ae.isConnected) return;
    const seq = ++previewSeq;
    try {
      const html = await artifactPreview(artifact, data);
      if (seq !== previewSeq || !ae.isConnected) return;
      frame.innerHTML = '';
      frame.appendChild(buildDocFrame(html));
    } catch (err) {
      if (seq === previewSeq) frame.innerHTML = `<p class="ae-empty">Não foi possível montar a prévia: ${esc(String(err.message ?? err))}</p>`;
    }
  }

  // ---- eventos ----
  formEl.addEventListener('input', (e) => {
    if (!e.target.matches('textarea, select')) return;
    if (e.target.matches('textarea')) autosize(e.target);
    const [obj, key] = path(e.target.dataset.path);
    obj[key] = e.target.value;
    error = '';
    refreshChrome();
  });
  function rebuild(focusSel) {
    buildForm();
    refreshChrome();
    if (focusSel) formEl.querySelector(focusSel)?.focus();
  }
  formEl.addEventListener('click', (e) => {
    const rmChip = e.target.closest('[data-rmchip]');
    if (rmChip) {
      const [obj, key] = path(rmChip.closest('[data-chips]').dataset.chips);
      obj[key].splice(Number(rmChip.dataset.rmchip), 1);
      return rebuild();
    }
    const rmRow = e.target.closest('[data-rmrow]');
    if (rmRow) {
      const [list, index] = path(rmRow.dataset.rmrow);
      list.splice(Number(index), 1);
      return rebuild();
    }
    const add = e.target.closest('[data-add]');
    if (add) {
      const section = spec.find((s) => s.key === add.dataset.add);
      data[section.key].push(blankItem(section, data[section.key]));
      rebuild(`[data-sec="${section.key}"] .ae-card:last-of-type textarea, [data-sec="${section.key}"] .ae-card:last-of-type select`);
    }
  });
  formEl.addEventListener('keydown', (e) => {
    if (!e.target.matches('[data-addchip]') || (e.key !== 'Enter' && e.key !== ',')) return;
    e.preventDefault();
    const value = e.target.value.trim();
    if (!value) return;
    const [obj, key] = path(e.target.closest('[data-chips]').dataset.chips);
    // 'gap' e o marcador de "sem fonte": ao citar uma fonte real ele sai.
    if (value !== 'gap') obj[key] = obj[key].filter((s) => s !== 'gap');
    if (!obj[key].includes(value)) obj[key].push(value);
    rebuild();
  });
  $('.ae-nav').addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) $(`#ae-s-${go.dataset.go}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  host.querySelectorAll('[data-view]').forEach((btn) =>
    btn.addEventListener('click', () => {
      ae.dataset.view = btn.dataset.view;
      host.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      if (btn.dataset.view === 'preview') renderPreview();
    }),
  );

  function close(result) {
    clearTimeout(previewTimer);
    openEditors.delete(draftKey);
    host.removeEventListener('keydown', onKey);
    onClose(result);
  }
  async function save() {
    if (saving || !dirtySections().length) return;
    saving = true;
    error = '';
    refreshChrome();
    try {
      await saveArtifact(projectId, artifact, data, describeChanges(dirtySections(), data));
      drafts.delete(draftKey);
      await onSaved();
      close(true);
    } catch (err) {
      saving = false;
      error = `Não foi possível salvar: ${err.message ?? err}`;
      refreshChrome();
    }
  }
  function cancel() {
    if (!dirtySections().length) {
      drafts.delete(draftKey);
      return close(false);
    }
    confirmingDiscard = true;
    $('.ae-discard').hidden = false;
    $('[data-cancel]').hidden = true;
  }
  $('[data-save]').addEventListener('click', save);
  $('[data-cancel]').addEventListener('click', cancel);
  $('[data-keep]').addEventListener('click', () => {
    confirmingDiscard = false;
    $('.ae-discard').hidden = true;
    $('[data-cancel]').hidden = false;
  });
  $('[data-discard]').addEventListener('click', () => {
    drafts.delete(draftKey);
    close(false);
  });
  function onKey(e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape' && !confirmingDiscard) cancel();
  }
  host.addEventListener('keydown', onKey);

  buildForm();
  refreshChrome();
  renderPreview();
  formEl.querySelector('textarea')?.focus();
}
