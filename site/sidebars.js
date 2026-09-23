const sidebars = {
  mainSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Primeiros passos',
      collapsed: false,
      items: [
        'primeiros-passos/instalacao',
        'primeiros-passos/primeiro-work-item',
      ],
    },
    {
      type: 'category',
      label: 'Funcionalidades',
      collapsed: false,
      items: [
        'funcionalidades/work-items',
        'funcionalidades/fontes-e-wiki',
        'funcionalidades/artefatos',
        'funcionalidades/revisao-e-rastreabilidade',
        'funcionalidades/logs-e-exportacao',
      ],
    },
    {
      type: 'category',
      label: 'Referência',
      items: [
        'referencia/pipelines',
        'referencia/dados-locais',
        'referencia/desenvolvimento',
      ],
    },
  ],
};

export default sidebars;
