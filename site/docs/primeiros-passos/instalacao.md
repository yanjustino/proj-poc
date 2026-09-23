---
sidebar_position: 1
title: Instalação
description: Prepare o ambiente e execute o Senpai localmente.
---

# Instalação

O Senpai é uma aplicação desktop Go/Wails. O backend de LLM suportado em produção é o **Devin CLI**, executado localmente pelo runtime MHL embarcado.

## Usar um build fornecido pela equipe

Se você recebeu um pacote pronto:

- **macOS:** mova `senpai-app.app` para Aplicativos e abra o bundle.
- **Windows:** mantenha o executável e seus arquivos distribuídos juntos e execute `senpai-app.exe`.

O primeiro início valida o runtime local. Antes de gerar conteúdo, confirme que o Devin CLI está instalado e autenticado.

## Executar a partir do código-fonte

### 1. Pré-requisitos

Instale:

- Go compatível com a versão declarada em `app/go.mod` — atualmente Go 1.26;
- Node.js 20 ou superior e npm;
- Wails CLI v2.16.0;
- Devin CLI instalado e autenticado;
- MHL CLI disponível no `PATH` para validar ou alterar workflows.

Instale a versão do Wails usada pelo projeto:

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0
```

### 2. Autentique o Devin CLI

```bash
devin auth login --force-manual-token-flow
devin auth status
```

Nunca salve tokens no repositório, em prompts ou em argumentos de scripts.

### 3. Valide o ambiente

Na raiz do repositório:

```bash
./scripts/check-devin-environment.sh
```

O verificador confirma a presença de `devin`, `mhl`, `go` e `npm`, além do estado de autenticação do Devin.

### 4. Instale o frontend

```bash
cd app/frontend
npm install
```

### 5. Inicie em modo de desenvolvimento

```bash
cd app
wails dev
```

O Wails inicia o frontend com hot reload e o processo Go que gerencia o bridge local.

## Gerar um executável

Para a plataforma atual:

```bash
cd app
wails build
```

O resultado fica em `app/build/bin/`.

Para o fluxo completo de release usado pelo repositório:

```bash
./scripts/build-all.sh --release
```

Esse script também recompila e sincroniza o runtime MHL. Ele exige que `MHL_RUNTIME_DIR` aponte para o checkout do runtime e aceita `WAILS` para definir o caminho do executável Wails.

Para Windows x64:

```bash
./scripts/build-windows.sh
```

Em uma máquina macOS ou Linux, o build cruzado para Windows também exige `x86_64-w64-mingw32-gcc` e um runtime MHL Windows já preparado em `app/embedded/bin/`.

## Solução rápida de problemas

| Sintoma | Verificação |
| --- | --- |
| “MCP indisponível” | Use **Reconectar** na barra lateral e confira `mhl` no `PATH`. |
| Falha ao gerar | Rode `devin auth status` e autentique novamente se necessário. |
| Frontend não abre | Rode `npm install` em `app/frontend/` e reinicie `wails dev`. |
| Workflow local não mudou | Em `app/`, execute `bash embedded/sync-dev-mhl.sh`. |

:::note Dados e privacidade
Documentos, prompts e respostas ficam no diretório local de dados do usuário. Trate esse diretório como informação potencialmente sensível.
:::
