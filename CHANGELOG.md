# Changelog

Todas as mudanças relevantes do Senpai são registradas neste arquivo.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Como o projeto ainda não tem versões publicadas, as entradas estão agrupadas por data.

## [Não lançado]

### 2026-10-05

#### Adicionado
- Artefato **Modelo arquitetural** (`modelo`), entre as ADRs e os diagramas, em Discovery e Delivery: os diagramas C4 de contexto e de contêiner descritos como dados (elementos e relações próprios de cada um), revisados em tabelas antes dos demais diagramas (`workflows/shared/artifacts/arch_model.mh`).
- Edição manual do modelo no editor guiado (`ArtifactSave`), com uma aba por diagrama (Contexto, Contêineres, Lacunas), tabelas por linha e prévia da visão da aba: ao salvar, os diagramas de contexto e de contêiner são redesenhados na hora, sem LLM, e o lote de diagramas é reanotado.

#### Alterado
- Os diagramas C4 de contexto e de contêiner passam a vir do modelo aprovado, desenhados por código; nomes divergentes entre os dois níveis viram aviso. A geração de diagramas passa a exigir o modelo e produz só os tipos opcionais (componente, implantação, fluxos, sequência, estado), com o modelo como vocabulário fixo.
- O diagrama de contêiner aceita mais de uma fronteira de sistema de software (`fronteiras` e `fronteira` por elemento), com um subgrafo por fronteira e avisos para contêiner fora de fronteira e fronteira vazia; no editor do modelo, cada fronteira tem sua própria tabela de elementos.
- A autorrevisão dos diagramas ignora os avisos de regra C4 das visões derivadas, que só o modelo pode corrigir.

### 2026-10-04

#### Adicionado
- Modal para registrar páginas web como fonte: o backend (`AddRawURL`) baixa o HTML e converte para Markdown mantendo só o conteúdo principal; PDFs são salvos como estão.
- Controles de zoom no app (ampliar, reduzir, restaurar), com atalhos de teclado no estilo do VS Code e nível persistido localmente.
- Combobox pesquisável para a seleção de modelo no shell.
- `enhanceComposer` e `sendButtonHtml` para padronizar o composer nas abas de artefatos e wiki.
- Binários de distribuição para macOS (`.app` assinado), Linux amd64, Linux amd64 RHEL, Linux arm64 e Windows amd64.

#### Alterado
- `app/embedded/sync.sh` e os scripts de build de macOS, Linux e Windows foram ampliados.
- A aba de artefatos passa a sinalizar features de história desatualizadas.

### 2026-10-03

#### Adicionado
- `LocalProjects`, que lista os work-items diretamente de `<dataDir>/projects`.
- Ação `commit_concept` na wiki, com schema e prompt próprios, para criar páginas de conceito a partir dos conceitos ausentes apontados pelo lint.
- Paginação, ordenação e filtros nas listas da wiki.
- Opção para exibir os logs de sincronização automática na aba de logs.

#### Alterado
- Abas de artefatos e logs compartilham os mesmos rótulos de artefato; os títulos das execuções trazem o nome do artefato e mais metadados.
- Metadados de execução gravam apenas as informações essenciais.

### 2026-10-02

#### Adicionado
- Roadmap de features e schemas para detalhar itens de backlog.
- Suporte a builds Linux ARM64 e Dockerfile para builds em RHEL, com `mhl` e `pdftotext` embarcados para essas plataformas.
- Regras de tamanho de texto nos prompts e schemas de diagramas C4, e corte de texto (`clip`) que não quebra palavras.

#### Alterado
- Exportação e importação de projetos preservam a data de modificação dos arquivos.
- Lint e alertas da wiki distinguem contradições pendentes de claims resolvidas ou substituídas, inclusive no HTML exportado.

#### Corrigido
- Alertas de revisão da wiki não se perdem mais ao ingerir novos fatos.

#### Removido
- Binários e arquivos de aplicação obsoletos.

### 2026-10-01

#### Adicionado
- Workflow `ArtifactFlow` para gerar e aprovar artefatos.
- Artefatos e workflows de discovery (`DiscoveryKinds`, `DiscoveryDrafts`, `DiscoveryCommits`) e módulos compartilhados de rascunho e commit de artefatos.
- Editor de artefatos (briefs, atributos, requisitos) que esconde o JSON e o HTML, com workflow de salvamento (`artifact_save.mh`) que mantém os dois consistentes.
- Modal para adicionar fontes de texto bruto.
- Ferramentas de alertas (`wiki_alerts.mh`) e lint (`wiki_lint.mh`) da wiki.
- Paginação na geração de histórias e mais tratamento de erros e logs nos workflows.
- `Info.plist` e empacotamento da aplicação para macOS, Linux e Windows.

#### Alterado
- Ferramentas da wiki passaram a ter visibilidade interna; os workflows de Wiki e WorkItem usam enums para os tipos de ação.

#### Removido
- Ferramentas `Closed` e `DirClear` e workflows parciais de discovery sem uso.

### 2026-09-30

#### Adicionado
- Modos de ajuda e spec do Radahn, com as ferramentas `RadahnAssess` e `RadahnModel`.
- `pdftotext` embarcado para ingestão de PDFs.

#### Alterado
- `UsageParser` passa a somar os tokens de entrada de criação e leitura de cache.

### 2026-09-29

#### Adicionado
- `TelemetryClient`, com ID de sessão, caminho de certificado e coleta de dados de sessão e LLM nos workflows de Delivery e Discovery.
- Campo `mudanca` (`novo`, `modificado`, `as_is`, `removido`) nos schemas de qualidade, restrição e compliance, e classificação `natureza` das fontes na ingestão, para acompanhar a evolução de sistemas existentes.

#### Alterado
- `RawExtract` aceita mais formatos de texto simples.
- O caminho de certificado saiu da configuração padrão de telemetria.

### 2026-09-27 a 2026-09-28

#### Adicionado
- Funções `adr_context` e `dedupe_shared_fields` no processamento de artefatos.

#### Alterado
- A telemetria passou a usar o `AgentSelector`; a implementação antiga foi removida.
