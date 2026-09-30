# Esquema `ApplicationWorkflow` (referência autoritativa)

```yaml
apiVersion: worflows.workflow.radahn.com/v1alpha   # opcional — cabeçalho no estilo Kubernetes
kind: ApplicationWorkflow                          # OBRIGATÓRIO (alias legado: ApiWorkflow)
metadata:
  name: nome-do-workflow
  namespace: meu-namespace
spec:
  timezone: "America/Sao_Paulo"     # opcional — timezone IANA usada nos cálculos temporais (padrão: UTC)
  include:                          # opcional — paths/globs relativos com fragmentos de Spec a mesclar
    - behaviors/*.yaml
  correlationId:                    # opcional — mutuamente exclusivos
    calculateBy: GENERATE_NEW_UUID_V4   # OU:
    # headerName: X-Correlation-Id
  obfuscation:                      # opcional — ofuscação de dados sensíveis em logs
    logs:
      placeholder: "********"       # opcional — substituto do match (padrão: "********")
      patterns:                     # regex Go compiladas no boot (regex inválida aborta o boot)
        - "\\d{3}\\.?\\d{3}\\.?\\d{3}-?\\d{2}"   # CPF
        - "\\d{2}\\.?\\d{3}\\.?\\d{3}/?\\d{4}-?\\d{2}"  # CNPJ
  requiredSkills: [ ... ]           # lista documental das skills usadas
  routes:
    <nomeDaRota>:
      method: GET                   # GET, POST, PUT, PATCH, DELETE
      url: /caminho/$pathVar        # $var no path vira {pathVar}
      pathParameters:
        - { name, type, required, default }
      queryParameters:
        - { name, type, required, default }
      headers:
        - { name, header, type, required, default }
  behaviors:
    <nomeDaRota>:                   # DEVE casar exatamente com o nome da rota
      - name: <nomeDoStep>
        kind: <NomeDaSkill>
        # ... bloco de config específico da skill ...
        retry:                      # opcional — política de retry por step
          maxRetries: 3
          initialDelay: "200ms"
          multiplier: 2.0
          jitter: true
          filterStatus: [502, 503]  # restringe retry a esses status HTTP
        onSuccess: NextStep | Finish | { localStore: <nome> } | <nomeDoStep>
        onFailure: { statusCode: <int>, message: "<texto com $vars>" } | <nomeDoStep>
```

## Parâmetros
- `type`: `uuid`, `datetime`, `int`, `bool`, `string` (informativo; valores fluem como strings).
- `required: true` → valor ausente retorna **HTTP 400**.
- `default: "today"` → resolvido em runtime: **início do dia** (`00:00:00`), ou **fim do dia**
  (`23:59:59`) quando o nome contém `final`, `fim` ou `end`. Formato `YYYY-MM-DD HH:MM:SS`.
- A query string pode ser **declarada dentro da `url`** (apenas documental). O motor roteia pelo
  **path** e lê os valores de query via `queryParameters`.

## Controle de fluxo
| `onSuccess` | Efeito |
|-------------|--------|
| `NextStep`   | passa o resultado adiante e executa o próximo step |
| `Finish`    | encerra o pipeline e retorna o resultado atual (HTTP 200 por padrão, ou o status definido por `HttpStatusCodeResult`) |
| `{ localStore: <nome> }` | armazena o resultado em memória para `MergeLocalStore` e continua |
| `<nomeDoStep>` (scalar) | redireciona o fluxo para o step com esse nome |

`onFailure` aceita:
- `{ statusCode: <int>, message: "<interpolada>" }` — encerra com erro HTTP. (`status` e `statusCode` são sinônimos.)
- `<nomeDoStep>` (scalar) — redireciona o fluxo para o step sem encerrar com erro.
- `StopApplication` — **exclusivo de hooks** (`spec.hooks`): aborta o hook; em `onStart` encerra o processo (exit != 0). Não use em rotas.

Status `204` ou `message` vazia → corpo vazio; caso contrário, o corpo é `{"message": "..."}`.

**Proteção anti-loop:** o motor limita cada request a **100 execuções de step**; excedido → HTTP 500.

## Interpolação de variáveis
- `$nome` — variável de um parâmetro de rota ou de um step anterior (`$accessToken`, `putInto`, ...).
- `$1..$n` — placeholders posicionais SQL, preenchidos pela lista `parameters` (MySQL reescreve para `?`).
- JSONPath (`$.a.b`, `$`) — extração de respostas HTTP JSON (`extractResult`, `from`/`to`).
- Valores interpolados em URLs de saída são automaticamente *URL-encoded*.

## Variáveis de ambiente no YAML (`FROM_ENV`)
`FROM_ENV(NOME)` lê o valor de uma variável de ambiente do processo, resolvida **uma única vez no
boot** — a substituição roda em **qualquer campo string do spec** (rotas, behaviors, hooks,
workers, otel etc.), inclusive dentro de mapeamentos/listas genéricos, e acontece **antes** da
validação estrutural do workflow.

```yaml
spec:
  hooks:
    onStart:
      - name: DownloadCert
        kind: KafkaCertDownload
        kafkaCertDownload:
          profile: kaas
          environment: FROM_ENV(ENVIRONMENT_EXECUTION)

  behaviors:
    criarRecurso:
      - name: CriarRecurso
        kind: HttpOperation
        httpOperation:
          url: FROM_ENV(SUBSISTEMA_BASE_URL)/v1/recursos
```

- `NOME` deve ser um identificador válido de variável de ambiente (letras, dígitos e `_`, não pode
  começar com dígito); nome inválido falha o boot.
- Se `NOME` não estiver definida no ambiente do processo, o **boot falha** citando a variável. Uma
  variável definida com valor vazio é aceita normalmente (distinto de "não definida").
- Não depende de nenhuma declaração prévia no spec (não existe um `spec.envVars`); qualquer
  variável do ambiente do processo pode ser lida — diferente de `FROM_OVERLAY(chave)`, que exige
  `spec.overlays` declarado e a chave presente no overlay do ambiente ativo.
- Segredos e configuração de infraestrutura devem vir **exclusivamente** via `FROM_ENV`/variáveis
  de ambiente — nunca em texto literal no `radahn.yaml`.

## Ofuscação de logs (`spec.obfuscation.logs`)
Mascara dados sensíveis (CPF, CNPJ, ...) nos **logs estruturados** emitidos por cada step.

- `placeholder` — string que substitui cada match. Opcional; padrão `"********"`.
- `patterns` — lista de expressões regulares Go, **compiladas no boot**. Uma regex inválida
  **aborta a inicialização** (exit ≠ 0), como acontece com validações de skill no start.
- **Aplicação:** cada regex é aplicada à **linha de log serializada inteira** (JSON), na ordem
  declarada, antes de escrever no sink. Só afeta os logs estruturados de step (não as linhas de
  ciclo de vida: boot/shutdown/hooks/workers).
- **Atenção às âncoras:** `^...$` casam a linha inteira; para mascarar valores **embutidos** no
  JSON (ex.: um CPF dentro de `vars`), use patterns **sem** âncoras (casam substring).

```yaml
spec:
  obfuscation:
    logs:
      placeholder: "********"
      patterns:
        - "\\d{3}\\.?\\d{3}\\.?\\d{3}-?\\d{2}"        # CPF
        - "\\d{2}\\.?\\d{3}\\.?\\d{3}/?\\d{4}-?\\d{2}" # CNPJ
```

## Tracing OpenTelemetry (`spec.otel`)
Tracing distribuído **opcional**, exportado via **OTLP** (gRPC/HTTP) para qualquer coletor
compatível (Datadog, New Relic, OTEL Collector). Desligado por padrão (provider no-op, custo ~nulo).

- Cria um **span-servidor por requisição HTTP** (via `otelhttp`, com extração de `traceparent` de
  entrada) e **um span filho por step** do pipeline (inclui `Parallel`, `ForEach`, hooks e workers).
- Atributos de span: `radahn.skill.kind`, `radahn.step.name`, `radahn.correlation_id`. Steps que
  falham marcam o span como `error`.
- Correlação log↔trace: com um span ativo, cada linha de log estruturado ganha `traceId`/`spanId`.
- **Sem segredos no YAML.** Só opções declarativas em `spec.otel`; endpoint/protocolo/credenciais
  vêm das env vars OTLP padrão (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_PROTOCOL`,
  `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_EXPORTER_OTLP_INSECURE`, `OTEL_SERVICE_NAME`,
  `OTEL_TRACES_SAMPLER[_ARG]`, `OTEL_RESOURCE_ATTRIBUTES`). `RADAHN_TRACING_ENABLED` liga/desliga
  independentemente de `spec.otel.enabled`.
- `enabled` (bool, default false), `serviceName`, `serviceNamespace`, `serviceVersion`, `sampler`
  (`always_on|always_off|traceidratio|parentbased_always_on|parentbased_always_off|parentbased_traceidratio`,
  validado no boot), `samplerArg` (razão 0.0..1.0), `resourceAttributes` (map). Export assíncrono
  (`BatchSpanProcessor`, fora do caminho crítico) e *best-effort* (falha não derruba o processo).
- **Fora de escopo:** spans de chamadas externas (HTTP/DB/Kafka/AWS/Redis), métricas e propagação
  de `traceparent` de saída. Detalhes: `repo/HOW-TO-OBSERVE.md` §7.

```yaml
spec:
  otel:
    enabled: true
    serviceName: meu-servico
    serviceNamespace: pagamentos
    sampler: parentbased_traceidratio
    samplerArg: 0.1
    resourceAttributes:
      deployment.environment: prod
```

## `include` para múltiplos behaviors
Para aplicações com **mais de 1 behavior**, use `spec.include` para fatiar o workflow em
múltiplos arquivos e facilitar a manutenção. Cada arquivo incluído contribui com fragmentos de
`Spec` (routes, behaviors, hooks, workers, requiredSkills) que são **mesclados**: mapas são
sobrescritos pelo último arquivo, hooks são concatenados, `requiredSkills` são deduplicados e
campos escalares são sobrescritos quando definidos.

```yaml
# radahn.yaml (raiz)
kind: ApplicationWorkflow
metadata:
  name: minha-app
spec:
  include:
    - behaviors/consultas.yaml
    - behaviors/escritas.yaml
```
