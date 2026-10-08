<p align="center">
  <img src="assets/SENPAI_REFINER_Senpai_Kohai_Brand_Kit/01_Logo_Principal/SENPAI_REFINER_Senpai_Kohai_Transparent.png" alt="Senpai Refiner" width="420">
</p>

# Senpai Refiner

Aplicação desktop para transformar documentos de negócio e engenharia em uma wiki rastreável e em artefatos estruturados de Discovery e Delivery.

O Senpai organiza o trabalho por **Oportunidade**, **Feature** ou **História**, usa LLM para extrair e sintetizar conhecimento e mantém o usuário no controle por meio de revisão antes da publicação dos artefatos.

**Discovery** (Oportunidade) explora uma oportunidade nova, do zero. **Delivery** (Feature/enabler ou História) é o nível de **continuidade**: tipicamente detalha a evolução de um sistema que já existe em produção, não uma iniciativa greenfield — por isso seus artefatos finais classificam cada regra, entidade ou dependência como `as_is` (já existe), `modificado`, `novo` ou `removido` em vez de assumir que tudo é novo.

## Principais recursos

- Ingestão de fontes em `.txt`, `.md`, `.json`, `.yml`, `.yaml`, `.sql`, `.feature` e `.pdf` — os cinco primeiros formatos plain-text cobrem contratos, schemas de dados, configuração e cenários já implementados de um sistema existente, comuns em Delivery.
- Cada fonte ingerida é classificada quanto à `natureza`: descreve o sistema atual, um pedido novo, ou ambos — visível na página da fonte e no índice da wiki, e usada pelos artefatos gerados para distinguir o que já existe do que é novo.
- Wiki incremental organizada em fontes, entidades, conceitos e respostas arquivadas.
- Consulta e verificação de consistência da wiki com apoio de LLM.
- Geração guiada de brief, requisitos, ADRs, DER, modelo arquitetural, diagramas, features de negócio, enablers e histórias.
- Modelo arquitetural revisável e editável: os diagramas C4 de contexto e de contêiner são desenhados a partir dele, sem nova chamada ao LLM.
- Revisão dos artefatos, solicitação de alterações e aprovação antes da gravação, inclusive após reiniciar o app ou atualizar a definição do pipeline.
- Rastreabilidade por fonte, incluindo marcações explícitas de `gap` e `inferência`.
- Diagramas Mermaid renderizados também fora do aplicativo, sem dependência de rede.
- JSON estruturado como contexto semântico dos LLMs e HTML como apresentação no frontend.
- Métricas de tokens, cache e custo quando disponibilizadas pelo backend.
- Persistência de logs de execução, prompts e respostas para auditoria local.
- Exportação da wiki, dos artefatos completos ou de documentos individuais.

## Como funciona

1. Crie um work-item como Oportunidade, Feature ou História.
2. Adicione os documentos de origem na aba **Fontes**.
3. Faça a ingestão das fontes para construir a wiki do work-item.
4. Consulte ou verifique a wiki na aba **Wiki**.
5. Gere os artefatos disponíveis na ordem indicada pela interface.
6. Revise, aprove ou solicite alterações antes de persistir cada artefato.
7. Exporte o resultado quando estiver pronto.

### Artefatos por tipo de work-item

| Tipo | Pipeline |
| --- | --- |
| Oportunidade | Brief → Atributos de qualidade → Requisitos → ADRs → DER / Modelo arquitetural → Diagramas → Backlog da solução (features e enablers) → Dependências → Histórias |
| Feature | Brief → Requisitos → ADRs → DER / Modelo arquitetural → Diagramas → Detalhamento da feature ou enabler → Histórias |
| História | Brief → Requisitos → ADRs → DER / Modelo arquitetural → Diagramas → Detalhamento da história |
| Comitê de Arquitetura (WAR) | Demanda → RFCs → ADRs do comitê → Artefatos executáveis → Métricas |

Em ambos os níveis a sequência é totalmente encadeada: cada artefato exige que seu predecessor direto já exista (brief antes de requisitos, requisitos antes de ADR, ADR antes de DER e do modelo arquitetural, modelo antes dos diagramas, e assim até o detalhamento final). A interface bloqueia a geração e indica qual predecessor falta antes de cada etapa.

Como Delivery normalmente parte de um sistema existente, o brief e os requisitos devem descrever o que já existe hoje (comportamento, entidades, integrações) sempre que as fontes sustentarem isso — não apenas o que está sendo adicionado. Essa distinção alimenta o campo `mudanca` do detalhamento final e do DER.

O **Comitê de Arquitetura (WAR)** tem fontes de outra natureza: as transcrições das reuniões do comitê. Os artefatos seguem a metodologia de governança do comitê. Cada ADR traz o nível de força (`DEVE`/`DEVERIA`/`PODE`) e um mecanismo de conformidade concreto, e cada ADR aprovada precisa de pelo menos um artefato executável que a materialize. Cada aprovação também atualiza um export em Markdown com frontmatter (`artifacts/export/comite-arquitetura/`), que o botão **Exportar Markdown** copia para o repositório de documentação do comitê.

No backlog da solução, uma `feature_negocio` representa valor percebido diretamente por usuário ou stakeholder. Um `enabler` representa trabalho de exploração, arquitetura, infraestrutura ou conformidade que habilita entregas próximas. Ambos ocupam o mesmo nível e usam o mesmo mapa de dependências; histórias podem ser classificadas como `historia_usuario`, `historia_habilitadora` ou `spike`.

## Arquitetura

```mermaid
flowchart LR
    UI[Frontend<br>Vite + JavaScript] --> APP[Aplicação desktop<br>Go + Wails]
    APP --> BRIDGE[mhl bridge<br>MCP local]
    BRIDGE --> WF[Workflows MHL<br>Wiki · Discovery · Delivery · Comitê]
    WF --> LLM[Devin CLI]
    WF --> DATA[(Dados locais<br>raw · wiki · artifacts · logs)]
    DATA --> APP
```

Em produção, o backend de LLM suportado é o **Devin CLI**. O código contém adaptadores auxiliares para outros agentes usados no desenvolvimento, mas eles não são dependências obrigatórias do produto.

O ledger registra custo em dólar com procedência explícita. Se a execução
informar `total_cost_usd`, esse valor prevalece; caso contrário, o Senpai usa
as tarifas de entrada, cache e saída publicadas para o modelo selecionado por
`devin models list --format json`. Sem nenhuma das duas fontes, a interface
mostra **sem estimativa** em vez de tratar a ausência como custo zero.

Cada tipo de resposta estruturada possui um contrato em JSON Schema. O adaptador normaliza a saída e o workflow faz o parse do JSON antes da renderização. Cada artefato novo é persistido em duas representações:

```text
artifacts/
├── requisitos.json   # fonte semântica usada como contexto pelos LLMs
└── requisitos.html   # documento apresentado no frontend e exportável
```

Projetos antigos que possuem somente HTML continuam funcionando; o leitor de contexto usa HTML como fallback até que o artefato seja regenerado.

## Estrutura do repositório

```text
.
├── app/                  # aplicação Go/Wails
│   ├── frontend/         # interface Vite em JavaScript
│   ├── mhlbridge/        # cliente e ciclo de vida do servidor MCP local
│   └── embedded/         # runtime MHL, workflows e assets embarcados
├── workflows/            # workflows MHL usados em desenvolvimento
│   ├── wiki/             # ingestão, consulta, lint e HTML estático
│   ├── discovery/        # pipeline de Oportunidade
│   ├── delivery/         # pipelines de Feature e História
│   ├── comite/           # pipeline do Comitê de Arquitetura (WAR) e export Markdown
│   └── shared/           # agentes, schemas, renderização e utilitários
├── scripts/              # verificação de ambiente e builds
└── assets/               # identidade visual e fontes de demonstração
```

## Pré-requisitos

Para executar e desenvolver o projeto:

- Go `1.26` ou compatível com [app/go.mod](app/go.mod).
- Node.js e npm.
- Wails v2 CLI compatível com a versão do módulo Go.
- Devin CLI instalado e autenticado.
- MHL CLI para alterar, validar ou testar os workflows.

Instale o Wails usado pelo projeto:

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0
```

Valide o restante do ambiente a partir da raiz:

```bash
./scripts/check-devin-environment.sh
```

Se necessário, autentique o Devin:

```bash
devin auth login --force-manual-token-flow
```

## Desenvolvimento local

Instale as dependências do frontend:

```bash
cd app/frontend
npm install
```

Inicie o aplicativo com hot reload:

```bash
cd app
wails dev
```

Durante o desenvolvimento, a aplicação prefere a árvore `workflows/` do checkout. O runtime MHL é embarcado no binário. Caso a versão local do MHL seja atualizada, sincronize o runtime da plataforma atual:

```bash
cd app
bash embedded/sync-dev-mhl.sh
```

## Validação

Depois de alterar os workflows, execute na raiz:

```bash
mhl lint workflows
mhl test workflows
```

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

## Build

Para um build Wails da plataforma atual:

```bash
cd app
wails build
```

O script abaixo executa o ciclo completo usado no ambiente de desenvolvimento principal: testa e compila o runtime MHL, atualiza os recursos embarcados e gera o bundle do Senpai.

```bash
./scripts/build-all.sh --release
```

Esse script espera o código-fonte do runtime MHL em `MHL_RUNTIME_DIR` e permite configurar o executável do Wails com `WAILS`.

Para gerar o executável Windows x64:

```bash
./scripts/build-windows.sh
```

Detalhes sobre os binários e workflows embarcados estão em [app/embedded/README.md](app/embedded/README.md).

## Dados locais

Por padrão, o Senpai usa o diretório de configuração do usuário:

| Sistema | Diretório base |
| --- | --- |
| macOS | `~/Library/Application Support/senpai` |
| Windows | `%AppData%\senpai` |
| Linux | `$XDG_CONFIG_HOME/senpai` ou `~/.config/senpai` |

A variável `SENPAI_APPDATA_DIR` substitui esse diretório, sendo útil principalmente para testes e ambientes isolados.

Estrutura principal em disco:

```text
senpai/
├── settings.json
├── logs/app.log
├── state/
└── data/projects/<project_id>/
    ├── project.json
    ├── raw/
    ├── wiki/
    ├── artifacts/
    ├── usage.jsonl
    ├── prompt_log.jsonl
    └── run_logs/
```

Os prompts, respostas e documentos de origem podem conter informações sensíveis. Proteja o diretório de dados e não inclua segredos nas fontes ou instruções enviadas aos agentes.

## Convenções para contribuições

- Execute comandos gerais na raiz; comandos Go/Wails devem rodar em `app/`.
- Mantenha todo acesso em `projects/` restrito ao `project_id` recebido.
- Não grave segredos no repositório, em prompts ou em argumentos de linha de comando.
- Ao alterar `workflows/`, sincronize a cópia em `app/embedded/workflows/` antes de preparar uma release.
- Preserve o Devin como backend obrigatório de produção.

As instruções completas para agentes e contribuidores automatizados estão em [AGENTS.md](AGENTS.md).
