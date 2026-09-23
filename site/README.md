# Site de documentação do Senpai

Site Docusaurus com a documentação funcional e técnica do Senpai Refiner.

## Executar localmente

Use Node.js 20 ou superior:

```bash
cd site
npm install
npm run start
```

O servidor de desenvolvimento abre a documentação em `http://localhost:3000`.

## Validar o build

```bash
cd site
npm run build
npm run serve
```

O conteúdo estático gerado fica em `site/build/`.

Para publicar fora da raiz do domínio, configure a URL e o caminho base antes do build:

```bash
SITE_URL=https://exemplo.com BASE_URL=/senpai/ npm run build
```

## Onde editar

- `docs/`: conteúdo da documentação.
- `src/components/ProductTour/`: simulações visuais do aplicativo.
- `src/pages/index.jsx`: home.
- `src/css/custom.css`: identidade visual global.
- `docusaurus.config.js`: navegação e configuração do Docusaurus.

As simulações são componentes HTML/CSS responsivos. Elas não acessam dados reais nem executam ações no aplicativo.
