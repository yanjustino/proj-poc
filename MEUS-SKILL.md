<!-- SENPAI-SKILLS-COLLECTION -->
<!-- ======================================================================= -->
<!-- # SKILL: senpai-artifact                                                -->
<!-- ======================================================================= -->

---
name: senpai-artifact
description: "Gera um artefato de engenharia de software para o item de trabalho ativo."
argument-hint: "[$mode] [$input]"
user-invocable: false
---

# Artefato de Engenharia de Software

Seu objetivo é gerar um artefato de engenharia de software para o item de trabalho ativo.


## Passo 1 — Carregar item de trabalho ativo

Use o script de memória para recuperar o item de trabalho ativo. Execute:

```bash
.senpai/scripts/senpai memory get
```

**exemplo de saída:**

```bash
senpai memory get
# id: OP-001-sistema-rv
# path: docs/discovery/OP-001-sistema-rv
# type: oportunidade
```

Extraia do resultado do stdout o `id`, `path` e `type` do item de trabalho ativo e registre os seguintes parametros:

- `WORKITEM_ID`   = `$id`
- `WORKITEM_PATH` = `$path`
- `WORKITEM_TYPE` = `$type`
- `ARTIFACT_TYPE` = `$input`
- `LANGUAGE`      = `pt-BR`
- `INPUT_PATH`    = `{WORKITEM_PATH}/input`
- `OUTPUT_PATH`   = `{WORKITEM_PATH}/output`
- `BUDDY_MODE`    = `true` se `$mode` for `-buddy`, caso contrário `false`
- `USER_INPUT`    = `$input`
- `SESSION_ID`    = upper(`{timestamp}-SENPAI-{WORKITEM_ID}`) (timestamp no formato `YYYYMMDD-HHMMSS`)
- `MODEL_ID`      = `{MODEL_ID}` (modelo recuperado do contexto do agente)

## Passo 2 — Encaminhar para a skill do artefato

Use a tabela a seguir para identificar o caminho da skill pelo `ARTIFACT_TYPE`. O caminho da skill correspondente deve ser armazenado como `SKILL_PATH`.

| Tipo        | Caminho da skill (`SKILL_PATH`)                    | argumentos        |
|-------------|----------------------------------------------------|-------------------|
| `brief`     | `.senpai/skills/senpai-doc-brief/SKILL.md`         | `$mode`           |
| `atributos` | `.senpai/skills/senpai-doc-requirements/SKILL.md`  | `$mode`           |
| `requisito` | `.senpai/skills/senpai-doc-requirements/SKILL.md`  | `$mode`           |
| `requisitos`| `.senpai/skills/senpai-doc-requirements/SKILL.md`  | `$mode`           |
| `adr`       | `.senpai/skills/senpai-doc-adr/SKILL.md`           | `$mode`           |
| `der`       | `.senpai/skills/senpai-doc-der/SKILL.md`           | `$mode`           |
| `diagrama`  | `.senpai/skills/senpai-doc-diagram/SKILL.md`       | `$mode`, `$input` |
| `diagramas` | `.senpai/skills/senpai-doc-diagram/SKILL.md`       | `$mode`, `$input` |
| `features`  | `.senpai/skills/senpai-doc-feature/SKILL.md`       | `$mode`           |
| `feature`   | `.senpai/skills/senpai-doc-feature/SKILL.md`       | `$mode`           |
| `historia`  | `.senpai/skills/senpai-doc-story/SKILL.md`         | `$mode`, `$input` |

Antes de invocar `{SKILL_PATH}`, injete os seguintes parâmetros já resolvidos no contexto da sub-skill — ela os receberá como valores disponíveis e **não precisará executar `senpai memory get` novamente**:

| Parâmetro       | Valor              |
|-----------------|--------------------|
| `WORKITEM_ID`   | `{WORKITEM_ID}`    |
| `WORKITEM_PATH` | `{WORKITEM_PATH}`  |
| `WORKITEM_TYPE` | `{WORKITEM_TYPE}`  |
| `LANGUAGE`      | `{LANGUAGE}`       |
| `INPUT_PATH`    | `{INPUT_PATH}`     |
| `OUTPUT_PATH`   | `{OUTPUT_PATH}`    |
| `BUDDY_MODE`    | `{BUDDY_MODE}`     |
| `USER_INPUT`    | `{USER_INPUT}`     |

Em seguida, leia e execute `{SKILL_PATH}` de ponta a ponta, passando todos os argumentos necessários e seguindo cada passo dentro dela. Trate as instruções da skill como autoritativas — elas substituem qualquer comportamento padrão.

## Passo 3 — Telemetria do artefato gerado
Após a execução da skill, execute o seguinte comando em background para registrar o artefato gerado:

```bash
.senpai/scripts/senpai telemetry --event-type user_request --session-id {SESSION_ID} --project {WORKITEM_ID} --phase {WORKITEM_TYPE} --task "senpai-doc" --hierarchy Strategic --model-id {MODEL_ID} --llm-status success --agent-name senpai-refiner --document senpai:{WORKITEM_TYPE}:{OUTPUT_PATH}/index.md
```  

## Restrições

- Nunca escreva arquivos de artefatos fora de `{OUTPUT_PATH}/artifacts/`.
- Nunca crie `{OUTPUT_PATH}/artifacts/index.md`.
- O registro de artefatos é sempre feito adicionando ou atualizando a seção `## Artifacts` em `{OUTPUT_PATH}/index.md`.
- Nunca invoque uma skill que não esteja listada na tabela de roteamento.
- Se o usuário solicitar um tipo de artefato ainda não implementado, diga claramente e liste o que está disponível.
- Não faça perguntas desnecessárias. Pause apenas onde um passo exigir explicitamente a entrada do usuário.

<!-- ======================================================================= -->
<!-- # SKILL: senpai-doc-adr                                                 -->
<!-- ======================================================================= -->

---
name: senpai-doc-adr
description: "Gera Registros de Decisão de Arquitetura (ADR) a partir da wiki ativa."
argument-hint: "[$mode]"
user-invocable: false
---

# Skill: ADR (Architecture Decision Record)

Você foi invocado para gerar Registros de Decisão de Arquitetura (ADR) a partir da wiki ativa. Seu trabalho é detectar decisões arquiteturais — explícitas ou implícitas — na wiki e registrá-las no formato MADR.

> ⚠️ **Language lock:** Escreva absolutamente tudo em `pt-BR` — conteúdo do artefato, cabeçalhos, valores de tabela E todas as mensagens exibidas ao usuário (status updates, confirmações de escopo, perguntas, avisos, erros). Esta restrição está ativa desde o Passo 0.

---

## Passo 0 — Receber parâmetros do item de trabalho ativo

### Subpasso 0.1 — Receber parâmetros do orquestrador

> **Atalho de orquestrador:** Se `WORKITEM_ID`, `WORKITEM_PATH`, `WORKITEM_TYPE`, `LANGUAGE`, `INPUT_PATH`, `OUTPUT_PATH`, `BUDDY_MODE` e `USER_INPUT` já estiverem presentes no contexto (injetados pelo `senpai-artifact`), vá para o Subpasso 0.3. Caso contrário, execute o Subpasso 0.2 para receber os parâmetros do item de trabalho ativo.

### Subpasso 0.2 — Receber parâmetros standalone

execute:

```bash
.senpai/scripts/senpai memory get
```

**exemplo de saída:**

```bash
senpai memory get
# id: OP-001-sistema-rv
# path: docs/discovery/OP-001-sistema-rv
# type: oportunidade
```

Extraia do resultado do stdout o `$id`, `$path` e `$type` do item de trabalho ativo e registre os seguintes parametros:

Registre os seguintes parâmetros:

- `WORKITEM_ID`    = `$id`
- `WORKITEM_PATH`  = `$path`
- `WORKITEM_TYPE`  = `$type`
- `LANGUAGE`       = `pt-BR`
- `BUDDY_MODE`     = `true` se `$mode` for `-buddy`, caso contrário `false`

### Subpasso 0.3 — Registrar caminhos de artefatos e templates

Registre os seguintes parâmetros adicionais:

- `ARTIFACT_PATH`  = `{WORKITEM_PATH}/output/artifacts/adr`
- `TEMPLATE_PATH`  = `.senpai/skills/senpai-doc-adr/template.md`
- `WIKI_REL_PATH`   = calculado conforme abaixo

**Calcular `WIKI_REL_PATH`:**

Execute:

```bash
.senpai/scripts/senpai wiki-rel-path {WORKITEM_PATH}/output/artifacts
```

Registre a saída como `WIKI_REL_PATH`. Use-a em **todos** os links para páginas da wiki dentro do brief.

---

## Passo 1 — Carregar conteúdo da wiki e artefatos predecessores

Execute:

```bash
.senpai/scripts/senpai ingest dump {WORKITEM_PATH}
```

**Saída esperada:**
- Primeira linha: `STATUS: sources:N concepts:N entities:N` — registre os totais.
- Linhas seguintes: conteúdo completo de todas as páginas, delimitadas por `--- <caminho> ---`, agrupadas em `=== SOURCES ===`, `=== CONCEPTS ===`, `=== ENTITIES ===`.
- `none` — nenhuma fonte ingerida; informe ao usuário e pare. Sugira executar `/senpai-ingest` primeiro.

> **Importante:** Leia o dump uma única vez. Não faça chamadas `read_file` individuais nas páginas da wiki — todo o conteúdo já está presente na saída do comando acima.

**Após o dump**, leia separadamente os artefatos predecessores em `{OUTPUT_PATH}/artifacts/` — eles contêm decisões nem sempre presentes nas páginas brutas da wiki:

| Artefato | Arquivo | Propósito |
|---|---|---|
| `brief` | `{OUTPUT_PATH}/artifacts/brief.md` | Metas estratégicas e escopo — confirma quais decisões arquiteturais estão no escopo do MVP |
| `attributes` | `{OUTPUT_PATH}/artifacts/attributes.md` | Atributos de qualidade e restrições arquiteturais — pode introduzir decisões implícitas |
| `requirements` | `{OUTPUT_PATH}/artifacts/requirements.md` | Requisitos de negócio — pode implicar decisões sobre padrões de integração e modelo de dados |

Leia cada arquivo que existir. Ignore silenciosamente os ausentes.

---

## Passo 2 — Determinar o escopo da ADR

Use `WORKITEM_TYPE` para determinar o escopo:

| `WORKITEM_TYPE` | Escopo da ADR |
|---|---|
| `oportunidade` | **Fundamental** — estilo arquitetural, plataforma tecnológica, princípios transversais |
| `feature` | **Escopo de Feature** — seleção de bibliotecas, ferramentas, design de API, modelo de dados, padrões de integração |
| `historia` | **Escopo de História** — decisões de implementação, padrões de código, convenções de projeto |

Este escopo determina o que conta como uma decisão relevante para registro. Aplique-o no Passo 3.

---

## Passo 3 — Detectar decisões

Com base no conteúdo carregado no Passo 1, identifique decisões arquiteturais usando o critério abaixo.

**O que conta como uma decisão:**
- Uma escolha explícita feita entre alternativas nomeadas ("escolhemos X em vez de Y porque...").
- Uma tecnologia, framework, biblioteca ou plataforma selecionada.
- Um padrão arquitetural adotado (event-driven, CQRS, REST vs GraphQL, etc.).
- Uma fronteira ou interface acordada entre sistemas ou times.
- Uma restrição que descarta uma categoria de soluções.

**O que NÃO conta:**
- Requisitos (o que o sistema deve fazer).
- Perguntas abertas sem resolução.
- Preferências declaradas sem justificativa (rationale).

Para cada decisão encontrada, anote:
- A decisão em si (o que foi escolhido).
- As alternativas consideradas (o que foi rejeitado).
- A justificativa/rationale (por que a escolha foi feita).
- A fonte na wiki (caminho relativo da página).

---

## Passo 4 — Confirmar a lista de decisões com o usuário

Antes de escrever, apresente o que encontrou:

```
Detectei {N} decisões arquiteturais:

1. {Título da decisão} — [{Fundamental | Escopo de Feature}]
   Escolhido: {opção}
   Alternativas: {opções}
   Fonte: [slug](sources/slug)

2. ...

Estas definições estão corretas? Alguma decisão que eu tenha perdido ou que deva ser excluída?
```

**Se `BUDDY_MODE` for `true`:** Aguarde uma resposta. Ajuste com base no feedback do usuário. Se o usuário disser "prossiga", siga em frente.

**Se `BUDDY_MODE` for `false` (padrão):** Prossiga diretamente.

---

## Passo 5 — Escrever um arquivo ADR por decisão

Crie um arquivo ADR numerado para cada decisão confirmada em:
`{ARTIFACT_PATH}/NNN-{slug-do-titulo-da-decisao}.md`

Numere sequencialmente a partir de `001`. Se já existirem arquivos ADR na pasta, continue do número mais alto existente.

Leia o template em `{TEMPLATE_PATH}` e preencha todos os placeholders exatamente.

> ⚠️ **Imposição de Template (não negociável):** O arquivo gerado DEVE ser estruturalmente idêntico ao `template.md`:
> - **Cabeçalhos (Headings)**: não adicione, remova ou renomeie nenhuma seção.
> - **Colunas de tabela**: não adicione, remova ou renomeie nenhuma coluna.
> - **Campos YAML frontmatter**: não adicione campos ausentes no template. Não remova campos obrigatórios.
> - **Sem blocos extras**: sem emojis, subseções extras ou callouts ausentes no template.
> A violação de qualquer uma destas regras é um erro grave — corrija o arquivo antes de executar a validação.

Após escrever cada ADR, execute a validação:

```bash
.senpai/scripts/senpai adr lint {ARTIFACT_PATH}/NNN-{slug}.md {TEMPLATE_PATH}
```

- Saída `ok` → prossiga para a próxima ADR.
- Saída JSON de violações → corrija e execute novamente até obter `ok`.

Não escreva o índice de ADRs, não atualize arquivos de navegação nem reporte sucesso antes que todos os arquivos ADR passem na validação.

---

## Passo 6 — Escrever o índice de ADRs

Crie ou atualize `{ARTIFACT_PATH}/index.md`:

```markdown
---
title: "Índice de ADRs — {title}"
type: artifact
subtype: adr-index
generated: YYYY-MM-DD
---

# Registros de Decisão de Arquitetura: {title}

| # | Título | Status | Data |
|---|---|--------|--------|------|
| ADR-001 | [Título da decisão](001-slug) | aceito | YYYY-MM-DD |
| ADR-002 | ... | ... | ... |
```

---

## Passo 7 — Atualizar arquivos de navegação

Execute o script passando as contagens coletadas nos passos anteriores:

```bash
echo "ADR_RESULT:
- decisions: {N_ADRS}
- scope: \"{Fundamental | Escopo de Feature}\"
- gaps: {N_GAPS}
- sources: {N_SOURCES}
- status: \"ok\"
- message: \"\"" | .senpai/scripts/senpai adr register {WORKITEM_PATH}
```

O script atualiza automaticamente `{OUTPUT_PATH}/index.md` (seção `## Artifacts`) e prepende a entrada em `{OUTPUT_PATH}/log.md`. Não escreva nesses arquivos manualmente.

---

## Passo 8 — Fechar o ciclo

Diga ao usuário o que foi feito:

```
Concluído. {N} ADRs gerados em {ARTIFACT_PATH}.

Escopo: {Fundamental | Escopo de Feature}
Decisões registradas: {N}
Gaps sinalizados: {N} (decisões sem alternativas documentadas)
Páginas lidas: {N} total (fontes: N, conceitos: N, entidades: N)

Deseja revisar algo antes de continuarmos?
```

---

## Regras

- **Escreva todo o conteúdo e todas as mensagens em `pt-BR`.** Sem fallback para inglês.
- **Nunca registre uma decisão não presente na wiki.** Se a wiki sugerir uma escolha, mas não a declarar, não crie uma ADR — sinalize como um gap.
- **Nunca combine duas decisões distintas em uma única ADR.** Uma decisão = um arquivo.
- **O status é sempre `aceito` na geração**, a menos que a wiki marque algo explicitamente como proposto ou substituído.
- **A seção de alternativas usa `> [!gap]`** quando nenhuma foi documentada — nunca invente alternativas com base em conhecimento de treinamento.
- **Nunca modifique páginas de fontes ou conceitos da wiki.** Os únicos arquivos escritos são os ADRs em `{ARTIFACT_PATH}`, o índice `{ARTIFACT_PATH}/index.md`, `{OUTPUT_PATH}/index.md` e `{OUTPUT_PATH}/log.md`.
- **Links para páginas da wiki usam sempre `WIKI_REL_PATH`.** Use exclusivamente a variável calculada no Passo 0. O formato correto é `{$WIKI_REL_PATH}/{sources|concepts|entities}/{slug}.md`. Nunca construa caminhos relativos de cabeça — sempre derive de `WIKI_REL_PATH`.
- **No modo buddy, nunca pule o Passo 4.** O usuário deve confirmar a lista de decisões antes de qualquer arquivo ser escrito.
- **Se a wiki tiver menos de 3 páginas**, avise o usuário que os ADRs terão lacunas significativas e pergunte se deseja prosseguir ou ingerir mais fontes primeiro.

<!-- ======================================================================= -->
<!-- # SKILL: senpai-doc-brief                                               -->
<!-- ======================================================================= -->

---
name: senpai-doc-brief
description: "Gera um artefato de resumo estratégico (brief) sintetizando todo o conhecimento da wiki."
argument-hint: "[$mode]"
user-invocable: false
---

# Skill: Brief (Estratégico)

Você foi invocado pelo orquestrador porque o usuário deseja gerar um **resumo estratégico (brief)** para o item de trabalho ativo. Seu trabalho é sintetizar todo o conhecimento ingerido da wiki em um documento estruturado e pronto para tomada de decisão.


## Passo 0 — Receber parâmetros do item de trabalho ativo

### Subpasso 0.1 — Receber parâmetros do orquestrador

> **Atalho de orquestrador:** Se `WORKITEM_ID`, `WORKITEM_PATH`, `WORKITEM_TYPE`, `LANGUAGE`, `INPUT_PATH`, `OUTPUT_PATH`, `BUDDY_MODE` e `USER_INPUT` já estiverem presentes no contexto (injetados pelo `senpai-artifact`), vá para o Subpasso 0.3. Caso contrário, execute o Subpasso 0.2 para receber os parâmetros do item de trabalho ativo.

### Subpasso 0.2 — Receber parâmetros standalone

Execute o script de memória para recuperar o item de trabalho ativo:

```bash
.senpai/scripts/senpai memory get
```

**Exemplo de saída:**

```bash
senpai memory get
# id: OP-001-sistema-rv
# path: docs/discovery/OP-001-sistema-rv
# type: oportunidade
```

Extraia do resultado do stdout o `$id`, `$path` e `$type` do item de trabalho ativo e registre os seguintes parametros:

- `WORKITEM_ID`    = `$id`
- `WORKITEM_PATH`  = `$path`
- `WORKITEM_TYPE`  = `$type`
- `LANGUAGE`       = `pt-BR`
- `BUDDY_MODE`     = `true` se `$mode` for `-buddy`, caso contrário `false`

### Subpasso 0.3 — Registrar caminhos de artefatos e templates

Registre os seguintes parâmetros adicionais:

- `WORKITEM_TITLE`  = `{WORKITEM_ID}` (ou o título da página principal da wiki, se disponível)
- `INPUT_PATH`      = `{WORKITEM_PATH}/input`
- `OUTPUT_PATH`     = `{WORKITEM_PATH}/output`
- `ARTIFACT_PATH`   = `{WORKITEM_PATH}/output/artifacts/brief.md`
- `TEMPLATE_PATH`   = `.senpai/skills/senpai-doc-brief/template.md`
- `WIKI_REL_PATH`   = calculado conforme abaixo

**Calcular `WIKI_REL_PATH`:**

Execute:

```bash
.senpai/scripts/senpai wiki-rel-path {WORKITEM_PATH}/output/artifacts
```

Registre a saída como `WIKI_REL_PATH`. Use-a em **todos** os links para páginas da wiki dentro do brief.

---

## Passo 1 — Carregar todo o conteúdo da wiki

Execute:

```bash
.senpai/scripts/senpai ingest dump {WORKITEM_PATH}
```

**Saída esperada:**
- Primeira linha: `STATUS: sources:N concepts:N entities:N` — registre os totais.
- Linhas seguintes: conteúdo completo de todas as páginas, delimitadas por `--- <caminho> ---`, agrupadas em `=== SOURCES ===`, `=== CONCEPTS ===`, `=== ENTITIES ===`.
- `none` — nenhuma fonte ingerida; informe ao usuário e pare. Sugira executar `/senpai-ingest` primeiro.

> **Importante:** Leia este output uma única vez. Não faça chamadas `read_file` individuais para as páginas da wiki — todo o conteúdo já está presente na saída do comando acima.

**Filtro de Relevância e Descarte:**
Ao processar as páginas, ignore qualquer conteúdo marcado com metadado `status: discarded` ou callouts de `[!contradiction]` sinalizando item fora de escopo ou solução prematura.

**Resistência ao Viés de Solução Precoce:**
Separe o **Problema de Negócio** da **Hipótese de Solução**.
- **Foco no Outcome:** Foque em capacidades (ex: "agilidade na alteração") e não em implementações (ex: "usar Lambda").
- **Hipóteses Técnicas:** Componentes técnicos (AWS, Lambda, SQS, etc.) devem aparecer apenas nas seções "Riscos e Dependências" ou "Perguntas Abertas", nunca como Metas ou Escopo funcional.

Enquanto processa o dump, extraia e rastreie:

- **Objetivos e resultados (outcomes)** explicitamente declarados.
- **Restrições e fronteiras** (o que está fora de escopo ou explicitamente excluído).
- **Stakeholders principais** (pessoas, times, organizações mencionados como responsáveis ou afetados).
- **Métricas de sucesso ou KPIs** mencionados em qualquer fonte.
- **Riscos, bloqueios e dependências** sinalizados.
- **Perguntas abertas** — quaisquer seções `## Open questions` ou callouts de `[!contradiction]`.
- **Sinais de cronograma** — datas, marcos ou expectativas de entrega.

Não escreva o brief ainda. Complete o processamento do dump primeiro.

---

## Passo 2 — Confirmar o escopo com o usuário

Se `BUDDY_MODE` for `false` (padrão), prossiga diretamente com seu julgamento e vá para o Passo 3. Caso contrário, apresente uma síntese de um parágrafo ao usuário:

```
Com base na wiki ({N} páginas), eis o que pretendo cobrir no brief:

• [Objetivo ou resultado 1]
• [Objetivo ou resultado 2]
• [Risco principal ou pergunta aberta]
• ...

Esta abordagem está correta? Algo que você queira enfatizar, excluir ou reformular?
```

Aguarde uma resposta. Ajuste seu entendimento se o usuário fornecer correções. Se o usuário disser "prossiga", siga seu julgamento.


---

## Passo 3 — Escrever o resumo estratégico (brief)

Leia o template em `{TEMPLATE_PATH}` e preencha todos os placeholders com o conteúdo extraído da wiki. Mantenha a estrutura do template intacta. Antes de escrever, valide se o conteúdo cumpre as regras de neutralidade e visão de negócio: 

- **O "QUÊ" antes do "COMO":** O Resumo Executivo e as Metas descrevem benefícios de negócio (agilidade, autonomia, retenção).
- **Nomes de Componentes:** Se nomes de serviços (Lambda, AWS, EventBridge, ECS) aparecem fora da seção de Riscos ou Perguntas Abertas, substitua-os pelo benefício técnico que eles trazem (ex: "processamento em tempo real", "arquitetura escalável").
- **Filtro de Descarte:** Verifique se nenhuma entidade ou conceito marcado como descartado ou contraditório na wiki foi levado para o documento final como uma premissa.

As regras de escrita do brief são:

- **Cabeçalhos (Headings)**: não adicione, remova ou renomeie nenhuma seção de cabeçalho.
- **Colunas de tabela**: não adicione, remova ou renomeie nenhuma coluna. Mantenha os nomes e a ordem exatos das colunas do template.
- **Campos YAML frontmatter**: não adicione nenhum campo que não esteja presente no frontmatter do template. Não remova campos obrigatórios.
- **Sem blocos extras**: não adicione emojis, subseções extras, callouts ou qualquer bloco de conteúdo ausente no template.

A violação de qualquer uma destas regras é um erro grave — corrija o arquivo antes de escrever.
Siga as seguintes regras durante a escrita:
- Toda afirmação factual deve citar uma página da wiki usando `[markdown links](<relative path to page>)`.
- Não adicione fatos do seu treinamento. Se a wiki não cobrir uma seção, use um callout `> [!gap]`.
- Sinalize contradições com `> [!contradiction]` e cite ambos os lados.
- Escreva de forma direta e simples. Sem "encheção de linguiça". Evite voz passiva sempre que possível.

Por fim, escreva o conteúdo no arquivo `{ARTIFACT_PATH}`.

Em seguida, execute a validação estrutural:

```bash
.senpai/scripts/senpai brief lint {ARTIFACT_PATH} {TEMPLATE_PATH}
```

- Saída `ok` — prossiga para o Passo 4.
- Saída JSON de violações — corrija o artefato e execute novamente até obter `ok`.

---

## Passo 4 — Atualizar arquivos de navegação

Após escrever o brief, execute o script passando as contagens coletadas no Passo 1:

```bash
echo "BRIEF_RESULT:
- sources: {N_SOURCES}
- concepts: {N_CONCEPTS}
- entities: {N_ENTITIES}
- gaps: {N_GAPS}
- open_questions: {N_OPEN_QUESTIONS}
- status: \"ok\"
- message: \"\"" | .senpai/scripts/senpai brief register {WORKITEM_PATH}
```

O script atualiza automaticamente `{OUTPUT_PATH}/index.md` (seção `## Artifacts`) e
prepende a entrada em `{OUTPUT_PATH}/log.md`. Não escreva nesses arquivos manualmente.

---

## Passo 5 — Fechar o ciclo

Diga ao usuário o que foi feito:

```
Concluído. Resumo estratégico gerado em {OUTPUT_PATH}/artifacts/brief.md.

Páginas lidas: N total (fontes: N, conceitos: N, entidades: N)
Gaps sinalizados: N (seções com falta de cobertura na wiki)
Perguntas abertas mantidas: N

Deseja revisar algo antes de continuarmos?
```

---

## Regras

- **Escreva todo o conteúdo E todas as mensagens para o usuário em `{LANGUAGE}`.** Isso se aplica ao conteúdo do artefato, cabeçalhos de seção, valores de tabela, atualizações de status, mensagens de confirmação de escopo, perguntas, avisos e erros. `{LANGUAGE}` é sempre `pt-BR` — não há fallback para inglês.
- **Nunca escreva conteúdo não suportado pela wiki.** Use `> [!gap]` para qualquer seção que a wiki não cubra. Não preencha lacunas com seu conhecimento de treinamento.
- **Nunca modifique páginas de fontes (sources) ou conceitos (concepts).** A geração do brief é apenas leitura na wiki (`docs/wiki/`). Os únicos arquivos que você escreve são `ARTIFACT_PATH`, `index.md` (seção Artifacts) e `log.md` — todos dentro de `{OUTPUT_PATH}/`.
- **No modo buddy, nunca pule o Passo 2.** Quando `{BUDDY_MODE}` for `true`, o usuário deve confirmar o escopo antes de você escrever mais de 400 palavras. No modo não-buddy, prossiga automaticamente.
- **Nunca pule o Passo 3.** O idioma deve ser travado antes de qualquer arquivo ser escrito — nunca assuma ou infira o idioma no meio da geração.
- **Se `overview.md` não existir**, prossiga usando apenas as páginas de fontes e conceitos — observe no brief que a visão geral está ausente.
- **Se a wiki tiver menos de 3 páginas**, avise o usuário que o brief terá lacunas significativas e pergunte se deseja prosseguir ou ingerir mais fontes primeiro.

<!-- ======================================================================= -->
<!-- # SKILL: senpai-doc-der                                                 -->
<!-- ======================================================================= -->

---
name: senpai-doc-der
description: "Gera um artefato DER (Diagrama de Entidade-Relacionamento) no formato Mermaid ER a partir da wiki ativa."
user-invocable: false
---

# Skill: DER (Diagrama de Entidade-Relacionamento)

Você foi invocado pelo agente porque o usuário deseja gerar um diagrama Entidade-Relacionamento a partir da wiki ativa. Seu trabalho é extrair entidades e seus relacionamentos das páginas da wiki e produzir um diagrama Mermaid ER com um glossário de apoio.

Esta skill é aplicável a:
- Itens de nível **Discovery** (`WORKITEM_TYPE = oportunidade`)
- Itens de nível **Delivery** do tipo **Feature standalone** (`WORKITEM_TYPE = feature` sem item pai de Discovery)

Se `WORKITEM_TYPE` for `historia` ou qualquer outro tipo não listado acima, informe ao usuário que este artefato não é aplicável para essa camada e pare.

Siga cada passo em ordem.

> ⚠️ **Bloqueio de Idioma:** Escreva tudo em `pt-BR` — conteúdo do artefato, cabeçalhos, valores de tabela E todas as mensagens mostradas ao usuário (atualizações de status, confirmações de escopo, perguntas, avisos, erros). Os documentos de origem podem estar em outro idioma; nunca os espelhe. Esta restrição está ativa desde o Passo 0.

---

## Passo 0 — Receber parâmetros do item de trabalho ativo

### Subpasso 0.1 — Receber parâmetros do orquestrador

> **Atalho de orquestrador:** Se `WORKITEM_ID`, `WORKITEM_PATH`, `WORKITEM_TYPE`, `LANGUAGE`, `INPUT_PATH`, `OUTPUT_PATH`, `BUDDY_MODE` e `USER_INPUT` já estiverem presentes no contexto (injetados pelo `senpai-artifact`), vá para o Subpasso 0.3. Caso contrário, execute o Subpasso 0.2 para receber os parâmetros do item de trabalho ativo.

### Subpasso 0.2 — Receber parâmetros standalone

Execute:

```bash
.senpai/scripts/senpai memory get
```

**Exemplo de saída:**

```bash
senpai memory get
# id: OP-001-sistema-rv
# path: docs/discovery/OP-001-sistema-rv
# type: oportunidade
```

Extraia do stdout o `$id`, `$path` e `$type` do item de trabalho ativo e registre os seguintes parâmetros:

- `WORKITEM_ID`    = `$id`
- `WORKITEM_PATH`  = `$path`
- `WORKITEM_TYPE`  = `$type`
- `LANGUAGE`       = `pt-BR`
- `BUDDY_MODE`     = `true` se `$mode` for `-buddy`, caso contrário `false`

### Subpasso 0.3 — Registrar caminhos de artefatos e templates

Se `WORKITEM_TYPE` for `historia` ou qualquer outro tipo não elegível, pare e informe ao usuário que este artefato não é aplicável para essa camada.

Registre os seguintes parâmetros adicionais:

- `WORKITEM_TITLE`  = `{WORKITEM_ID}` (ou o título da página principal da wiki, se disponível)
- `INPUT_PATH`      = `{WORKITEM_PATH}/input`
- `OUTPUT_PATH`     = `{WORKITEM_PATH}/output`
- `ARTIFACT_PATH`   = `{WORKITEM_PATH}/output/artifacts/der.md`
- `TEMPLATE_PATH`   = `.senpai/skills/senpai-doc-der/template.md`
- `WIKI_REL_PATH`   = calculado conforme abaixo

**Calcular `WIKI_REL_PATH`:**

Execute:

```bash
.senpai/scripts/senpai wiki-rel-path {WORKITEM_PATH}/output/artifacts
```

Registre a saída como `WIKI_REL_PATH`. Use-a em **todos** os links para páginas da wiki dentro dos arquivos DER.

---

## Passo 1 — Carregar fontes de dados do modelo

### 1.1 — Carregar artefatos predecessores (fonte primária)

Leia os artefatos já gerados em `{OUTPUT_PATH}/artifacts/`. Eles descrevem o sistema em termos de requisitos e decisões — são a fonte mais confiável para inferir o modelo de domínio.

| Artefato | Arquivo | O que extrai para o DER |
|---|---|---|
| `requirements` | `{OUTPUT_PATH}/artifacts/requirements.md` | Verbos de persistência ("registrar", "armazenar", "consultar", "emitir") e os substantivos que os acompanham → candidatos a entidades |
| `brief` | `{OUTPUT_PATH}/artifacts/brief.md` | Escopo e domínio do sistema → confirma limites do modelo e descarta candidatos fora de escopo |
| `adrs` | `{OUTPUT_PATH}/artifacts/adr/*.md` | Decisões arquiteturais que impactam o modelo (ex: escolha de banco de dados, imutabilidade, auditoria) |
| `attributes` | `{OUTPUT_PATH}/artifacts/attributes.md` | Restrições arquiteturais que impactam o modelo (ex: imutabilidade, auditoria) |

Leia cada arquivo que existir. Ignore silenciosamente os ausentes. Registre quais foram encontrados como `PREDECESSORS_FOUND`.

> **Critério de suficiência:** Se `requirements.md` ou `attributes.md` ou `brief.md` foram encontrados e têm conteúdo, os predecessores são suficientes. Prossiga para o Passo 1.2 apenas para complementar com fontes brutas.

### 1.2 — Carregar fontes brutas da wiki (fallback)

Execute:

```bash
.senpai/scripts/senpai ingest dump {WORKITEM_PATH}
```

**Saída esperada:**
- Primeira linha: `STATUS: sources:N concepts:N entities:N` — registre os totais.
- Linhas seguintes: conteúdo completo de todas as páginas, delimitadas por `--- <caminho> ---`, agrupadas em `=== SOURCES ===`, `=== CONCEPTS ===`, `=== ENTITIES ===`.
- `none` — nenhuma fonte ingerida.

Use **apenas** a seção `=== SOURCES ===` como insumo para o DER. Ignore `=== ENTITIES ===` e `=== CONCEPTS ===` — elas descrevem stakeholders, metodologias e capacidades do sistema, não tabelas de banco de dados.

> **Quando o fallback é necessário:** Use `=== SOURCES ===` apenas se `PREDECESSORS_FOUND` estiver vazio ou se os predecessores não contiverem evidências suficientes de objetos de domínio a serem persistidos.

**Condição de parada:** Se `PREDECESSORS_FOUND` estiver vazio E `=== SOURCES ===` retornar `none` ou vazio, informe ao usuário:

```
Nenhum artefato predecessor encontrado e nenhuma fonte ingerida na wiki.
Não é possível inferir o modelo de domínio sem ao menos um dos seguintes:
  - {OUTPUT_PATH}/artifacts/requirements.md
  - {OUTPUT_PATH}/artifacts/brief.md
  - Fontes ingeridas via /senpai-ingest

Gere os artefatos predecessores primeiro e tente novamente.
```

Pare a execução.

---

## Passo 2 — Detectar contexto de banco de dados

Antes de extrair entidades, determine se a feature opera sobre uma base de dados **existente** ou se trata de um **projeto do zero (greenfield)**. Esta detecção define como o DER será apresentado.

### 2.1 — Buscar sinais de banco existente

Procure por evidências nos seguintes locais (use apenas o conteúdo já carregado no Passo 1, sem leituras adicionais neste passo):

- Artefatos predecessores (`requirements.md`, `brief.md`) — fonte primária
- Seção `=== SOURCES ===` do dump da wiki — fallback

**Sinais que indicam banco existente:**
- Menções a tabelas, esquemas ou entidades já existentes no sistema ("tabela X já existe", "herda do modelo atual", "integra com a base legada")
- Referências a sistemas legados ou módulos em produção com dados persistidos
- Verbos como "estender", "adaptar", "migrar", "evoluir" aplicados ao modelo de dados
- Presença de um DER ou modelo de dados em `{OUTPUT_PATH}/artifacts/` ou na wiki

**Sinais que indicam greenfield:**
- Nenhuma menção a estruturas de dados existentes
- Feature descrita como capacidade completamente nova, sem integração com módulos existentes
- Ausência de qualquer modelo upstream

### 2.2 — Classificar o modo de operação

Com base nos sinais encontrados, classifique em um dos três modos e armazene como `DB_CONTEXT`:

| Modo | `DB_CONTEXT` | Quando usar |
|---|---|---|
| **Greenfield** | `greenfield` | Nenhum sinal de banco existente. O DER modela entidades do zero para esta feature. |
| **AS-IS** | `as-is` | A feature opera integralmente sobre um banco já existente. O DER documenta o modelo atual sem propor alterações. |
| **Evolução** | `evolucao` | A feature exige mudanças (novas tabelas, colunas ou relacionamentos) sobre um banco já existente. O DER documenta o delta em relação ao AS-IS. |

### 2.3 — Confirmar classificação com o usuário

Apresente a classificação detectada e aguarde confirmação **sempre** (independente de `BUDDY_MODE`):

```
Contexto de banco de dados detectado: {DB_CONTEXT}

Razão: {breve justificativa baseada nos sinais encontrados, ou "Nenhum sinal de banco existente encontrado."}

Modos disponíveis:
  1. greenfield — modelagem do zero, sem banco preexistente
  2. as-is      — documenta o modelo existente sem propor alterações
  3. evolucao   — documenta o delta necessário sobre o modelo existente

Este modo está correto? Se não, informe o modo correto antes de prosseguir.
```

Aguarde a confirmação ou correção do usuário antes de avançar para o Passo 3.

> **Impacto nos passos seguintes:**
> - **`greenfield`**: prossiga com o fluxo padrão — extraia entidades da wiki e modele do zero.
> - **`as-is`**: no Passo 5, o diagrama deve refletir apenas entidades e relacionamentos já confirmados como existentes. Nenhuma entidade nova deve ser proposta. Marque o diagrama com o callout `> [!as-is] Este DER representa o modelo de dados atual — nenhuma alteração é proposta para esta feature.`
> - **`evolucao`**: no Passo 5, o diagrama deve distinguir claramente entidades/atributos **existentes** (sem marcação especial) de entidades/atributos **novos ou alterados** (marcados com comentário `"[NOVO]"` ou `"[ALTERADO]"`). Adicione a seção `## Delta do Modelo` listando cada mudança proposta.

---

## Passo 3 — Extrair entidades e relacionamentos

Use as fontes na ordem de prioridade definida no Passo 1: **predecessores primeiro, fontes brutas como fallback**. Não faça leituras adicionais de arquivo neste passo — todo o conteúdo já está disponível.

**Regra de Ouro para identificar entidades:** _"O sistema precisa armazenar e recuperar registros deste objeto em banco de dados?"_ Se sim, é uma Entidade de Domínio. Caso contrário, não é.

### 3.1 — Extrair a partir dos artefatos predecessores (fonte primária)

Analise `requirements.md`, `brief.md` e `features.md` buscando:

**Padrões de persistência em `requirements.md`:**
- Verbos que implicam armazenamento: _registrar, armazenar, emitir, consultar, aprovar, cancelar, histórico de, rastrear_
- Substantivos que acompanham esses verbos → candidatos a entidades (ex: "o sistema deve registrar **ordens** de compra" → entidade ORDEM)
- Atributos explicitados: "cada **título** possui código ISIN, taxa, vencimento" → entidade TITULO com atributos

**Padrões de escopo em `brief.md`:**
- Domínio central do sistema → confirma quais candidatos são do escopo
- Descarta entidades que pertencem a sistemas externos

**Padrões de fluxo em `features.md`:**
- Operações CRUD nos fluxos → reforçam entidades já identificadas
- Relacionamentos implícitos: "ao aprovar uma **inscrição**, o sistema vincula ao **edital**" → INSCRICAO }o--|| EDITAL

Para cada entidade identificada, registre:
- **Nome** (substantivo do domínio, em UPPER_SNAKE_CASE)
- **Atributos** explicitamente mencionados nos predecessores
- **Fonte:** trecho exato do artefato predecessor que justifica a inclusão
- **Status:** `confirmado` (mencionado explicitamente) ou `inferido` (implícito no contexto)

### 3.2 — Complementar com fontes brutas da wiki (fallback)

Se os predecessores forem insuficientes (menos de 2 entidades identificadas no 3.1), analise `=== SOURCES ===` do dump com os mesmos padrões do 3.1.

Ignore completamente `=== ENTITIES ===` e `=== CONCEPTS ===` do dump — eles descrevem stakeholders e capacidades do sistema, não tabelas de banco de dados.

### 3.3 — Determinar cardinalidade dos relacionamentos

Para cada relacionamento entre entidades de domínio:
- `||--||` um-para-um
- `||--o{` um-para-muitos
- `}o--o{` muitos-para-muitos

Marque como **confirmado** (explícito no texto fonte) ou **inferido** (implícito — requer validação do time).

---

## Passo 4 — Confirmar entidades e relacionamentos com o usuário

Antes de escrever, apresente o que você encontrou, incluindo o resultado da classificação:

```
Fontes utilizadas: {PREDECESSORS_FOUND} {"+ sources da wiki (fallback)" se usado}

Entidades de domínio identificadas: {N_DOMINIO}
  {EntidadeA} [confirmada — requirements.md]
  {EntidadeB} [inferida — brief.md]
  ...

Relacionamentos confirmados:
- EntidadeA ||--o{ EntidadeB : "possui muitos" [fonte: requirements.md]

Relacionamentos inferidos (precisam de validação):
- EntidadeA ||--o{ EntidadeD : "pode conter"   [inferido de: brief.md]

{N} entidades sem atributos documentados.

Isto parece correto? Alguma entidade de domínio que eu esqueci?
```

> Se nenhuma entidade de domínio for identificada, informe: _"Nenhuma entidade de domínio encontrada nos predecessores nem nas fontes da wiki. Gere `requirements.md` ou `brief.md` antes de tentar o DER."_ E pare.

**Se `{BUDDY_MODE}` for `true`:** Aguarde uma resposta. Se o usuário disser "prossiga", continue.

**Se `{BUDDY_MODE}` for `false` (padrão):** Prossiga diretamente.

---

## Passo 5 — Escrever o artefato DER

Leia o template em `{TEMPLATE_PATH}` e preencha todos os placeholders. Escreva o resultado em `{ARTIFACT_PATH}`.
Altere o `{WIKI_REL_PATH}` para o valor calculado no `Passo 0.3`.

> ⚠️ **Execução do Template (não negociável):** O arquivo gerado DEVE ser estruturalmente idêntico ao `template.md`. Isso significa:
> - **Cabeçalhos**: não adicione, remova ou renomeie nenhum cabeçalho de seção.
> - **Colunas de tabela**: não adicione, remova ou renomeie nenhuma coluna. Mantenha os nomes exatos e a ordem do template.
> - **Campos YAML frontmatter**: não adicione nenhum campo não presente no frontmatter do template. Não remova campos obrigatórios.
> - **Sem blocos extras**: não adicione emojis, subseções extras, callouts ou qualquer bloco de conteúdo ausente no template.
> A violação de qualquer uma destas regras é um erro crítico — corrija o arquivo antes de rodar a validação.

Em seguida, execute a validação estrutural:

```bash
.senpai/scripts/senpai der lint {ARTIFACT_PATH} {TEMPLATE_PATH}
```

- Saída `ok` — prossiga para o Passo 6.
- Saída JSON de violações — corrija o artefato e execute novamente até obter `ok`.

Regras de Mermaid ER a seguir:
- Nomes de entidades em `UPPER_SNAKE_CASE` no diagrama, linguagem natural no glossário.
- O tipo do atributo deve ser um de: `string`, `int`, `float`, `boolean`, `date`, `datetime`, `uuid`, `json`.
- Use `"descrição"` (string entre aspas) como o terceiro token para comentários de atributos.
- Não use recursos do Mermaid não suportados no tipo de diagrama ER.
- Se uma entidade não possui atributos documentados, renderize-a com um bloco vazio `NOME_ENTIDADE { }`.

---

## Passo 6 — Atualizar arquivos de navegação

Após escrever o artefato, execute o script passando as contagens coletadas no Passo 1:

```bash
echo "DER_RESULT:
- sources: {N_SOURCES}
- concepts: {N_CONCEPTS}
- entities: {N_ENTITIES}
- relationships_confirmed: {N_CONFIRMED}
- relationships_inferred: {N_INFERRED}
- gaps: {N_GAPS}
- status: \"ok\"
- message: \"\"" | .senpai/scripts/senpai der register {WORKITEM_PATH}
```

O script atualiza automaticamente `{OUTPUT_PATH}/index.md` (seção `## Artifacts`) e
prepende a entrada em `{OUTPUT_PATH}/log.md`. Não escreva nesses arquivos manualmente.

---

## Passo 7 — Encerrar o ciclo

Diga ao usuário o que foi feito:

```
Concluído. DER gerado em {ARTIFACT_PATH}.

Entidades: N
Relacionamentos confirmados: N
Relacionamentos inferidos: N (marcados — requerem validação do time)
Gaps identificados: N
Fontes primárias: {PREDECESSORS_FOUND}
Fontes brutas (wiki): {N_SOURCES} fontes {"(não utilizadas — predecessores suficientes)" OU "(utilizadas como fallback)"}

Deseja que eu revise algo?
```

---

## Regras

- **Escreva todo o conteúdo E todas as mensagens para o usuário em `pt-BR`.**
- **Nunca invente entidades ou atributos não presentes na wiki.** Use `> [!gap]` para entidades não documentadas.
- **Separe claramente relacionamentos confirmados de inferidos.** Nunca apresente um relacionamento inferido como fato.
- **Nunca escreva nas páginas de origem/conceito/entidade.** A geração do DER é apenas leitura na wiki.
- **Nunca pule o Passo 3.** Entidades erradas resultam em um diagrama enganoso.
- **Esta skill é aplicável para Discovery (`oportunidade`) e Delivery (`feature` standalone).**
- **A sintaxe Mermaid deve ser válida.**
- **Formato de citação de fonte:** use `[slug](sources/slug)`, `[slug](concepts/slug)` ou `[slug](entities/slug)` para páginas da wiki local.
- **A fonte primária para o DER são os artefatos predecessores** (`requirements.md`, `brief.md`, `features.md`). A wiki (`=== SOURCES ===`) é fallback. `=== ENTITIES ===` e `=== CONCEPTS ===` da wiki NUNCA são fontes para entidades do DER.
- **PROIBIDO incluir stakeholders no DER.** Pessoas, papéis profissionais, equipes e organizações externas não são tabelas de banco de dados.
- **PROIBIDO incluir conceitos de processo no DER.** Metodologias, capacidades do sistema, regulamentações e requisitos não-funcionais não são tabelas de banco de dados.
- **Entidades de domínio são objetos com ciclo de vida e dados persistidos.** Teste rápido: _"Existe uma tabela (ou coleção) no banco de dados para este objeto?"_ Se não, não é entidade de domínio.

<!-- ======================================================================= -->
<!-- # SKILL: senpai-doc-diagram                                             -->
<!-- ======================================================================= -->

---
name: senpai-doc-diagram
description: "Gera diagramas de arquitetura e fluxo em formato Mermaid a partir da wiki ativa. Estratégico: C4 L1/L2. Produto: C4 L3, fluxo de processo, fluxo de dados. Tático: sequência, estado."
argument-hint: "[$mode] [$input]"
user-invocable: false
---

# Skill: Diagrama

Você foi invocado porque o usuário deseja gerar um diagrama a partir da wiki ativa. Seu trabalho é extrair informações estruturais ou comportamentais da wiki e produzir um diagrama Mermaid válido.

Siga cada passo em ordem.

> ⚠️ **Language lock (Trava de idioma):** Escreva absolutamente tudo em português brasileiro (pt-BR) — conteúdo do artefato, cabeçalhos, valores de tabela E todas as mensagens exibidas ao usuário (status updates, confirmações de escopo, perguntas, avisos, erros). Documentos de origem podem estar em outro idioma; nunca os espelhe. Esta restrição está ativa desde o Passo 0.

---

## Passo 0 — Receber parâmetros do item de trabalho ativo

### Subpasso 0.1 — Receber parâmetros do orquestrador

> **Atalho de orquestrador:** Se `WORKITEM_ID`, `WORKITEM_PATH`, `WORKITEM_TYPE`, `LANGUAGE`, `INPUT_PATH`, `OUTPUT_PATH`, `BUDDY_MODE` e `USER_INPUT` já estiverem presentes no contexto (injetados pelo `senpai-artifact`), vá para o Subpasso 0.3. Caso contrário, execute o Subpasso 0.2 para receber os parâmetros do item de trabalho ativo.

### Subpasso 0.2 — Receber parâmetros standalone

Execute:

```bash
.senpai/scripts/senpai memory get
```

**Exemplo de saída:**

```bash
senpai memory get
# id: OP-001-sistema-rv
# path: docs/discovery/OP-001-sistema-rv
# type: oportunidade
```

Extraia `$id`, `$path` e `$type` do stdout e registre os seguintes parâmetros:

- `WORKITEM_ID`    = `$id`
- `WORKITEM_PATH`  = `$path`
- `WORKITEM_TYPE`  = `$type`
- `LANGUAGE`       = `pt-BR`
- `BUDDY_MODE`     = `true` se `$mode` for `-buddy`, caso contrário `false`
- `USER_INPUT`     = `$input`

### Subpasso 0.3 — Registrar caminhos de artefatos e templates

Registre os seguintes parâmetros adicionais:

- `WORKITEM_TITLE`  = `{WORKITEM_ID}` (ou o título da página principal da wiki, se disponível)
- `DIAGRAM_NAME`    = `{WORKITEM_ID}`
- `INPUT_PATH`      = `{WORKITEM_PATH}/input`
- `OUTPUT_PATH`     = `{WORKITEM_PATH}/output`
- `TEMPLATE_PATH`   = `.senpai/skills/senpai-doc-diagram/template.md`
- `WIKI_REL_PATH`   = calculado conforme abaixo

**Calcular `WIKI_REL_PATH`:**

Execute:

```bash
.senpai/scripts/senpai wiki-rel-path {WORKITEM_PATH}/output/artifacts/diagrams
```

Registre a saída como `WIKI_REL_PATH`. Use-a em **todos** os links para páginas da wiki dentro dos arquivos de diagramas.

Derive `HIERARCHY_LEVEL` a partir de `WORKITEM_TYPE`:

| `WORKITEM_TYPE` | `HIERARCHY_LEVEL` |
|-----------------|-------------------|
| `oportunidade`  | `Strategic`       |
| `feature`       | `Product`         |
| `história`      | `Tactical`        |

Se `WORKITEM_TYPE` não se encaixar em nenhuma linha, pare e informe o usuário.

Se o usuário informou `USER_INPUT`, avalie se ele corresponde a um arquivo de feature ou história de usuário existente. Se corresponder, derive `HIERARCHY_LEVEL` a partir do tipo do arquivo e extraia o `DIAGRAM_NAME` no formato slug. Se não corresponder, pare e informe o usuário.

---

## Passo 1 — Carregar conteúdo

Tente ler cada artefato predecessor em `{OUTPUT_PATH}/artifacts/`:

| Variável                | Arquivo                                    |
|-------------------------|--------------------------------------------|
| `ARTIFACT_BRIEF`        | `{OUTPUT_PATH}/artifacts/brief.md`          |
| `ARTIFACT_REQUIREMENTS` | `{OUTPUT_PATH}/artifacts/requirements.md`   |
| `ARTIFACT_ATTRIBUTES`   | `{OUTPUT_PATH}/artifacts/attributes.md`     |
| `ARTIFACT_DER`          | `{OUTPUT_PATH}/artifacts/der.md`            |
| `ARTIFACT_ADR`          | todos os `{OUTPUT_PATH}/artifacts/adr/*.md` |

Registre em `AVAILABLE_ARTIFACTS` quais existem. Ignore silenciosamente os ausentes.

**Se pelo menos um artefato for encontrado:** use exclusivamente os artefatos como fonte. Defina `N_READ = <contagem de artefatos encontrados>`. Não execute `ingest dump`.

**Se nenhum artefato existir — fallback:** execute:

```bash
.senpai/scripts/senpai ingest dump {WORKITEM_PATH}
```

Avise o usuário:
```
Nenhum artefato predecessor encontrado em {OUTPUT_PATH}/artifacts/.
Carregando diretamente da wiki — a qualidade do diagrama será inferior.
Considere gerar brief, requirements, ADRs e DER antes de prosseguir.
```

- Primeira linha: `STATUS: sources:N concepts:N entities:N` — registre `N_READ = sources + concepts + entities`.
- `none` — nenhuma fonte ingerida; informe ao usuário e pare. Sugira executar `/senpai-ingest` primeiro.

> **Importante (fallback):** Leia este output uma única vez. Não faça chamadas `read_file` individuais para as páginas da wiki.

---

## Passo 2 — Selecionar o tipo de diagrama

**Se `HIERARCHY_LEVEL` for `Strategic` — caminho rápido (sem menu):**

Ambos os diagramas C4 são sempre gerados juntos no nível Estratégico. Não peça ao usuário para escolher.

Defina `DIAGRAM_SEQUENCE = [c4-context, c4-container]` e `DIAGRAM_TYPE = c4-context` (primeira passagem).

Anuncie:
```
Nível Estratégico detectado. Gerando ambos os diagramas C4 em sequência:
  1. C4 Nível 1 — Contexto de Sistema
  2. C4 Nível 2 — Contêiner
Iniciando com Nível 1…
```

Então prossiga para o Passo 3. Após o Passo 7 completar para `c4-context`, avance para o próximo item em `DIAGRAM_SEQUENCE`, defina `DIAGRAM_TYPE = c4-container`, anuncie `"C4 Nível 1 concluído. Gerando agora C4 Nível 2 — Contêiner…"` e retorne ao Passo 3. Pule o Passo 4 na segunda passagem (o idioma já está travado). Após o Passo 7 completar para `c4-container`, vá direto para o Passo 8.

---

**Se `HIERARCHY_LEVEL` for `Product` — mostre o menu e aguarde:**
```
Qual diagrama você deseja gerar?
  1. C4 Nível 2 — Contêiner
  2. C4 Nível 3 — Componente  (componentes dentro de um contêiner específico)
  3. Fluxo de Processo        (etapas em um processo de negócio ou usuário)
  4. Fluxo de Dados           (como os dados se movem entre partes do sistema)
```

**Se `HIERARCHY_LEVEL` for `Tactical` — mostre o menu e aguarde:**
```
Qual diagrama você deseja gerar?
  1. Sequência  (interações entre atores/componentes ao longo do tempo)
  2. Estado     (estados e transições de uma entidade ou processo)
```

Para Produto e Tático: aguarde a seleção do usuário. Registre-a como `DIAGRAM_TYPE` usando o slug correspondente (`c4-container`, `c4-component`, `process-flow`, `data-flow`, `sequence`, `state`). Não prossiga até que um tipo seja escolhido.

---

## Passo 3 — Extrair elementos por tipo de diagrama

**Se `AVAILABLE_ARTIFACTS` não estiver vazio**, use a tabela de artefatos abaixo:

| `DIAGRAM_TYPE` | Artefatos (prioridade) | O que extrair |
|---|---|---|
| `c4-context` | `brief.md` → `requirements.md` | Stakeholders (seção Principais Stakeholders), fronteira do sistema (seção Escopo), integrações externas (seção Integrações) |
| `c4-container` | `adr/*.md` → `brief.md` → `requirements.md` | Stack e decisões de infraestrutura (seção Decisão de cada ADR), protocolos, agrupamentos de fronteira |
| `c4-component` | `adr/*.md` → `requirements.md` | Componentes internos e responsabilidades mencionados em ADRs; requisitos que implicam módulos distintos |
| `process-flow` | `requirements.md` (BR-*, RN-*) → `brief.md` | Etapas (cada BR como uma etapa), pontos de decisão (RN-* com condições), atores por etapa |
| `data-flow` | `der.md` → `requirements.md` (seção Integrações) | Entidades e relacionamentos do DER; sistemas externos e protocolos de integração |
| `sequence` | `requirements.md` (BR-*, RN-*) → `der.md` | Participantes (stakeholders + entidades), mensagens derivadas de fluxos dos BR, retornos implícitos nas RN |
| `state` | `der.md` (campos `status` de cada entidade) → `requirements.md` (RN-*) | Valores de `status` como estados; RN que descrevem condições de transição |

**Se `AVAILABLE_ARTIFACTS` estiver vazio (fallback via dump)**, use a tabela de seções abaixo:

| `DIAGRAM_TYPE` | Seções do dump (primárias → secundárias) |
|---|---|
| `c4-context` | ENTITIES, SOURCES → CONCEPTS |
| `c4-container` | ENTITIES, CONCEPTS, SOURCES |
| `c4-component` | ENTITIES, CONCEPTS → SOURCES |
| `process-flow` | SOURCES → CONCEPTS |
| `data-flow` | ENTITIES, CONCEPTS → SOURCES |
| `sequence` | SOURCES, CONCEPTS → ENTITIES |
| `state` | CONCEPTS → SOURCES |

Independentemente da fonte, extraia os elementos específicos do tipo:

**Diagramas C4 — extraia:**
- Sistemas, contêineres ou componentes nomeados na wiki.
- Atores externos (usuários, serviços externos, terceiros).
- Relacionamentos e fluxos de dados entre elementos.
- Rótulos de tecnologia (linguagem, framework, protocolo), se declarados.
- Agrupamentos de fronteira (quais elementos pertencem juntos).

**Fluxo de Processo — extraia:**
- Etapas ou ações descritas em sequência.
- Pontos de decisão (condições que ramificam o fluxo).
- Atores ou papéis responsáveis por cada etapa.
- Estados iniciais e finais.

**Fluxo de Dados — extraia:**
- Elementos de dado ou entidades que se movem entre as partes.
- Origem e destino de cada movimento de dado.
- Etapas de transformação, se descritas.
- Sistemas externos envolvidos.

**Sequência — extraia:**
- Participantes (atores, sistemas, componentes).
- Mensagens trocadas em ordem cronológica.
- Interações síncronas vs assíncronas (se declaradas).
- Valores de retorno ou respostas.
- Loops ou blocos condicionais descritos nas fontes.

**Estado — extraia:**
- Estados em que a entidade pode estar.
- Eventos ou condições que disparam transições.
- Ações de entrada/saída para estados (se descritas).
- Estados terminais e iniciais.

---

## Passo 4 — Travar o idioma de saída

Antes de escrever qualquer arquivo, declare:

```
Idioma de saída travado: Português Brasileiro (pt-BR)
Todo o conteúdo do artefato, cabeçalhos e mensagens serão escritos neste idioma.
```

**Não comece a escrever nenhum arquivo até que este passo esteja concluído.** Trave-o uma única vez por invocação da skill (não uma vez por passagem).

---

## Passo 5 — Confirmar elementos do diagrama com o usuário

Antes de escrever, apresente o que encontrou:

```
Para um diagrama de {DIAGRAM_TYPE}, identifiquei:

Elementos ({N} total):
|- {nome do elemento} — {tipo: sistema | contêiner | ator | etapa | estado | participante}
|- ...

Relacionamentos / transições ({N}):
|- {A} → {B} : "{rótulo}"
|- ...

{N} elementos tiveram cobertura insuficiente na wiki (serão sinalizados como gaps).

Estas definições estão corretas? Algo a adicionar, renomear ou remover?
```

**Se `BUDDY_MODE` for `true`:** Aguarde uma resposta. Se o usuário disser "prossiga", siga em frente.

**Se `BUDDY_MODE` for `false` (padrão):** Prossiga diretamente.

---

## Passo 6 — Escrever o artefato de diagrama

Crie `{OUTPUT_PATH}/artifacts/diagrams/{DIAGRAM_NAME}-{DIAGRAM_TYPE}.md`.

Leia `{TEMPLATE_PATH}` e use a seção correspondente ao `DIAGRAM_TYPE` (cada seção está delimitada por `## {DIAGRAM_TYPE}` seguida de um bloco ` ````markdown `).

**Copie a palavra-chave do tipo de diagrama Mermaid exatamente como aparece no template** — `flowchart TB`, `flowchart TD`, `flowchart LR`, `sequenceDiagram` ou `stateDiagram-v2`. Não a altere.

> ⚠️ **Imposição de Template (não negociável):** O arquivo gerado DEVE ser estruturalmente idêntico à seção correspondente no `template.md`. Isso significa:
> - **Cabeçalhos (Headings)**: não adicione, remova ou renomeie nenhuma seção de cabeçalho.
> - **Campos YAML frontmatter**: não adicione nenhum campo que não esteja no frontmatter do template. Não remova campos obrigatórios.
> - **Sem blocos extras**: não adicione emojis, subseções extras, callouts ou qualquer bloco de conteúdo ausente no template.
> A violação de qualquer uma destas regras é um erro grave — corrija o arquivo antes de executar a validação.

Em seguida, execute a validação estrutural:

```bash
.senpai/scripts/senpai diagram lint {OUTPUT_PATH}/artifacts/diagrams/{DIAGRAM_NAME}-{DIAGRAM_TYPE}.md {TEMPLATE_PATH} {DIAGRAM_TYPE}
```

- Saída `ok` — prossiga para o Passo 7.
- Saída JSON de violações — corrija o artefato e execute novamente até obter `ok`.

---

## Passo 7 — Registrar nos arquivos de navegação

Após escrever e validar o artefato, execute:

```bash
echo "DIAGRAM_RESULT:
- diagram_type: \"{DIAGRAM_TYPE}\"
- elements: {N_ELEMENTS}
- relationships: {N_RELATIONSHIPS}
- gaps: {N_GAPS}
- sources: {N_READ}
- status: \"ok\"
- message: \"\"" | .senpai/scripts/senpai diagram register {WORKITEM_PATH}
```

O script atualiza automaticamente `{OUTPUT_PATH}/index.md` (seção `## Artifacts`) e prepende a entrada em `{OUTPUT_PATH}/log.md`. Não escreva nesses arquivos manualmente.

Para o nível Estratégico, execute o registro duas vezes — uma para `c4-context` e outra para `c4-container` — com os contadores corretos de cada passagem.

---

## Passo 8 — Fechar o ciclo

**Para o nível Estratégico (após ambas as passagens):**
```
Concluído. Ambos os diagramas C4 foram gerados:
  - C4 Nível 1: {OUTPUT_PATH}/artifacts/diagrams/{DIAGRAM_NAME}-{DIAGRAM_TYPE}.md  (N elementos, N relacionamentos)
  - C4 Nível 2: {OUTPUT_PATH}/artifacts/diagrams/{DIAGRAM_NAME}-{DIAGRAM_TYPE}.md  (N elementos, N relacionamentos)

Total de gaps sinalizados: N
Artefatos lidos: N

Deseja revisar algo?
```

**Para os níveis de Produto e Tático (diagrama único):**
```
Concluído. Diagrama de {Tipo de diagrama} gerado em {OUTPUT_PATH}/artifacts/diagrams/{DIAGRAM_NAME}-{DIAGRAM_TYPE}.md.

Elementos: N
Relacionamentos: N
Gaps sinalizados: N
Artefatos lidos: N

Deseja revisar algo?
```

---

## Regras

- **Escreva todo o conteúdo E todas as mensagens para o usuário em `pt-BR`.** Isso se aplica ao conteúdo do artefato, cabeçalhos de seção, valores de tabela, atualizações de status, mensagens de confirmação de escopo, perguntas, avisos e erros. `LANGUAGE` é sempre `pt-BR` — não há fallback para inglês.
- **Nunca invente elementos não presentes nos artefatos predecessores (ou na wiki, no fallback).** Use `> [!gap]` para qualquer item sem cobertura na fonte utilizada.
- **`flowchart` é obrigatório para todos os diagramas C4.** Nunca use os tipos Mermaid `C4Context`, `C4Container` ou `C4Component` — eles são proibidos. Todos os diagramas c4-context, c4-container e c4-component devem abrir com `flowchart TB` exatamente como no template.
- **Siga o template literalmente para a palavra-chave do tipo Mermaid.** A palavra-chave de abertura de cada bloco de diagrama (`flowchart TB`, `flowchart TD`, `flowchart LR`, `sequenceDiagram`, `stateDiagram-v2`) é fixa pelo template e não deve ser alterada ou substituída.
- **A sintaxe Mermaid deve ser válida.** Teste mentalmente antes de escrever — prefira um diagrama simples e correto a um complexo e quebrado.
- **Nunca combine elementos distintos** para encurtar o diagrama. Um sistema = um nó; um contêiner = um nó.
- **Nunca modifique páginas de fonte/conceito/entidade.** A geração do diagrama é apenas leitura na wiki.
- **O nível Estratégico nunca mostra um menu.** Ambos C4 L1 e C4 L2 são sempre gerados em sequência automaticamente.
- **Nunca pule o Passo 2 para Produto/Tático.** O tipo de diagrama deve ser explicitamente selecionado — não tente adivinhar.
- **No modo buddy, nunca pule o Passo 5.** Quando `BUDDY_MODE` for `true`, o usuário deve confirmar os elementos antes da escrita. No modo não-buddy, prossiga automaticamente.
- **Nunca pule o Passo 4.** O idioma deve ser travado antes de qualquer arquivo ser escrito — trave-o uma única vez por invocação da skill (não uma vez por passagem).
- **Rótulos de tecnologia vêm apenas dos ADRs.** Se nenhum ADR declarar a tecnologia, use `"não declarado"` na descrição do elemento do diagrama.
- **Um arquivo de artefato por tipo de diagrama.** O nível Estratégico gera dois arquivos (`c4-context.md` e `c4-container.md`) em uma única execução da skill.

<!-- ======================================================================= -->
<!-- # SKILL: senpai-doc-feature                                             -->
<!-- ======================================================================= -->

---
name: senpai-doc-feature
description: "Gera o detalhamento de features com decomposição de histórias de usuário a partir da wiki ativa. Em oportunidade, gera todas as features com integridade entre si; em feature standalone (brownfield), gera a feature única com contexto AS-IS + porção de modificação."
argument-hint: "[$mode]"
user-invocable: false
---

# Skill: Detalhamento de Feature

Você foi invocado porque o usuário deseja gerar o detalhamento de feature(s) a partir da wiki ativa. Seu trabalho é transformar o conhecimento ingerido e os artefatos predecessores em um ou mais documentos de feature — cada um com escopo, regras, critérios de aceite e uma proposta de decomposição em histórias de usuário.

Esta skill possui **dois fluxos**, determinados pelo tipo do item de trabalho ativo:

| `WORKITEM_TYPE` | `FLOW` | Comportamento |
|---|---|---|
| `oportunidade` | `oportunidade` | **Greenfield / múltiplas features.** Decompõe o escopo da oportunidade em N features. Cada feature é escrita **isoladamente** em `output/artifacts/features/<id>-<slug>.md`, mais um índice. As features devem manter **integridade entre si** (cobertura total, sem sobreposição, IDs únicos, dependências consistentes). |
| `feature` | `feature` | **Brownfield / standalone.** O item de trabalho já é uma feature. Gera **apenas uma** feature em `output/artifacts/feature.md`, baseada no conteúdo ingerido + artefatos predecessores, representando um contexto **AS-IS** (o que já existe) mais a **porção de modificação** (o que muda). |

Se `WORKITEM_TYPE` for `historia` ou qualquer outro tipo, informe ao usuário que este artefato não é aplicável para essa camada e pare.

Siga cada passo em ordem.

> ⚠️ **Language lock (Trava de idioma):** Escreva absolutamente tudo em português brasileiro (pt-BR) — conteúdo do artefato, cabeçalhos, valores de tabela E todas as mensagens exibidas ao usuário (status updates, confirmações de escopo, perguntas, avisos, erros). Documentos de origem podem estar em outro idioma; nunca os espelhe. Esta restrição está ativa desde o Passo 0.

---

## Passo 0 — Receber parâmetros do item de trabalho ativo

### Subpasso 0.1 — Receber parâmetros do orquestrador

> **Atalho de orquestrador:** Se `WORKITEM_ID`, `WORKITEM_PATH`, `WORKITEM_TYPE`, `LANGUAGE`, `INPUT_PATH`, `OUTPUT_PATH`, `BUDDY_MODE` e `USER_INPUT` já estiverem presentes no contexto (injetados pelo `senpai-artifact`), vá para o Subpasso 0.3. Caso contrário, execute o Subpasso 0.2 para receber os parâmetros do item de trabalho ativo.

### Subpasso 0.2 — Receber parâmetros standalone

Execute:

```bash
.senpai/scripts/senpai memory get
```

**Exemplo de saída:**

```bash
senpai memory get
# id: OP-001-sistema-rv
# path: docs/discovery/OP-001-sistema-rv
# type: oportunidade
```

Extraia `$id`, `$path` e `$type` do stdout e registre os seguintes parâmetros:

- `WORKITEM_ID`    = `$id`
- `WORKITEM_PATH`  = `$path`
- `WORKITEM_TYPE`  = `$type`
- `LANGUAGE`       = `pt-BR`
- `BUDDY_MODE`     = `true` se `$mode` for `-buddy`, caso contrário `false`

### Subpasso 0.3 — Registrar caminhos de artefatos e templates

Registre os seguintes parâmetros adicionais:

- `WORKITEM_TITLE`  = `{WORKITEM_ID}` (ou o título da página principal da wiki, se disponível)
- `INPUT_PATH`      = `{WORKITEM_PATH}/input`
- `OUTPUT_PATH`     = `{WORKITEM_PATH}/output`
- `TEMPLATE_PATH`   = `.senpai/skills/senpai-doc-feature/template.md`
- `REFERENCE_PATH`  = `.senpai/skills/senpai-doc-feature/references/quebra-historias.md`
- `ARTIFACT_DIR`    = `{OUTPUT_PATH}/artifacts/features` se `FLOW` for `oportunidade`, ou `{OUTPUT_PATH}/artifacts/` se `FLOW` for `feature`.
- `WIKI_REL_PATH`   = calculado conforme abaixo

**Calcular `WIKI_REL_PATH`:**

Execute:

```bash
.senpai/scripts/senpai wiki-rel-path {ARTIFACT_DIR}
```

Registre a saída como `WIKI_REL_PATH`. Use-a em **todos** os links para páginas da wiki dentro dos arquivos de feature. O formato correto é `{$WIKI_REL_PATH}/{sources|concepts|entities}/{slug}.md`. Nunca construa caminhos relativos de cabeça — sempre derive de `WIKI_REL_PATH`.

---

## Passo 1 — Carregar insumos

O detalhamento de feature é um artefato **downstream**: os artefatos predecessores já são a destilação curada da wiki. Portanto, a fonte primária são os artefatos — não o dump bruto da wiki. Só recorra ao dump completo quando **nenhum** artefato existir.

### 1.1 — Ler os artefatos predecessores (fonte primária)

Tente ler cada artefato em `{OUTPUT_PATH}/artifacts/`. Eles formam o **contexto de referência** (e, no fluxo `feature`, o baseline **AS-IS**):

| Insumo | Arquivo | Papel na geração |
|---|---|---|
| `requirements` | `{OUTPUT_PATH}/artifacts/requirements.md` | **Fonte primária** de *quais* features/histórias existem — escopo, regras e critérios de aceite |
| `brief` | `{OUTPUT_PATH}/artifacts/brief.md` | Metas estratégicas e recorte de escopo do MVP |
| `attributes` | `{OUTPUT_PATH}/artifacts/attributes.md` | Atributos de qualidade e restrições — origem de histórias não funcionais |
| `der` | `{OUTPUT_PATH}/artifacts/der.md` | Modelo de dados — origem das "Interações com Entidades e Dados" |
| `adr` | todos os `{OUTPUT_PATH}/artifacts/adr/*.md` | Decisões de arquitetura — restringem especialidade e unidade de deploy |

### 1.2 — Ler os diagramas (apoio à decomposição)

Tente ler cada diagrama em `{OUTPUT_PATH}/artifacts/diagrams/*.md`. Eles são o insumo estrutural que define as **fronteiras de deploy** usadas na quebra de histórias do Passo 3 — não definem *quais* features existem, mas *como* decompô-las:

| Diagrama | Arquivo | O que informa à decomposição |
|---|---|---|
| C4 Contêiner | `diagrams/c4-container.md` | Unidades de deploy (API Gateway, Backend, Worker, Job) — eixo central da quebra |
| C4 Componente | `diagrams/c4-component.md` | Componentes internos e responsabilidades |
| Sequência | `diagrams/sequence.md` | Interações entre componentes → participantes e mensagens |
| Fluxo de Processo | `diagrams/process-flow.md` | Etapas do processo → candidatas a histórias |
| Fluxo de Dados | `diagrams/data-flow.md` | Movimento de dados entre partes → interações com entidades |
| Estado | `diagrams/state.md` | Transições de `status` → critérios de aceite |

Leia cada arquivo que existir. Ignore silenciosamente os ausentes. Registre em `AVAILABLE_INPUTS` a lista dos insumos encontrados e em `N_ARTIFACTS` a quantidade total de arquivos lidos em 1.1 e 1.2.

### 1.3 — Decidir a fonte

**Se `N_ARTIFACTS ≥ 1` (caminho primário):** use exclusivamente os artefatos e diagramas como fonte. **Não** execute `ingest dump`. Defina `N_SOURCES = N_CONCEPTS = N_ENTITIES = 0` (nenhuma página de wiki foi lida).

> Exceção pontual: se o fluxo exigir dados de personas/entidades e **não** houver `der.md` nem `requirements.md` suficientes, sinalize a lacuna com `> [!gap]` no artefato — não caia para o dump apenas por isso.

**Se `N_ARTIFACTS == 0` (fallback):** execute o dump completo da wiki e avise o usuário que a qualidade será inferior:

```bash
.senpai/scripts/senpai ingest dump {WORKITEM_PATH}
```

```
Nenhum artefato predecessor encontrado em {OUTPUT_PATH}/artifacts/.
Carregando diretamente da wiki — a qualidade das features será inferior.
Considere gerar requisitos, ADRs, DER e diagramas antes de prosseguir.
```

- Primeira linha: `STATUS: sources:N concepts:N entities:N` — registre os totais como `N_SOURCES`, `N_CONCEPTS`, `N_ENTITIES` e `N_READ = N_SOURCES + N_CONCEPTS + N_ENTITIES`.
- Linhas seguintes: conteúdo completo das páginas, delimitadas por `--- <caminho> ---`, agrupadas em `=== SOURCES ===`, `=== CONCEPTS ===`, `=== ENTITIES ===`.
- `none` — nenhuma fonte ingerida; informe ao usuário e pare. Sugira executar `/senpai-ingest` primeiro.

> **Importante (fallback):** Leia o dump uma única vez. Não faça chamadas `read_file` individuais para as páginas da wiki — todo o conteúdo já está presente na saída do comando acima.

Se, no fallback, a wiki tiver menos de 3 páginas, avise o usuário que as features terão lacunas significativas e pergunte se deseja prosseguir ou gerar `requisitos` antes.


---

## Passo 2 — Determinar as features

O que fazer depende de `FLOW`.

### 2.A — Fluxo `oportunidade` (múltiplas features com integridade)

Identifique o conjunto de features que, **em conjunto**, cobrem o escopo da oportunidade. Derive-as prioritariamente das capacidades de `requirements.md` e do escopo de `brief.md`; use os diagramas e demais artefatos como apoio (e, no fallback, a wiki).

O nome do arquivo será `{ARTIFACT_DIR}/{id}-{slug}.md` (ex.: `F-001-gestao-de-editais.md`).

**Regras de integridade (obrigatórias neste fluxo):**

- **Cobertura total:** cada requisito/capacidade relevante dos artefatos predecessores deve ser coberto por **pelo menos uma** feature. Nenhuma capacidade em escopo pode ficar órfã.
- **Sem sobreposição:** cada requisito pertence a **exatamente uma** feature. Não duplique a mesma regra em features diferentes — referencie a feature dona.
- **IDs únicos e estáveis:** nunca reutilize um `F-NNN`. Se já existirem arquivos em `{ARTIFACT_DIR}`, continue a numeração a partir do maior ID existente.
- **Dependências consistentes:** quando uma feature depende de outra, registre a relação na seção `## Dependências e Relações de Integridade` de **ambas** com direção coerente (origem → destino). Não crie dependências circulares sem sinalizá-las como gap.
- **Coesão por unidade de deploy:** agrupe em uma mesma feature capacidades que compartilham contexto funcional e persistência; separe o que é implantado de forma independente.

Monte uma **matriz de rastreabilidade** (requisito → feature) para validar cobertura e ausência de sobreposição. Você a usará na confirmação do Passo 4 e nas relações de integridade do Passo 5.

Registre `N_FEATURES` = número de features identificadas.

### 2.B — Fluxo `feature` (standalone / brownfield — AS-IS + modificação)

O item de trabalho já é a feature. Haverá **uma única** feature. Defina:
- `SELECTED_FEATURE_ID` = `WORKITEM_ID`
- `SELECTED_FEATURE_NAME` = `WORKITEM_TITLE`
- `N_FEATURES` = 1

Trate o conteúdo ingerido e os artefatos predecessores como o **contexto AS-IS**: o sistema, os dados e os processos que **já existem**. A feature descreve a **porção de modificação** sobre esse baseline.

Como o template é fixo (Passo 5), distinga AS-IS de modificação **dentro das seções existentes**, usando marcadores inline no início do item:
- `[AS-IS]` — comportamento, entidade ou dependência que **já existe** e não muda (contexto).
- `[MODIFICAÇÃO]` — comportamento novo ou alterado introduzido por esta feature.

Aplique os marcadores principalmente em `## Escopo Funcional`, `## Interações com Entidades e Dados` e `## Dependências de Sistema`. O `## Objetivo` e o `## Resumo da Feature` devem deixar claro que se trata de uma evolução sobre um sistema existente.

---

## Passo 3 — Decompor histórias de usuário

Para **cada** feature, proponha a decomposição em histórias de usuário seguindo estritamente a referência:

```
Leia {REFERENCE_PATH}
```

Aplique as regras de quebra ao produzir a tabela `## Decomposição de Histórias de Usuário (Proposta)`. Use os **diagramas** lidos no Passo 1.2 como principal insumo para as fronteiras de deploy (c4-container/c4-component definem as unidades; sequence/process-flow sugerem participantes e etapas):

- **Coesão técnica:** mantenha juntas capacidades do mesmo worker/job/componente que não podem ser implantadas de forma independente.
- **APIs REST → duas histórias:** para cada novo endpoint REST, gere **uma história de API Gateway** (scope, autenticação, autorização, throttling, mapeamento) e **uma história de Backend** (lógica, validações, persistência, testes, OpenAPI).
- **Workers/Jobs → história única e completa:** consumo/scheduling + processamento + retry + persistência em uma só história.
- **Notas INVEST:** para cada história, resuma as dimensões I-N-V-E-S-T na coluna `Notas INVEST`.

Mapeie as dimensões de classificação da referência para as colunas do template:

| Coluna do template | Origem na referência |
|---|---|
| `Tipo (Natureza)` | Funcional ou Não Funcional |
| `Classificação (Sub)` | Subclassificação (ex.: Nova funcionalidade, Evolução Técnica, Setup de Ambiente) |
| `Especialidade` | negocios / ia / analitics / mainframe / legado / aws |
| `Prioridade` | Must / Should / Could / Won't |

Numere as histórias como `US-001`, `US-002`, … reiniciando a numeração por feature. Registre `N_STORIES` = total de histórias somando todas as features.

---

## Passo 4 — Confirmar o escopo com o usuário

Antes de escrever, apresente o que encontrou.

**Fluxo `oportunidade`:**

```
Com base nos artefatos e na wiki ({N_READ} páginas), proponho {N_FEATURES} features:

1. F-001 — {Nome}  ({X} histórias)
2. F-002 — {Nome}  ({Y} histórias)
...

Rastreabilidade: {N} requisitos cobertos, 0 órfãos, 0 sobreposições.
Dependências entre features: {resumo curto ou "nenhuma"}.

Este recorte está correto? Deseja unir, dividir ou renomear alguma feature?
```

**Fluxo `feature`:**

```
Detalhando a feature {SELECTED_FEATURE_ID} — {SELECTED_FEATURE_NAME} (contexto brownfield).

Baseline AS-IS: {resumo do que já existe, a partir dos artefatos}.
Porção de modificação: {resumo do que muda}.
Histórias propostas: {N_STORIES}.

Esta delimitação AS-IS × modificação está correta?
```

**Se `BUDDY_MODE` for `true`:** Aguarde uma resposta. Ajuste conforme o feedback. Se o usuário disser "prossiga", siga em frente.

**Se `BUDDY_MODE` for `false` (padrão):** Prossiga diretamente.

---

## Passo 5 — Escrever o(s) artefato(s) de feature

Leia o template em `{TEMPLATE_PATH}`. Para cada feature, preencha **todos** os placeholders e escreva um arquivo:

- Fluxo `oportunidade`: `{ARTIFACT_DIR}/{id}-{slug}.md` (um arquivo por feature).
- Fluxo `feature`: `{ARTIFACT_DIR}/feature.md` (arquivo único).

Preencha o frontmatter: `feature_id` = `F-NNN` (ou `WORKITEM_ID` no standalone), `work_item_type` = `WORKITEM_TYPE`, `generated` = data de hoje (`YYYY-MM-DD`), `sources_read` = `N_READ`, `total_stories` = nº de histórias **daquela** feature.

> ⚠️ **Imposição de Template (não negociável):** Cada arquivo gerado DEVE ser estruturalmente idêntico ao `template.md`:
> - **Cabeçalhos (Headings)**: não adicione, remova ou renomeie nenhuma seção (`##`/`###`).
> - **Colunas de tabela**: não adicione, remova ou renomeie nenhuma coluna. Mantenha nomes e ordem exatos.
> - **Campos YAML frontmatter**: não adicione campos ausentes no template. Não remova campos obrigatórios.
> - **Sem blocos extras**: sem emojis, subseções extras ou callouts ausentes no template.
> A violação de qualquer uma destas regras é um erro grave — corrija o arquivo antes de rodar a validação.

Regras de conteúdo:
- Toda afirmação factual cita a página da wiki ou o artefato de origem com `[markdown link]`. Para páginas da wiki, use `{$WIKI_REL_PATH}/{sources|concepts|entities}/{slug}.md`.
- Onde a wiki não cobrir uma seção, use `> [!gap]`. Nunca invente requisitos, regras ou entidades.
- No fluxo `oportunidade`, preencha `## Dependências e Relações de Integridade` com a decomposição (`{feature} → US-NNN`, relação "Decomposição") **e** com as dependências entre features apuradas na matriz de rastreabilidade.
- No fluxo `feature`, aplique os marcadores `[AS-IS]` / `[MODIFICAÇÃO]` conforme o Passo 2.B.

Após escrever **cada** arquivo, execute a validação estrutural:

```bash
.senpai/scripts/senpai feature lint <arquivo-gerado> {TEMPLATE_PATH}
```

- Saída `ok` → prossiga para a próxima feature.
- Saída JSON de violações → corrija o arquivo e execute novamente até obter `ok`.

Não escreva o índice, não atualize arquivos de navegação e não reporte sucesso antes que **todos** os arquivos de feature passem na validação.

---

## Passo 6 — Escrever o índice de features (somente fluxo `oportunidade`)

No fluxo `oportunidade`, crie ou atualize `{ARTIFACT_DIR}/index.md`:

```markdown
---
title: "Índice de Features — {WORKITEM_TITLE}"
type: artifact
subtype: feature-index
generated: YYYY-MM-DD
---

# Features: {WORKITEM_TITLE}

| ID | Feature | Histórias | Prioridade |
|----|---------|-----------|------------|
| F-001 | [Nome da feature](F-001-slug) | N | Must |
| F-002 | ... | ... | ... |
```

## Dependências e Relações de Integridade

| Item Origem | Item Destino | Relação | Descrição |
|----|---|---|---|
| F-001 | F-002 | Dependência | F-001 depende de F-002 para ... |
| F-002 | ... | ... | ... | 

No fluxo `feature`, **pule este passo** — não há índice para arquivo único.

---

## Passo 7 — Registrar via CLI

Execute, passando as contagens coletadas:

```bash
echo "FEATURE_RESULT:
- flow: \"{FLOW}\"
- features: {N_FEATURES}
- stories: {N_STORIES}
- gaps: {N_GAPS}
- artifacts: {N_ARTIFACTS}
- sources: {N_SOURCES}
- concepts: {N_CONCEPTS}
- entities: {N_ENTITIES}
- status: \"ok\"
- message: \"\"" | .senpai/scripts/senpai feature register {WORKITEM_PATH}
```

O script atualiza automaticamente `{OUTPUT_PATH}/index.md` (seção `## Artifacts`) e prepende a entrada em `{OUTPUT_PATH}/log.md`. Não escreva nesses arquivos manualmente.

---

## Passo 8 — Fechar o ciclo

Diga ao usuário o que foi feito.

**Fluxo `oportunidade`:**

```
Concluído. {N_FEATURES} features geradas em {ARTIFACT_DIR}.

Features: {N_FEATURES} (índice em {ARTIFACT_DIR}/index.md)
Histórias propostas: {N_STORIES}
Rastreabilidade: {N} requisitos cobertos, 0 órfãos, 0 sobreposições
Gaps sinalizados: {N_GAPS}
Insumos lidos: {N_ARTIFACTS} artefatos predecessores (ou {N_READ} páginas de wiki, no fallback)

Deseja revisar algo antes de continuarmos?
```

**Fluxo `feature`:**

```
Concluído. Feature detalhada em {ARTIFACT_DIR}/feature.md.

Feature: {SELECTED_FEATURE_ID} — {SELECTED_FEATURE_NAME} (brownfield: AS-IS + modificação)
Histórias propostas: {N_STORIES}
Gaps sinalizados: {N_GAPS}
Insumos lidos: {N_ARTIFACTS} artefatos predecessores (ou {N_READ} páginas de wiki, no fallback)

Deseja revisar algo antes de continuarmos?
```

---

## Regras

- **Escreva todo o conteúdo E todas as mensagens ao usuário em `pt-BR`.** Sem fallback para inglês.
- **Artefatos são a fonte primária; a wiki é fallback.** Como artefato downstream, esta skill lê `requirements.md`, `brief.md`, `attributes.md`, `der.md`, `adr/*.md` e os `diagrams/*.md`. Só execute `ingest dump` quando **nenhum** artefato existir — nunca combine dump completo e artefatos na mesma geração.
- **Os diagramas guiam a decomposição, não o escopo.** Use `c4-container`/`c4-component`/`sequence`/`process-flow`/`data-flow`/`state` para as fronteiras de deploy do Passo 3; os requisitos definem *quais* features existem.
- **Nunca invente requisitos, regras, entidades ou histórias não respaldados pelos artefatos (ou pela wiki, no fallback).** Use `> [!gap]` para lacunas.
- **No fluxo `oportunidade`, a integridade entre features é obrigatória:** cobertura total, sem sobreposição, IDs únicos, dependências consistentes. Uma matriz de rastreabilidade sem órfãos é pré-requisito para escrever os arquivos.
- **No fluxo `feature`, o artefato representa AS-IS + modificação.** Nunca descreva a feature como greenfield quando os artefatos indicam um sistema existente; marque o que já existe com `[AS-IS]`.
- **Um template compartilhado para os dois fluxos.** Não crie variações de template — ambos usam `{TEMPLATE_PATH}` e devem ser estruturalmente idênticos a ele.
- **A decomposição de histórias segue `{REFERENCE_PATH}`.** Cada endpoint REST vira duas histórias (API Gateway + Backend); workers/jobs permanecem em uma história única.
- **Nunca modifique páginas de fontes, conceitos ou entidades da wiki.** Os únicos arquivos escritos são os de feature em `{ARTIFACT_DIR}`, o `index.md` de features (fluxo `oportunidade`), `{OUTPUT_PATH}/index.md` e `{OUTPUT_PATH}/log.md`.
- **Links para páginas da wiki usam sempre `WIKI_REL_PATH`.** Nunca construa caminhos relativos manualmente.
- **No modo buddy, nunca pule o Passo 4.** O usuário deve confirmar o recorte de features (ou a delimitação AS-IS × modificação) antes de qualquer arquivo ser escrito.

<!-- ======================================================================= -->
<!-- # SKILL: senpai-doc-requirements                                        -->
<!-- ======================================================================= -->

---
name: senpai-doc-requirements
description: "Gera um artefato de requisitos ou atributos a partir da wiki ativa."
argument-hint: "[$mode]"
user-invocable: false
---

# Skill: Requisitos e Atributos

Você foi invocado pelo orquestrador porque o usuário deseja gerar uma lista de requisitos ou atributos para o item de trabalho ativo. Seu trabalho é extrair e estruturar cada requisito presente na wiki — não inventar requisitos do seu conhecimento de treinamento.

> ⚠️ **Language lock:** Escreva absolutamente tudo em pt-BR — conteúdo do artefato, cabeçalhos, valores de tabela E todas as mensagens exibidas ao usuário. Esta restrição está ativa desde este ponto.

---

## Passo 0 — Receber parâmetros do item de trabalho ativo

### Subpasso 0.1 — Receber parâmetros do orquestrador

> **Atalho de orquestrador:** Se `WORKITEM_ID`, `WORKITEM_PATH`, `WORKITEM_TYPE`, `LANGUAGE`, `INPUT_PATH`, `OUTPUT_PATH`, `BUDDY_MODE` e `USER_INPUT` já estiverem presentes no contexto (injetados pelo `senpai-artifact`), vá para o Subpasso 0.3. Caso contrário, execute o Subpasso 0.2 para receber os parâmetros do item de trabalho ativo.

### Subpasso 0.2 — Receber parâmetros standalone

Execute o script de memória para recuperar o item de trabalho ativo:

```bash
.senpai/scripts/senpai memory get
```

**Exemplo de saída:**

```bash
senpai memory get
# id: OP-001-sistema-rv
# path: docs/discovery/OP-001-sistema-rv
# type: oportunidade
```

Extraia `$id`, `$path` e `$type` do stdout e registre os seguintes parâmetros:

- `WORKITEM_ID`    = `$id`
- `WORKITEM_PATH`  = `$path`
- `WORKITEM_TYPE`  = `$type`
- `LANGUAGE`       = `pt-BR`
- `BUDDY_MODE`     = `true` se `$mode` for `-buddy`, caso contrário `false`

### Subpasso 0.3 — Registrar caminhos de artefatos e templates

Registre os seguintes parâmetros adicionais:

- `OUTPUT_PATH`    = `{WORKITEM_PATH}/output`
- `WIKI_REL_PATH`  = calculado conforme abaixo

**Calcular `WIKI_REL_PATH`:**

Execute:

```bash
.senpai/scripts/senpai wiki-rel-path {OUTPUT_PATH}/artifacts
```

Registre a saída como `WIKI_REL_PATH`.

### Subpasso 0.4 — Determinar tipo de artefato e template

Determine `HIERARCHY_LEVEL` a partir de `WORKITEM_TYPE`:

| `WORKITEM_TYPE` | `HIERARCHY_LEVEL` |
|-----------------|-------------------|
| `oportunidade`  | `discovery`       |
| `feature`       | `delivery`        |
| `historia`      | `delivery`        |
| outro           | Pare. Tipo de item de trabalho não suportado. |

Mapeie `{ARTIFACT_TYPE}` (definido pelo orquestrador) para o identificador interno:

| `ARTIFACT_TYPE` recebido | Identificador interno |
|--------------------------|-----------------------|
| `atributos`              | `attributes`          |
| `requisitos`             | `requirements`        |

Se o identificador interno for `attributes` e `HIERARCHY_LEVEL` não for `discovery`, pare e informe:
> `atributos` está disponível apenas para itens de discovery. Para Delivery, use `/senpai-artifact requisitos`.

Resolva `RESOLVED_MODE` e `TEMPLATE_PATH`:

| Identificador interno | `HIERARCHY_LEVEL` | `RESOLVED_MODE` | `TEMPLATE_PATH` |
|-----------------------|-------------------|-----------------|-----------------|
| `attributes`          | `discovery`       | `constraints`   | `.senpai/skills/senpai-doc-requirements/template-constraints.md` |
| `requirements`        | `discovery`       | `business`      | `.senpai/skills/senpai-doc-requirements/template-business.md` |
| `requirements`        | `delivery`        | `functional`    | `.senpai/skills/senpai-doc-requirements/template-functional.md` |

Resolva também o arquivo de saída:
- `RESOLVED_MODE = constraints` → `ARTIFACT_FILE = attributes.md`
- `RESOLVED_MODE = business` ou `functional` → `ARTIFACT_FILE = requirements.md`
- `ARTIFACT_PATH = {OUTPUT_PATH}/artifacts/{ARTIFACT_FILE}`

---

## Passo 1 — Carregar conteúdo da wiki

Execute:

```bash
.senpai/scripts/senpai ingest dump {WORKITEM_PATH}
```

**Saída esperada:**
- Primeira linha: `STATUS: sources:N concepts:N entities:N` — registre os totais como `N_SOURCES`, `N_CONCEPTS`, `N_ENTITIES`.
- Linhas seguintes: conteúdo completo das páginas, delimitadas por `--- <caminho> ---`, agrupadas em `=== SOURCES ===`, `=== CONCEPTS ===`, `=== ENTITIES ===`.
- `none` — nenhuma fonte ingerida; pare e informe o usuário. Sugira executar `/senpai-ingest` primeiro.

> **Importante:** Leia este output uma única vez. Não faça chamadas `read_file` individuais — todo o conteúdo já está presente.

**Filtro:** ignore conteúdo com metadado `status: discarded` ou callouts `[!contradiction]` sinalizando item fora de escopo.

Enquanto processa, rastreie conforme o modo:

- **Modo `constraints`:** desempenho, escalabilidade, disponibilidade, segurança, privacidade, compliance, interoperabilidade, princípios arquiteturais.
- **Modo `business`:** capacidades de alto nível, regras de negócio, necessidades do usuário em nível conceitual, pontos de integração, exclusões explícitas. NÃO extraia critérios de aceitação.
- **Modo `functional`:** capacidades, regras e validações, interações de usuário, requisitos de dados (campos, formatos, volumes), integrações, exclusões.

**Em todos os modos:** leia artefatos irmãos já existentes em `{OUTPUT_PATH}/artifacts/` (ex: `brief.md`, `attributes.md`) como contexto adicional. Não contradiga o que está documentado nesses artefatos.

Rastreie a página fonte para cada item encontrado. Nunca crie um requisito sem respaldo na wiki.
Se a wiki tiver menos de 3 páginas, avise o usuário que o artefato terá lacunas significativas e pergunte se deseja prosseguir.

---

## Passo 2 — Confirmar escopo com o usuário

Apresente um resumo do que encontrou:

```
Com base na wiki ({N} páginas), encontrei:

• {N} itens para documentar
• {N} itens respaldados por múltiplas fontes
• {N} áreas sem cobertura (gaps)

Modo: {RESOLVED_MODE}
Categorias detectadas: [lista]

Deseja que algo seja excluído, reformulado ou dividido de forma diferente?
```

**Se `BUDDY_MODE` for `true`:** Aguarde resposta. Se o usuário disser "prossiga", siga em frente.

**Se `BUDDY_MODE` for `false` (padrão):** Prossiga diretamente.

---

## Passo 3 — Escrever o artefato

Leia o template em `{TEMPLATE_PATH}` e preencha todos os placeholders com o conteúdo extraído. Mantenha a estrutura do template intacta.

> ⚠️ **Imposição de Template (não negociável):**
> - **Cabeçalhos**: não adicione, remova ou renomeie nenhuma seção.
> - **Colunas de tabela**: não adicione, remova ou renomeie nenhuma coluna. Mantenha nomes e ordem exatos.
> - **Campos YAML frontmatter**: não adicione campos ausentes no template; não remova campos obrigatórios.
> - **Sem blocos extras**: sem emojis, subseções extras ou callouts ausentes no template.

Regras de escrita:
- Toda afirmação factual deve citar a página da wiki com `[markdown link]({$WIKI_REL_PATH}/<referência>)`.
- Se a wiki não cobrir uma seção, use `> [!gap]`.
- Sinalize contradições com `> [!contradiction]` e cite ambos os lados.
- Escrita direta e simples. Evite voz passiva.

**IMPORTANTE:** Antes de escrever o arquivo, substitua todas as ocorrências do placeholder `{$WIKI_REL_PATH}` pelo valor calculado de `WIKI_REL_PATH`.

Escreva o conteúdo em `{ARTIFACT_PATH}`.

Em seguida, valide:

```bash
.senpai/scripts/senpai requirements lint {ARTIFACT_PATH} {TEMPLATE_PATH}
```

- Saída `ok` — prossiga para o Passo 4.
- Saída JSON de violações — corrija o artefato e execute novamente até obter `ok`.

---

## Passo 4 — Registrar via CLI

Execute:

```bash
echo "REQUIREMENTS_RESULT:
- mode: \"{RESOLVED_MODE}\"
- artifact: \"{ARTIFACT_FILE}\"
- items: {N_ITEMS}
- gaps: {N_GAPS}
- sources: {N_SOURCES}
- concepts: {N_CONCEPTS}
- entities: {N_ENTITIES}
- status: \"ok\"
- message: \"\"" | .senpai/scripts/senpai requirements register {WORKITEM_PATH}
```

O script atualiza automaticamente `{OUTPUT_PATH}/index.md` (seção `## Artifacts`) e prepende a entrada em `{OUTPUT_PATH}/log.md`. Não escreva nesses arquivos manualmente.

---

## Passo 5 — Fechar o ciclo

```
Concluído. Artefato gerado em {ARTIFACT_PATH}.

Modo: {RESOLVED_MODE}
Itens documentados: {N_ITEMS}
Gaps sinalizados: {N_GAPS}
Fontes lidas: {total} páginas (fontes: {N_SOURCES}, conceitos: {N_CONCEPTS}, entidades: {N_ENTITIES})
```

---

## Regras

- **Escreva tudo em pt-BR** — conteúdo, cabeçalhos, valores de tabela, mensagens, avisos e erros.
- **Nunca escreva conteúdo não suportado pela wiki.** Use `> [!gap]` para lacunas.
- **Nunca modifique páginas de sources ou concepts.** Os únicos arquivos que você escreve são `{ARTIFACT_PATH}`, a seção Artifacts de `{OUTPUT_PATH}/index.md` e `{OUTPUT_PATH}/log.md`.
- **No modo buddy, nunca pule o Passo 2.**
- **`atributos` é exclusivo para Discovery.** Nunca gere `attributes.md` para um item de Delivery.
- **Modo `business` não possui critérios de aceitação.** Descreva capacidades em nível conceitual; detalhes pertencem ao modo `functional`.
- **Prioridades aceitas: Must / Should / Could / Won't.** Não use escalas numéricas a menos que a wiki declare explicitamente.

<!-- ======================================================================= -->
<!-- # SKILL: senpai-doc-story                                               -->
<!-- ======================================================================= -->

---
name: senpai-doc-story
description: "Gera histórias de usuário a partir da wiki ativa. Em oportunidade/feature, expande a Feature informada em N histórias isoladas com integridade entre si; em história standalone (brownfield), gera a história única com contexto AS-IS + porção de modificação."
argument-hint: "[$mode] [$feature_file]"
user-invocable: false
---

# Skill: História de Usuário

Você foi invocado porque o usuário deseja gerar história(s) de usuário a partir da wiki ativa. Seu trabalho é transformar o conhecimento ingerido e os artefatos predecessores em um ou mais documentos de história — cada um com contexto de negócio, critérios de aceite, cenários Gherkin, regras de negócio e definição de pronto.

Esta skill possui **dois fluxos**, determinados pelo tipo do item de trabalho ativo:

| `WORKITEM_TYPE` | `FLOW` | Comportamento |
|---|---|---|
| `oportunidade` / `feature` | `linked` | **Vinculado a uma Feature.** O usuário **informa a Feature** à qual as histórias pertencem (via `#file:F-001-....md`). Expande a decomposição da Feature em N histórias, cada uma escrita **isoladamente** em `output/artifacts/stories/<feature_id>/<US-NNN>-<slug>.md`, mais um índice. As histórias devem manter **integridade entre si** (cobertura da decomposição, IDs únicos, sem sobreposição, dependências consistentes). |
| `historia` | `standalone` | **Brownfield / standalone.** O item de trabalho já é uma história. Gera **apenas uma** história em `output/artifacts/story.md`, baseada no conteúdo ingerido + artefatos predecessores, representando um contexto **AS-IS** (o que já existe) mais a **porção de modificação** (o que muda). |

Se `WORKITEM_TYPE` for qualquer outro tipo, informe ao usuário que este artefato não é aplicável para essa camada e pare.

Siga cada passo em ordem.

> ⚠️ **Language lock (Trava de idioma):** Escreva absolutamente tudo em português brasileiro (pt-BR) — conteúdo do artefato, cabeçalhos, valores de tabela E todas as mensagens exibidas ao usuário (status updates, confirmações de escopo, perguntas, avisos, erros). Documentos de origem podem estar em outro idioma; nunca os espelhe. Esta restrição está ativa desde o Passo 0.

---

## Passo 0 — Receber parâmetros do item de trabalho ativo

### Subpasso 0.1 — Receber parâmetros do orquestrador

> **Atalho de orquestrador:** Se `WORKITEM_ID`, `WORKITEM_PATH`, `WORKITEM_TYPE`, `LANGUAGE`, `INPUT_PATH`, `OUTPUT_PATH`, `BUDDY_MODE` e `USER_INPUT` já estiverem presentes no contexto (injetados pelo `senpai-artifact`), vá para o Subpasso 0.3. Caso contrário, execute o Subpasso 0.2 para receber os parâmetros do item de trabalho ativo.

### Subpasso 0.2 — Receber parâmetros standalone

Execute:

```bash
.senpai/scripts/senpai memory get
```

**Exemplo de saída:**

```bash
senpai memory get
# id: OP-001-sistema-rv
# path: docs/discovery/OP-001-sistema-rv
# type: oportunidade
```

Extraia `$id`, `$path` e `$type` do stdout e registre os seguintes parâmetros:

- `WORKITEM_ID`    = `$id`
- `WORKITEM_PATH`  = `$path`
- `WORKITEM_TYPE`  = `$type`
- `LANGUAGE`       = `pt-BR`
- `BUDDY_MODE`     = `true` se `$mode` for `-buddy`, caso contrário `false`

### Subpasso 0.3 — Registrar caminhos de artefatos e templates

Registre os seguintes parâmetros adicionais:

- `WORKITEM_TITLE`  = `{WORKITEM_ID}` (ou o título da página principal da wiki, se disponível)
- `INPUT_PATH`      = `{WORKITEM_PATH}/input`
- `OUTPUT_PATH`     = `{WORKITEM_PATH}/output`
- `TEMPLATE_PATH`   = `.senpai/skills/senpai-doc-story/template.md`
- `REFERENCE_PATH`  = `.senpai/skills/senpai-doc-feature/references/quebra-historias.md`

Determine `FLOW` a partir de `WORKITEM_TYPE`:

| `WORKITEM_TYPE` | `FLOW`       |
|-----------------|--------------|
| `oportunidade`  | `linked`     |
| `feature`       | `linked`     |
| `historia`      | `standalone` |
| outro           | Pare. Tipo de item de trabalho não suportado por esta skill. |

O diretório de artefatos e o cálculo dos links da wiki dependem do `FLOW` e só serão definidos no Passo 2, após identificar a Feature (no fluxo `linked`).

---

## Passo 1 — Carregar insumos

A história é um artefato **downstream**: os artefatos predecessores já são a destilação curada da wiki. Portanto, a fonte primária são os artefatos — não o dump bruto da wiki. Só recorra ao dump completo quando **nenhum** artefato existir.

### 1.1 — Identificar a Feature (somente fluxo `linked`)

No fluxo `linked`, o usuário **deve** informar a Feature à qual as histórias pertencem, anexando o arquivo da feature na invocação:

```
/senpai-doc historia #file:F-001-gestao-de-editais.md
```

- Localize o arquivo de feature anexado ao contexto da conversa. Ele estará em `{OUTPUT_PATH}/artifacts/features/<id>-<slug>.md` (quando o work item é uma `oportunidade`) ou em `{OUTPUT_PATH}/artifacts/feature.md` (quando o work item é uma `feature` standalone).
- Leia o arquivo. Extraia do frontmatter:
  - `SELECTED_FEATURE_ID`   = campo `feature_id` (ex.: `F-001`).
  - `SELECTED_FEATURE_NAME` = nome da feature (do título / heading `#`).
- Extraia a tabela `## Decomposição de Histórias de Usuário (Proposta)`. Ela é a **fonte primária** das histórias a gerar: cada linha (`US-NNN`) vira um documento de história completo. Preserve os valores das colunas `Persona`, `Tipo (Natureza)`, `Classificação (Sub)`, `Especialidade` e `Prioridade` — eles alimentam o frontmatter e a seção `## Atributos` de cada história.
- Extraia também `## Critérios de Aceite da Feature (FAC)`, `## Regras de Negócio`, `## Interações com Entidades e Dados` e `## Dependências e Relações de Integridade` — são o insumo direto dos critérios de aceite, regras e dependências de cada história.

**Se nenhum arquivo de feature estiver anexado no fluxo `linked`:**

- Em `BUDDY_MODE = true`: pergunte ao usuário qual Feature detalhar, listando as features disponíveis em `{OUTPUT_PATH}/artifacts/features/`. Aguarde a resposta.
- Em `BUDDY_MODE = false`: pare e instrua o usuário a informar a Feature, exibindo:

```
No fluxo de oportunidade/feature é obrigatório informar a Feature à qual as histórias pertencem.
Invoque assim: /senpai-doc historia #file:F-001-<slug>.md
Features disponíveis: {lista de arquivos em artifacts/features/}
```

### 1.2 — Ler os artefatos predecessores (fonte de contexto)

Tente ler cada artefato em `{OUTPUT_PATH}/artifacts/`. Eles formam o **contexto de referência** (e, no fluxo `standalone`, o baseline **AS-IS**):

| Insumo | Arquivo | Papel na geração |
|---|---|---|
| `feature`(s) | `{OUTPUT_PATH}/artifacts/features/*.md` ou `feature.md` | **Fonte primária** (fluxo `linked`) — decomposição, FAC, regras e dependências |
| `requirements` | `{OUTPUT_PATH}/artifacts/requirements.md` | Regras de negócio e critérios de aceite detalhados |
| `brief` | `{OUTPUT_PATH}/artifacts/brief.md` | Contexto de negócio e recorte de MVP |
| `attributes` | `{OUTPUT_PATH}/artifacts/attributes.md` | Atributos de qualidade — origem de critérios não funcionais e da DoD |
| `der` | `{OUTPUT_PATH}/artifacts/der.md` | Modelo de dados — origem das interações com entidades |
| `adr` | todos os `{OUTPUT_PATH}/artifacts/adr/*.md` | Decisões de arquitetura — restringem especialidade e contratos de interface |

### 1.3 — Ler os diagramas (apoio)

Tente ler cada diagrama em `{OUTPUT_PATH}/artifacts/diagrams/*.md`. Eles informam os cenários Gherkin e os contratos de interface:

| Diagrama | Arquivo | O que informa à história |
|---|---|---|
| Sequência | `diagrams/sequence.md` | Interações → participantes e mensagens dos cenários |
| Fluxo de Processo | `diagrams/process-flow.md` | Etapas → cenários Gherkin |
| Estado | `diagrams/state.md` | Transições de `status` → critérios de aceite |
| Fluxo de Dados | `diagrams/data-flow.md` | Movimento de dados → interações com entidades |

Leia cada arquivo que existir. Ignore silenciosamente os ausentes. Registre em `AVAILABLE_INPUTS` a lista dos insumos encontrados e em `N_ARTIFACTS` a quantidade total de arquivos lidos em 1.1, 1.2 e 1.3.

### 1.4 — Decidir a fonte

**Se `N_ARTIFACTS ≥ 1` (caminho primário):** use exclusivamente os artefatos e diagramas como fonte. **Não** execute `ingest dump`. Defina `N_SOURCES = N_CONCEPTS = N_ENTITIES = 0` (nenhuma página de wiki foi lida).

**Se `N_ARTIFACTS == 0` (fallback):** execute o dump completo da wiki e avise o usuário que a qualidade será inferior:

```bash
.senpai/scripts/senpai ingest dump {WORKITEM_PATH}
```

```
Nenhum artefato predecessor encontrado em {OUTPUT_PATH}/artifacts/.
Carregando diretamente da wiki — a qualidade das histórias será inferior.
Considere gerar requisitos, feature e diagramas antes de prosseguir.
```

- Primeira linha: `STATUS: sources:N concepts:N entities:N` — registre os totais como `N_SOURCES`, `N_CONCEPTS`, `N_ENTITIES` e `N_READ = N_SOURCES + N_CONCEPTS + N_ENTITIES`.
- Linhas seguintes: conteúdo completo das páginas, delimitadas por `--- <caminho> ---`, agrupadas em `=== SOURCES ===`, `=== CONCEPTS ===`, `=== ENTITIES ===`.
- `none` — nenhuma fonte ingerida; informe ao usuário e pare. Sugira executar `/senpai-ingest` primeiro.

> **Importante (fallback):** Leia o dump uma única vez. Não faça chamadas `read_file` individuais para páginas da wiki — todo o conteúdo já está presente na saída do comando acima.

> **Observação (fluxo `linked`):** o dump da wiki **não substitui** a Feature informada. Se, no fluxo `linked`, não houver nenhum arquivo de feature, não é possível gerar histórias vinculadas — volte ao Passo 1.1.

---

## Passo 2 — Definir o diretório de artefatos e os links da wiki

O que fazer depende de `FLOW`.

### 2.A — Fluxo `linked`

- `ARTIFACT_DIR`  = `{OUTPUT_PATH}/artifacts/stories/{SELECTED_FEATURE_ID}/`
- `WIKI_REL_DIR`  = `{WORKITEM_PATH}/output/artifacts/stories/{SELECTED_FEATURE_ID}`

### 2.B — Fluxo `standalone`

- `SELECTED_FEATURE_ID`   = `WORKITEM_ID`
- `SELECTED_FEATURE_NAME` = `WORKITEM_TITLE`
- `ARTIFACT_DIR`          = `{OUTPUT_PATH}/artifacts/` (arquivo único `story.md`)
- `WIKI_REL_DIR`          = `{WORKITEM_PATH}/output/artifacts`

### 2.C — Calcular caminho relativo da wiki para os artefatos

- `WIKI_REL_PATH`  = calculado conforme abaixo

**Calcular `WIKI_REL_PATH`:**

```bash
.senpai/scripts/senpai wiki-rel-path {WIKI_REL_DIR}
```

Registre a saída como `WIKI_REL_PATH`. Use-a em **todos** os links para páginas da wiki dentro dos arquivos de história. O formato correto é `{$WIKI_REL_PATH}/{sources|concepts|entities}/{slug}.md`. Nunca construa caminhos relativos de cabeça — sempre derive de `WIKI_REL_PATH`.

---

## Passo 3 — Determinar as histórias

O que fazer depende de `FLOW`.

### 3.A — Fluxo `linked` (múltiplas histórias com integridade)

O conjunto de histórias é dado pela tabela `## Decomposição de Histórias de Usuário (Proposta)` da Feature lida no Passo 1.1. Cada linha `US-NNN` vira um documento completo. Consulte `{REFERENCE_PATH}` para aplicar corretamente as regras de quebra e classificação ao detalhar cada história.

Atribua a cada história o `story_id` da proposta (`US-001`, `US-002`, …) e um `slug` a partir do título (minúsculas, hífens, sem acentos). O nome do arquivo será `{ARTIFACT_DIR}<US-NNN>-<slug>.md` (ex.: `US-001-criar-edital.md`).

**Regras de integridade (obrigatórias neste fluxo):**

- **Cobertura da decomposição:** cada linha `US-NNN` da proposta da Feature deve gerar **exatamente um** arquivo de história. Nenhuma história proposta pode ficar sem documento.
- **Sem sobreposição:** cada critério de aceite / regra de negócio pertence a **exatamente uma** história. Não duplique a mesma regra em histórias diferentes — referencie a história dona.
- **IDs únicos e estáveis:** nunca reutilize um `US-NNN`. Se já existirem arquivos em `{ARTIFACT_DIR}`, respeite a numeração existente.
- **Dependências consistentes:** quando uma história depende de outra (ex.: história de Backend depende da de API Gateway), registre a relação na seção `## Dependências e Impedimentos` de ambas com direção coerente. Não crie dependências circulares sem sinalizá-las como gap.

Registre `N_STORIES` = número de histórias identificadas na proposta.

### 3.B — Fluxo `standalone` (única história — AS-IS + modificação)

O item de trabalho já é a história. Haverá **uma única** história. Defina `N_STORIES = 1`.

Trate o conteúdo ingerido e os artefatos predecessores como o **contexto AS-IS**: o sistema, os dados e os processos que **já existem**. A história descreve a **porção de modificação** sobre esse baseline.

Como o template é fixo (Passo 4), distinga AS-IS de modificação **dentro das seções existentes**, usando marcadores inline no início do item:
- `[AS-IS]` — comportamento, entidade ou dependência que **já existe** e não muda (contexto).
- `[MODIFICAÇÃO]` — comportamento novo ou alterado introduzido por esta história.

Aplique os marcadores principalmente em `## Contexto de Negócio`, `## Critérios de Aceite`, `## Regras de Negócio` e `## Dependências e Impedimentos`. O `## Contexto de Negócio` deve deixar claro que se trata de uma evolução sobre um sistema existente.

Para classificar a história (natureza, tipo, subclassificação, especialidade), aplique `{REFERENCE_PATH}`.

---

## Passo 4 — Confirmar o escopo com o usuário

Antes de escrever, apresente o que encontrou.

**Fluxo `linked`:**

```
Feature {SELECTED_FEATURE_ID} — {SELECTED_FEATURE_NAME}.
Com base na decomposição da Feature, vou gerar {N_STORIES} histórias:

1. US-001 — {título}  ({Prioridade})
2. US-002 — {título}  ({Prioridade})
...

Integridade: {N_STORIES} histórias cobrindo a decomposição, 0 órfãos, 0 sobreposições.
Dependências entre histórias: {resumo curto ou "nenhuma"}.

Este recorte está correto? Deseja unir, dividir ou renomear alguma história?
```

**Fluxo `standalone`:**

```
Detalhando a história {SELECTED_FEATURE_ID} — {SELECTED_FEATURE_NAME} (contexto brownfield).

Baseline AS-IS: {resumo do que já existe, a partir dos artefatos}.
Porção de modificação: {resumo do que muda}.

Esta delimitação AS-IS × modificação está correta?
```

**Se `BUDDY_MODE` for `true`:** Aguarde uma resposta. Ajuste conforme o feedback. Se o usuário disser "prossiga", siga em frente.

**Se `BUDDY_MODE` for `false` (padrão):** Prossiga diretamente.

---

## Passo 5 — Escrever o(s) artefato(s) de história

Leia o template em `{TEMPLATE_PATH}`. Para cada história, preencha **todos** os placeholders e escreva um arquivo:

- Fluxo `linked`: `{ARTIFACT_DIR}<US-NNN>-<slug>.md` (um arquivo por história).
- Fluxo `standalone`: `{ARTIFACT_DIR}story.md` (arquivo único).

Preencha o frontmatter a partir da classificação da história (proposta da Feature no `linked`; `{REFERENCE_PATH}` no `standalone`):
- `feature_id` = `SELECTED_FEATURE_ID`
- `story_id` = `US-NNN`
- `work_item_type` = `História` ou `Tarefa`
- `story_type`, `subclassification`, `nature`, `specialty`, `persona` = valores da classificação
- `generated` = data de hoje (`YYYY-MM-DD`)
- `sources_read` = `N_READ` (0 no caminho primário)

> ⚠️ **Imposição de Template (não negociável):** Cada arquivo gerado DEVE ser estruturalmente idêntico ao `template.md`:
> - **Cabeçalhos (Headings)**: não adicione, remova ou renomeie nenhuma seção (`##`/`###`).
> - **Colunas de tabela**: não adicione, remova ou renomeie nenhuma coluna. Mantenha nomes e ordem exatos.
> - **Campos YAML frontmatter**: não adicione campos ausentes no template. Não remova campos obrigatórios.
> - **Sem blocos extras**: sem emojis, subseções extras ou callouts ausentes no template.
> As seções `## Exemplo de Uso (Use Case)` e `## Contratos de Interface (Interface Contracts)` são opcionais em conteúdo, mas os **cabeçalhos devem permanecer**. Quando não aplicável, mantenha o cabeçalho e sinalize com `> [!gap]`.
> A violação de qualquer uma destas regras é um erro grave — corrija o arquivo antes de rodar a validação.

Regras de conteúdo:
- Toda afirmação factual cita a página da wiki ou o artefato de origem com `[markdown link]`. Para páginas da wiki, use `{$WIKI_REL_PATH}/{sources|concepts|entities}/{slug}.md`.
- Onde a wiki/artefatos não cobrirem uma seção, use `> [!gap]`. Nunca invente critérios, regras ou entidades.
- Escreva os cenários em Gherkin válido (`Funcionalidade`/`Cenario`/`Dado`/`Quando`/`Entao`), cobrindo ao menos um cenário por critério de aceite relevante.
- No fluxo `standalone`, aplique os marcadores `[AS-IS]` / `[MODIFICAÇÃO]` conforme o Passo 3.B.

Após escrever **cada** arquivo, execute a validação estrutural:

```bash
.senpai/scripts/senpai story lint <arquivo-gerado> {TEMPLATE_PATH}
```

- Saída `ok` → prossiga para a próxima história.
- Saída JSON de violações → corrija o arquivo e execute novamente até obter `ok`.

Não escreva o índice, não atualize arquivos de navegação e não reporte sucesso antes que **todas** as histórias passem na validação.

---

## Passo 6 — Escrever o índice de histórias (somente fluxo `linked`)

No fluxo `linked`, crie ou atualize `{ARTIFACT_DIR}index.md`:

```markdown
---
title: "Índice de Histórias — {SELECTED_FEATURE_ID}: {SELECTED_FEATURE_NAME}"
type: artifact
subtype: story-index
feature_id: {SELECTED_FEATURE_ID}
generated: YYYY-MM-DD
---

# Histórias: {SELECTED_FEATURE_ID} — {SELECTED_FEATURE_NAME}

| ID | História | Persona | Prioridade |
|----|----------|---------|------------|
| US-001 | [Título da história](US-001-slug) | ... | Must |
| US-002 | ... | ... | ... |
```

No fluxo `standalone`, **pule este passo** — não há índice para arquivo único.

---

## Passo 7 — Registrar via CLI

Execute, passando as contagens coletadas:

```bash
echo "STORY_RESULT:
- flow: \"{FLOW}\"
- feature_id: \"{SELECTED_FEATURE_ID}\"
- stories: {N_STORIES}
- gaps: {N_GAPS}
- artifacts: {N_ARTIFACTS}
- sources: {N_SOURCES}
- concepts: {N_CONCEPTS}
- entities: {N_ENTITIES}
- status: \"ok\"
- message: \"\"" | .senpai/scripts/senpai story register {WORKITEM_PATH}
```

No fluxo `standalone`, deixe `feature_id` vazio (`""`). O script atualiza automaticamente `{OUTPUT_PATH}/index.md` (seção `## Artifacts`) e prepende a entrada em `{OUTPUT_PATH}/log.md`. Não escreva nesses arquivos manualmente.

---

## Passo 8 — Fechar o ciclo

Diga ao usuário o que foi feito.

**Fluxo `linked`:**

```
Concluído. {N_STORIES} histórias geradas em {ARTIFACT_DIR}.

Feature: {SELECTED_FEATURE_ID} — {SELECTED_FEATURE_NAME}
Histórias: {N_STORIES} (índice em artifacts/stories/{SELECTED_FEATURE_ID}/index.md)
Integridade: {N_STORIES} histórias cobrindo a decomposição, 0 órfãos, 0 sobreposições
Gaps sinalizados: {N_GAPS}
Insumos lidos: {N_ARTIFACTS} artefatos predecessores (ou {N_READ} páginas de wiki, no fallback)

Deseja revisar algo antes de continuarmos?
```

**Fluxo `standalone`:**

```
Concluído. História detalhada em {ARTIFACT_DIR}story.md.

História: {SELECTED_FEATURE_ID} — {SELECTED_FEATURE_NAME} (brownfield: AS-IS + modificação)
Gaps sinalizados: {N_GAPS}
Insumos lidos: {N_ARTIFACTS} artefatos predecessores (ou {N_READ} páginas de wiki, no fallback)

Deseja revisar algo antes de continuarmos?
```

---

## Regras

- **Escreva todo o conteúdo E todas as mensagens ao usuário em `pt-BR`.** Sem fallback para inglês.
- **Artefatos são a fonte primária; a wiki é fallback.** Como artefato downstream, esta skill lê a(s) feature(s), `requirements.md`, `brief.md`, `attributes.md`, `der.md`, `adr/*.md` e os `diagrams/*.md`. Só execute `ingest dump` quando **nenhum** artefato existir — nunca combine dump completo e artefatos na mesma geração.
- **No fluxo `linked`, informar a Feature é obrigatório.** As histórias derivam da decomposição da Feature informada via `#file:`. Sem a Feature, não gere histórias vinculadas.
- **No fluxo `linked`, a integridade entre histórias é obrigatória:** cobertura total da decomposição, sem sobreposição, IDs únicos, dependências consistentes (API Gateway ← Backend, etc.).
- **No fluxo `standalone`, o artefato representa AS-IS + modificação.** Nunca descreva a história como greenfield quando os artefatos indicam um sistema existente; marque o que já existe com `[AS-IS]`.
- **Um template compartilhado para os dois fluxos.** Não crie variações de template — ambos usam `{TEMPLATE_PATH}` e devem ser estruturalmente idênticos a ele.
- **A classificação e a quebra seguem `{REFERENCE_PATH}`.** Natureza, tipo, subclassificação, especialidade e prioridade vêm da referência de quebra de histórias.
- **Nunca invente critérios, regras, entidades ou cenários não respaldados pelos artefatos (ou pela wiki, no fallback).** Use `> [!gap]` para lacunas.
- **Nunca modifique páginas de fontes, conceitos ou entidades da wiki.** Os únicos arquivos escritos são os de história em `{ARTIFACT_DIR}`, o `index.md` de histórias (fluxo `linked`), `{OUTPUT_PATH}/index.md` e `{OUTPUT_PATH}/log.md`.
- **Links para páginas da wiki usam sempre `WIKI_REL_PATH`.** Nunca construa caminhos relativos manualmente.
- **No modo buddy, nunca pule o Passo 4.** O usuário deve confirmar o recorte de histórias (ou a delimitação AS-IS × modificação) antes de qualquer arquivo ser escrito.

<!-- FIM SENPAI-SKILLS-COLLECTION -->







