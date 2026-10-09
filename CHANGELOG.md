# Changelog

Todas as mudanças relevantes do Senpai são registradas neste arquivo.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Como o projeto ainda não tem versões publicadas, as entradas estão agrupadas por data.

## [Não lançado]

### 2026-10-08

#### Adicionado
- Botão **Ver markdown** no painel de leitura, ao lado de **Ver HTML** (antes "Ver fonte"): páginas da wiki mostram o `.md` de origem; artefatos, que não têm `.md`, são convertidos do HTML na hora (`turndown` + `turndown-plugin-gfm`, com diagramas Mermaid como blocos ` ```mermaid `). Respostas da wiki, o relatório de verificação e páginas abertas pelo `.md` também ganham o botão.
- Botão **Copiar** no painel de leitura, visível enquanto o HTML ou o markdown está sendo exibido, que copia o código mostrado para a área de transferência.
- Tipo de work-item **Comitê de Arquitetura (WAR)** (`item_type: "comite"`, nível `comite`), cujas fontes são as transcrições das reuniões do comitê. O workflow `Comite` (`workflows/comite/`) gera em cadeia **Demanda → RFCs → ADRs do comitê → Artefatos executáveis → Métricas**, seguindo a metodologia de governança do comitê: nível de força (DEVE/DEVERIA/PODE), mecanismo de conformidade, reversibilidade e materialização. As verificações sem LLM, que alimentam a autorrevisão, apontam:
  - ADR `DEVE` sustentada só por um documento;
  - ADR `DEVERIA` sem caminho de exceção;
  - ADR aprovada sem artefato executável;
  - artefato que cita uma ADR inexistente.

  O indicador "Artefatos materializados por padrão" e o tempo até produção, em dias, são calculados por código.
- Páginas `.html`/`.htm`/`.xhtml` salvas no disco ou no Drive sincronizado viram fonte: o arquivo é convertido em Markdown no envio, com o mesmo conversor das páginas baixadas por link (`app/html_source.go`), e gravado como `<nome>.html.md`. Antes, o arquivo era copiado como estava e a ingestão o recusava. Os cards **Página web** e **Transcrição** da aba Fontes aceitam esses arquivos.
- Export Markdown do comitê: cada aprovação refaz `artifacts/export/comite-arquitetura/` no layout `demandas/`, `decisoes/adr/`, `decisoes/rfc/`, `artefatos/` e `metricas/`. Cada documento leva o frontmatter da metodologia (`id`/`code`, `status`, `classification`, `strength`, `owners`, `related_projects`, `decision_link`…) e cada pasta tem um `README.md` de índice. O botão **Exportar Markdown** da aba Artefatos copia a pasta para onde o usuário escolher (`ExportComiteMarkdown`).

#### Alterado
- Trocar o agente ou o modelo (Devin, Codex, Claude) não reinicia mais o `mhl`, e a troca é instantânea; antes, cada troca custava ~7 s, revalidando todos os workflows. O app grava a escolha em `.senpai-agent.json`, na pasta de dados, e o `mhl` lê esse arquivo a cada chamada de LLM (`AgentConfig`, `workflows/shared/agents/agent_config.mh`). As variáveis `SENPAI_*` continuam como fallback para o uso pela CLI. A troca de agente segue recusada com uma geração em andamento.
- Na troca de agente, a lista de modelos do novo agente é carregada em paralelo com a troca, não depois dela.

#### Corrigido
- O ícone de "Reconectar" continuava girando, e o botão desabilitado, por até 20 s depois de uma troca de modelo ou de agente, até a próxima checagem de status. As trocas não acionam mais esse indicador. Durante um reconectar de verdade, o status mostra "Reconectando…" em vez do último status, verde, de um `mhl` que já foi parado.

### 2026-10-07

#### Adicionado
- **Reprocessar a wiki**: apaga o que ela derivou das fontes (ação `reset` da wiki, sem LLM) e reingere as fontes restantes na ordem original, verificando a wiki no fim. Respostas arquivadas ficam, com um aviso de que citam a wiki anterior. A ação pede confirmação num modal reutilizável (`openConfirmModal`).
- Remoção de fontes na aba Fontes (`RemoveRawSource`). Uma fonte já ingerida deixa a wiki marcada como contendo conteúdo de fontes removidas (`raw/.wiki-stale.json`), com um aviso até ela ser reprocessada.
- Fonte do tipo **Repositório**: retrato AS-IS de um repositório git, por link (clone temporário e raso, descartado em seguida) ou por um clone local. Sem LLM, grava até três fontes Markdown (estrutura, stack e dependências, regras e decisões) e nunca lê arquivos com cara de segredo (`RepoSnapshot`).
- Fontes Office (`.docx`, `.pptx`, `.xlsx`) convertidas para Markdown ao serem adicionadas, só com a biblioteca padrão do Go (`app/office_source.go`).
- `LiteralBlocks`: trechos estruturados de uma fonte (como a árvore de pastas de um retrato de repositório) entram na página da wiki exatamente como estão, sem passar pela síntese da LLM.
- Botão **Regerar** na barra do artefato e no rascunho em revisão: gera outra versão a partir do contexto atual, sem pedido de mudança.
- Site de apresentação do Senpai Refiner (`site/`), com identidade visual e capturas de tela.

#### Alterado
- O composer da aba Artefatos passa a servir só para pedir mudança (texto obrigatório, registrado no histórico); regerar sem pedido ficou no botão **Regerar**.

### 2026-10-06

#### Adicionado
- Galeria "o que você quer trazer?" na aba Fontes: para cada tipo de fonte (código, transcrição, PDF, página web...), o que ela contribui para a wiki, dicas de preparo e as formas de adicioná-la. O seletor de arquivos já vem filtrado pelo tipo (`SelectRawFilesFiltered`), e um projeto vazio mostra a galeria no lugar da lista.
- Código-fonte como fonte da wiki: o ingest aceita arquivos de código e copia os trechos relevantes literalmente para a página da fonte (`code_snippets`, seção "Trechos de código"), exibidos como blocos de código no HTML exportado.
- `ArchConformance`: cada item do backlog declara em `aderencia_arquitetural` quais contêineres, entidades, ADRs e atributos de qualidade usa; o código confere cada referência contra os artefatos do work-item. ADRs e restrições que nenhum item cita viram aviso de cobertura no mapa de dependências.
- Visões detalhadas no modelo arquitetural: diagramas de contêiner a partir de um sistema do contexto e de componente a partir de um contêiner, criados no editor com o botão "Detalhar". Regerar o modelo preserva as visões, e as que perderam a origem viram aviso.
- Limpeza, na inicialização, de processos `mhl` deixados por uma execução anterior do app que terminou sem encerrá-los, sem tocar no `mhl` de outra instância aberta.

#### Alterado
- Prazo de inicialização do `mhl` ampliado de 30s para 120s, para máquinas Windows mais lentas ou com antivírus. Se o `mhl` falhar ao subir, os work-items lidos do disco continuam utilizáveis, com o erro e o "Tentar novamente" acima da lista.
- A aba Logs mostra só as chamadas de LLM feitas durante a execução selecionada, e não mais o histórico do projeto inteiro.
- A resposta do Devin é recortada do primeiro `{` ao último `}` antes de ser lida como JSON, tolerando prosa ou cercas Markdown em volta do objeto.

#### Corrigido
- Cancelar uma geração enquanto ela ainda estava sendo iniciada não a interrompia: ela continuava rodando, ocupava a vaga de LLM e deixava as demais gerações na fila.

### 2026-10-05

#### Adicionado
- Artefato **Modelo arquitetural** (`modelo`), entre as ADRs e os diagramas, em Discovery e Delivery: os diagramas C4 de contexto e de contêiner descritos como dados (elementos e relações próprios de cada um), revisados em tabelas antes dos demais diagramas (`workflows/shared/artifacts/arch_model.mh`).
- Edição manual do modelo no editor guiado (`ArtifactSave`), com uma aba por diagrama (Contexto, Contêineres, Lacunas), tabelas por linha e prévia da visão da aba: ao salvar, os diagramas de contexto e de contêiner são redesenhados na hora, sem LLM, e o lote de diagramas é reanotado.
- Revisão de cada feature do backlog do Discovery (`FeatureReview`): o PO aprova, rejeita (com motivo) ou reabre cada uma, e a aba Artefatos agrupa as features por status. Uma feature rejeitada não gera histórias nem planos até ser reaberta.
- Anexos de história (`AttachHistoriaFiles`): arquivos que o usuário anexa para cobrir o que a história gerada não reflete. São preservados ao regerar as histórias e levados ao pacote de handoff.
- Inventário de dependências do projeto em `docs/DEPENDENCIAS.md`.

#### Alterado
- Os diagramas C4 de contexto e de contêiner passam a vir do modelo aprovado, desenhados por código; nomes divergentes entre os dois níveis viram aviso. A geração de diagramas passa a exigir o modelo e produz só os tipos opcionais (componente, implantação, fluxos, sequência, estado), com o modelo como vocabulário fixo.
- O diagrama de contêiner aceita mais de uma fronteira de sistema de software (`fronteiras` e `fronteira` por elemento), com um subgrafo por fronteira e avisos para contêiner fora de fronteira e fronteira vazia; no editor do modelo, cada fronteira tem sua própria tabela de elementos.
- A autorrevisão dos diagramas ignora os avisos de regra C4 das visões derivadas, que só o modelo pode corrigir.
- As features do backlog do Discovery aparecem na ordem de execução do mapa de dependências, que passa a ser listado antes delas.

#### Corrigido
- Uma autorrevisão que falha (por exemplo, por estourar o limite de saída do modelo) não descarta mais a primeira versão, que era válida.
- No Windows, atualizar o app não falha mais ao substituir um `mhl.exe` ainda em execução ou bloqueado pelo antivírus.

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
