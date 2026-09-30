# HOW-TO-OBSERVE.md — Observabilidade e Troubleshooting do Radahn

Guia para engenheiros que operam e diagnosticam aplicações que rodam sobre o motor
**Radahn** (o binário que carrega um `radahn.yaml` e serve as rotas declaradas).

Este documento cobre:

1. O modelo de observabilidade do Radahn (o que existe de fato hoje).
2. O formato dos logs — **tudo JSON**: linhas de ciclo de vida (boot/hooks/workers/shutdown) **e** o log estruturado por step.
3. O modo **debug** (`spec.debug`) e o envelope de diagnóstico na resposta HTTP.
4. Health checks (`/liveness`, `/readiness`).
5. Correlação de requisições (`spec.correlationId`).
6. Ofuscação de dados sensíveis nos logs (`spec.obfuscation.logs`).
7. Tracing / OTEL — spans exportáveis via OTLP (`spec.otel` + env vars `OTEL_*`).
8. Playbook de troubleshooting ponta a ponta.

> **Fonte de verdade do código:** `app/internal/logging/logging.go`, `app/engine/logger.go`,
> `app/engine/otel.go`, `app/engine/tracing.go`, `app/engine/debug.go`,
> `app/engine/healthcheck.go`, `app/engine/engine.go`, `app/cmd/radahn/main.go` e
> `app/internal/workflow/model.go`. Este guia descreve o comportamento observado nesses arquivos.

---

## 1. Modelo de observabilidade (visão geral)

O Radahn mantém a telemetria de logs **simples e por stdout**, e agora oferece também **tracing
distribuído opcional** via OpenTelemetry, exportado por **OTLP** (gRPC/HTTP) para qualquer coletor
compatível — Datadog, New Relic, OTEL Collector (ver seção 7). O tracing é **desligado por padrão**
(custo ~nulo) e habilitado por `spec.otel.enabled` (ou `RADAHN_TRACING_ENABLED`).

O que o motor oferece:

- **Logs 100% JSON** — **toda** linha escrita no stdout é um objeto JSON de uma linha, com
  `tool: "radahn"`, `level` e `timestamp` (RFC3339). Não existe mais log em texto puro.
- **Logs de ciclo de vida** (boot, shutdown, hooks, workers) — JSON com campos estruturados
  (`component`, `phase`, `worker`, ...) em vez de texto interpolado.
- **Log estruturado por step** — uma linha **JSON** por execução de skill, com nível, correlationId,
  `traceId`/`spanId` (quando o tracing está ativo), nome do step e contexto (`app/engine/otel.go`).
- **Tracing OTEL (opcional)** — um span-servidor por requisição HTTP + um span filho por step
  (inclusive `Parallel`/`ForEach`, hooks e workers), exportado via OTLP (`app/engine/tracing.go`).
- **Modo debug** — quando `spec.debug.enabled: true`, toda resposta HTTP carrega um envelope
  `debug` com metadados completos da requisição, variáveis de sessão e variáveis de ambiente.
- **Health checks** — `/liveness` (processo vivo) e `/readiness` (dependências declaradas em
  `spec.requiredSkills`).
- **Correlação** — `spec.correlationId` propaga um id por requisição para dentro dos logs e do
  envelope de debug.
- **Ofuscação** — `spec.obfuscation.logs` mascara dados sensíveis antes de a linha chegar ao stdout.

Como tudo sai por stdout, a coleta em produção é responsabilidade da plataforma (ex.: agente de
log do cluster / sidecar que lê stdout e envia para o coletor central).

---

## 2. Formato dos logs

O logger é criado em `app/cmd/radahn/main.go` e implementado em `app/internal/logging/logging.go`
(adapter fino sobre [zerolog](https://github.com/rs/zerolog)):

```go
logger := logging.New(os.Stdout)
```

O motor não depende do zerolog diretamente: ele consome a interface `engine.Logger`
(`app/engine/logger.go`), com dois métodos — `Event` (ciclo de vida) e `Line` (log de step já
serializado e ofuscado).

Isso significa que **toda** linha de log é:

- Um **único objeto JSON por linha** (pronto para Datadog/OTEL Collector, sem parser de texto).
- Sempre com `"tool":"radahn"`, um `level` (`info` \| `warn` \| `error` \| `debug` \| `fatal`) e um
  `timestamp` **RFC3339** (com offset do fuso do processo).

> **Ordem das chaves:** o zerolog escreve `level`/`tool` primeiro e `message` por último; os campos
> extras saem em ordem alfabética. A ordem é irrelevante para consumo — filtre por chave, nunca por
> posição.

### 2.1 Logs de ciclo de vida (JSON estruturado)

Emitidos via `Logger.Event` no boot, shutdown, hooks e workers — cada informação que antes era
interpolada no texto agora é um **campo**. Exemplos reais:

```json
{"level":"info","tool":"radahn","component":"boot","routeCount":1,"workflowPath":"radahn.yaml","timestamp":"2026-08-26T11:17:38-03:00","message":"workflow loaded"}
{"level":"info","tool":"radahn","component":"hook","phase":"onStart","stepCount":1,"timestamp":"2026-08-26T11:17:38-03:00","message":"running hook steps"}
{"level":"info","tool":"radahn","component":"hook","phase":"onStart","timestamp":"2026-08-26T11:17:38-03:00","message":"hooks completed"}
{"level":"info","tool":"radahn","addr":":8080","component":"server","timestamp":"2026-08-26T11:17:38-03:00","message":"http server listening"}
{"level":"info","tool":"radahn","breakOnFailure":false,"component":"worker","loopWait":"200ms","schedule":"","worker":"heartbeat","timestamp":"2026-08-26T11:17:38-03:00","message":"worker started"}
{"level":"info","tool":"radahn","component":"shutdown","timestamp":"2026-08-26T11:17:45-03:00","message":"shutting down"}
```

Campos de ciclo de vida:

| Campo | Valores | Descrição |
|-------|---------|-----------|
| `component` | `boot`, `server`, `shutdown`, `hook`, `worker`, `otel` | Quem emitiu a linha. |
| `phase` | `onStart`, `onStop` | Fase do hook (`component: hook`). |
| `worker` | nome do worker | Worker que emitiu a linha (`component: worker`). |
| `error` | texto do erro | Presente em toda linha `level: error` de ciclo de vida. |

Outros campos são específicos da mensagem: `workflowPath`/`routeCount` (boot), `addr` (server),
`stepCount` (hook), `loopWait`/`schedule`/`breakOnFailure`/`nextRun`/`skillKind` (worker),
`exporter` (otel), `timezone` (worker com fuso inválido).

Filtros úteis (substituem o grep por tags de texto):

```bash
jq -c 'select(.component=="hook")'                      # ciclo de vida dos hooks
jq -c 'select(.component=="worker" and .worker=="x")'    # um worker específico
jq -c 'select(.level=="error")'                          # tudo que falhou
jq -c 'select(.source!=null)'                            # só logs de step
```

**Níveis:** transições normais (`worker started`, `worker stopped`, `hooks completed`, boot,
shutdown) são `info`. Falhas e configurações inválidas que desabilitam um worker
(`worker skipped: ...`, `worker disabled: ...`, `hook failed`, `worker iteration failed`) são
`error`. Falhas fatais de boot (`failed to load workflow`, `onStart hook failed`, `server error`)
são `fatal` e encerram o processo com exit code 1.

### 2.2 Log estruturado por step (JSON)

Toda execução de skill emite **uma linha JSON**, produzida por `logSkill` em `app/engine/otel.go`.
O schema (`logRecord`) é:

| Campo | Tipo | Origem | Descrição |
|-------|------|--------|-----------|
| `timestamp` | string | `time.Now().Format(time.RFC3339)` | Instante da execução do step (RFC3339). |
| `level` | string | `info` \| `error` | `error` quando a skill retorna `err != nil` **ou** `success == false`; senão `info`. |
| `correlationId` | string | `spec.correlationId` | Id de correlação da requisição/sessão (vazio se não configurado). |
| `traceId` | string | span OTEL ativo | Id do trace (omitido quando o tracing está desligado ou não há span válido). |
| `spanId` | string | span OTEL ativo | Id do span do step (omitido quando o tracing está desligado). |
| `source` | string | `behavior.Name` | Nome do step que gerou a linha. |
| `message` | string | resultado do step | No sucesso, a mensagem de status; no erro, o texto do erro (`err.Error()`). |
| `skillContent` | objeto | `{ "kind": <Kind> }` | O tipo de skill executada (ex.: `PostgresQuery`). |
| `skillContext` | objeto | `{ "vars": <sessão> }` | Snapshot das variáveis da sessão no momento do log. |

Além do schema acima, a linha carrega o envelope `tool: "radahn"` (o `level` e o `timestamp` são os
do próprio registro do step, preservados como estão):

```json
{"tool":"radahn","correlationId":"9e25b7a4-58ed-4f18-b442-03e5961170bb","level":"info","message":"ok","skillContent":{"kind":"LogicalOperator"},"skillContext":{"vars":{"cpfCnpj":"********"}},"source":"ValidarPayload","timestamp":"2026-08-26T11:17:41-03:00"}
```

Notas importantes:

- O `level` é derivado por `level(success, err)` e a `message` por `statusMessage(success, err)`
  em `app/engine/engine.go`. Uma skill que **reprova uma validação** (`success == false`, sem erro)
  também gera `level: "error"`.
- **Retries** também logam: cada tentativa emite `"retry attempt N/M after <delay>"` com `level: info`.
- O JSON é serializado e **então passado pela ofuscação** (`e.obfuscate`) antes de ir para o stdout
  (ver seção 6). Ou seja, `skillContext.vars` pode conter dados que você **deve** mascarar.

> **Atenção:** por padrão, `skillContext.vars` inclui **todas** as variáveis de sessão (parâmetros,
> corpo injetado, resultados intermediários). Em domínios com dado sensível (CPF, token, etc.),
> configure `spec.obfuscation.logs` (seção 6) para não vazar em claro.

### 2.3 Onde os logs ficam

Sempre **stdout**. Não há arquivo de log, rotação ou nível configurável por env var no motor.
Para reter/filtrar/rotear, capture o stdout do processo/container na sua plataforma.

---

## 3. Modo debug (`spec.debug`)

Ative o modo debug para receber um envelope de diagnóstico **dentro de cada resposta HTTP**.
Definição em `app/internal/workflow/model.go`:

```yaml
spec:
  debug:
    enabled: true   # padrão: false
```

Quando ativo (`e.debugEnabled()` em `app/engine/engine.go`), tanto respostas de **sucesso** quanto de
**falha** ganham um campo `debug` (construído por `buildDebugEnvelope` em `app/engine/debug.go`).

### 3.1 Estrutura do envelope `debug`

| Campo | Descrição |
|-------|-----------|
| `correlationId` | Id de correlação da requisição. |
| `endpoint` | Caminho da URL (`r.URL.Path`). |
| `method` | Método HTTP. |
| `queryStringParameters` | Lista `{name, value}` de todos os query params. |
| `pathParameters` | Lista `{name, value}` dos path params (capturados só em modo debug). |
| `headers` | Lista `{name, value}` de **todos** os headers da requisição. |
| `body` | Corpo bruto recebido, como string. |
| `result` | `SUCCESS` ou `FAILURE`. |
| `error` | Texto do erro (omitido quando vazio). |
| `sessionVariables` | Lista `{name, type, value}`; o `type` é inferido (`boolean`/`integer`/`decimal`/`null`/`string`). |
| `environmentVariables` | Lista `{name, value}` de **todas** as variáveis de ambiente do processo. |

### 3.2 Como o envelope é anexado à resposta

- **Sucesso com corpo:** o `debug` é mesclado no corpo. Se o corpo for um objeto JSON, ganha a
  chave `debug`; se não for um objeto (ex.: array), o corpo original vai para `data` e o `debug` fica
  ao lado (`wrapDebug` em `app/engine/debug.go`).
- **Sucesso sem corpo** (status 204/304 ou `noBody`): a resposta passa a ser `{ "debug": {...} }`.
- **Falha:** o corpo vira `{ "message": "...", "debug": {...} }` com o status apropriado
  (`res.status` quando o `onFailure` declara `statusCode`, senão `500`).

### 3.3 AVISO DE SEGURANÇA

O envelope de debug **expõe todos os headers, o body, todas as variáveis de sessão e todas as
variáveis de ambiente do processo** (incluindo `DB_PASSWORD`, `HTTP_AUTHORIZE_*`, `AWS_*`, etc.).

- **NUNCA** habilite `spec.debug.enabled: true` em produção.
- Use apenas em ambiente local/desenvolvimento, com dados e credenciais descartáveis.
- A ofuscação (`spec.obfuscation.logs`) atua **nos logs**, não no envelope de debug da resposta.

---

## 4. Health checks

Registrados incondicionalmente em `app/engine/engine.go` e implementados em
`app/engine/healthcheck.go`.

### 4.1 `GET /liveness`

Sempre retorna `200` com `{"status":"ok"}`. Sinaliza apenas que o **processo está vivo** e
respondendo — não testa dependências. Use como *liveness probe* do orquestrador.

### 4.2 `GET /readiness`

Faz *ping* em cada dependência **declarada em `spec.requiredSkills`** (com timeout de 5s):

- **Redis** — se houver alguma skill `Redis*` (prefixo `Redis`).
- **Postgres** — se houver `PostgresQuery`, `PostgresOperation` ou `DataValidation`.
- **MySQL** — se houver `MySqlQuery` ou `MysqlOperation`.

Resposta:

- **Tudo OK** → `200` com `{"status":"ok","checks":{...}}`.
- **Qualquer falha** → `503` com `{"status":"degraded","checks":{"postgres":"FAIL: ...", ...}}`.

```yaml
spec:
  requiredSkills:
    - PostgresQuery
    - RedisGetItem
```

> **Nota:** dependências não cobertas pelos pings (HTTP de subsistemas, Kafka, AWS, etc.) **não**
> entram no readiness. O readiness cobre apenas Redis, Postgres e MySQL. Se `requiredSkills` estiver
> vazio, o `/readiness` sempre retorna `200`.

---

## 5. Correlação de requisições (`spec.correlationId`)

Configurado em `app/internal/workflow/model.go` e resolvido por `resolveCorrelationID` em
`app/engine/engine.go`. `calculateBy` e `headerName` são **mutuamente exclusivos** (o `Validate()`
falha no boot se ambos forem definidos).

```yaml
spec:
  correlationId:
    calculateBy: GENERATE_NEW_UUID_V4   # gera um UUID novo por requisição
    # headerName: X-Correlation-Id      # OU propaga o valor de um header de entrada
```

- **`calculateBy`** — gera o id via `Calculate(...)` (ex.: `GENERATE_NEW_UUID_V4`).
- **`headerName`** — usa o valor de uma variável de sessão de mesmo nome (tipicamente populada por
  um `routes.<r>.headers` que lê um header HTTP como `X-Correlation-Id`).
- Se `spec.correlationId` não for declarado, o `correlationId` fica **vazio** nos logs e no debug.

O id resolvido aparece em:

- Cada linha de **log estruturado** (`correlationId`).
- O envelope **debug** (`correlationId`).

**Recomendação:** sempre configure `correlationId` para conseguir amarrar todas as linhas de log de
uma mesma requisição (`grep` pelo id) e correlacionar com sistemas upstream/downstream.

---

## 6. Ofuscação de dados sensíveis nos logs (`spec.obfuscation.logs`)

Mascara dados sensíveis nas **linhas de log estruturado** antes de escrevê-las no stdout.
Compilada no boot por `compileObfuscation` e aplicada por `obfuscate` (`app/engine/engine.go`).

```yaml
spec:
  obfuscation:
    logs:
      placeholder: "********"   # opcional; padrão "********"
      patterns:                 # regex Go, compiladas no boot
        - "\\d{3}\\.?\\d{3}\\.?\\d{3}-?\\d{2}"   # CPF
        - "\\d{2}\\.?\\d{3}\\.?\\d{3}/?\\d{4}-?\\d{2}"  # CNPJ
```

Comportamento:

- Cada `pattern` é uma **regex Go**, compilada no boot. Uma regex inválida **aborta o startup**
  (exit ≠ 0).
- A regex é aplicada à **linha JSON serializada inteira**, na ordem declarada; cada match vira
  `placeholder`.
- **Só afeta o log estruturado por step** (seção 2.2). **Não** afeta as linhas de ciclo de vida
  (seção 2.1) nem o envelope de debug da resposta HTTP.
- **Âncoras:** `^...$` casam a linha inteira. Para mascarar um valor **embutido** no JSON (ex.: um
  CPF dentro de `skillContext.vars`), use patterns **sem** âncora (casam substring).

---

## 7. Tracing e OTEL (OpenTelemetry)

O Radahn integra **OpenTelemetry tracing** e exporta os traces via **OTLP genérico** (gRPC ou
HTTP), compatível com Datadog, New Relic e qualquer OpenTelemetry Collector. É implementado em
`app/engine/tracing.go` (provider/exporter/sampler) e no wiring de spans do pacote `engine`.

**Desligado por padrão.** Quando `spec.otel.enabled` é `false`/ausente (e `RADAHN_TRACING_ENABLED`
não está setada), o motor usa um `TracerProvider` no-op — criar spans é praticamente gratuito e
nenhum dado sai do processo.

### 7.1 O que é instrumentado

Granularidade **request + step**:

- **Span-servidor por requisição HTTP** — criado pelo middleware `otelhttp`, que também **extrai** o
  contexto W3C `traceparent` de entrada (parentando o trilho corretamente). As rotas de negócio são
  instrumentadas; `/liveness` e `/readiness` **não**.
- **Um span filho por step** do pipeline, com os atributos `radahn.skill.kind`, `radahn.step.name` e
  `radahn.correlation_id`. Steps que falham marcam o span como `error` (com `RecordError`).
- **`Parallel`** — cada branch abre um span `branch:<nome>` concorrente sob o span do step.
- **`ForEach`** — cada iteração abre um span `item[<índice>]` sob o span do step.
- **Hooks e workers** — cada execução de hook (`hook:onStart|onStop`) e cada iteração de worker
  (`worker:<nome>`) abre um span-raiz próprio (rodam fora de qualquer requisição HTTP).

**Correlação log↔trace:** enquanto um span está ativo, cada linha de log estruturado (seção 2.2)
inclui `traceId` e `spanId`, permitindo pular do log para o trace no backend.

> **Fora de escopo (fase atual):** spans para chamadas externas (HTTP/DB/Kafka/AWS/Redis) e
> **métricas** (`MeterProvider`). A **propagação de saída** (`traceparent` em chamadas downstream)
> ainda não é injetada; a **extração** de entrada já funciona via `otelhttp`.

### 7.2 Configuração — `spec.otel` (não sensível)

Endpoints, protocolo e credenciais **nunca** ficam no `radahn.yaml` — só as opções declarativas:

```yaml
spec:
  otel:
    enabled: true                       # padrão: false
    serviceName: meu-servico            # OTEL_SERVICE_NAME sobrepõe, se definida
    serviceNamespace: pagamentos
    serviceVersion: 1.4.2
    sampler: parentbased_traceidratio   # opcional (ver lista abaixo)
    samplerArg: 0.1                      # razão p/ *traceidratio (0.0..1.0)
    resourceAttributes:
      deployment.environment: prod
```

Samplers aceitos (validados no boot): `always_on`, `always_off`, `traceidratio`,
`parentbased_always_on` (padrão), `parentbased_always_off`, `parentbased_traceidratio`.

### 7.3 Configuração — variáveis de ambiente (endpoint/credenciais)

Lidas pelo SDK/exporter OTLP padrão (têm precedência sobre o bloco `spec.otel`):

| Env var | Descrição |
|---------|-----------|
| `RADAHN_TRACING_ENABLED` | Liga/desliga o tracing independentemente de `spec.otel.enabled`. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Destino OTLP (ex.: `http://collector:4317`). Inclua o esquema. |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `grpc` (padrão) ou `http/protobuf`. |
| `OTEL_EXPORTER_OTLP_HEADERS` | Headers do exporter (ex.: `api-key=...` para o New Relic). |
| `OTEL_EXPORTER_OTLP_INSECURE` | `true` para gRPC sem TLS (coletor local). |
| `OTEL_SERVICE_NAME` | Sobrepõe `spec.otel.serviceName`. |
| `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` | Sobrepõem `sampler`/`samplerArg`. |
| `OTEL_RESOURCE_ATTRIBUTES` | Atributos extras de resource (mesclados). |

A exportação usa `BatchSpanProcessor` (assíncrono, em goroutine dedicada): a chamada ao coletor
**não** fica no caminho crítico da requisição. Falhas de exportador são *best-effort* — logadas no
boot, sem abortar o processo. No `shutdown` os spans pendentes são drenados (flush).

### 7.4 Exemplos de destino

**Datadog** (via Datadog Agent com ingestão OTLP):

```bash
export RADAHN_TRACING_ENABLED=true
export OTEL_EXPORTER_OTLP_PROTOCOL=grpc
export OTEL_EXPORTER_OTLP_ENDPOINT=http://datadog-agent:4317
export OTEL_EXPORTER_OTLP_INSECURE=true
export OTEL_SERVICE_NAME=meu-servico
```

**New Relic** (endpoint OTLP gerenciado):

```bash
export RADAHN_TRACING_ENABLED=true
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
export OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.nr-data.net
export OTEL_EXPORTER_OTLP_HEADERS=api-key=<LICENSE_KEY>
export OTEL_SERVICE_NAME=meu-servico
```

**OTEL Collector local** (o mesmo usado no teste integrado
`app/tests/integrated-tests/scenario-20260817-200000`): aponte para o receiver OTLP do coletor
(`OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317`, `OTEL_EXPORTER_OTLP_INSECURE=true`).

### 7.5 Correlação sem tracing (fallback)

Se o tracing estiver desligado, a correlação ponta a ponta continua disponível pela combinação
**`correlationId` + logs estruturados** (seção 5). Com o tracing ligado, use `traceId`/`spanId` das
linhas de log para pular direto ao trace no backend:

```bash
# assumindo que o stdout do processo está em app.log
grep '"correlationId":"6f0c' app.log      # sequência completa da requisição
grep '"traceId":"7b513712' app.log         # todas as linhas do mesmo trace
```

---

## 8. Playbook de troubleshooting

### 8.1 Falhas no startup (o processo encerra)

O boot é *fail-fast* (`logger.Fatal` em `app/cmd/radahn/main.go`, que emite uma linha
`level: "fatal"` e encerra com exit code 1). O texto abaixo aparece no campo `message`, com o
detalhe no campo `error`:

| Log | Causa | Correção |
|-----|-------|----------|
| `failed to load workflow: reading workflow file "..."` | arquivo ausente / `RADAHN_CONFIG` errado | verifique o caminho e a env `RADAHN_CONFIG` |
| `failed to load workflow: parsing workflow YAML: ...` | YAML inválido (com frequência **tabs**) | corrija o YAML; use espaços |
| `failed to load workflow: ... has no routes` | `spec.routes` ausente/vazio | declare ao menos uma rota |
| `onStart hook failed: ...` | hook `onStart` falhou (`StopApplication`) | corrija o pipeline do hook / a dependência |
| `invalid obfuscation log pattern "...": ...` | regex de `obfuscation.logs` inválida | corrija a regex Go |
| `server error: listen tcp :8080: bind: address already in use` | porta ocupada | mude `RADAHN_ADDR` ou libere a porta |

### 8.2 Falhas por requisição (log estruturado `level: error`)

Procure a linha JSON com `"level":"error"` e use o par `source` (step) + `message` (erro):

- `message: unknown skill kind "X"` → typo/skill não suportada no `kind`.
- `message: missing <skill> config` → `kind` declarado sem o bloco de config correspondente.
- `message: HttpAuthorize: no token URL configured (HTTP_AUTHORIZE_URL)` → env var ausente.
- `message: HttpSearch: GET <url> returned 4xx/5xx` → subsistema rejeitou/falhou.
- `message: pq: ... connection refused` → banco inativo ou `DB_*` incorreta.
- `message: pipeline step limit exceeded` → estouro do teto de 100 execuções por requisição.

Para a tabela completa de mensagens e correções, consulte o playbook em
`agent/radahn-agent.md` (seção "Diagnóstico de logs e erros").

### 8.3 Status HTTP retornados ao cliente (sem log de erro, por design)

| Status | Significado | Origem |
|--------|-------------|--------|
| `400` | entrada inválida/ausente | param obrigatório ausente ou `LogicalOperator` disparou |
| `404` | não encontrado | `EmptyValidation` com `status: 404` |
| `204` | vazio | `EmptyValidation` com `status: 204` |
| `422` | schema inválido | `JsonValidation` |
| `500` | inesperado | `err` de skill ou `onFailure` padrão |
| `200` | sucesso | alcançou um `Finish` |
| `503` | dependência indisponível | `/readiness` degradado |

### 8.4 Procedimento recomendado

1. **Health first:** `GET /liveness` (processo) e `GET /readiness` (dependências).
2. **Correlacione:** pegue o `correlationId` da resposta (ou do header de entrada) e filtre os logs.
3. **Localize o step:** ache a linha JSON `level: error` — o campo `source` é o step culpado.
4. **Classifique:** é problema de **config** (`radahn.yaml`), de **env** (variável/segredo) ou
   **externo** (banco/subsistema/rede)?
5. **Reproduza localmente com debug:** ligue `spec.debug.enabled: true` **só em local** para inspecionar
   headers, body, variáveis de sessão e ambiente no envelope `debug`. Desligue depois.
6. **Proponha a correção** (edição de YAML, ajuste de env ou checagem de infra) e valide com um `curl`.

### 8.5 Nota (Windows)

O Radahn emite UTF-8 correto. Se acentos aparecerem como mojibake ao usar
`curl ... | python -m json.tool`, é a re-codificação do stdin em cp1252 — use `jq` ou defina
`PYTHONUTF8=1`.

---

## 9. Referências

- `app/internal/logging/logging.go` — logger JSON (zerolog): `Event`, `Line`, `Fatal`.
- `app/engine/logger.go` — interface `engine.Logger` + constantes de campos/componentes.
- `app/engine/otel.go` — log estruturado por step (`logRecord`, `logSkill`) + spans de step (`startStepSpan`, `endStepSpan`).
- `app/engine/tracing.go` — `InitTracer`, seleção de exporter OTLP, sampler e resource.
- `app/engine/{engine,parallel,foreach,hooks,workers}.go` — criação de spans (servidor, step, branch, item, hook, worker).
- `app/tests/integrated-tests/scenario-20260817-200000/` — teste integrado de export OTLP para um OTEL Collector real.
- `app/tests/integrated-tests/scenario-20260826-103000/` — teste integrado que valida linha a linha o formato JSON dos logs (boot, hook, rota, worker, shutdown, ofuscação); `sample-logs.jsonl` traz uma saída real do cenário.
- `app/engine/debug.go` — envelope de debug (`debugEnvelope`, `buildDebugEnvelope`, `wrapDebug`).
- `app/engine/healthcheck.go` — `/liveness` e `/readiness`.
- `app/engine/engine.go` — derivação de `level`/`message`, ofuscação, correlationId, escrita de resposta.
- `app/cmd/radahn/main.go` — logger, boot, hooks, shutdown.
- `app/internal/workflow/model.go` — `DebugConfig`, `CorrelationID`, `Obfuscation`, `LogObfuscation`, `RequiredSkills`, `OTelConfig`.
- `HOW-RADAHN-WORKS.md` — funcionamento interno e "Trace ponta a ponta".
- `agent/radahn-agent.md` — playbook completo de diagnóstico de logs/erros.
