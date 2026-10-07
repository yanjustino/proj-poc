// SOURCE_KINDS: the "o que você quer trazer?" catalog behind the Fontes tab's
// picker (add-source-picker.js). Each kind teaches what that kind of source
// contributes to the wiki and how to prepare it, and says which ways of
// adding it make sense:
//   files — native picker filtered to `extensions` (AddRawFile)
//   paste — text modal (AddRawText, always saved as .md)
//   url   — web page download (AddRawURL)
//
// `extensions` must stay a subset of what RawExtract accepts
// (workflows/shared/wiki/raw_extract.mh: plain_text_extensions + .pdf) —
// a file the picker offers but the ingest rejects only fails later, mid-run.
const CODE_EXTENSIONS = [
  '.py', '.go', '.cs', '.java', '.kt', '.js', '.jsx', '.ts', '.tsx', '.rb', '.php', '.rs',
  '.swift', '.c', '.h', '.cpp', '.hpp', '.sh', '.xml', '.proto', '.graphql', '.tf',
];

export const SOURCE_KINDS = [
  {
    id: 'code',
    icon: 'code',
    label: 'Código',
    wish: 'Quero inserir um código',
    teaser: 'Arquivos de código ou um trecho colado.',
    why: 'O código é a fonte de verdade do comportamento real: regras de negócio, contratos e nomes do domínio aparecem ali antes de aparecer em qualquer documento.',
    tips: [
      'Prefira os arquivos que definem o domínio (modelos, serviços, contratos), não o projeto inteiro.',
      'Um arquivo por fonte deixa a wiki citar cada um com precisão.',
      'Remova segredos (chaves, senhas, connection strings) antes de enviar.',
    ],
    extensions: CODE_EXTENSIONS,
    actions: ['files', 'paste'],
    paste: {
      heading: 'Colar trecho de código',
      titlePlaceholder: 'Ex.: Cálculo de juros do contrato',
      contentPlaceholder: 'Cole o código aqui',
      language: true,
      hint: 'O trecho é salvo como Markdown dentro de um bloco de código, preservando a indentação.',
    },
  },
  {
    id: 'transcript',
    icon: 'mic',
    label: 'Transcrição',
    wish: 'Quero inserir uma transcrição',
    teaser: 'Reuniões, entrevistas, conversas com o cliente.',
    why: 'Transcrições guardam o "porquê" que ninguém escreve: dúvidas, decisões tomadas de boca e a linguagem que as pessoas de negócio realmente usam.',
    tips: [
      'Mantenha o nome de quem fala em cada trecho — ajuda a separar pedido de opinião.',
      'Corte conversa fiada e trechos fora de pauta; ruído vira custo de tokens.',
      'Legendas .vtt/.srt: salve como .txt antes de enviar.',
    ],
    extensions: ['.txt', '.md'],
    actions: ['paste', 'files'],
    paste: {
      heading: 'Colar transcrição',
      titlePlaceholder: 'Ex.: Entrevista com o time de cobrança — 12/09',
      contentPlaceholder: 'Ana: Hoje o boleto vence no dia 10...\nBruno: E quando cai em feriado?',
      preface: '> Tipo de fonte: transcrição (reunião/entrevista).\n\n',
      hint: 'Dica: um parágrafo por fala, com o nome de quem fala no início.',
    },
  },
  {
    id: 'pdf',
    icon: 'book',
    label: 'PDF',
    wish: 'Quero inserir um PDF',
    teaser: 'Normas, contratos, manuais, especificações.',
    why: 'PDFs costumam carregar o material formal: regulamentos, contratos e especificações que definem o que o sistema é obrigado a fazer.',
    tips: [
      'O texto é extraído do PDF — PDFs escaneados (só imagem) chegam vazios.',
      'Documentos muito longos custam mais: envie só os capítulos relevantes, se puder.',
      'Tabelas complexas podem perder a formatação na extração.',
    ],
    extensions: ['.pdf'],
    actions: ['files'],
  },
  {
    id: 'web',
    icon: 'globe',
    label: 'Página web',
    wish: 'Quero inserir uma página web',
    teaser: 'Documentação online, artigos, wikis públicas.',
    why: 'Boa parte do contexto mora na web: documentação de APIs, guias de produto e artigos que explicam o domínio.',
    tips: [
      'A página é baixada e convertida em texto no momento do envio — é uma foto, não um link vivo.',
      'Páginas que exigem login ou só carregam via JavaScript não funcionam.',
      'Prefira o link da seção específica em vez da página inicial do site.',
    ],
    extensions: [],
    actions: ['url'],
  },
  {
    id: 'markdown',
    icon: 'hash',
    label: 'Markdown',
    wish: 'Quero inserir um Markdown',
    teaser: 'READMEs, ADRs, notas técnicas.',
    why: 'Markdown já chega estruturado: títulos e listas ajudam a wiki a separar conceitos e decisões com menos interpretação.',
    tips: [
      'READMEs e ADRs são ótimos pontos de partida para um projeto existente.',
      'Imagens e links relativos não são seguidos — só o texto entra.',
    ],
    extensions: ['.md'],
    actions: ['files', 'paste'],
    paste: {
      heading: 'Escrever em Markdown',
      titlePlaceholder: 'Ex.: ADR 004 — Fila de cobrança',
      contentPlaceholder: '# Contexto\n\n...\n\n## Decisão\n\n...',
    },
  },
  {
    id: 'spec',
    icon: 'database',
    label: 'Dados e contratos',
    wish: 'Quero inserir um esquema ou contrato',
    teaser: 'OpenAPI, JSON Schema, SQL, cenários .feature.',
    why: 'Esquemas e contratos dizem exatamente quais dados existem e como os sistemas conversam — a wiki ganha precisão de campos, tipos e cenários.',
    tips: [
      'OpenAPI/Swagger (.yml/.json) e DDL (.sql) rendem páginas de entidades bem detalhadas.',
      'Arquivos .feature (Gherkin) viram exemplos concretos de regras de negócio.',
      'Evite dumps de dados reais — envie a estrutura, não os registros.',
    ],
    extensions: ['.json', '.yml', '.yaml', '.sql', '.feature', '.proto', '.graphql', '.xml'],
    actions: ['files'],
  },
  {
    id: 'note',
    icon: 'edit',
    label: 'Anotação livre',
    wish: 'Quero escrever uma anotação',
    teaser: 'Atas, decisões, conhecimento que só está na sua cabeça.',
    why: 'Nem tudo está escrito em algum lugar. Uma anotação rápida registra premissas, restrições e decisões antes que se percam.',
    tips: [
      'Escreva como explicaria para alguém novo no time.',
      'Diga o que é fato e o que é hipótese — a wiki preserva essa diferença.',
    ],
    extensions: [],
    actions: ['paste'],
    paste: {
      heading: 'Nova anotação',
      titlePlaceholder: 'Ex.: Ata da reunião de alinhamento',
      contentPlaceholder: 'Escreva ou cole o texto (Markdown ou texto puro)',
    },
  },
];

export function sourceKind(id) {
  return SOURCE_KINDS.find((kind) => kind.id === id) ?? null;
}

// kindOfFile: best-effort kind for an existing raw/ file, by extension —
// only drives the icon on the Fontes cards/table. Pasted text is always .md,
// so a pasted transcript or note shows as Markdown; that's fine.
export function kindOfFile(name) {
  const lower = name.toLowerCase();
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.')) : '';
  if (ext === '.pdf') return sourceKind('pdf');
  if (ext === '.md') return sourceKind('markdown');
  if (ext === '.txt') return sourceKind('transcript');
  if (sourceKind('spec').extensions.includes(ext)) return sourceKind('spec');
  if (CODE_EXTENSIONS.includes(ext)) return sourceKind('code');
  return null;
}

export function filePattern(kind) {
  return kind.extensions.map((ext) => `*${ext}`).join(';');
}
