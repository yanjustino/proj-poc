---
sidebar_position: 2
title: Dados locais
description: Saiba onde o Senpai armazena projetos, artefatos, métricas e logs.
---

# Dados locais

Por padrão, o Senpai usa o diretório de configuração do usuário:

| Sistema | Diretório base |
| --- | --- |
| macOS | `~/Library/Application Support/senpai` |
| Windows | `%AppData%\senpai` |
| Linux | `$XDG_CONFIG_HOME/senpai` ou `~/.config/senpai` |

Defina `SENPAI_APPDATA_DIR` para usar outro diretório, por exemplo em testes locais isolados.

## Estrutura

```text
senpai/
├── settings.json
├── logs/
│   └── app.log
├── state/
└── data/
    └── projects/
        └── <project_id>/
            ├── project.json
            ├── raw/
            ├── wiki/
            ├── artifacts/
            ├── usage.jsonl
            ├── prompt_log.jsonl
            └── run_logs/
```

## Artefatos JSON e HTML

Um artefato novo possui duas representações com o mesmo nome base:

```text
artifacts/
├── requisitos.json
└── requisitos.html
```

- O **JSON** preserva a estrutura semântica usada como contexto em outras gerações.
- O **HTML** é usado na apresentação do frontend e na exportação para leitura.

Artefatos legados que possuem apenas HTML continuam válidos; o carregador usa o HTML como fallback.

## Backup

Feche o aplicativo antes de copiar o diretório. Preserve a estrutura completa para manter relações entre metadados, wiki, artefatos e logs.

:::danger Segurança
O diretório pode conter documentos enviados, prompts, respostas e dados derivados. Aplique as mesmas regras de acesso e retenção usadas para as fontes originais.
:::
