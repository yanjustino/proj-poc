---
sidebar_position: 3
title: Desenvolvimento e validação
description: Comandos de desenvolvimento, testes e manutenção da documentação.
---

# Desenvolvimento e validação

Execute comandos gerais a partir da raiz do repositório. Comandos Go e Wails devem ser executados em `app/`.

## Aplicação

Depois de alterar o backend Go/Wails:

```bash
cd app
go test ./...
go vet ./...
```

Depois de alterar o frontend:

```bash
cd app/frontend
npm run lint
npm run build
```

## Workflows

Depois de alterar arquivos em `workflows/`, valide na raiz:

```bash
mhl lint workflows
mhl test workflows
```

Para atualizar a cópia de desenvolvimento embarcada:

```bash
cd app
bash embedded/sync-dev-mhl.sh
```

O backend obrigatório de produção deve continuar sendo Devin. Adaptadores auxiliares não devem se tornar dependências obrigatórias do aplicativo.

## Site de documentação

O site usa Docusaurus e requer Node.js 20 ou superior:

```bash
cd site
npm install
npm run start
```

Antes de publicar:

```bash
cd site
npm run build
npm run serve
```

O build estático é criado em `site/build/`.

## Atualizações de conteúdo

- Atualize `docs/referencia/pipelines.md` quando as dependências dos workflows mudarem.
- Atualize as simulações em `src/components/ProductTour/` quando a navegação principal mudar.
- Não use dados reais de clientes nas telas simuladas.
- Prefira exemplos que demonstrem estados: pendente, gerando, pronto e em revisão.
