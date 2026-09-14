# Fase 4 — Achados dos spikes (`workflow Delivery`)

> Segue o mesmo espírito de [FASE0-ACHADOS.md](FASE0-ACHADOS.md)/[FASE2-ACHADOS.md](FASE2-ACHADOS.md), escopado à Fase 4.

## 1. Achado de design (o mais caro desta fase) — `standalone: false` era um erro de modelagem, não uma escolha de implementação

A primeira versão implementada de `Delivery` tinha um input `standalone: bool`. Com `standalone: false`, o workflow gerava um conjunto completo de artefatos intermediários (`brief`/`atributos`/`requisitos`/`adr`/`der`/`diagramas`) **dentro da própria pasta de uma feature do backlog de uma Oportunidade** (`artifacts/features/FT001-slug/brief.html`, `.../atributos.html`, `.../adr/`, etc.) — um "mini-Discovery" por feature.

O erro ficou óbvio ao observar o próprio arquivo sendo gravado numa pasta de Feature durante um teste manual: não existe, na prática, um "brief" ou uma "ADR" por feature — brief/ADR são decisões de nível de Oportunidade, não algo que se refaz para cada item de backlog. Reler [SENPAI-REFINAMENTO-VISAO-GERAL.md](SENPAI-REFINAMENTO-VISAO-GERAL.md) confirmou que esse segundo modo nunca existiu no protocolo original — a "Visão geral" do documento fonte só lista `feature`/`historia` como artefatos finais de um projeto Feature/História **próprio**, nunca como um segundo nível de detalhamento sobre o backlog de uma Oportunidade já existente. O documento também revelou, de quebra, que **`atributos` nunca fez parte da sequência de Delivery** em nenhum dos dois modos (Feature ou História) — só de Discovery.

**Decisão final (não uma correção parcial):** `standalone` foi removido por completo, junto com `feature_id`/`historia_id` como inputs de `Delivery`, junto com `atributos` como artefato de Delivery. `Delivery` agora só opera sobre um `project_id` que já é, desde a criação pelo `WorkItem` (`item_type: "feature"` ou `"historia"`), inteiramente próprio — sua própria Wiki, seus próprios artefatos na raiz de `artifacts/`, sem nenhuma noção de "pasta de origem" ou "projeto pai". "Detalhar a Feature FT001 do backlog de uma Oportunidade em histórias" continua sendo inteiramente responsabilidade de `Discovery` (`artifact: "historias"` com um `feature_id`, mesmo `project_id` da Oportunidade) — nunca cruza para `Delivery`.

**Lição para fases futuras:** quando o plano macro descreve um contrato de workflow antes de reler o documento fonte completo (aqui, [SENPAI-REFINAMENTO-VISAO-GERAL.md](SENPAI-REFINAMENTO-VISAO-GERAL.md)) para a fase específica, a implementação corre o risco de inventar uma mecânica plausível-mas-errada por analogia com a fase anterior (Discovery tem sub-pastas por feature/história, então Delivery "deveria" ter também) em vez de derivar do protocolo real. Vale reler a seção correspondente do documento fonte **antes** de escrever o primeiro `.mh` de uma fase nova, não só ao ser corrigido no meio dela.

## 2. Reconfirmado — resposta degenerada transitória do `claude` CLI (mesma classe de instabilidade da Fase 3)

Uma chamada real ao `artifact: "feature"` (rodada dentro de uma sessão pausada de Modo Buddy, `buddy: true`) devolveu um JSON tecnicamente válido contra o schema, mas com conteúdo degenerado — `descricao: "teste"`, um único critério de aceite com `texto: "teste"` — apesar de todo o contexto real (requisitos, 4 ADRs, DER, diagramas) estar presente e correto no prompt. Tokens de saída da chamada (`tokens_out: 9859`) foram bem mais altos que o normal para essa resposta minúscula, sugerindo que o modelo gerou (e descartou, ou raciocinou sobre) bem mais conteúdo do que o que efetivamente saiu no campo final.

Repetida a chamada **idêntica** (mesmo `project_id`, mesmo `mode`, mesmo `artifact`, sem Modo Buddy) imediatamente depois: resposta completa e coerente na primeira tentativa, sem qualquer mudança de prompt/schema. Mesmo padrão já registrado em [PLANO-MACRO-MHL-SENPAI.md §4.1](PLANO-MACRO-MHL-SENPAI.md#41-matriz-de-dependência-entre-artefatos) (achado da Fase 3: duas falhas transitórias reais em chamadas consecutivas de `der`/`diagramas`) — não reproduzido de forma determinística, sem qualquer alteração de código entre a chamada ruim e a boa.

**Não é coberto pelo `retry:` do `agent Writer`** (`workflows/shared/agents.mh`) porque a chamada **não falhou** — voltou HTTP 200 com um envelope de uso válido e um JSON validado contra o schema; `retry_on` só dispara em erro de transporte/rate-limit, não em "resposta ruim mas tecnicamente válida". Registrado aqui como vigilância contínua, não como resolvido: o risco de uma resposta degenerada-mas-schema-válida passar despercebida é exatamente o motivo de Modo Buddy existir (`pause()` antes de gravar) — nesse teste específico, o problema foi percebido justamente porque a chamada estava pausada para revisão manual antes do commit em disco.

## 3. Confirmado — Modo Buddy não duplica chamada de LLM no resume, também em Delivery

Testado no step `historias` (o único de Delivery com uma cadeia de dependência interna — depende de `feature` já ter sido commitado): `mhl run ... --input buddy=true --session historias-buddy` pausou em `Gate` com o backlog de 6 histórias completo em `pending_data`; `mhl run ... --input approved=true --session historias-buddy --resume` retomou direto em `Gate` (`"skipped": ["Dispatch", "HistoriasGenerate"]` no JSON de saída) e gravou os 6 arquivos sem nenhuma nova chamada ao `claude` — mesmo mecanismo já validado em Discovery (Fase 3) e Wiki (Fase 2), agora reconfirmado no workflow que reaproveita o `historias` compartilhado.

## 4. Confirmado — `brief` é opcional de verdade em Delivery (ao contrário de Discovery)

Cadeia real rodada para um projeto História standalone **sem gerar `brief`**: `requisitos` → `adr` → `der` → `diagramas` → `historia`, todas completando normalmente. `RequisitosGenerate` de Delivery usa um texto fixo (`"(não gerado para este projeto)"`) no lugar de `brief_content` quando o arquivo não existe, em vez do `fail("gere 'brief' antes de 'requisitos'")` que Discovery usa — reflete a diferença real do protocolo original (`brief (opcional)` na sequência de Delivery, mas obrigatório como raiz em Discovery). Título do artefato final (`historia.html`) confirmado como vindo de `project.json.name`, não da LLM.

## 5. Confirmado — `WorkItem action:usage` agrega corretamente as duas cadeias de Delivery

Rodadas duas cadeias completas de ponta a ponta com chamadas reais ao `claude` (não simulado):

- **Projeto Feature** ("Checkout em uma etapa"): `ingest` → `brief` → `requisitos` → `adr` (4 decisões) → `der` → `diagramas` (2) → `feature` (com a resposta degenerada do achado #2 acima, descartada, mais uma chamada boa) → `historias` (6 histórias). `WorkItem action:usage` devolveu 9 entradas em `by_artifact` (incluindo a chamada degenerada — corretamente registrada como uso real de token, já que a chamada de fato aconteceu), `total_tokens_out: 43957`.
- **Projeto História** ("Notificar usuario sobre falha de pagamento"), deliberadamente sem `brief`: `ingest` → `requisitos` → `adr` (5 decisões) → `der` → `diagramas` (2) → `historia`. `WorkItem action:usage` devolveu 6 entradas, `total_tokens_out: 23650`.

Nenhuma entrada fantasma, nenhuma duplicação por causa do resume de Modo Buddy (achado #3) ou da resposta degenerada re-tentada manualmente (achado #2) — cada chamada real ao `claude`, boa ou degenerada, vira exatamente uma entrada em `usage.jsonl`.

## Consequência prática

- `PLANO-MACRO-MHL-SENPAI.md` §3.2, §4, §4.1.1 e a linha de status da Fase 4 já refletem a remoção de `standalone`/`atributos` de Delivery (achado #1).
- Toda fase futura que aninhar workflows por analogia estrutural com uma fase anterior deve reler o documento fonte da fase específica antes de fixar o contrato de input — não só ao ser corrigido.
- O risco de resposta degenerada-mas-schema-válida (achado #2) não tem mitigação automática — só Modo Buddy como rede de segurança para revisão humana antes do commit em disco. Não abrir um mecanismo de "detecção automática de resposta ruim" sem um pedido explícito — arriscaria virar um novo lugar de julgamento delegado à LLM (violaria C3) sem necessidade comprovada além de uma observação isolada.
