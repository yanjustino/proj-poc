# Plano Macro — Senpai em MHL (Wiki, Work-Item, Discovery, Delivery)

> Base de leitura: [docs/site/index.html](docs/site/index.html), [docs/site/Docs-Reference.dc.html](docs/site/Docs-Reference.dc.html), [docs/site/Docs-Servers.dc.html](docs/site/Docs-Servers.dc.html), [docs/site/Docs-Extensions.dc.html](docs/site/Docs-Extensions.dc.html), [docs/site/Docs-Specification.dc.html](docs/site/Docs-Specification.dc.html), [docs/wiki-llm.md](docs/wiki-llm.md) (padrão de referência para o workflow `Wiki`).
> Este documento é um **plano macro**, organizado por fases para execução incremental — não é uma implementação. Cada fase deve virar um ciclo de trabalho próprio.

## 1. Objetivo

Reconstruir o protocolo de refinamento do Senpai (ver [SENPAI-REFINAMENTO-VISAO-GERAL.md](SENPAI-REFINAMENTO-VISAO-GERAL.md)) como **4 workflows MHL separados** — `WorkItem`, `Wiki`, `Discovery`, `Delivery` —, servidos como ferramentas MCP, com uma **interface visual local** por cima. O produto final é **um executável único, distribuído e rodado localmente**, sem depender de infraestrutura externa.

Experiência alvo do usuário final:

1. Abre o app (executável local, sem instalação de runtime à parte).
2. Cria um novo work-item (projeto).
3. Faz upload dos arquivos-base (PDFs, notas, transcrições, etc.).
4. Gera a Wiki do projeto a partir desses arquivos.
5. Gera os artefatos de Discovery e/ou Delivery a partir da Wiki.

## 2. Decisões de arquitetura (âncoras nos docs)

| Decisão | Baseado em | Motivo |
|---|---|---|
| 4 workflows MHL distintos: `WorkItem`, `Wiki`, `Discovery`, `Delivery` | "Every transport publishes one tool / skill per declaration" (Docs-Servers §01) | Cada `workflow` vira 1 ferramenta MCP com contrato de input próprio — mapeia 1:1 com os 4 domínios pedidos. |
| Cada work-item é um **projeto isolado em disco**, não uma linha em banco central | `fs`/`dir` nativos ([Docs-Reference §09](docs/site/Docs-Reference.dc.html)) + `memory type: "json"` por caminho interpolado ([Docs-Reference §08](docs/site/Docs-Reference.dc.html)) | Um `path` interpolado com `${project_id}` dá a cada projeto seu próprio estado, sem risco de um work-item vazar em outro — isolamento é constraint obrigatória (C1), não só conveniência; ver §2.1 para o mecanismo de reforço. |
| Servidor exposto via **`mhl serve mcp <dir>`** em stdio, spawnado como processo filho do app | Docs-Servers §03 — "the form an MCP client uses when it spawns the server as a subprocess" | É literalmente o modelo pedido ("mcp servido como stdin"): a UI não fala com uma API própria, fala MCP com o `mhl`. |
| Uso de `Discovery`/`Delivery` como `workflow` (não `pipeline`) | `workflow` permite `goto` para trás/frente (Docs-Reference §13); `reached` no status do run é "ordered steps that started" (Docs-Servers §05) | Cada chamada só deve **executar e reportar** o step do `artifact` pedido — um `goto` direto para o step certo (e para um step `Done` final) mantém `reached` enxuto (ex. `["Dispatch","Brief","Done"]`), o que importa agora que a UI mostra progresso real por `reached`/`step`. Sem isso, um `pipeline`/`workflow` sem goto "roda" (e reporta) os 8 steps a cada chamada, mesmo os que são no-op para outros artefatos — progresso enganoso. |
| "Modo Buddy" = `pause()` + `mhl_run_resume` | Docs-Servers §06 (Human-in-the-loop) | É o mesmo conceito descrito no protocolo original ("agente pausa em cada ponto de decisão") — não precisa ser reinventado, é nativo do runtime. |
| Geração de artefato = chamada assíncrona (`mhl_run_start` / `mhl_run_status`) | Docs-Servers §05 | Steps chamam agente de LLM (podem levar segundos/minutos); a UI precisa de progresso por etapa (`step`, `stepIndex`, `reached`), não de uma chamada bloqueante. |
| Upload de arquivo não trafega como argumento MCP | "pass large payloads by reference (a URL, a blob key), not inline" + limite de 256 KiB por chamada (Docs-Servers §05) | O shell da aplicação grava o arquivo em disco no diretório do projeto e passa **caminhos**, não bytes, para os workflows. |
| `Wiki` segue o padrão de 3 camadas (raw / wiki / schema) de [docs/wiki-llm.md](docs/wiki-llm.md) | "There are three layers: Raw sources… The wiki… The schema…" | `raw/` fica imutável (só o usuário grava, via upload); `wiki/` é escrita só pelo agente de extração; a "schema" vira um `prompt` fixo (convenções de ingest/lint) que molda como o agente escreve a wiki. |
| `wiki/index.md` + `wiki/log.md` como os dois arquivos especiais do padrão | "Two special files help the LLM (and you) navigate the wiki as it grows" | `index.md` é o catálogo que Discovery/Delivery leem antes de gerar qualquer artefato (evita reprocessar a wiki inteira a cada step); `log.md` é o histórico append-only de ingest/lint por projeto. |
| Todo artefato = **schema JSON** (contrato da LLM) + **template MHL** (contrato de renderização) | `agent.run(prompt:, schema:)` é um argumento nativo, string, "passed to backends that support structured output" (Docs-Specification §12); `prompt X(...) from "file.ext"` já é um motor de template com interpolação nomeada, sem restrição de extensão (Docs-Reference §07) | A LLM nunca escreve markup livre — só JSON validado contra o schema; quem escreve o arquivo final é um `prompt`-template MHL, determinístico, carregado de arquivo. Ver §3.4. |
| **Artefatos (`artifacts/`) em HTML, não Markdown** — a Wiki (`wiki/`) continua em Markdown | Requisito explícito do usuário; padrão [docs/wiki-llm.md](docs/wiki-llm.md) é especificamente sobre uma wiki Markdown (Obsidian etc.), o que não se aplica aos artefatos de engenharia | Cada template vira `templates/<artefato>.html`; o resultado (`brief.html`, `feature.html`, …) já é a coisa final a pré-visualizar/imprimir/exportar — sem passo de conversão markdown→html na UI. |
| Escaping obrigatório de todo campo JSON antes de interpolar num template HTML | MHL não tem `html.escape` nativo; tem `.replace(old, new)` em string (Docs-Specification §10.3) | Um template `.md` que recebe texto cru da LLM é só texto; um template `.html` que recebe texto cru é **HTML-injection** (um campo com `<` ou `"` quebra a página ou injeta markup). Precisa de uma `tool Html { escape(text: string): string -> ... }` chamada em cada argumento antes de toda chamada ao prompt-template. Ver §3.4. |
| Pré-visualização = renderização direta do HTML, sem conversão | Artefato já É o HTML final | A UI abre o arquivo gerado num `iframe`/webview (`sandbox`, sem rede), lado a lado com a lista de artefatos — não precisa de um markdown renderer embutido. |
| Progresso da UI = leitura direta de `mhl_run_status` (`state`, `step`, `stepIndex`, `stepTotal`, `reached`) | Docs-Servers §05 — campos já existem no status de todo run assíncrono | Nenhuma lógica de progresso nova no MHL: a UI só faz polling do `runId` que ela mesma iniciou e desenha a barra/etapa a partir do JSON de status. |

## 2.1 Constraints obrigatórias

Cinco regras valem para o sistema inteiro, não para uma fase específica — qualquer decisão de fase futura que as viole precisa ser revista antes de seguir:

**C1 — Isolamento de work-item.** Nenhuma operação de nenhum dos 4 workflows pode ler ou escrever fora de `projects/<project_id>/` do work-item que a está chamando.
- **Correção ao design anterior deste plano:** o `Delivery` com `standalone: false` (detalhar uma feature/história dentro do backlog de uma Oportunidade) **não é mais uma travessia entre dois projetos**. "Detalhar a Feature FT001 desta Oportunidade" é uma chamada de `Delivery` com o **mesmo `project_id`** da própria Oportunidade — não existe `parent_project_id`, porque não existe um work-item separado até que o usuário explicitamente crie um standalone. Um work-item só tem um `project_id`, e cada chamada só enxerga o seu.
- **Mecanismo de reforço:** um `tool Paths` único, compartilhado pelos 4 workflows, é o único ponto que monta caminhos sob `projects/` — `Paths.artifact(project_id, relative)`, `Paths.wiki(project_id, relative)`, `Paths.raw(project_id, relative)`. Ele valida `project_id` contra um padrão fechado (sem `..`, sem `/`, sem caracteres fora de um slug/UUID) antes de qualquer `fs`/`dir` op; nenhum step monta caminho à mão com `"projects/" + project_id + "/..."`.
- **O runtime MHL não sandboxa isso por nós:** não há, nos docs lidos, nenhum isolamento nativo de sistema de arquivos por `workflow`/declaração — `fs`/`dir` operam com a permissão do processo, ponto. O isolamento de work-item é responsabilidade 100% do nosso código (o `tool Paths`), não uma garantia do MHL. Ver risco correspondente em §7.

**C2 — Geração de artefato só pode usar Wiki ou artefatos já gerados.** Nenhum step de `Discovery`/`Delivery` pode `fs.read` em `raw/`, nem fazer `http.*`/`extension mcp` durante a geração de um artefato. As únicas fontes permitidas são `wiki/**` e `artifacts/**` do mesmo `project_id` — nunca de outro work-item.
- Isso já era o comportamento descrito no protocolo original — "cada artefato é derivado do conteúdo da Wiki e dos artefatos predecessores, garantindo rastreabilidade completa" (ver [SENPAI-REFINAMENTO-VISAO-GERAL.md](SENPAI-REFINAMENTO-VISAO-GERAL.md)) — agora é uma restrição obrigatória, não só uma convenção de UX.
- Consequência prática: um dado presente numa fonte bruta mas que o `ingest` ainda não "compilou" na Wiki **não existe** para Discovery/Delivery. Reforça por que `Wiki ingest` é sempre pré-requisito bloqueante antes de gerar qualquer artefato (Fase 6).
- **Mecanismo de reforço:** um `tool Context { wiki(project_id): {...}, priorArtifacts(project_id): {...} }` é o único ponto de leitura de contexto para um `agent.run(...)` de artefato — nenhum step chama `fs.read`/`http.*` solto para montar o prompt. Complementar com um `mhl test` por artefato que falha se o step tocar `raw/`.

**C3 — Prompt de LLM só carrega trabalho de julgamento, nunca trabalho determinístico.** Nenhuma instrução de prompt (nem o schema) pode pedir à LLM para fazer algo que um `tool`/operação nativa já resolve deterministicamente: id/slug, ordenação, formatação de lista, escaping, data/hora, contagem, dedupe. É o próprio princípio do MHL — "Your program owns the flow; AI contributes judgment where it helps" ([index.html](docs/site/index.html)) — elevado a regra de produto.
- Já cumprido por design em: geração de `FT00N`/`US00N` (`tool`, não LLM), `Html.escape` (`tool`), timestamp de `log.md` (`time.format`, não LLM).
- **Fecha a "decisão em aberto" da §3.4:** a opção (a) (pedir à LLM uma string já formatada em HTML/markdown) deixa de ser uma alternativa válida — formatar uma lista é exatamente o tipo de tarefa determinística que essa regra proíbe delegar à LLM. **(b) — schema com `type: "array"` de verdade + `tool Html.list(...)` — é a única opção compatível com C3.**
- **Estende-se à Wiki:** a LLM de `ingest` não reescreve `index.md`/`log.md` inteiros nem decide onde inserir a entrada nova (isso é bookkeeping determinístico). Ela devolve, via `schema:`, só os campos julgados — título, resumo, categoria, fatos-chave da entidade/conceito/fonte; um passo determinístico (`tool`) insere/ordena/dedupe em `index.md` e formata a linha de `log.md`. **O mesmo padrão schema+template da §3.4 passa a valer também para `wiki/entities|concepts|sources`**, não só para os artefatos de Discovery/Delivery — a LLM só entrega conteúdo, nunca mecânica de arquivo.

**C4 — O backend do agente de LLM é substituível por ambiente: local usa Claude Code CLI ou Codex CLI; produção usa Devin CLI.** Nenhum `prompt`/`schema`/step pode depender de uma peculiaridade de um CLI específico — o contrato entre o workflow e o agente é só `prompt:`/`schema:` entrando e uma string (idealmente JSON puro) saindo.
- Mecanismo: `command`/`args` do `agent` não ficam hard-coded no `.mh` — resolvem a partir de uma variável de ambiente (`env("SENPAI_AGENT_CLI")`, ex. `"claude" | "codex" | "devin"`) resolvida na declaração do `agent`, com `args` também parametrizados onde os três CLIs divergem (ex. nome da flag de schema estruturado). **Assunção a validar na Fase 0**, junto da outra pendência de agente: os exemplos oficiais (Docs-Reference §05) mostram `command`/`args` como literais — confirmar que `command:`/valores de `args:` aceitam uma expressão (`env(...)`) e não só string fixa, antes de assumir esse mecanismo como viável.
- Consequência direta para C3: a saída estruturada (`schema:`) só funciona em produção se o **Devin CLI também suportar saída JSON restrita a um schema**, do mesmo jeito que se assume para `claude`/`codex` hoje. Isso é uma incógnita real — não documentada nos guias do MHL, que só descrevem o *transporte* (`${schema}` interpolado em `args`), não o que cada CLI faz com ele. Validar cedo (Fase 0) com o Devin CLI real, não presumir paridade.
- Enquanto o suporte do Devin CLI a `schema:` não estiver confirmado, tratar como risco de bloqueio de produção, não como detalhe de configuração (ver §7).

**C5 — A UI precisa mostrar consumo de token; os agentes são responsáveis por extrair esse dado.** Toda chamada de `agent.run(...)` que gera artefato ou página de wiki deve capturar quantos tokens de entrada/saída aquela chamada consumiu, e esse número precisa chegar até a UI — não é só um log de depuração.
- **O runtime já rastreia isso para exibição no terminal** — o exemplo de `mhl run` na home do MHL mostra `tokens 1420 → 38` na saída bonita do CLI (index.html) — mas isso é só o *pretty-print* do `mhl run`; não há, nos docs lidos, nenhum campo documentado (`result.tokens`, `context.tokens`, `mhl_run_status.vars.tokens`, …) que exponha esse número programaticamente para um step ou para o cliente MCP. Não presumir que existe; construir a extração como responsabilidade nossa.
- **Mecanismo:** o próprio CLI do agente (Claude/Codex/Devin, com `--output-format json`) tipicamente devolve o uso de token junto da resposta, fora do conteúdo pedido pelo `schema:`. O hook `after` do `agent` (Docs-Reference §05 — "sees the calling step's variables") é o lugar certo: ele recebe a resposta crua em `result`, extrai os campos de uso (a forma exata varia por CLI — **um parser de uso por backend**, já que C4 troca o CLI por ambiente), grava numa `memory { type: "jsonl", path: "projects/${project_id}/usage.jsonl" }` (mesmo padrão de `Audit.append` do exemplo canônico do MHL) e devolve só o conteúdo limpo (sem o envelope de uso) — assim o `json.parse` do passo seguinte continua recebendo exatamente o schema esperado, sem quebrar C3.
- O hook também atualiza uma `var` pipeline-scoped (ex. `tokens_in`/`tokens_out` daquela chamada), incluída no `output:` do workflow — dá o número **daquela geração específica** de volta pro `mhl_run_status` do run em andamento, sem esperar o work-item inteiro.
- Para o total acumulado do work-item (que atravessa várias chamadas/`runId`s independentes — cada artefato é seu próprio run), a UI não lê `usage.jsonl` direto do disco: `WorkItem` ganha `action: "usage"` (soma + lista por artefato), mantendo `Paths`/`Context` como único ponto de leitura de arquivo (C1/C2) — ver §4.

## 3. Layout de dados por work-item

Cada work-item é uma pasta própria sob um diretório-base da aplicação (ex.: `~/.senpai/projects/<project_id>/`). O layout dentro de `artifacts/` depende do **modo** do work-item — não é o mesmo para todos:

### 3.1 Work-item Discovery (Oportunidade) — modo com breakdown

Quando existe uma Oportunidade completa, `features` e `historias` são **pastas**, não arquivos únicos — uma pasta por feature, e as histórias agrupadas pelo id da feature-mãe:

```
projects/<project_id>/
  project.json              # metadata: nome, nível ativo (discovery|delivery), criado_em
  usage.jsonl                # ledger append-only de tokens por chamada de agente (C5)
  raw/                      # fontes enviadas pelo usuário — imutáveis, o agente só lê
  wiki/
    index.md                 # catálogo: página, link, resumo de 1 linha, categoria — lido antes de cada geração
    log.md                    # append-only: "## [2026-04-02] ingest | Nome da fonte"
    sources/
      <slug-da-fonte>.md       # 1 página de síntese por fonte ingerida (não é o arquivo bruto)
    entities/
      <slug>.md
    concepts/
      <slug>.md
  artifacts/
    brief.html
    atributos.html
    requisitos.html
    adr/
    der.html
    diagramas/               # diagramas C4 do projeto/oportunidade, cada um seu .html
    features/
      FT001-nome-da-feature/
        feature.html
      FT002-outra-feature/
        feature.html
    historias/
      FT001/
        US001-nome-da-historia/
          historia.html
        US002-outra-historia/
          historia.html
      FT002/
        US001-nome-da-historia/
          historia.html
```

`diagramas/` — em qualquer nível (projeto, feature ou história) — guarda os diagramas C4 model daquele escopo, um `.html` autocontido por diagrama (ver §3.5). `wiki/sources/` guarda a síntese gerada por fonte, não o arquivo original (esse fica intocado em `raw/`) — **a Wiki continua em Markdown**, só `artifacts/` vira HTML.

### 3.2 Work-item Delivery standalone (Feature ou História como projeto próprio)

Quando o work-item **é** a própria Feature ou a própria História (não deriva de uma Oportunidade com backlog completo), não há por quê fatiar em pastas — o resultado é **um único arquivo**:

```
projects/<project_id>/
  project.json               # metadata.mode: "feature" | "historia"
  usage.jsonl
  raw/
  wiki/
    index.md
    log.md
    sources/
      <slug-da-fonte>.md
    entities/
      <slug>.md
    concepts/
      <slug>.md
  artifacts/
    brief.html
    requisitos.html
    adr/
    der.html
    diagramas/                # diagramas C4 dessa feature/história isolada
    feature.html                # mode: "feature" — a feature e suas histórias, tudo num arquivo só
    # ou, exclusivamente:
    historia.html                # mode: "historia" — sem quebras
```

Isso espelha `docs/wiki/`, `docs/senpai.yml` e `output/artifacts/*` do protocolo original — por projeto, com caminhos interpolados (`memory { path: "projects/${project_id}/project.json" }`) — mas com o `Delivery` decidindo, pelo `mode` de entrada, se grava um arquivo único (standalone, projeto próprio) ou uma pasta dentro de `features/<id>/` / `historias/<feature_id>/<id>/` **do mesmo projeto** (quando está detalhando uma feature/história dentro de uma Oportunidade em Discovery — sem cruzar para outro `project_id`, ver constraint C1 em §2.1). A estrutura de `wiki/` é idêntica em qualquer modo — o padrão de [docs/wiki-llm.md](docs/wiki-llm.md) não muda por causa do tamanho do projeto.

### 3.3 A "schema" da wiki

O terceiro elemento do padrão — "a document... that tells the LLM how the wiki is structured, what the conventions are" — não é um arquivo por projeto em v1: vira um `prompt` fixo, versionado junto com o workflow `Wiki` (ex. `workflows/wiki/schema.prompt.md`), injetado em todo `agent.run(...)` de ingest/lint. Ele descreve: convenção de página (entidade/conceito/fonte), formato do `index.md`, formato do prefixo em `log.md` (`## [YYYY-MM-DD] ingest | <fonte>`), e o que conta como contradição/órfão no lint. Evoluir esse prompt por projeto (como o artigo original sugere) fica como melhoria de fase futura, não do v1.

### 3.4 Padrão de artefato: schema JSON + template (requisito técnico)

**Regra fixa para todo artefato gerado por LLM (Wiki, Discovery, Delivery): a LLM nunca escreve o markdown final — ela só responde JSON validado contra um schema. Quem escreve o arquivo é um template MHL determinístico.** Cada tipo de artefato (brief, atributos, requisitos, adr, der, feature, historia, …) é um **par de arquivos**, versionado junto com o workflow (não por work-item):

```
workflows/
  <discovery|delivery|shared>/
    schemas/
      brief.schema.json        # JSON Schema — os campos que a LLM DEVE devolver
      requisitos.schema.json
      feature.schema.json
      ...
    templates/
      brief.html                # template HTML com marcação `${...}` — o "arquivo base" do artefato
      requisitos.html
      feature.html
      ...
```

Fluxo de geração de 1 artefato, em 4 passos + 1 hook (parte do mesmo padrão do exemplo `LocalCoder.run(prompt:, schema:)` de Docs-Reference §05, com um passo de escaping a mais por causa do destino ser HTML, e a extração de tokens da C5 embutida no próprio agente via `after`):

0. **Hook `after` do agente, sempre presente (C5)** — todo `agent` usado para gerar artefato ou página de wiki declara `after: () -> { var usage = UsageParser.extract(result); Usage.append({artifact: artifact, tokens_in: usage.in, tokens_out: usage.out, at: time.now()}); tokens_in = usage.in; tokens_out = usage.out; return usage.content; }` — lê a resposta crua do CLI (`result`), separa o envelope de uso do conteúdo, grava no ledger `Usage` (`memory jsonl`, §2.1) e devolve só o conteúdo limpo. `UsageParser` é uma `tool` com um método por backend (`claude`/`codex`/`devin`, C4) — o formato do envelope difere entre eles.
1. **Chamada à LLM, sempre com `schema:`** — `var raw = Writer.run(prompt: BriefInstruction(...), schema: fs.read("schemas/brief.schema.json"))`. O `raw` que chega aqui já passou pelo `after` acima — é só o conteúdo, não o envelope de uso. O `schema:` é um argumento nativo do `.run()` (string, JSON Schema) "passed to backends that support structured output" (Docs-Specification §12) — para agente `cli/*` ele vira `${schema}` interpolado em `args` (ex. `--json-schema`); para `ollama/*` o adapter usa o output estruturado nativo do modelo. **Nenhum agente de artefato deve ser declarado sem essa flag em `args`.**
2. **Parse** — `var data = json.parse(raw)`. Se a LLM responder algo fora do schema, `json.parse` falha e o step falha (comportamento desejado: melhor falhar do que gravar HTML malformado).
3. **Escape** — cada campo de texto de `data` passa por `Html.escape(...)` (uma `tool` compartilhada, já que MHL não tem escaping de HTML nativo — só `.replace(old, new)` em string; `escape` encadeia `.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace("\"","&quot;").replace("'","&#39;")`, nessa ordem). Isso acontece **na chamada** ao prompt-template, não dentro do arquivo de template (os placeholders de um `prompt ... from file` só recebem os parâmetros declarados daquele prompt, não expressões arbitrárias).
4. **Render pelo template** — um segundo `prompt`, carregado do arquivo base, faz a interpolação: `prompt BriefTemplate(problema: string, objetivos: string, stakeholders: string) from "templates/brief.html"`; a chamada `BriefTemplate(problema: Html.escape(data.problema), objetivos: Html.escape(data.objetivos), stakeholders: Html.escape(data.stakeholders))` devolve a string final, gravada com `fs.write(path, rendered)`. O `output:` do workflow inclui `tokens_in`/`tokens_out` (setados no passo 0) junto do resultado — `mhl_run_status` já devolve o custo daquela geração, sem passo extra.

Isso reaproveita um mecanismo que o MHL já tem — "A prompt renders to a string" (Docs-Reference §07) — como motor de template, em vez de introduzir uma dependência de templating nova. Como bônus, **schema e template ficam auto-validados**: os nomes de propriedades do `.schema.json` precisam bater exatamente com os parâmetros do `prompt ... from template.html` (parâmetro faltando, sobrando ou desconhecido falha — "Missing, extra, or unknown placeholders fail instead of producing incomplete text", Docs-Reference §07), e isso é pego por `mhl lint` antes de rodar.

**Assunção a validar na Fase 0:** o carregador de `prompt ... from "arquivo"` não parece restringir a extensão do arquivo pelo texto da spec ("An external Markdown body uses the same `${name}` interpolation syntax") — mas como todos os exemplos oficiais usam `.md`, vale confirmar cedo que `.html` funciona de forma idêntica antes de escrever os 8+ templates de Discovery.

**Campos de lista — resolvido pela constraint C3 (§2.1), não é mais uma escolha em aberto:** campos do schema que representam listas (`objetivos: string[]`) usam `type: "array"` de fato — nunca uma string já formatada pela LLM ("devolva isto como bullets em HTML" é trabalho determinístico, proibido em prompt por C3. Uma `tool` compartilhada faz a conversão depois do escape: `Html.list(items: string[]): string -> "<ul>" + items.map((i) -> "<li>" + Html.escape(i) + "</li>").join("") + "</ul>"` (`map`/`join` são métodos nativos de array, Docs-Specification §10), rodando entre o passo 3 (escape) e o passo 4 (render). Mantém toda formatação HTML em código determinístico e testável (`mhl test`), nunca em texto livre da LLM.

### 3.5 Diagramas C4 (Mermaid) dentro de artefatos HTML

O campo do schema para diagrama é a **sintaxe Mermaid C4** como string (ex. `"diagrama_mermaid": "C4Context\n  Person(user, \"Usuário\")\n  ..."`), nunca uma imagem pronta. O template do artefato de diagrama grava um `.html` autocontido:

```html
<pre class="mermaid">${diagrama_mermaid}</pre>
<script src="./assets/mermaid.min.js"></script>
<script>mermaid.initialize({ startOnLoad: true });</script>
```

- `diagrama_mermaid` passa por `Html.escape` como qualquer outro campo (mermaid tolera `&amp;`/`&lt;`/`&gt;` no texto).
- `assets/mermaid.min.js` é um asset **vendorizado com o app** (mesma lógica de vendoring do binário `mhl`, Fase 7) — sem CDN, para funcionar 100% offline; referenciado por caminho relativo a partir de cada `diagramas/*.html`.
- Renderização é **client-side** (no navegador/webview no momento da pré-visualização ou ao abrir o `.html`), não um passo de `cmd.exec` no MHL — evita empacotar Chromium/`mermaid-cli` só para gerar SVG em build-time. Trade-off: o `.html` do diagrama só "aparece certo" com JS habilitado (ok para o preview da UI e para abrir num navegador comum; não ok se algum dia for exportado para PDF sem JS — ver Fase 8/futuro).
- Quando um artefato (ex. `brief.html`) referencia um diagrama já gerado, o template **inlina** o bloco `<pre class="mermaid">` inteiro (lido de volta do `.html` do diagrama, ou do dado bruto salvo à parte) em vez de linkar por `<iframe src="../diagramas/...">` — mantém cada artefato como arquivo único abrível isoladamente, sem depender de path relativo entre pastas.

## 4. Contrato dos 4 workflows (alto nível)

Sem código de implementação ainda — só o formato de entrada/saída de cada ferramenta MCP, para travar o design antes de escrever `.mh`.

### `WorkItem` — ciclo de vida do projeto
- `input action: string` (`"create" | "list" | "get" | "archive" | "usage"`)
- `input name: string` (quando `create`)
- `input project_id: string` (quando `get`/`archive`/`usage`)
- Efeito: cria/lê `project.json`; não conhece Wiki nem artefatos, **exceto** `usage`, que lê `usage.jsonl` (C5) via `Paths` e devolve `{total_tokens_in, total_tokens_out, by_artifact: [...]}` — é a única leitura "cross-domain" que o `WorkItem` faz, porque é puramente um agregador de bookkeeping, não geração.

### `Wiki` — ingestão, consulta e saneamento (padrão [docs/wiki-llm.md](docs/wiki-llm.md))
- `input project_id: string`
- `input action: string` (`"ingest" | "query" | "lint"`) — as 3 operações do padrão.
- `input raw_paths: string[]` (quando `ingest`; caminhos já gravados em `raw/` pelo shell, **um por vez** por padrão — ver Fase 2)
- `input question: string` (quando `query`)
- `input file_answer: bool = false` (quando `query`; se `true`, a resposta também é gravada como página nova em `wiki/` — "good answers can be filed back into the wiki as new pages")
- Efeito (sempre no padrão schema+template da §3.4/C3 — a LLM só devolve JSON com o conteúdo julgado; inserção/ordenação/formatação de arquivo é sempre `tool`):
  - `ingest`: para cada fonte, o agente lê **só** `raw/<arquivo>` (a única exceção a C2, já que é o próprio passo que faz a Wiki existir) e devolve, via `schema:`, os campos de cada página afetada (síntese da fonte, fatos por entidade/conceito, título+resumo+categoria para o índice) — nunca o Markdown pronto. Um passo determinístico renderiza `wiki/sources/<slug>.md`/`entities/*.md`/`concepts/*.md` pelos templates, insere/ordena a entrada em `wiki/index.md` e escreve a linha formatada em `wiki/log.md`.
  - `query`: o agente lê `wiki/index.md` (e as páginas que decidir abrir), devolve a resposta via `schema:`; opcionalmente vira página nova pelo mesmo mecanismo template quando `file_answer: true`.
  - `lint`: contradições entre páginas, alegações desatualizadas, páginas órfãs (sem link de entrada), conceitos citados sem página própria, cross-references faltando — relatório estruturado (`schema:`), sem side-effect automático.

### `Discovery` — artefatos de nível Oportunidade
- `input project_id: string`
- `input artifact: string` (`"brief" | "atributos" | "requisitos" | "adr" | "der" | "diagramas" | "features" | "historias"`)
- `input feature_id: string` (opcional; só relevante quando `artifact: "historias"` e se quer gerar histórias de uma feature específica, ex. `FT001`)
- Efeito: 1 `step` por artefato (branch pelo `artifact`), lê `wiki/*` + artefatos predecessores, escreve em `artifacts/`.
  - `artifact: "features"` cria/atualiza uma pasta por feature em `artifacts/features/FT00N-slug/feature.md` (id `FT00N` gerado sequencialmente pelo próprio step, slug derivado do nome).
  - `artifact: "historias"` cria uma pasta por história em `artifacts/historias/FT00N/US00N-slug/historia.md`, agrupada sob a feature indicada.
- Cada step com gate `pause()` opcional quando `buddy: true` for passado.

### `Delivery` — artefatos de nível Feature/História
- `input project_id: string`
- `input mode: string` (`"feature" | "historia"`)
- `input artifact: string` (mesmo vocabulário do Discovery + `"feature"` / `"historia"` para o detalhamento final)
- `input standalone: bool` — `true` quando este work-item **é** a própria Feature/História (projeto próprio, criado direto pelo `WorkItem`); `false` quando está detalhando uma feature/história que já existe no backlog **do mesmo `project_id`** (uma Oportunidade em Discovery chamando `Delivery` sobre si mesma — nunca outro projeto, C1 em §2.1).
- Efeito: mesma mecânica do Discovery para os artefatos intermediários (brief/requisitos/adr/der/diagramas); o artefato final ramifica por `mode` **e** por `standalone`, sempre dentro do `project_id` recebido:
  - `standalone: true` → grava um único arquivo (`artifacts/feature.html`, com a feature e suas histórias juntas; ou `artifacts/historia.html`, sem quebras).
  - `standalone: false` → grava na pasta do próprio backlog (`artifacts/features/FT00N-slug/feature.html` / `artifacts/historias/FT00N/US00N-slug/historia.html`), reaproveitando o `FT00N`/`US00N` já atribuído por `Discovery` nesse mesmo projeto.

> Cada um viraria uma entrada em `tools/list` — a UI descobre os 4 workflows via `tools/list` e o schema via `resources/read` em `mhl://workflow/<nome>`, sem precisar hardcodar o contrato duas vezes.

## 5. Fases macro

### Fase 0 — Fundamentos e spikes
- Instalar o runtime `mhl` localmente e rodar os exemplos de `Docs-Servers` (`workflows/summarize.mh`, `approval.mh`) para validar o ciclo `mhl_run_start/status/resume` na máquina de desenvolvimento.
- Validar como spike: `--state-dir` funciona em `mhl serve mcp <dir>` (stdio puro), ou só em `--http`? Isso decide se o modo "buddy" sobrevive a um restart do processo filho.
- Agente de LLM: **local usa `claude` (Claude Code CLI) ou `codex` (Codex CLI); produção usa `devin` (Devin CLI)** — decisão fechada por C4 (§2.1), não mais em aberto qual usar. O que falta validar aqui: (1) se `command:`/`args:` de um `agent` aceitam `env(...)` em vez de string literal — todo exemplo oficial usa literal; (2) se os três CLIs de fato suportam `--json-schema`/saída estruturada com paridade suficiente para C3; (3) se o Devin CLI expõe uso de token no seu `--output-format json` (ou equivalente) — sem isso, C5 não tem o que extrair em produção. Os três achados definem se o mecanismo de troca por ambiente (§2.1/C4) é viável como desenhado ou precisa de plano B.
- Setup inicial do projeto Wails (ver §6 — stack já definida): `wails init`, estrutura `app.go`/`main.go`, `wails.json`, e um spike mínimo de `exec.Command` no Go spawnando `mhl serve mcp <dir>` com pipes de stdin/stdout conectados, confirmando que dá para falar JSON-RPC por ali antes de integrar com o frontend.

### Fase 1 — Workflow `WorkItem`
- Declarar `memory`/`tool` para criar, listar e ler `project.json` por `project_id`.
- Implementar aqui o `tool Paths` (C1, §2.1) — validação de `project_id` + resolução de caminhos sob `projects/<project_id>/...` — já que é o primeiro workflow a existir e todos os outros (`Wiki`, `Discovery`, `Delivery`) vão importá-lo.
- `mhl lint` + `mhl test` cobrindo criação/listagem **e** casos de `project_id` inválido/malicioso (`../`, caminho absoluto, vazio) rejeitados por `Paths`.
- Rodar via `mhl run` isolado antes de plugar em `serve`.

### Fase 2 — Workflow `Wiki`
- Usa `Paths` (Fase 1) para todo acesso a `raw/`/`wiki/` — nenhum caminho montado à mão.
- `prompt Schema()` fixo (a "schema" do padrão) + `agent` de extração, com `prompt`s de instrução carregados de arquivo (mesmo padrão do exemplo `Review` em Docs-Reference §07) — um prompt + um `schema.json` por operação (ingest/query/lint), seguindo C3: a LLM só devolve campos, nunca o arquivo pronto.
- `schemas/`+`templates/` também para as páginas de wiki (`entity.schema.json`+`entity.md`, e o mesmo par para `source`, `concept`, `index_entry`), no mesmo espírito da §3.4 — única diferença de Discovery/Delivery: o arquivo final continua `.md`, não `.html` (só `artifacts/` virou HTML).
- Ação `ingest` processa **uma fonte por chamada** (o padrão recomenda ingerir e revisar uma de cada vez); a UI decide se dispara N chamadas em sequência (uma por arquivo enviado) ou oferece um modo "batch" com menos supervisão — ver Fase 6.
- Gate `pause()` opcional em `ingest`, depois do parse do JSON e antes do `fs.write` das páginas, para o usuário revisar o conteúdo antes de "commitar" — o equivalente ao fluxo "I read the summaries, check the updates, and guide the LLM" do artigo, via Modo Buddy.
- Inserção/ordenação em `wiki/index.md` é uma `tool` determinística (lê, insere a entrada nova na posição certa, escreve de volta) — nunca a LLM reescrevendo o arquivo inteiro (C3). `log.md` usa `memory { type: "append_log" }`, com a linha montada por `time.format(time.now(), layout: "2006-01-02")` + os campos devolvidos pelo schema, nunca formatada pela LLM.
- Ação `query` não persiste nada por padrão; só grava página nova quando `file_answer: true`.
- Ação `lint` (contradições, alegações desatualizadas, páginas órfãs, conceitos sem página, cross-references faltando) — reaproveita `fs.list`/`fs.read` **só dentro de `wiki/`** (C2); produz um relatório estruturado (`vars` de saída), sem escrever na wiki.
- Fora do escopo do v1 (mencionado no artigo como opcional): busca híbrida via `qmd`/MCP externo — `wiki/index.md` já cobre a escala inicial (~100 fontes); reavaliar via `extension mcp` só se o projeto crescer além disso.

### Fase 3 — Workflow `Discovery`
- Um `step` por artefato, selecionado pelo input `artifact`.
- Cada artefato lê Wiki + artefatos predecessores **do mesmo `project_id`** via `tool Context` (C2, §2.1) — nunca `raw/`, nunca outro projeto — para manter rastreabilidade, como no protocolo original.
- Cada artefato segue o padrão schema+template da §3.4: `schemas/<artifact>.schema.json` + `templates/<artifact>.html`; nenhum step escreve HTML vindo direto da LLM — sempre `run(..., schema: ...)` → `json.parse` → `Html.escape`/`Html.list` → `prompt ...Template(...) from "templates/..."` → `fs.write` (via `Paths`, C1).
- `Dispatch` inicial + `goto` para o step do `artifact` pedido + `goto Done` ao final (ver linha "Uso de Discovery/Delivery como workflow" na §2) — garante que `reached` no `mhl_run_status` mostre só o que realmente rodou, para a barra de progresso da UI.
- Campos de lista no schema sempre `type: "array"` + `Html.list` (C3, §2.1 — já não é mais uma escolha em aberto).
- `tool` dedicada para geração de id sequencial + slug (`FT001-nome-da-feature`, `US001-nome-da-historia`), reaproveitada pelos steps de `features` e `historias` — decidir cedo a regra de slug (normalização de acentos/espaços) e onde o contador vive (`dir.list("artifacts/features")` contando entradas, ou um contador em `memory`); é geração de id, então é `tool`, nunca a LLM (C3).
- Steps de `features`/`historias` usam `dir.create` (idempotente) para a pasta de cada item antes de `fs.write` do `feature.html`/`historia.html`.
- Gate `pause()` por artefato quando "Modo Buddy" estiver ativo — o `data` já parseado (passo 2 da §3.4) é o que fica exposto para revisão/edição humana antes do `fs.write` do template.

### Fase 4 — Workflow `Delivery`
- Reaproveita os mesmos `schema`s/`template`s/`tool`s de Discovery onde fizer sentido (brief, requisitos, adr, der, diagramas são conceitualmente iguais); diferencia o artefato final por `mode` (`feature` vs. `historia`) **e** por `standalone`.
- `standalone: true` escreve um arquivo único (`feature.html` com histórias embutidas, ou `historia.html` sem quebras) direto em `artifacts/` do próprio work-item — mesmo par schema+template do artefato final, só muda o destino.
- `standalone: false` reaproveita a mesma `tool` de id/slug do Discovery e escreve dentro da pasta do próprio backlog (mesmo `project_id` recebido — sem `parent_project_id`, C1 em §2.1), preservando o `FT00N`/`US00N` já atribuído por `Discovery` nesse projeto.

### Fase 5 — Servir via MCP local
- `mhl serve mcp ./workflows --state-dir <appdata>/state` spawnado de dentro do `app.go` do Wails (`os/exec.Command`), como processo filho da aplicação — sobe junto com o app e morre com ele.
- Implementar em Go, dentro do backend do Wails, um cliente MCP mínimo em stdio: `initialize` → `tools/list` → `tools/call` / `mhl_run_start` / `mhl_run_status` / `mhl_run_resume`, exposto ao frontend como métodos vinculados (bindings do Wails), não uma API HTTP própria.
- Mapear `mhl://workflow/<nome>` para gerar a UI de formulário dinamicamente a partir do `inputSchema` (evita duplicar o contrato na UI).
- Polling de `mhl_run_status` roda do lado Go (que já segura os pipes do `mhl`) e é empurrado ao frontend via `runtime.EventsEmit`, em vez do frontend fazer polling duplicado por cima do binding — ver §6.2.

### Fase 6 — Interface visual
- Tela "Meus work-items" (lista via `WorkItem action:list`).
- Fluxo "Novo work-item" → upload de arquivos-base → grava em `raw/` do projeto → chama `Wiki ingest`.
- Tela da Wiki gerada (visualização de `wiki/entities/*.md`, `concepts/*.md`, `sources/*.md`, `index.md` — ainda Markdown, então essa tela sim precisa de um renderer markdown→html client-side).
- Tela de geração de artefatos: lista de checkboxes/steps (igual à tabela "Visão geral do que será construído" do protocolo original), cada um disparando `Discovery`/`Delivery` com o `artifact` certo.
- **Progresso visível** — para cada `runId` iniciado (`mhl_run_start`), a UI faz polling de `mhl_run_status` e mostra, por artefato: estado (`working` / `paused` / `completed` / `failed` / `canceled`), `step`/`stepIndex`/`stepTotal` durante a execução, e o `reached` acumulado. A tela de geração inteira é essa lista de artefatos com o status de cada run lado a lado — o usuário nunca fica sem saber se algo está rodando, travado ou parado esperando aprovação. Estado `paused` mostra um botão "Aprovar e continuar" (`mhl_run_resume`) — Modo Buddy.
- **Pré-visualização por artefato** — como cada artefato já é `.html` (§3.4/3.2), a UI abre o arquivo direto num `iframe sandbox="allow-same-origin"` (sem `allow-scripts` para artefatos de texto; com `allow-scripts` só para os que embutem Mermaid, §3.5) ou via `srcdoc` a partir do `fs.read` do arquivo — nenhuma conversão client-side é necessária. Um toggle "ver fonte" mostra o HTML bruto para depuração.
- Preview e progresso vivem na mesma tela: clicar num artefato `completed` abre a pré-visualização; um artefato `working`/`paused` mostra o status em vez do preview (ainda não há arquivo final, ou o arquivo é o de uma tentativa anterior).
- **Consumo de token visível (C5)** — cada artefato `completed`/`working` mostra `tokens_in`/`tokens_out` daquela geração (vindo do `output:` do próprio run, sem chamada extra); o cabeçalho do work-item mostra o agregado via `WorkItem action:"usage"` (total de tokens do projeto inteiro, somando todos os `runId`s já executados nele) — atualizado a cada `mhl_run_status` que chega em `completed`.

### Fase 7 — Empacotamento como executável local
- Vendorizar o binário `mhl` por plataforma (`mhl-darwin-arm64`, `mhl-darwin-amd64`, `mhl-windows-amd64.exe`, `mhl-linux-amd64`), seguindo a mesma convenção de nomeação usada pelas extensions (Docs-Extensions §"One package can carry every platform's binary").
- `wails build -platform darwin/amd64,darwin/arm64,windows/amd64,linux/amd64` gera o executável nativo por SO; decidir (`go:embed` vs. pasta ao lado do binário) onde entram o `mhl` vendorizado, os `workflows/*.mh`, `schemas/`, `templates/` e `assets/mermaid.min.js` — ver §6.1.
- Diretório de dados do usuário (`~/.senpai/`) criado no primeiro start; state-dir do `mhl serve` aponta pra lá.

### Fase 8 — Hardening
- `mhl lint .` e `mhl test .` no CI antes de cada empacotamento.
- Revisão de segurança: processo filho só fala stdio local (sem bind de rede exposta), sem token necessário porque não há transporte de rede; se algum dia migrar para `--http`, revisitar `--token`/loopback (Docs-Servers, seção de guardas).
- Checklist de C1/C2/C3 (§2.1) em todo PR que toca `Wiki`/`Discovery`/`Delivery`: todo `fs`/`dir` passa por `Paths`/`Context`? Nenhum step lê `raw/` fora de `Wiki ingest`? Nenhum schema/prompt pede formatação, id ou ordenação à LLM? Como `mhl lint` não pega isso, vira item de review manual (ou um linter próprio, se der tempo).
- Política de retenção: `checkpoint.ttl` e limpeza de sessões antigas por work-item.

## 6. Stack do shell visual — decidido: Wails (Go + web frontend)

Fechado. Mesma linguagem (Go) do runtime `mhl`; spawn de processo filho + pipes de stdio são nativos da stdlib Go (`os/exec`); compila para **1 binário nativo por SO**, sem runtime extra embarcado (ao contrário do Electron/Node). Alternativas descartadas: Tauri (Rust — toolchain a mais, sem ganho que justifique, já que o runtime já é Go) e Electron (binário grande, backend em outra linguagem para orquestrar um processo Go).

### 6.1 O que isso fixa no design

- **Backend do shell = Go.** É quem spawna `mhl serve mcp <dir>` (`os/exec.Command`), mantém os pipes `Stdin`/`Stdout` abertos pela vida do processo filho, e implementa o cliente JSON-RPC 2.0 mínimo por cima desses pipes (`initialize` → `tools/list` → `tools/call`/`mhl_run_*`) — é o "cliente MCP em stdio" da Fase 5, só que concretamente em Go, não uma escolha em aberto.
- **Frontend = HTML/CSS/TS**, servido pelo runtime do Wails dentro do webview nativo do SO (WebView2 no Windows, WebKit no macOS/Linux — sem Chromium embarcado, diferente do Electron). É essa mesma webview que faz a pré-visualização dos artefatos `.html` (§ Fase 6) e roda o Mermaid client-side (§3.5).
- **Ponte Go↔JS é bindings do Wails**, não uma API HTTP própria: métodos exportados de uma struct Go (`type App struct{...}`) ficam chamáveis direto do TypeScript do frontend (`window.go.main.App.StartRun(...)`), com o Wails gerando os tipos TS automaticamente a partir das assinaturas Go. Evita reinventar um protocolo entre UI e shell além do MCP que já fala com o `mhl`.
- **Distribuição = `wails build`**, cross-compilando por plataforma (`-platform darwin/amd64,darwin/arm64,windows/amd64,linux/amd64`) — cobre o requisito de "executável único por SO" da Fase 7 diretamente, sem passo extra de empacotamento.
- **Assets locais** (binário `mhl` vendorizado, `mermaid.min.js`, os `schemas/`/`templates/` dos workflows) entram via `go:embed` no binário do Wails ou como pasta ao lado do executável — decidir em Fase 7 qual dos dois, mas o mecanismo (`go:embed`) já é o padrão natural do Go, sem dependência nova.

### 6.2 Consequência para as fases já descritas

- **Fase 0**: setup do projeto Wails substitui a "escolha de stack" (ver Fase 0 acima).
- **Fase 5 (Servir via MCP local)**: "implementar, no shell, um cliente MCP mínimo em stdio" passa a ser, concretamente, um pacote Go dentro do projeto Wails.
- **Fase 6 (Interface visual)**: o `iframe`/`srcdoc` de pré-visualização e o polling de `mhl_run_status` rodam dentro da webview do Wails; o polling em si pode ser feito do lado Go (que já fala com o `mhl` pelos pipes) e empurrado pro frontend via evento Wails (`runtime.EventsEmit`), em vez de o frontend fazer polling duplicado por cima do binding.
- **Fase 7 (Empacotamento)**: `wails build` é o comando central; vendoring do binário `mhl` por plataforma continua necessário (Wails empacota o *shell*, não o runtime MHL, que é um binário externo spawnado).

## 7. Riscos e perguntas em aberto

- **`--state-dir` em stdio puro**: precisa validar cedo (Fase 0) se persiste entre reinícios do processo filho; se não persistir, um `pause()` sobrevive só enquanto o app estiver aberto — pode ser aceitável para v1, mas muda a promessa de "retomar depois".
- **Dependência de um agente de LLM**: `Wiki`/`Discovery`/`Delivery` chamam `agent.run(...)`; se o objetivo é "rodar localmente" sem configuração externa, isso empurra para um modelo local via Ollama — precisa decidir se isso é aceitável em termos de qualidade de geração.
- **Tamanho dos uploads**: arquivos grandes (PDFs) devem ser referenciados por caminho, nunca inline — já coberto no design, mas vale um teste de carga na Fase 2.
- **Reuso de prompts entre Discovery e Delivery**: extrair para `prompt`s compartilhados desde o início evita duplicar `brief`/`requisitos`/`adr`/`der` nos dois workflows.
- **Ingest um-a-um vs. batch**: o padrão de [docs/wiki-llm.md](docs/wiki-llm.md) recomenda revisar fonte por fonte; para um upload de 20 arquivos de uma vez isso vira 20 chamadas (ou 20 pausas) — decidir na Fase 6 se a UI expõe as duas velocidades (supervisionado vs. lote sem pausa) desde o v1 ou só a versão supervisionada.
- **Schema fixa (Fase 2) vs. schema evolutiva por projeto (artigo original)**: v1 usa um único `prompt` de convenções para todos os projetos; se diferentes domínios de work-item precisarem de convenções de wiki diferentes, isso vira trabalho de uma fase futura (schema editável por projeto, guardada em `wiki/SCHEMA.md`).
- **Suporte a `--json-schema` no agente CLI escolhido**: o padrão schema+template (§3.4) depende do backend realmente honrar saída estruturada — validar na Fase 0, junto da escolha do agente, que o CLI (`claude`, outro) ou o modelo Ollama aceita `schema:`/`--json-schema` de forma confiável, e não só "na maioria das vezes"; sem isso o `json.parse` do passo 2 vira o ponto de falha mais comum do pipeline.
- **HTML-injection via campo não escapado**: se algum artefato novo esquecer de passar um campo por `Html.escape`/`Html.list` antes do prompt-template (§3.4), o conteúdo (potencialmente influenciado por texto de `raw/` ou pela própria LLM) quebra o layout ou injeta markup no artefato final — não há um mecanismo do MHL que force isso automaticamente; a mitigação é convenção + `mhl test` cobrindo pelo menos um caso de caractere especial por schema.
- **Mermaid client-side (§3.5) exige JS no viewer**: a pré-visualização dentro do app funciona (webview tem JS), mas se o artefato `.html` for aberto fora do app (double-click, anexado a um e-mail) com JS bloqueado, o diagrama não renderiza — aceitável para v1, mas revisitar se "exportar para PDF" virar requisito (aí precisaria de um render-to-SVG em build-time, com o custo de Chromium/`mermaid-cli` mencionado em §3.5).
- **Extensão `.html` em `prompt ... from`**: nenhum exemplo oficial usa extensão diferente de `.md`; validar na Fase 0 antes de escrever os templates reais (ver nota em §3.4).
- **C1/C2/C3 (§2.1) não são impostas pelo compilador do MHL** — `mhl lint` valida sintaxe/tipos/referências, não "este `fs.read` só pode apontar para dentro de `wiki/`". As três constraints dependem de convenção de código (sempre passar por `Paths`/`Context`/`Html`, nunca montar path ou pedir formatação à mão) reforçada por `mhl test`, não de uma garantia estrutural da linguagem — tratar como item fixo de checklist de code review em toda fase que toca `Discovery`/`Delivery`/`Wiki` (Fase 8 formaliza isso, mas vale desde a Fase 2).
- **Devin CLI é a maior incógnita do plano inteiro**: diferente de `claude`/`codex` (usados desde a Fase 0 em dev), o Devin CLI só entra em produção — então C3 (saída JSON via schema) e C5 (extração de token) podem passar a Fase 0 inteira "funcionando" com Claude/Codex e só quebrar quando alguém apontar o `SENPAI_AGENT_CLI` pra produção. Mitigação: incluir um smoke test manual com Devin CLI real ainda na Fase 0 (não esperar a Fase 7/deploy), mesmo que o resto do desenvolvimento continue em Claude/Codex.
- **Parser de uso por backend (C5) é código que ninguém documentou**: o formato exato do envelope de tokens em `--output-format json` de cada CLI (`claude`/`codex`/`devin`) não está nos docs do MHL (é particularidade de cada ferramenta, fora do escopo da linguagem) — `UsageParser` só pode ser escrito depois de inspecionar a saída real de cada CLI, e cada um pode mudar esse formato numa atualização futura sem aviso; tratar como acoplamento externo frágil, com teste de contrato (`mhl test`) por backend.
- **Comando/args por `env()` (C4) pode não ser suportado**: se a Fase 0 confirmar que `command:`/`args:` só aceitam literais, o plano B é gerar (ou manter) declarações de `agent` separadas por ambiente — ex. `agent Writer` com `command: "claude"` versus uma versão de produção com `command: "devin"` — escolhidas por qual arquivo é carregado, não por uma expressão dentro do mesmo `.mh`; revisitar §2.1/C4 se for esse o caso.
