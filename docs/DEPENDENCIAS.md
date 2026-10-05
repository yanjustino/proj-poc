# Senpai — Solicitação de liberação de pacotes no Artifactory

Projeto: Senpai (aplicativo desktop em Go + Wails, frontend em JavaScript/Vite)
Data: 2026-10-05

## Pacotes solicitados

As dependências transitivas são resolvidas pelos repositórios remotos do Artifactory a partir dos lockfiles versionados (`app/go.sum` e `app/frontend/package-lock.json`).

### Go (repositório remoto Go → proxy.golang.org)

| Pacote | Versão | Licença | Uso |
| --- | --- | --- | --- |
| `github.com/wailsapp/wails/v2` | v2.15.0 | MIT | Framework do app desktop e CLI de build (`wails`) |
| `github.com/google/uuid` | v1.6.0 | BSD-3-Clause | Geração de identificadores |
| `golang.org/x/net` | v0.59.0 | BSD-3-Clause | Biblioteca de rede da equipe Go |

### npm (repositório remoto npm → registry.npmjs.org)

| Pacote | Versão | Licença | Uso |
| --- | --- | --- | --- |
| `vite` | 7.3.6 | MIT | Build do frontend |
| `marked` | 18.0.13 | MIT | Renderização de Markdown |
| `mermaid` | 12.0.0 | MIT | Renderização de diagramas |

## Ferramentas de build

- Go 1.26
- Node.js 22 LTS
