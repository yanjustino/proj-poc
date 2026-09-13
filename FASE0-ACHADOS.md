# Fase 0 — Achados dos spikes

> Valida (ou invalida) as suposições/assunções em aberto do [PLANO-MACRO-MHL-SENPAI.md](PLANO-MACRO-MHL-SENPAI.md) antes de escrever os workflows reais. `mhl 1.4.0-beta.5` instalado em `~/.mhl/bin/mhl`. Scripts de spike em `spikes/` (não fazem parte do produto — mantidos como referência).

## 1. `command:`/`args:` do `agent` **não aceitam `env(...)`** — só string literal

```
agent Echo { command: env("SENPAI_TEST_CMD") args: ["${prompt}"] }
```
→ `mhl lint`: `agent "Echo" has no command`. Confirma o risco do plano (§7, C4): a troca de backend por ambiente **não pode** ser uma expressão dentro do mesmo `.mh`.

**Decisão adotada (plano B do próprio documento):** dois arquivos de agente por ambiente — `workflows/shared/agents.local.mh` (Claude/Codex, dev) e `workflows/shared/agents.prod.mh` (Devin) — cada workflow importa o arquivo de agente certo; a escolha de ambiente vira "qual arquivo é importado", não uma expressão em runtime. Formalizado na Fase 2+ quando os primeiros `agent` entrarem em uso.

## 2. **Achado crítico — `mhl_run_start`/`status`/`resume`/`cancel`/`list`/`logs` só existem sob `--http`, não em stdio puro**

Testado: `mhl serve mcp <dir>` (stdio) publica só as ferramentas 1:1 por workflow — `tools/list` nunca inclui `mhl_run_*`, e chamar `mhl_run_start` por stdio retorna `unknown tool "mhl_run_start"`. Repetindo a mesma sequência contra `mhl serve mcp --http`, após o handshake `initialize`, `tools/list` já traz `['<Workflow>', 'mhl_run_start', 'mhl_run_status', 'mhl_run_resume', 'mhl_run_cancel', 'mhl_run_list', 'mhl_run_logs']`.

**Isso invalida a decisão de arquitetura da linha 24 do plano** ("Servidor exposto via `mhl serve mcp <dir>` em stdio, spawnado como processo filho... a UI não fala com uma API própria, fala MCP com o `mhl`") no que depende de progresso assíncrono e Modo Buddy — que são justamente C5 e a pausa/retomada do §2.

**Correção adotada para a Fase 5:** o backend Go do Wails sobe `mhl serve mcp --http --addr 127.0.0.1:<porta-livre> <dir>` como processo filho (ainda um único processo local, sem infra externa — `--addr` fica em loopback, sem `--token` necessário já que não sai da máquina) e fala com ele via cliente HTTP padrão do Go, não via pipes de stdin/stdout crus. O ciclo de vida (sobe com o app, morre com o app) e o restante do design (Fase 6 lê `mhl_run_status`, Modo Buddy usa `mhl_run_resume`) continuam idênticos — só o transporte muda de "JSON-RPC em pipe" para "JSON-RPC sobre `POST /mcp` em loopback", com o detalhe extra do handshake `initialize` devolvendo um header `Mcp-Session-Id` que precisa ser ecoado em toda chamada seguinte (`tools/list`, `tools/call`, etc.) — ver Docs-Servers §04.

Ciclo completo validado via `curl` contra `--http`: `mhl_run_start` (Approval, `approved:"no"`) → `mhl_run_status` devolve `state:"paused", reason:"awaiting approval..."` → `mhl_run_resume` com `{approved:"yes"}` → `mhl_run_status` final devolve `state:"completed", reached:["Prepare","Gate","Act"]`. Bate exatamente com a §06 dos Docs-Servers.

## 3. `prompt ... from "arquivo.html"` funciona idêntico a `.md`

Testado: `prompt Brief(title, body) from "templates/brief.html"` renderiza normalmente (`<h1>${title}</h1>`), sem nenhuma restrição de extensão. Confirma a assunção da §3.4 do plano — nenhum ajuste necessário para os 8+ templates HTML de Discovery/Delivery.

## 4. Suporte a schema estruturado — **diverge por CLI, e Devin não tem nenhum**

| Backend | Flag | Forma |
|---|---|---|
| `claude` | `--json-schema <schema>` | schema **inline** (string JSON), exatamente como o exemplo dos Docs-Reference §05 |
| `codex` | `codex exec --output-schema <FILE>` | schema como **caminho de arquivo**, não inline — precisa de um `fs.write` do schema num arquivo temporário antes da chamada |
| `devin` | — | **nenhuma flag de schema/JSON estruturado em `--help`**, nem em `-p`/`--print` |

**Achado crítico confirmado:** a maior incógnita do plano (§7 — "Devin CLI é a maior incógnita do plano inteiro") é real, não hipotética. Sem `--json-schema`/`--output-schema` no Devin CLI, C3 (LLM só devolve JSON validado contra schema) não tem mecanismo nativo em produção.
**Mitigação recomendada (não implementada agora — é decisão de Fase 7/produção):** para o backend `devin`, incluir o JSON Schema como texto dentro do próprio `prompt` (pedido em linguagem natural + o schema colado, sem enforcement do CLI) e adicionar um passo de "reparo" depois do `json.parse` falhar — uma segunda chamada curta "conserte este JSON para bater com o schema: ...". Trata-se de uma exceção só para o backend Devin; `claude`/`codex` continuam com enforcement real. Registrar como risco aberto de produção, não bloqueia Fases 1-6 (que rodam em dev com `claude`/`codex`).

## 5. Confirmado — o envelope do CLI (`after` hook) carrega uso de token junto do conteúdo

Chamada real ao `claude` (via `agent.run(prompt:, schema:)`) devolveu em `raw` (o texto cru pré-`after`) um envelope com, entre outros: `usage.input_tokens`, `usage.output_tokens`, `modelUsage` (custo/tokens por modelo, já que o Claude Code roteia parte do trabalho para um modelo menor), `total_cost_usd`, e o conteúdo pedido duplicado em dois lugares — `structured_output` (já objeto) e `result` (a mesma coisa, como string JSON).

Isso fecha o desenho do `UsageParser` (C5, §3.4) para o backend `claude`: `after` faz `var env = json.parse(result)`, tokens = `env.usage.input_tokens`/`env.usage.output_tokens`, conteúdo limpo a devolver = `env.result` (já é a string JSON que o passo 2 da §3.4 espera parsear). Backend `codex`/`devin` terão parsers próprios (formato ainda não inspecionado — ficam para quando esses backends entrarem em uso real, Fases futuras).

## 6. Sem novidade — confirma o que o plano já assumia

- `--state-dir` só existe como flag de `mhl serve mcp --http` (`mhl serve mcp --help` não lista para stdio puro) — irrelevante agora que a Fase 5 já vai usar `--http` por causa do achado 2.
- Não existe `html.escape` nativo — só `.replace()` em string — confirma que o `tool Html` da §3.4 precisa ser escrito à mão com `.replace()` encadeado.

## 7. Achado crítico de segurança — `memory { path: "...${project_id}..." }` interpola sem sanitizar; path traversal funciona de verdade

Testado: `memory Project { path: "projects/${project_id}/project.json" }`, chamado de dentro de uma `pipeline` com `input project_id: string`, resolve `${project_id}` contra o valor real do input — **isso por si só é bom** (confirma que a interpolação de `path:` enxerga variáveis de pipeline, não só `context.*`, viabilizando isolamento por projeto). O problema: com `project_id = "../../../../tmp/mhl_spike2_escaped"`, o arquivo foi gravado em `/private/tmp/mhl_spike2_escaped/project.json` — **fora de `projects/` por completo**. Nenhuma sanitização automática acontece na interpolação de `path:`.

**Consequência direta para a Fase 1:** `tool Paths` não é "uma opção de design" — é a única coisa que impede um `project_id` malicioso de escapar. Decisão adotada: **não usar `memory { type: "json", path: "...${project_id}..." }` para `project.json`/`usage.jsonl`**, mesmo que funcione — usar exclusivamente `tool Paths` (que chama `fail(...)` num `project_id` inválido antes de montar qualquer caminho) seguido de `fs.read`/`fs.write`/`json.parse`/`json.stringify` diretos. Isso é estritamente mais seguro que confiar na conveniência do `memory` interpolado, e é exatamente o mecanismo que C1 (§2.1 do plano) já prescrevia — este spike só prova que era necessário, não opcional.

Regra adotada em código (todo workflow que recebe `project_id` de fora): a primeira linha de qualquer step que o usa reatribui `project_id = Paths.ensure_valid(project_id)` — nunca usa o valor bruto do input diretamente em uma string interpolada ou chamada `fs`/`dir`.

## 8. Achados de sintaxe descobertos escrevendo a Fase 1 (`tool Paths` + `workflow WorkItem`)

Nenhum destes está documentado explicitamente nas páginas de referência lidas — descobertos por tentativa em `mhl lint`/`mhl run`:

- **`input` não aceita valor default.** A gramática da §02 do Reference mostra `parameter := identifier [":" type] ["=" expression]` (usado em métodos de `tool` e lambdas) mas `input := "input" Identifier ":" type` (sem `=`). Todo `input` de um `pipeline`/`workflow` é obrigatório — o padrão do próprio exemplo `Approval` dos Docs-Servers já mostrava isso (`approved` sempre passado, "no" no start) mas não estava explícito que é uma regra da linguagem, não só um estilo. Consequência: `WorkItem` declara os 4 inputs sempre obrigatórios; quem chama passa `""` para os que não valem para a `action` escolhida.
- **`var` não aceita anotação de tipo.** `var x: any = null` é erro de parse — só `var x = null`. Anotação de tipo (`: Type`) só existe em `input`, `parameter` e retorno de método de `tool`.
- **Método de `tool` chamando um "irmão" precisa ser qualificado.** Dentro do próprio `tool Paths`, `root(id)` chamando `ensure_valid(id)` sem prefixo falha com `undefined variable "ensure_valid"` — precisa ser `Paths.ensure_valid(id)`, mesmo estando no mesmo bloco `tool`. Não documentado nas páginas lidas; contradiz a expectativa de que o corpo de um método veria os outros métodos do mesmo tool como escopo local.
- **Escrita de campo de objeto exige colchete, não ponto.** `record.archived = true` → `assignment target must be a plain variable or an array index, not a nested field`. Escrita precisa ser `record["archived"] = true`. Leitura (`record.archived`) funciona normalmente com ponto — só a **escrita** exige `[...]`. Bate com a frase do Reference "Assigning to `items[index]` or `object[key]` mutates the original collection" (§03) — mas ali não fica claro que `object.key = ...` (com ponto) é rejeitado, não só "uma forma alternativa".
- **`<array-var>.append(x)` é falso-positivo no `mhl lint`** (mas roda certo em `mhl run`/`mhl test`): o lint tenta resolver `<nome>.append(...)` como uma chamada de método `append` de uma declaração `memory` (o nome homônimo do método `append` de `memory { type: "append_log" | "jsonl" }`), e erra com `memory "<nome>" not found` quando `<nome>` é só uma `var` array comum — mesmo com `mhl run` executando o `.append()` corretamente sobre o array. Já existe um caso irmão documentado no Reference §08 para `remove` em `memory json` ("treat a remove finding as a false positive") — este é o mesmo tipo de lacuna do lint beta, mas para `append` em array puro. **Mitigação adotada: usar `acc += [x]` em vez de `acc = acc.append(x)`** sempre que for acumular um array numa `var` de pipeline/step — os Docs-Reference já apresentam as duas formas como equivalentes ("To accumulate into a list, reassign — `acc = acc.append(x)` or `acc += [x]`"), então trocar não perde expressividade e mantém `mhl lint .` limpo (relevante para o gate de CI da Fase 8).
- **`time.format` não tem escape tipo `'T'`/`'Z'` (estilo Java/ICU) nos tokens amigáveis (`yyyy`/`MM`/…).** `"yyyy-MM-dd'T'HH:mm:ss'Z'"` produz literalmente `2026-09-13'T'16:01:50'Z'` (aspas simples inclusas) em vez de interpretar como escape de literal. Para timestamp ISO 8601/RFC 3339 em UTC, usar o layout **Go puro**: `time.format(time.now(), "2006-01-02T15:04:05Z07:00")` → `"2026-09-13T16:02:15Z"`. Vale para todo `created_at`/timestamp desse formato nas próximas fases (Wiki `log.md`, `usage.jsonl`, etc.).

## 9. Achado crítico de segurança — `claude -p` sem flag de restrição explora e escreve fora do escopo do prompt

Durante o spike do item 5 (chamada real ao `claude` CLI via `agent.run(prompt:, schema:)` pedindo só "um título e um resumo sobre a linguagem MHL"), o processo `claude -p` — invocado sem nenhuma flag de permissão/sandbox — acabou, por conta própria, tentando explorar o diretório do projeto (`ls`/`Read` em `PLANO-MACRO-MHL-SENPAI.md`, negados pelo modo padrão) e **efetivamente leu/buscou o bastante para copiar toda a suíte de exemplos oficiais do próprio MHL para `docs/sample/`** (~300 arquivos `.mh`/`README.md` + um binário `mhl` de ~9.8 MB) — nenhuma dessas ações fazia parte do prompt. `num_turns` da resposta foi 11 (várias chamadas de ferramenta), e só 3 delas aparecem como negadas — as demais tiveram sucesso.

**Isso é a constraint C2 do plano (§2.1) se manifestando de verdade, não hipoteticamente:** um agente de LLM invocado sem restrição explícita de ferramentas pode ler/escrever/buscar muito além do que o prompt pediu, mesmo com um prompt inofensivo. Para produção, isso significa que **C2 não pode depender só de "o prompt não pede para ler `raw/`"** — o processo do CLI em si precisa ser invocado com flags que **impeçam** acesso a ferramentas de arquivo/rede, não apenas contar com o bom comportamento do modelo.

**Flags de restrição confirmadas nos três CLIs (`--help` real, não documentação do MHL):**

| Backend | Flag | Efeito |
|---|---|---|
| `claude` | `--permission-mode plan` ou `--disallowed-tools "Bash,Read,Write,WebFetch,WebSearch"` | restringe quais ferramentas o Claude Code pode executar durante o `-p` |
| `codex` | `codex exec --sandbox read-only` (ou `workspace-write` restrito ao diretório do projeto) | política de sandbox para comandos que o modelo tentar executar |
| `devin` | `--permission-mode auto` (já é o **default** — só auto-aprova ferramentas somente-leitura) + `--sandbox` para restringir escrita ao workspace | modo `auto` é relativamente seguro por padrão; `accept-edits`/`smart`/`dangerous` são escaladas explícitas, nunca usar em produção para geração de artefato |

**Ação adotada:** toda declaração `agent` usada por `Wiki`/`Discovery`/`Delivery` (Fases 2-4) precisa incluir a flag de restrição correspondente em `args` desde a primeira versão — não como hardening tardio da Fase 8. `docs/sample/` foi removido do controle de versão (`.gitignore`) — é uma cópia de terceiros (a própria suíte de exemplos do MHL) que apareceu sem ter sido pedida, mantida localmente como referência (é bem útil para as Fases 2-4: exemplos oficiais de `agents/`, `memory/`, `html/`, `mcp/`), mas não pertence ao histórico do Senpai.

## Consequência prática para as próximas fases

- **Fase 5** muda de "stdio puro" para "`--http` em loopback" — atualizar §6.1/§6.2 do plano macro quando essa fase for escrita (nota, não bloqueio).
- **Fase 2 em diante**: todo `agent` de produção usa `command`/`args` fixos por arquivo (`agents.local.mh`/`agents.prod.mh`), nunca `env(...)` dentro de `command:`.
- **Fase 2**: ao declarar o primeiro `agent Writer`, usar o padrão validado no spike 5 para o `after` hook do backend `claude`.
