# Fase 0 — Achados dos spikes

## 0. Revalidação — `mhl` atualizado de `1.4.0-beta.5` para `1.4.0-beta.6`

O binário instalado mudou de versão entre a redação inicial deste documento e esta revisão (`~/.mhl/bin/mhl`, timestamp do binário: 13/09 14:59) — o mantenedor do MHL corrigiu, no runtime real, vários itens que este projeto reportou em [MHL-Melhorias.md](MHL-Melhorias.md). Cada "✅ Resolvido" marcado naquele arquivo foi **reverificado aqui por spike**, não aceito de olhos fechados — resultado:

| Item (MHL-Melhorias.md) | Reverificado | Resultado |
|---|---|---|
| #1 — `env()` em `agent.command`/`args` | ✅ | `command: env("SENPAI_TEST_CMD")` roda de verdade agora — `mhl lint` limpo, `mhl run` executa. |
| #3 — `memory { path_guard: "no_traversal" }` | ✅ | Um `project_id` com `../../../../tmp/x` é rejeitado com erro claro (`interpolated value "..." contains ".."`) antes de tocar o disco; um id benigno continua funcionando normal. |
| #4 — `html.escape`/`html.attr_escape` nativos | ✅ | Ambos disponíveis e escapam `<`, `>`, `&`, `'`, `"` corretamente (verificado via round-trip). |
| #5 — falso-positivo do lint em `.append()` | ✅ | `items.append(x)` numa `var` array simples não gera mais nenhum achado de lint. |
| #8 — `input` com valor default | ✅ | `input name: string = ""` aceito; some do `required` do `inputSchema` e aparece como `"default": ""`; um valor passado pelo chamador continua vencendo o default. |
| #9 — `enum` projetado no `inputSchema` | ✅ (schema) — ⚠️ **novo gap encontrado por trás dele** | O `inputSchema` de fato ganha `"enum": ["Create","List",...]`. Mas ao testar o caminho completo (chamar de fora com uma string e comparar contra a variante), achei que o valor **não é coagido** para o tipo enum de verdade — `type_of(action)` continua `"string"`, `action == ActionType.Create` é `false`, e `match` não bate em nenhuma variante. Reportado como **item novo #15** em MHL-Melhorias.md — não estava no relato original, é uma descoberta desta revisão. |
| #14 — `string.matches(pattern)` | ✅ | Regex RE2, string inteira contra o padrão; confirmado com um caso válido e um inválido. |

**Itens que continuam sem correção** (marcados `🚧 Blocking` no arquivo de melhorias, não reverificados aqui por não terem mudado): #2 (`mhl_run_*` só em `--http`), #6 (chamada a método-irmão de `tool` precisa de qualificação), #7 (escrita de campo via `[...]`, não `.`), #10 (sem escape de literal no layout amigável de `time.format`), #11 (contrato de `schema:` divergente entre `claude`/`codex`/`devin`), #12 (`--format json` pode emitir JSON inválido no campo `log`), #13 (não dá para testar um `workflow` inteiro via `test`/`describe`).

**Consequência para o código já escrito (Fases 0-1):** ver §10 mais abaixo para o que isso muda em `tool Paths`/`workflow WorkItem`, e a seção "0. Status do desenvolvimento" do plano macro para o registro formal.


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
- **Método de `tool` chamando um "irmão" precisa ser qualificado — mas `self.` já resolve.** Dentro do próprio `tool Paths`, `root(id)` chamando `ensure_valid(id)` **sem nenhum prefixo** falha com `undefined variable "ensure_valid"`. Nesta fase eu só tinha testado a forma sem prefixo e a forma com o nome completo do tool (`Paths.ensure_valid(id)`) — **correção feita na Fase 2**: `self.ensure_valid(id)` funciona perfeitamente (verificado por spike, tanto em corpo de expressão quanto em bloco) e é a forma idiomática — só não documentada nas páginas lidas. Ver [MHL-Melhorias.md #6](MHL-Melhorias.md) para o relato completo; código do Senpai passou a usar `self.` em vez do nome do tool repetido.
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

## 10. Consequência da atualização `beta.6` para o código já escrito (`Paths`/`WorkItem`)

Decisões tomadas ao revisar a Fase 0/1 depois da revalidação acima:

- **`tool Paths.is_valid_id` simplificado com `string.matches`** (item #14 confirmado): a validação por `split("")` + laço de caractere-a-caractere vira uma linha, `project_id.matches("^[A-Za-z0-9_-]{1,128}$")` — o padrão âncorado já rejeita `/`, `\`, `..` e qualquer caractere fora do conjunto permitido sem checagens redundantes (um `.` sozinho, fora do conjunto permitido, já reprova a regex — não precisa mais de `contains("..")` em separado).
- **`memory { path_guard: "no_traversal" }` (item #3) não substitui `tool Paths` — complementa.** `WorkItem`/`Paths` continuam usando `fs`/`dir` diretos (não `memory`) para `project.json`/`usage.jsonl`, porque `Paths` também constrói caminhos para `wiki/`/`artifacts/`/`raw/` que nunca passam por `memory` — um único mecanismo (`Paths.ensure_valid`) continua sendo mais simples de raciocinar/auditar do que dois mecanismos parcialmente sobrepostos. Registrado para a Fase 2 em diante: se algum `memory` novo interpolar `project_id` diretamente (ex. `Usage` em C5), declarar `path_guard: "no_traversal"` nele também — defesa em profundidade, não substituto de validar `project_id` antes com `Paths.ensure_valid`.
- **`input name/project_id: string = ""` adotado no `WorkItem`** (item #8 confirmado): antes, os 4 inputs eram sempre obrigatórios em toda chamada (inclusive os irrelevantes pra ação escolhida) por causa de uma limitação da linguagem, não por design. Corrigida a limitação, o `WorkItem` passa a declarar default `""` em `name`/`project_id` (só `action` continua sem default — não existe uma ação padrão sensata). `item_type` também ganha default `""`, resolvendo para as ações que não são `create`. O `inputSchema` exposto via `tools/list` passa a refletir isso com precisão (`required: ["action"]` em vez dos 4 campos).
- **`enum` para `action`/`item_type` — decisão: não adotar ainda.** Seria a aplicação direta de C7 ("considerar enum quando o valor for fechado") e do que o item #9 parecia liberar, mas a revalidação encontrou o gap do item #15 (coerção de `enum` externo não funciona) — adotar agora quebraria silenciosamente todo `match`/`==` contra as variantes. `action`/`item_type` continuam `string` simples, validados por `tool` (`Paths`-style, com `.contains(...)`/`.matches(...)` contra uma lista permitida). Revisitar quando o item #15 for corrigido.

## 11. Spike do shell Wails — `exec.Command` + MCP sobre HTTP a partir do Go, ponta a ponta

Último item em aberto da Fase 0 (§6 do plano). `wails init -t vanilla` em `app/`; pacote `app/mhlbridge` spawna `mhl serve mcp --http --addr 127.0.0.1:<porta livre>` (já `--http`, não stdio — achado §2 desta fase), completa o handshake MCP (`initialize` → `Mcp-Session-Id`) e expõe `ToolsList`/`ToolsCall`. `App.PingMHL()` — um bound method do Wails — chama `tools/list` e um `WorkItem(action:"list")` real, e vira binding JS automático (`wailsjs/go/main/App.js`) consumido por um botão mínimo no frontend.

**Validado:**
- `go build`/`go vet`/`gofmt` limpos.
- `wails build` produz um `.app` nativo (`darwin/arm64`) funcional — só a assinatura ad-hoc automática do Wails falhou (`codesign failed: ... resource fork, Finder information, or similar detritus not allowed`), por causa de um atributo estendido `com.apple.provenance` que este ambiente de desenvolvimento sandboxado adiciona a todo arquivo novo — **não é um problema do código nem do Wails**; resolvido manualmente com `xattr -cr app.app && codesign --force --deep -s - app.app` antes de rodar. Ambiente de desenvolvimento real (fora deste sandbox) não deve ter esse problema.
- Rodando o `.app` assinado: loga `mhl bridge: ready, serving .../workflows`, e um `ps aux` confirma `mhl serve mcp --http --addr 127.0.0.1:<porta> .../workflows` rodando como processo filho de verdade.
- Encerrar o app (`kill` no processo) aciona o handler de shutdown nativo do Wails ("Ctrl+C detected. Shutting down..."), que chama nosso `OnShutdown` → `mhlbridge.Client.Stop()` → nenhum processo `mhl serve` órfão depois (confirmado via `ps aux` antes/depois).
- `app_test.go::TestPingMHLEndToEnd` automatiza o ciclo inteiro (`startup` real → `PingMHL()` real, contra o `mhl` e o `workflows/` reais, sem mocks → `shutdown` real) e passa — prova que o mecanismo funciona sem depender de clicar manualmente num botão.

**Não verificado:** o clique do botão dentro de uma janela real e visível — este ambiente de execução não tem sessão gráfica interativa (sem display attachado ao processo). A cadeia de binding (JS → `window['go']['main']['App']['PingMHL']` → método Go → resultado) foi confirmada **mecanicamente** (o binding é gerado corretamente a partir da assinatura Go, e o mesmo método por trás dele foi exercitado de ponta a ponta via `go test`) mas não **visualmente**. Ficar de olho na Fase 6, quando a UI de verdade existir e puder ser aberta numa máquina com tela.

**Decisões de design que saíram desse spike, não previstas em detalhe no plano original:**
- O processo `mhl` filho recebe seu próprio grupo de processo (`setProcessGroup`, Unix via `Setpgid`, Windows via `CREATE_NEW_PROCESS_GROUP` — arquivos `_unix`/`_windows` com build tags, C6) para não ser atingido por um sinal endereçado só ao grupo do processo pai.
- A porta é escolhida dinamicamente (`net.Listen("tcp", "127.0.0.1:0")`, depois liberada) em vez de fixa — evita colisão se o usuário já tiver algo na porta padrão do `mhl` (`8711`) ou abrir duas instâncias do Senpai.
- `Client.Stop()` tenta um encerramento gracioso (`os.Interrupt`) antes de `Kill()` — no Windows, `Signal` não suporta isso para um processo arbitrário e cai direto para `Kill()`; aceitável para uma ferramenta local, documentado no código.
- O caminho de `workflows/` usado no spike (`../workflows`, relativo ao diretório `app/`) é propositalmente provisório — a Fase 7 decide entre vendorizar/embutir esse diretório junto do executável (`go:embed` vs. pasta ao lado do binário, já previsto em §6.1) em vez de depender de uma estrutura de diretórios de desenvolvimento.

## Consequência prática para as próximas fases

- **Fase 5** muda de "stdio puro" para "`--http` em loopback" — atualizar §6.1/§6.2 do plano macro quando essa fase for escrita (nota, não bloqueio).
- **Fase 2 em diante**: todo `agent` de produção usa `command`/`args` fixos por arquivo (`agents.local.mh`/`agents.prod.mh`), nunca `env(...)` dentro de `command:`.
- **Fase 2**: ao declarar o primeiro `agent Writer`, usar o padrão validado no spike 5 para o `after` hook do backend `claude`.
