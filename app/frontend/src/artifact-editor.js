// Editor guiado dos artefatos de documento unico (brief, atributos,
// requisitos, modelo). O usuario nunca ve JSON nem HTML: o formulario e montado a
// partir do JSON semantico que ja mora ao lado do .html (ArtifactData), e a
// previa vem do mesmo workflow ArtifactPreview que o Modo Buddy usa. Salvar
// chama ArtifactSave, que regrava JSON + HTML pelos mesmos templates dos
// *Commit — por isso a estrutura (chaves de topo) nunca muda aqui: so valores
// de texto e itens de lista.
import { artifactPreview, saveArtifact } from './api.js';
import { buildDocFrame } from './reading-pane.js';
import { inlineMermaid, hasMermaidDiagram } from './mermaid-inline.js';
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

// Modelo arquitetural (workflows/shared/artifacts/arch_model.mh): editar aqui
// e o caminho sem LLM para mudar os diagramas de contexto e de conteiner —
// ArtifactSave os redesenha a partir deste JSON.
const TIPOS_ELEMENTO = [
  ['pessoa', 'Pessoa'],
  ['sistema_externo', 'Sistema externo'],
  ['container', 'Contêiner: aplicação'],
  ['banco_dados', 'Contêiner: banco de dados'],
];
const TIPOS_CONTEXTO = TIPOS_ELEMENTO.slice(0, 2);
// As pontas de uma relacao sao os elementos do mesmo diagrama, mostrados pelo
// nome; o id fica por baixo. No contexto, o sistema em escopo e uma ponta
// tambem, pelo id reservado "sistema" (ArchModel).
const elementOptions = (view) => (data) => [
  ...(view === 'contexto' ? [['sistema', `${data.sistema?.nome || 'Sistema em escopo'} (sistema em escopo)`]] : []),
  ...data[view].elementos.map((el) => [el.id, el.nome || el.id]),
];
// Uma relacao sem uma das pontas nao tem como ser desenhada.
const removeRelationsOf = (view) => (data, removed) => {
  data[view].relacoes = data[view].relacoes.filter((r) => r.de !== removed.id && r.para !== removed.id);
};
// Fronteiras do diagrama de conteiner: cada uma vira uma tabela de elementos
// (groupBy) e uma opcao da coluna "Fronteira", que move o elemento.
const FORA = 'Fora das fronteiras';
const boundaryOptions = (data) => [...data.conteineres.fronteiras.map((b) => [b.id, b.nome || b.id]), ['', FORA]];
// Apagar uma fronteira nao apaga os elementos: eles vao para "fora" (com o
// aviso de conteiner fora de fronteira) e podem ser movidos depois.
const releaseElementsOf = (data, removed) => {
  for (const el of data.conteineres.elementos) if (el.fronteira === removed.id) el.fronteira = '';
};
// Modelo gravado antes das fronteiras: uma so, a do sistema em escopo, com os
// conteineres dentro — o mesmo desenho que ele ja tinha (ArchModel).
function normalizeModelo(data) {
  const view = data.conteineres;
  if (!view || Array.isArray(view.fronteiras)) return;
  view.fronteiras = [{ id: 'sistema', nome: data.sistema?.nome ?? '', descricao: '', fontes: data.sistema?.fontes ?? ['gap'] }];
  for (const el of view.elementos) el.fronteira = el.tipo === 'container' || el.tipo === 'banco_dados' ? 'sistema' : '';
}
const NORMALIZE = { modelo: normalizeModelo };

const relationFields = (view, withTecnologia) => [
  f('de', 'De', { type: 'select', options: elementOptions(view), initialIndex: 0 }),
  f('para', 'Para', { type: 'select', options: elementOptions(view), initialIndex: 1 }),
  f('descricao', 'Descrição', { long: true }),
  ...(withTecnologia ? [f('tecnologia', 'Tecnologia / protocolo')] : []),
];

// Cada secao: `text` (um paragrafo + suas fontes), `object` (um cartao so) ou
// lista de itens — cartoes, ou uma linha por item com `table: true` (listas
// longas de campos curtos, como os elementos e relacoes do modelo).
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
  // Uma aba por diagrama (TABS), cada uma com os proprios elementos e
  // relacoes (ids de cada diagrama; repetir uma pessoa nos dois e normal).
  // `key` com ponto aponta para dentro do JSON (contexto.elementos).
  modelo: [
    { key: 'sistema', tab: 'contexto', label: 'Sistema em escopo', object: true, fields: [f('nome', 'Nome'), f('descricao', 'Descrição', { long: true })] },
    {
      key: 'contexto.elementos', tab: 'contexto', label: 'Pessoas e sistemas externos', changeLabel: 'Contexto — elementos', noun: 'elemento', idPrefix: 'EL', table: true,
      fields: [id(), f('nome', 'Nome'), f('tipo', 'Tipo', { type: 'select', options: TIPOS_CONTEXTO, initial: 'pessoa' }), f('descricao', 'Descrição', { long: true })],
      defaults: { tecnologia: '' }, onRemove: removeRelationsOf('contexto'),
    },
    {
      key: 'contexto.relacoes', tab: 'contexto', label: 'Relações', changeLabel: 'Contexto — relações', noun: 'relação', table: true,
      fields: relationFields('contexto', false), defaults: { tecnologia: '' },
    },
    {
      key: 'conteineres.fronteiras', tab: 'conteineres', label: 'Fronteiras', changeLabel: 'Contêineres — fronteiras', noun: 'fronteira', idPrefix: 'SIS', table: true,
      fields: [id(), f('nome', 'Sistema de software'), f('descricao', 'Descrição', { long: true })],
      onRemove: releaseElementsOf,
    },
    {
      key: 'conteineres.elementos', tab: 'conteineres', label: 'Elementos', changeLabel: 'Contêineres — elementos', noun: 'elemento', idPrefix: 'EL', table: true,
      fields: [id(), f('nome', 'Nome'), f('tipo', 'Tipo', { type: 'select', options: TIPOS_ELEMENTO, initial: 'container' }), f('tecnologia', 'Tecnologia'), f('descricao', 'Descrição', { long: true }), f('fronteira', 'Fronteira', { type: 'select', options: boundaryOptions, regroup: true })],
      groupBy: {
        field: 'fronteira',
        groups: (data) => boundaryOptions(data).map(([gid, nome]) => [gid, gid ? `Fronteira: ${nome}` : FORA]),
        // Dentro de uma fronteira entra um conteiner; fora, uma pessoa.
        defaults: (gid) => ({ tipo: gid ? 'container' : 'pessoa' }),
      },
      onRemove: removeRelationsOf('conteineres'),
    },
    {
      key: 'conteineres.relacoes', tab: 'conteineres', label: 'Relações', changeLabel: 'Contêineres — relações', noun: 'relação', table: true,
      fields: relationFields('conteineres', true),
    },
    { key: 'gaps', tab: 'lacunas', label: 'Lacunas', noun: 'lacuna', table: true, fields: texto },
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

// Abas de um editor: cada uma mostra so as secoes com o mesmo `tab` e tem a
// propria previa (`preview`, um artefato de ArtifactPreview).
const TABS = {
  modelo: [
    { id: 'contexto', label: 'Contexto', preview: 'modelo_contexto' },
    { id: 'conteineres', label: 'Contêineres', preview: 'modelo_conteineres' },
    { id: 'lacunas', label: 'Lacunas', preview: 'modelo' },
  ],
};

// Ids de DOM e de evento: a chave sem pontos.
const sidOf = (section) => section.key.replaceAll('.', '-');
// Valor de uma chave com ponto ("contexto.elementos").
const getIn = (source, key) => key.split('.').reduce((o, k) => o?.[k], source);

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

// `options` de um select: lista fixa ou funcao dos dados atuais (as pontas
// de uma relacao do modelo sao os elementos que existem agora).
const optionsOf = (field, source) => (typeof field.options === 'function' ? field.options(source) : field.options);

// Rotulo de um valor de select (o nome do elemento, nao o id).
function shown(field, value, source) {
  if (field.type !== 'select') return value ?? '';
  return optionsOf(field, source).find(([v]) => v === value)?.[1] ?? value ?? '';
}

// Texto legivel de cada secao alterada, gravado como diretiva de regeneracao.
// Secoes de lista entram inteiras: adicionar, remover e editar itens mudam a
// lista toda, e a geracao seguinte so enxerga este texto.
function describeChanges(sections, source) {
  return sections.map((section) => {
    if (section.text) return { titulo: section.label, conteudo: String(source[section.key] ?? '') };
    const line = (item) => section.fields.map((fl) => `${fl.label}: ${shown(fl, item[fl.key], source)}`).join('; ');
    if (section.object) return { titulo: section.label, conteudo: line(source[section.key]) };
    const items = getIn(source, section.key).map((item) => `- ${line(item)}`);
    return { titulo: section.changeLabel ?? section.label, conteudo: items.join('\n') || '(sem itens)' };
  });
}

function blankItem(section, list, source) {
  const item = {};
  for (const field of section.fields) {
    if (field.type !== 'select') item[field.key] = '';
    else if (typeof field.options === 'function') {
      const options = optionsOf(field, source);
      item[field.key] = (options[field.initialIndex ?? 0] ?? options[0])?.[0] ?? '';
    } else item[field.key] = field.initial;
  }
  if (section.idPrefix) item.id = nextId(list, section.idPrefix);
  Object.assign(item, section.defaults);
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
  // Mesma normalizacao nos dois lados: so ela nao conta como alteracao.
  NORMALIZE[artifact]?.(saved);
  NORMALIZE[artifact]?.(data);
  let previewTimer = null;
  let previewSeq = 0;
  let saving = false;
  let confirmingDiscard = false;
  let error = '';
  // Linhas de tabela com as fontes abertas (caminho "secao.indice").
  const openSources = new Set();
  const tabs = TABS[artifact] ?? null;
  let activeTab = tabs?.[0].id ?? null;
  const visible = () => (tabs ? spec.filter((s) => s.tab === activeTab) : spec);

  host.className = 'doc-body ae-host';
  host.innerHTML = `
    <div class="ae">
      <div class="ae-top">
        <nav class="ae-nav${tabs ? ' ae-tabs' : ''}" aria-label="${tabs ? 'Diagramas' : 'Seções'}"${tabs ? ' role="tablist"' : ''}></nav>
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
    const base = `data-path="${path}" id="ae-${path.replaceAll('.', '-')}" aria-label="${esc(field.label)}"`;
    if (field.type === 'select') {
      const dynamic = typeof field.options === 'function' ? ' data-dynamic' : '';
      return `<select class="ae-field" ${base}${dynamic}>${optionsHTML(field, value)}</select>`;
    }
    if (field.type === 'id') return `<input class="ae-field ae-id" ${base} value="${esc(value)}" readonly title="O ID é usado como referência por outros artefatos e não muda">`;
    return `<textarea class="ae-field" rows="${field.long ? 2 : 1}" ${base}>${esc(value)}</textarea>`;
  }
  // Um valor que nao esta mais entre as opcoes (ponta de relacao apagada
  // fora do editor) continua visivel, marcado, em vez de sumir.
  function optionsHTML(field, value) {
    const options = optionsOf(field, data);
    const known = options.some(([v]) => v === value);
    const missing = known || !value ? '' : `<option value="${esc(value)}" selected>${esc(value)} (inexistente)</option>`;
    return missing + options.map(([v, l]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(l)}</option>`).join('');
  }
  // Renomear um elemento muda o rotulo dele nos selects das relacoes. Sem
  // redesenhar o formulario (perderia o foco de quem esta digitando).
  // "<lista>.<indice>.<campo>" -> o campo da propria secao (as relacoes do
  // contexto e as de conteineres tem opcoes diferentes).
  function fieldAt(pathStr) {
    const parts = pathStr.split('.');
    const key = parts.pop();
    parts.pop();
    return spec.find((s) => s.key === parts.join('.'))?.fields?.find((fl) => fl.key === key);
  }
  function refreshDynamicSelects() {
    formEl.querySelectorAll('select[data-dynamic]').forEach((el) => {
      if (el === document.activeElement) return;
      const [obj, key] = path(el.dataset.path);
      const field = fieldAt(el.dataset.path);
      if (field) el.innerHTML = optionsHTML(field, obj[key]);
    });
  }
  function fieldsHTML(path, fields, source) {
    return fields.map((fl) => `<div class="ae-col${fl.long ? ' wide' : ''}"><label class="ae-lbl" for="ae-${path.replaceAll('.', '-')}-${fl.key}">${fl.label}</label>${control(`${path}.${fl.key}`, fl, source[fl.key])}</div>`).join('');
  }
  // Uma linha por item; as fontes ficam recolhidas num contador que abre uma
  // linha logo abaixo (o mesmo editor de chips dos cartoes).
  function tableHTML(section) {
    const cols = section.fields.filter((fl) => fl.type !== 'id');
    const head = cols.map((fl) => `<th${fl.long ? ' class="wide"' : ''}>${fl.label}</th>`).join('') + '<th class="ae-t-src">Fontes</th><th class="ae-t-act"></th>';
    const rowHTML = (item, i) => {
      const p = `${section.key}.${i}`;
      const open = openSources.has(p);
      const fontes = item.fontes ?? [];
      const cells = cols.map((fl) => `<td>${control(`${p}.${fl.key}`, fl, item[fl.key])}</td>`).join('');
      const toggle = `<button type="button" class="ae-src-toggle${fontes.includes('gap') ? ' gap' : ''}" data-togglesrc="${p}" aria-expanded="${open}" title="${esc(fontes.join(', ') || 'Sem fontes')}">${fontes.length}</button>`;
      const remove = `<button type="button" class="ae-rm-row" data-rmrow="${p}" title="Remover ${section.noun}" aria-label="Remover ${section.noun}">${icon('trash', 14)}</button>`;
      const row = `<tr${item.id ? ` title="id: ${esc(item.id)}"` : ''}>${cells}<td class="ae-t-src">${toggle}</td><td class="ae-t-act">${remove}</td></tr>`;
      return open ? `${row}<tr class="ae-t-sources"><td colspan="${cols.length + 2}">${chips(`${p}.fontes`, fontes)}</td></tr>` : row;
    };
    // `pairs`: [item, indice na lista inteira] — o caminho de cada campo usa
    // o indice real, mesmo numa tabela que mostra so parte da lista.
    const table = (pairs) =>
      pairs.length
        ? `<div class="ae-table-wrap"><table class="ae-table"><thead><tr>${head}</tr></thead><tbody>${pairs.map(([item, i]) => rowHTML(item, i)).join('')}</tbody></table></div>`
        : '<p class="ae-empty">Nenhum item ainda.</p>';
    const addButton = (group) =>
      `<button type="button" class="ae-add" data-add="${sidOf(section)}"${group === undefined ? '' : ` data-group="${esc(group)}"`}>${icon('plus', 13)} Adicionar ${section.noun}</button>`;
    const list = getIn(data, section.key);
    const pairs = list.map((item, i) => [item, i]);
    let body;
    if (section.groupBy) {
      // Uma tabela por grupo (cada fronteira, e por ultimo "fora"); um valor
      // que nao bate com nenhum grupo cai em "fora", como no desenho.
      const groups = section.groupBy.groups(data);
      const known = new Set(groups.map(([gid]) => gid));
      const groupOf = (item) => (known.has(item[section.groupBy.field] ?? '') ? item[section.groupBy.field] ?? '' : '');
      body = groups
        .map(([gid, label]) => `<div class="ae-group"><h4>${esc(label)}</h4>${table(pairs.filter(([item]) => groupOf(item) === gid))}${addButton(gid)}</div>`)
        .join('');
    } else {
      body = table(pairs) + addButton();
    }
    return `<section class="ae-sec" id="ae-s-${sidOf(section)}" data-sec="${sidOf(section)}"><h3>${section.label}<span class="ae-count">${list.length}</span></h3>
      ${body}</section>`;
  }
  function sectionHTML(section) {
    if (section.table) return tableHTML(section);
    if (section.object) {
      return `<section class="ae-sec" id="ae-s-${section.key}" data-sec="${section.key}"><h3>${section.label}</h3>
        <div class="ae-card"><div class="ae-cols">${fieldsHTML(section.key, section.fields, data[section.key])}</div><div><span class="ae-lbl">Fontes</span>${chips(`${section.key}.fontes`, data[section.key].fontes)}</div></div></section>`;
    }
    if (section.text) {
      return `<section class="ae-sec" id="ae-s-${section.key}" data-sec="${section.key}"><h3>${section.label}</h3>
        ${control(section.key, { long: true }, data[section.key])}
        <div><span class="ae-lbl">Fontes</span>${chips(section.fontes, data[section.fontes])}</div></section>`;
    }
    const items = data[section.key].map((item, i) => {
      const path = `${section.key}.${i}`;
      const cols = fieldsHTML(path, section.fields, item);
      return `<div class="ae-card"><button type="button" class="ae-rm" data-rmrow="${section.key}.${i}" title="Remover ${section.noun}" aria-label="Remover ${section.noun}">${icon('trash', 14)}</button><div class="ae-cols">${cols}</div><div><span class="ae-lbl">Fontes</span>${chips(`${path}.fontes`, item.fontes)}</div></div>`;
    });
    return `<section class="ae-sec" id="ae-s-${section.key}" data-sec="${section.key}"><h3>${section.label}<span class="ae-count">${data[section.key].length}</span></h3>
      ${items.join('') || '<p class="ae-empty">Nenhum item ainda.</p>'}
      <button type="button" class="ae-add" data-add="${section.key}">${icon('plus', 13)} Adicionar ${section.noun}</button></section>`;
  }
  function buildForm() {
    const scroll = formEl.scrollTop;
    formEl.innerHTML = `<datalist id="ae-sources"></datalist>` + visible().map(sectionHTML).join('');
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
    return s.text ? [source[s.key], source[s.fontes]] : getIn(source, s.key);
  }
  const tabDirty = (tab) => dirtySections().some((s) => s.tab === tab);

  function refreshChrome() {
    const dirty = dirtySections();
    const keys = new Set(dirty.map((s) => s.key));
    const dot = '<i class="ae-dot" title="Alterada"></i>';
    $('.ae-nav').innerHTML = tabs
      ? tabs.map((t) => `<button type="button" role="tab" data-tab="${t.id}" aria-selected="${t.id === activeTab}">${t.label}${tabDirty(t.id) ? dot : ''}</button>`).join('')
      : spec.map((s) => `<button type="button" data-go="${s.key}">${s.label}${keys.has(s.key) ? dot : ''}</button>`).join('');
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
      const html = await artifactPreview(tabs?.find((t) => t.id === activeTab).preview ?? artifact, data);
      if (seq !== previewSeq || !ae.isConnected) return;
      frame.innerHTML = '';
      // O modelo traz as visoes de contexto e conteiner em Mermaid: o iframe
      // precisa do bundle inline, como nas demais previas (tab-artefatos.js).
      frame.appendChild(buildDocFrame(html, { mermaid: hasMermaidDiagram(html), inlineMermaid }));
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
    // Trocar a fronteira muda a tabela onde a linha mora.
    if (e.target.matches('select') && fieldAt(e.target.dataset.path)?.regroup) return rebuild();
    refreshDynamicSelects();
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
    const toggleSrc = e.target.closest('[data-togglesrc]');
    if (toggleSrc) {
      const p = toggleSrc.dataset.togglesrc;
      if (openSources.has(p)) openSources.delete(p);
      else openSources.add(p);
      return rebuild(openSources.has(p) ? `[data-chips="${p}.fontes"] .ae-chip-add` : null);
    }
    const rmRow = e.target.closest('[data-rmrow]');
    if (rmRow) {
      // Os indices das linhas seguintes mudam: nenhuma fica aberta por engano.
      openSources.clear();
      const [list, index] = path(rmRow.dataset.rmrow);
      const [removed] = list.splice(Number(index), 1);
      const listKey = rmRow.dataset.rmrow.split('.').slice(0, -1).join('.');
      spec.find((s) => s.key === listKey)?.onRemove?.(data, removed);
      return rebuild();
    }
    const add = e.target.closest('[data-add]');
    if (add) {
      const section = spec.find((s) => sidOf(s) === add.dataset.add);
      const list = getIn(data, section.key);
      const item = blankItem(section, list, data);
      if (add.dataset.group !== undefined) Object.assign(item, section.groupBy.defaults(add.dataset.group), { [section.groupBy.field]: add.dataset.group });
      list.push(item);
      const p = `${section.key}.${list.length - 1}.`;
      rebuild(`textarea[data-path^="${p}"]:not([readonly]), select[data-path^="${p}"]`);
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
    const tab = e.target.closest('[data-tab]');
    if (tab && tab.dataset.tab !== activeTab) {
      activeTab = tab.dataset.tab;
      openSources.clear();
      formEl.scrollTop = 0;
      rebuild();
      renderPreview();
      return;
    }
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
