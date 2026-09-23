import {themes as prismThemes} from 'prism-react-renderer';

const config = {
  title: 'Senpai',
  tagline: 'Refine contexto. Decida melhor. Entregue com clareza.',
  favicon: '/img/senpai-symbol.png',

  url: process.env.SITE_URL || 'http://localhost:3000',
  baseUrl: process.env.BASE_URL || '/',
  trailingSlash: false,
  onBrokenLinks: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'pt-BR',
    locales: ['pt-BR'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.js',
          routeBasePath: 'docs',
          breadcrumbs: true,
          showLastUpdateTime: false,
          showLastUpdateAuthor: false,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      },
    ],
  ],

  themeConfig: {
    image: 'img/senpai-social.jpg',
    metadata: [
      {name: 'theme-color', content: '#000000'},
      {
        name: 'description',
        content: 'Documentação do Senpai Refiner para transformar contexto em artefatos rastreáveis de Discovery e Delivery.',
      },
    ],
    colorMode: {
      defaultMode: 'dark',
      disableSwitch: false,
      respectPrefersColorScheme: false,
    },
    navbar: {
      title: 'SENPAI',
      hideOnScroll: true,
      logo: {
        alt: 'Símbolo Senpai',
        src: 'img/senpai-symbol.png',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'mainSidebar',
          position: 'left',
          label: 'Documentação',
        },
        {
          href: 'https://github.com/yanjustino/proj-poc',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Senpai',
          items: [
            {label: 'Visão geral', to: '/docs/intro'},
            {label: 'Instalação', to: '/docs/primeiros-passos/instalacao'},
            {label: 'Primeiro work-item', to: '/docs/primeiros-passos/primeiro-work-item'},
          ],
        },
        {
          title: 'Referência',
          items: [
            {label: 'Pipelines de artefatos', to: '/docs/referencia/pipelines'},
            {label: 'Dados locais', to: '/docs/referencia/dados-locais'},
          ],
        },
      ],
      copyright: `Senpai Refiner · documentação ${new Date().getFullYear()}`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'powershell'],
    },
  },
};

export default config;
