// Editor guiado dos artefatos de documento unico (brief, atributos,
// requisitos, modelo). O usuario nunca ve JSON nem HTML: o formulario e montado a
// partir do JSON semantico que ja mora ao lado do .html (ArtifactData), e a
// previa vem do mesmo workflow ArtifactPreview que o Modo Buddy usa. Salvar
// chama ArtifactSave, que regrava JSON + HTML pelos mesmos templates dos
// *Commit — por isso a estrutura (chaves de topo) nunca muda aqui: so valores
// de texto e itens de lista. Excecao: `detalhes` do modelo (visoes
// detalhadas), que um modelo gravado antes delas ganha (ArtifactSave aceita).
import { artifactPreview, saveArtifact, listProjectDir, readProjectFile } from './api.js';
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
const TIPOS_COMPONENTE = [['componente', 'Componente'], ...TIPOS_ELEMENTO];
// Cada visao mora numa chave do JSON: "contexto", "conteineres" ou
// "detalhes.<i>" (visao detalhada). As pontas de uma relacao sao os elementos
// da mesma visao, mostrados pelo nome; o id fica por baixo. No contexto, o
// sistema em escopo e uma ponta tambem, pelo id reservado "sistema" (ArchModel).
const elementOptions = (viewKey) => (data) => [
  ...(viewKey === 'contexto' ? [['sistema', `${data.sistema?.nome || 'Sistema em escopo'} (sistema em escopo)`]] : []),
  ...getIn(data, viewKey).elementos.map((el) => [el.id, el.nome || el.id]),
];
// Uma relacao sem uma das pontas nao tem como ser desenhada.
const removeRelationsOf = (viewKey) => (data, removed) => {
  const view = getIn(data, viewKey);
  view.relacoes = view.relacoes.filter((r) => r.de !== removed.id && r.para !== removed.id);
};
// Fronteiras de um diagrama de conteiner: cada uma vira uma tabela de
// elementos (groupBy) e uma opcao da coluna "Fronteira", que move o elemento.
const FORA = 'Fora das fronteiras';
const boundaryOptions = (viewKey) => (data) => [...getIn(data, viewKey).fronteiras.map((b) => [b.id, b.nome || b.id]), ['', FORA]];
// Apagar uma fronteira nao apaga os elementos: eles vao para "fora" (com o
// aviso de conteiner fora de fronteira) e podem ser movidos depois.
const releaseElementsOf = (viewKey) => (data, removed) => {
  for (const el of getIn(data, viewKey).elementos) if (el.fronteira === removed.id) el.fronteira = '';
};
// Modelo gravado antes das fronteiras: uma so, a do sistema em escopo, com os
// conteineres dentro — o mesmo desenho que ele ja tinha (ArchModel). E antes
// das visoes detalhadas: nenhuma (ArtifactSave aceita a chave nova).
function normalizeModelo(data) {
  if (!Array.isArray(data.detalhes)) data.detalhes = [];
  const view = data.conteineres;
  if (!view || Array.isArray(view.fronteiras)) return;
  view.fronteiras = [{ id: 'sistema', nome: data.sistema?.nome ?? '', descricao: '', fontes: data.sistema?.fontes ?? ['gap'] }];
  for (const el of view.elementos) el.fronteira = el.tipo === 'container' || el.tipo === 'banco_dados' ? 'sistema' : '';
}
const NORMALIZE = { modelo: normalizeModelo };

const relationFields = (viewKey, withTecnologia) => [
  f('de', 'De', { type: 'select', options: elementOptions(viewKey), initialIndex: 0 }),
  f('para', 'Para', { type: 'select', options: elementOptions(viewKey), initialIndex: 1 }),
  f('descricao', 'Descrição', { long: true }),
  ...(withTecnologia ? [f('tecnologia', 'Tecnologia / protocolo')] : []),
];

// ---- Visoes detalhadas do modelo (ArchModel.detalhes) ----
// Um diagrama de conteineres nasce de um sistema do contexto (o sistema em
// escopo — N recortes, um por jornada — ou um sistema externo); um diagrama
// de componentes nasce de um conteiner de aplicacao (do principal ou de outra
// visao detalhada). `detail` numa secao de elementos diz que linhas ganham o
// botao "Detalhar" e que tipo de visao ele cria.
const DETAIL_COMPONENT = { tipo: 'c4-component', when: (item) => item.tipo === 'container', title: (item) => `Novo diagrama de componentes de ${item.nome || item.id}` };
const DETAIL_CONTAINER = { tipo: 'c4-container', when: (item) => item.tipo === 'sistema_externo', title: (item) => `Novo diagrama de contêineres de ${item.nome || item.id}` };

// O elemento de origem como esta agora (null = sumiu: a visao ficou orfa).
function originOf(data, d) {
  const { visao, elemento } = d.origem ?? {};
  if (visao === 'contexto' && elemento === 'sistema') return { id: 'sistema', tipo: 'sistema', nome: data.sistema?.nome ?? '', descricao: data.sistema?.descricao ?? '' };
  const view = visao === 'contexto' ? data.contexto : visao === 'conteineres' ? data.conteineres : data.detalhes.find((x) => x.id === visao);
  return view?.elementos.find((el) => el.id === elemento) ?? null;
}
const detailKind = (d) => (d.tipo === 'c4-component' ? 'Componentes' : 'Contêineres');
const detailLabel = (data, d) => `${detailKind(d)} · ${d.titulo?.trim() || originOf(data, d)?.nome || d.origem?.nome || d.id}`;
// Chave da visao -> o `origem.visao` de quem nasce dela.
const visaoOf = (data, viewKey) => (viewKey.startsWith('detalhes.') ? getIn(data, viewKey).id : viewKey);
const visaoLabel = (data, visao) => {
  if (visao === 'contexto') return 'Contexto';
  if (visao === 'conteineres') return 'Contêineres';
  const pai = data.detalhes.find((x) => x.id === visao);
  return pai ? detailLabel(data, pai) : 'visão removida';
};
const sameName = (a, b) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
const copyElement = (el, fronteira = '') => ({ id: el.id, nome: el.nome ?? '', tipo: el.tipo, tecnologia: el.tecnologia ?? '', descricao: el.descricao ?? '', fronteira, fontes: clone(el.fontes ?? ['gap']) });

// Os vizinhos de `item` na visao (as outras pontas das relacoes dele) e as
// relacoes religadas a `novoId` — o ponto de partida da visao filha.
function rewire(view, item, novoId, mapNeighbor) {
  const vizinhos = [];
  const relacoes = [];
  for (const r of view.relacoes) {
    if (r.de !== item.id && r.para !== item.id) continue;
    const outro = r.de === item.id ? r.para : r.de;
    if (outro === item.id) continue;
    if (!vizinhos.some((v) => v.id === outro)) {
      const viz = mapNeighbor(view.elementos.find((e) => e.id === outro) ?? null, outro);
      if (viz) vizinhos.push(viz);
    }
    // Ponta que nao existe na visao (relacao quebrada): nao vem junto.
    if (!vizinhos.some((v) => v.id === outro)) continue;
    relacoes.push({ de: r.de === item.id ? novoId : r.de, para: r.para === item.id ? novoId : r.para, descricao: r.descricao ?? '', tecnologia: r.tecnologia ?? '', fontes: clone(r.fontes ?? ['gap']) });
  }
  return { vizinhos, relacoes };
}

// newDetail: a visao filha pre-preenchida por codigo (sem LLM). `llm`: os
// diagramas de componente gerados no lote — o do conteiner, se houver, vira
// o ponto de partida (e sai do lote ao salvar: ArchModel.optional_diagrams).
function newDetail(data, tipo, viewKey, item, llm) {
  const base = {
    id: nextId(data.detalhes, 'DET'), tipo, titulo: '', descricao: '', fontes: ['gap'],
    origem: { visao: visaoOf(data, viewKey), elemento: item.id, nome: item.nome ?? '' },
    fronteiras: [], elementos: [], relacoes: [],
  };
  if (tipo === 'c4-component') {
    const gerado = llm.find((g) => sameName(g.escopo?.nome, item.nome));
    if (gerado) {
      return {
        detail: Object.assign(base, {
          descricao: gerado.descricao ?? '',
          fontes: clone(gerado.descricao_fontes?.length ? gerado.descricao_fontes : ['gap']),
          elementos: (gerado.elementos ?? []).map((el) => copyElement(el)),
          relacoes: clone(gerado.relacoes ?? []).map((r) => ({ de: r.de, para: r.para, descricao: r.descricao ?? '', tecnologia: r.tecnologia ?? '', fontes: r.fontes ?? ['gap'] })),
        }),
        adopted: gerado.titulo || 'diagrama gerado',
      };
    }
    const view = getIn(data, viewKey);
    const novoId = nextId(view.elementos, 'EL');
    const { vizinhos, relacoes } = rewire(view, item, novoId, (el) => (el ? copyElement(el) : null));
    base.elementos = [...vizinhos, { id: novoId, nome: 'Novo componente', tipo: 'componente', tecnologia: item.tecnologia ?? '', descricao: '', fronteira: '', fontes: ['gap'] }];
    base.relacoes = relacoes;
    return { detail: base };
  }
  // Recorte do sistema em escopo: parte do diagrama de conteineres inteiro —
  // a jornada e o que sobra depois de tirar o que nao participa dela.
  if (item.id === 'sistema') {
    const recortes = data.detalhes.filter((d) => d.origem?.visao === 'contexto' && d.origem?.elemento === 'sistema').length;
    return { detail: Object.assign(base, { titulo: `Recorte ${recortes + 1}`, fronteiras: clone(data.conteineres.fronteiras), elementos: clone(data.conteineres.elementos), relacoes: clone(data.conteineres.relacoes) }) };
  }
  // Sistema externo: a fronteira dele, um conteiner provisorio e os vizinhos
  // do contexto (o sistema em escopo, visto de la, e um sistema externo).
  const novoId = nextId(data.contexto.elementos, 'EL');
  const { vizinhos, relacoes } = rewire(data.contexto, item, novoId, (el, outroId) =>
    el ? copyElement(el) : outroId !== 'sistema' ? null : { id: outroId, nome: data.sistema?.nome ?? '', tipo: 'sistema_externo', tecnologia: '', descricao: data.sistema?.descricao ?? '', fronteira: '', fontes: clone(data.sistema?.fontes ?? ['gap']) },
  );
  base.fronteiras = [{ id: item.id, nome: item.nome ?? '', descricao: item.descricao ?? '', fontes: clone(item.fontes ?? ['gap']) }];
  base.elementos = [...vizinhos, { id: novoId, nome: 'Novo contêiner', tipo: 'container', tecnologia: '', descricao: '', fronteira: item.id, fontes: ['gap'] }];
  base.relacoes = relacoes;
  return { detail: base };
}

// Secoes de um diagrama de conteiner (o principal e as visoes detalhadas).
// `extra` vai em todas (tab, changeLabel/noDirective).
function containerSections(viewKey, extra, labelOf) {
  return [
    {
      key: `${viewKey}.fronteiras`, label: 'Fronteiras', changeLabel: labelOf?.('fronteiras'), noun: 'fronteira', idPrefix: 'SIS', table: true,
      fields: [id(), f('nome', 'Sistema de software'), f('descricao', 'Descrição', { long: true })],
      onRemove: releaseElementsOf(viewKey), ...extra,
    },
    {
      key: `${viewKey}.elementos`, label: 'Elementos', changeLabel: labelOf?.('elementos'), noun: 'elemento', idPrefix: 'EL', table: true,
      fields: [id(), f('nome', 'Nome'), f('tipo', 'Tipo', { type: 'select', options: TIPOS_ELEMENTO, initial: 'container' }), f('tecnologia', 'Tecnologia'), f('descricao', 'Descrição', { long: true }), f('fronteira', 'Fronteira', { type: 'select', options: boundaryOptions(viewKey), regroup: true })],
      groupBy: {
        field: 'fronteira',
        groups: (data) => boundaryOptions(viewKey)(data).map(([gid, nome]) => [gid, gid ? `Fronteira: ${nome}` : FORA]),
        // Dentro de uma fronteira entra um conteiner; fora, uma pessoa.
        defaults: (gid) => ({ tipo: gid ? 'container' : 'pessoa' }),
      },
      onRemove: removeRelationsOf(viewKey), detail: DETAIL_COMPONENT, ...extra,
    },
    {
      key: `${viewKey}.relacoes`, label: 'Relações', changeLabel: labelOf?.('relações'), noun: 'relação', table: true,
      fields: relationFields(viewKey, true), ...extra,
    },
  ];
}

// Secoes de uma aba de visao detalhada. Nao viram diretiva de regeneracao
// (noDirective): a LLM do modelo nao escreve visoes detalhadas, e regerar o
// modelo as preserva (ArtifactCommit.modelo).
function detailSections(data) {
  return data.detalhes.flatMap((d, i) => {
    const viewKey = `detalhes.${i}`;
    const extra = { tab: `det-${d.id}`, noDirective: true };
    const header = { key: viewKey, label: 'Visão', object: true, colsClass: 'ae-cols-scope', detailHeader: d.id, fields: [f('titulo', 'Título'), f('descricao', 'Descrição')], ...extra };
    if (d.tipo !== 'c4-component') return [header, ...containerSections(viewKey, extra)];
    return [
      header,
      {
        key: `${viewKey}.elementos`, label: 'Elementos', noun: 'elemento', idPrefix: 'EL', table: true,
        fields: [id(), f('nome', 'Nome'), f('tipo', 'Tipo', { type: 'select', options: TIPOS_COMPONENTE, initial: 'componente' }), f('tecnologia', 'Tecnologia'), f('descricao', 'Descrição', { long: true })],
        defaults: { fronteira: '' }, onRemove: removeRelationsOf(viewKey), ...extra,
      },
      { key: `${viewKey}.relacoes`, label: 'Relações', noun: 'relação', table: true, fields: relationFields(viewKey, true), ...extra },
    ];
  });
}
// Secoes que dependem dos dados (uma aba por visao detalhada). A secao
// sintetica "detalhes" (sem aba, nunca desenhada) so detecta criar/remover
// uma visao como alteracao.
const DYNAMIC = {
  modelo: (data) => [...detailSections(data), { key: 'detalhes', label: 'Visões detalhadas', noDirective: true }],
};

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
    // Nome e descricao lado a lado, com a mesma altura de uma linha (ae-cols-scope).
    // O botao do cartao cria um recorte do diagrama de conteineres (newDetail).
    { key: 'sistema', tab: 'contexto', label: 'Sistema em escopo', object: true, colsClass: 'ae-cols-scope', detailScope: true, fields: [f('nome', 'Nome'), f('descricao', 'Descrição')] },
    {
      key: 'contexto.elementos', tab: 'contexto', label: 'Pessoas e sistemas externos', changeLabel: 'Contexto — elementos', noun: 'elemento', idPrefix: 'EL', table: true,
      fields: [id(), f('nome', 'Nome'), f('tipo', 'Tipo', { type: 'select', options: TIPOS_CONTEXTO, initial: 'pessoa' }), f('descricao', 'Descrição', { long: true })],
      defaults: { tecnologia: '' }, onRemove: removeRelationsOf('contexto'), detail: DETAIL_CONTAINER,
    },
    {
      key: 'contexto.relacoes', tab: 'contexto', label: 'Relações', changeLabel: 'Contexto — relações', noun: 'relação', table: true,
      fields: relationFields('contexto', false), defaults: { tecnologia: '' },
    },
    ...containerSections('conteineres', { tab: 'conteineres' }, (what) => `Contêineres — ${what}`),
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
  return sections.filter((section) => !section.noDirective).map((section) => {
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
  // Secoes e abas que dependem dos dados (visoes detalhadas do modelo).
  const specAll = () => [...spec, ...(DYNAMIC[artifact]?.(data) ?? [])];
  const baseTabs = TABS[artifact] ?? null;
  const tabsNow = () => {
    if (!baseTabs || artifact !== 'modelo') return baseTabs;
    const detalhes = data.detalhes.map((d) => ({ id: `det-${d.id}`, label: detailLabel(data, d), preview: 'modelo_detalhe', detail: d.id }));
    return [...baseTabs.slice(0, -1), ...detalhes, baseTabs.at(-1)];
  };
  const tabs = baseTabs;
  let activeTab = tabs?.[0].id ?? null;
  const visible = () => (tabs ? specAll().filter((s) => s.tab === activeTab) : spec);
  // Diagramas de componente gerados pela LLM no lote: detalhar o conteiner
  // de um deles parte dele (newDetail). Carregados em segundo plano.
  let llmComponents = [];
  let removingDetail = null;
  let notice = '';
  if (artifact === 'modelo') loadLlmComponents();
  async function loadLlmComponents() {
    try {
      const nodes = await listProjectDir(projectId, 'artifacts', 'diagramas');
      const found = [];
      for (const node of nodes) {
        if (node.isDir || !node.name.endsWith('.json')) continue;
        try {
          const d = JSON.parse(await readProjectFile(projectId, 'artifacts', `diagramas/${node.name}`));
          if (d?.diagram_type === 'c4-component' && !d.derivado_do_modelo) found.push(d);
        } catch {
          // um diagrama ilegivel so nao serve de ponto de partida
        }
      }
      llmComponents = found;
      if (ae.isConnected && found.length) buildForm();
    } catch {
      llmComponents = [];
    }
  }

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
    return specAll().find((s) => s.key === parts.join('.'))?.fields?.find((fl) => fl.key === key);
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
    const head = cols.map((fl) => `<th${fl.long ? ' class="wide"' : ''}>${fl.label}</th>`).join('') + `<th class="ae-t-src">Fontes</th><th class="ae-t-act${section.detail ? ' has-detail' : ''}"></th>`;
    const rowHTML = (item, i) => {
      const p = `${section.key}.${i}`;
      const open = openSources.has(p);
      const fontes = item.fontes ?? [];
      const cells = cols.map((fl) => `<td>${control(`${p}.${fl.key}`, fl, item[fl.key])}</td>`).join('');
      const toggle = `<button type="button" class="ae-src-toggle${fontes.includes('gap') ? ' gap' : ''}" data-togglesrc="${p}" aria-expanded="${open}" title="${esc(fontes.join(', ') || 'Sem fontes')}">${fontes.length}</button>`;
      const remove = `<button type="button" class="ae-rm-row" data-rmrow="${p}" title="Remover ${section.noun}" aria-label="Remover ${section.noun}">${icon('trash', 14)}</button>`;
      const row = `<tr${item.id ? ` title="id: ${esc(item.id)}"` : ''}>${cells}<td class="ae-t-src">${toggle}</td><td class="ae-t-act">${detailButton(section, item, p)}${remove}</td></tr>`;
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
  // "Detalhar": cria a visao de nivel abaixo a partir da linha. Um conteiner
  // com diagrama de componentes gerado pela LLM avisa que parte dele.
  function detailButton(section, item, p) {
    if (!section.detail?.when(item)) return '';
    const gerado = section.detail.tipo === 'c4-component' && llmComponents.some((g) => sameName(g.escopo?.nome, item.nome));
    const title = gerado ? `Editar o diagrama de componentes gerado para ${item.nome || item.id}` : section.detail.title(item);
    return `<button type="button" class="ae-detail${gerado ? ' generated' : ''}" data-detail="${p}" title="${esc(title)}" aria-label="${esc(title)}">${icon('layers', 14)}</button>`;
  }
  // Cabecalho da aba de uma visao detalhada: de onde ela nasceu e o remover
  // (em dois passos — a visao some com tudo o que foi desenhado nela).
  function detailHeaderHTML(detailId) {
    const d = data.detalhes.find((x) => x.id === detailId);
    const origem = originOf(data, d);
    const nome = origem ? origem.nome || origem.id : `${d.origem?.nome || d.origem?.elemento} (inexistente)`;
    const remove = removingDetail === detailId
      ? `<span class="ae-detail-confirm">Remover esta visão? <button type="button" class="button secondary small" data-rmdetail-cancel>Manter</button><button type="button" class="button danger small" data-rmdetail-confirm="${esc(detailId)}">Remover</button></span>`
      : `<button type="button" class="button tertiary small" data-rmdetail="${esc(detailId)}">${icon('trash', 13)} Remover visão</button>`;
    return `<div class="ae-detail-head"><span class="ae-origin${origem ? '' : ' orphan'}">Detalha “${esc(nome)}” · ${esc(visaoLabel(data, d.origem?.visao))}</span>${remove}</div>`;
  }
  function sectionHTML(section) {
    if (section.table) return tableHTML(section);
    if (section.object) {
      const source = getIn(data, section.key);
      const head = section.detailHeader ? detailHeaderHTML(section.detailHeader) : '';
      const scope = section.detailScope
        ? `<button type="button" class="ae-add" data-detail="sistema" title="Um recorte do diagrama de contêineres — por exemplo, os contêineres de uma jornada">${icon('layers', 13)} Novo diagrama de contêineres</button>`
        : '';
      return `<section class="ae-sec" id="ae-s-${sidOf(section)}" data-sec="${sidOf(section)}"><h3>${section.label}</h3>${head}
        <div class="ae-card"><div class="ae-cols${section.colsClass ? ` ${section.colsClass}` : ''}">${fieldsHTML(section.key, section.fields, source)}</div><div><span class="ae-lbl">Fontes</span>${chips(`${section.key}.fontes`, source.fontes)}</div></div>${scope}</section>`;
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
  // Na tabela e no card do sistema em escopo o campo tem altura fixa de uma
  // linha (style.css, .ae-table / .ae-cols-scope).
  function autosize(el) {
    if (el.closest('.ae-table, .ae-cols-scope')) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }

  function path(pathStr) {
    const parts = pathStr.split('.');
    const last = parts.pop();
    return [parts.reduce((o, k) => o[k], data), last];
  }
  const dirtySections = () => specAll().filter((s) => !same(sectionData(data, s), sectionData(saved, s)));
  function sectionData(source, s) {
    return s.text ? [source[s.key], source[s.fontes]] : getIn(source, s.key);
  }
  const tabDirty = (tab) => dirtySections().some((s) => s.tab === tab);

  function refreshChrome() {
    const dirty = dirtySections();
    const keys = new Set(dirty.map((s) => s.key));
    const dot = '<i class="ae-dot" title="Alterada"></i>';
    $('.ae-nav').innerHTML = tabs
      ? tabsNow().map((t) => `<button type="button" role="tab" data-tab="${t.id}" aria-selected="${t.id === activeTab}">${t.label}${tabDirty(t.id) ? dot : ''}</button>`).join('')
      : spec.map((s) => `<button type="button" data-go="${s.key}">${s.label}${keys.has(s.key) ? dot : ''}</button>`).join('');
    const status = $('.ae-status');
    status.textContent = error || notice || (dirty.length ? `${dirty.length} ${dirty.length > 1 ? 'seções alteradas' : 'seção alterada'}${restored ? ' · rascunho restaurado' : ''}` : 'Nenhuma alteração');
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
      const tab = tabsNow()?.find((t) => t.id === activeTab);
      const html = await artifactPreview(tab?.preview ?? artifact, tab?.detail ? { ...data, detalhe_ativo: tab.detail } : data);
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
    notice = '';
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
      specAll().find((s) => s.key === listKey)?.onRemove?.(data, removed);
      return rebuild();
    }
    const detail = e.target.closest('[data-detail]');
    if (detail) return createDetail(detail.dataset.detail);
    const rmDetail = e.target.closest('[data-rmdetail]');
    if (rmDetail) {
      removingDetail = rmDetail.dataset.rmdetail;
      return rebuild();
    }
    if (e.target.closest('[data-rmdetail-cancel]')) {
      removingDetail = null;
      return rebuild();
    }
    const rmConfirm = e.target.closest('[data-rmdetail-confirm]');
    if (rmConfirm) return removeDetail(rmConfirm.dataset.rmdetailConfirm);
    const add = e.target.closest('[data-add]');
    if (add) {
      const section = specAll().find((s) => sidOf(s) === add.dataset.add);
      const list = getIn(data, section.key);
      const item = blankItem(section, list, data);
      if (add.dataset.group !== undefined) Object.assign(item, section.groupBy.defaults(add.dataset.group), { [section.groupBy.field]: add.dataset.group });
      list.push(item);
      const p = `${section.key}.${list.length - 1}.`;
      rebuild(`textarea[data-path^="${p}"]:not([readonly]), select[data-path^="${p}"]`);
    }
  });
  // `where`: "sistema" (cartao do sistema em escopo) ou "<lista>.<indice>"
  // (linha de uma tabela de elementos com `detail`).
  function createDetail(where) {
    let item;
    let viewKey;
    let tipo;
    if (where === 'sistema') {
      item = { id: 'sistema', nome: data.sistema?.nome ?? '', tipo: 'sistema' };
      viewKey = 'contexto';
      tipo = 'c4-container';
    } else {
      const listKey = where.split('.').slice(0, -1).join('.');
      const section = specAll().find((s) => s.key === listKey);
      item = getIn(data, where);
      viewKey = listKey.split('.').slice(0, -1).join('.');
      tipo = section.detail.tipo;
    }
    const { detail, adopted } = newDetail(data, tipo, viewKey, item, llmComponents);
    data.detalhes.push(detail);
    notice = adopted ? `Visão criada a partir de “${adopted}” — ao salvar, ela substitui o diagrama gerado.` : '';
    activeTab = `det-${detail.id}`;
    openSources.clear();
    formEl.scrollTop = 0;
    rebuild(`textarea[data-path="detalhes.${data.detalhes.length - 1}.titulo"]`);
    renderPreview();
  }
  // Remover uma visao nao apaga as que nasceram dela: elas ficam orfas (com
  // aviso), como quando o elemento de origem some.
  function removeDetail(detailId) {
    const i = data.detalhes.findIndex((d) => d.id === detailId);
    const origem = data.detalhes[i]?.origem?.visao;
    if (i >= 0) data.detalhes.splice(i, 1);
    removingDetail = null;
    notice = '';
    openSources.clear();
    // Volta para a aba de onde a visao nasceu, se ela ainda existir.
    const back = origem === 'contexto' || origem === 'conteineres' ? origem : `det-${origem}`;
    activeTab = tabsNow().some((t) => t.id === back) ? back : 'conteineres';
    rebuild();
    renderPreview();
  }
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
      removingDetail = null;
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
