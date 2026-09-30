# Diagnóstico de logs, erros e status HTTP (modo debug)

O Radahn loga para stdout em **JSON, uma linha por evento** — toda linha tem `tool: "radahn"`,
`level` (`info`/`warn`/`error`/`debug`/`fatal`) e `timestamp` (RFC3339). Linhas de ciclo de vida
trazem campos estruturados (`component`: `boot`/`server`/`shutdown`/`hook`/`worker`/`otel`, mais
`phase`, `worker`, `error`); linhas de step trazem `source`, `skillContent`, `skillContext`,
`correlationId` e (com tracing ligado) `traceId`/`spanId`. Filtre com `jq`, não com grep de texto:

```bash
jq -c 'select(.level=="error")' app.log
jq -c 'select(.component=="worker" and .worker=="consolidarPosicoes")' app.log
jq -c 'select(.source=="ObterCliente")' app.log
```

Use este playbook para analisar métricas/logs/tracing e corrigir problemas na spec.

## Falhas no startup (processo encerra com `level: "fatal"` e exit code 1)
O texto abaixo aparece no campo `message`; o detalhe do erro, no campo `error`.

| Mensagem de log | Causa | Correção |
|----------------|-------|----------|
| `failed to load workflow: reading workflow file "..."` | arquivo ausente / `RADAHN_CONFIG` errado | verifique o caminho e `RADAHN_CONFIG` |
| `failed to load workflow: parsing workflow YAML: ...` | YAML inválido (frequentemente **tabs** ou indentação errada) | corrija o YAML; use espaços |
| `failed to load workflow: unexpected kind "..."` | `kind` não é `ApplicationWorkflow` (nem o alias `ApiWorkflow`) | defina `kind: ApplicationWorkflow` |
| `failed to load workflow: workflow has no routes` | `routes` ausente ou vazio | declare ao menos uma rota |
| `server error: listen tcp :8080: bind: address already in use` | porta ocupada | mude `RADAHN_ADDR` ou libere a porta |

## Falhas por requisição (linha de step com `"level":"error"`; `source` = nome do step)
As referências `[r/s]` abaixo indicam rota/step: na prática, filtre a linha JSON por `source` e leia
o campo `message`.

| Mensagem de log | Causa | Correção |
|----------------|-------|----------|
| `[r/s] unknown skill kind "X"` | typo / skill não suportada | use uma skill do catálogo (`02-skills.md`) |
| `[r/s] skill error: unsupported staticValidation expression: "..."` | expressão não é `A op B` | escreva `"$a > $b"` (3 tokens) |
| `[r/s] skill error: missing postgresQuery config` | `kind: PostgresQuery` sem bloco `postgresQuery:` | adicione o bloco |
| `[r/s] skill error: missing mysqlQuery config` | o mesmo para MySQL | adicione `mysqlQuery:` |
| `[r/s] skill error: missing httpSearch config` | `HttpSearch` sem `httpSearch:` | adicione o bloco |
| `[r/s] skill error: HttpAuthorize: no token URL configured (HTTP_AUTHORIZE_URL)` | env var não definida | defina `HTTP_AUTHORIZE_URL` (+ client id/secret) |
| `[r/s] skill error: HttpAuthorize: token endpoint returned 401/403` | credenciais erradas / URL errada | corrija `HTTP_AUTHORIZE_CLIENT_ID/SECRET/URL` |
| `[r/s] skill error: HttpAuthorize: token not found at "$.access_token"` | `extractResult` errado | ajuste para o JSONPath real do endpoint de token |
| `[r/s] skill error: HttpSearch: GET <url> returned 4xx/5xx` | subsistema rejeitou / falhou | verifique URL, bearer token, params e saúde do subsistema |
| `[r/s] skill error: pq: relation "x" does not exist` | tabela/schema errada | corrija o SQL / execute seed do banco |
| `[r/s] skill error: pq: ... / dial tcp ... connection refused` | banco inativo ou `DB_*` errada | inicie o banco / corrija env de conexão |
| `[r/s] skill error: pinging postgres: ...` (na 1ª query) | banco inalcançável | verifique host/porta/credenciais, rede |
| `[r/s] skill error: branch "X": ...` | uma branch de um step `Parallel` falhou | veja a causa raiz na mensagem da branch; ajuste o step interno. Com `failFast` o `onFailure` do step `Parallel` é disparado |
| `[r/s] skill error: pipeline step limit exceeded` (dentro de branch) | fan-out do `Parallel` estourou o teto de 100 execuções | reduza steps/branches ou revise loops via redirecionamento de step |

## Status HTTP retornados ao cliente (sem log de erro, por design)
| Status | Significado | Origem |
|--------|-------------|--------|
| `400` | entrada inválida/ausente | param obrigatório ausente, ou `LogicalOperator` disparou |
| `404` | não encontrado | `EmptyValidation` com `status: 404` |
| `204` | resultado vazio | `EmptyValidation` com `status: 204` |
| `422` | schema inválido | `JsonValidation` (mensagem frequentemente `$jsonValidationErrors`) |
| `500` | inesperado | qualquer `err` de skill ou `onFailure` padrão de um step |
| `200` | sucesso | alcançou um `Finish` (ou fim do pipeline) |

## Procedimento de diagnóstico
1. Identifique a **rota/step** com falha pelo campo `source` da linha JSON com `"level":"error"`.
2. Mapeie a mensagem pelas tabelas acima → causa raiz.
3. Decida: é um problema de **config** (corrigir `radahn.yaml`), de **env** (corrigir variável), ou **externo** (banco/subsistema indisponível, shape de payload errado)?
4. Proponha a correção concreta (edição de YAML, mudança de env ou checagem de infra) e, quando relevante, um `curl` para reproduzir e verificar.
5. Se o shape do payload for suspeito, solicite uma amostra de resposta e re-derive `extractResult`.

## Tracing / observabilidade
- Quando `spec.otel.enabled: true` (ou `RADAHN_TRACING_ENABLED`), cada requisição gera um span-servidor
  e um span filho por step. Use os atributos `radahn.skill.kind`, `radahn.step.name` e
  `radahn.correlation_id` para localizar o step problemático no coletor (Datadog, New Relic, OTEL).
- Steps que falham marcam o span como `error`. Correlacione `traceId`/`spanId` presentes nas linhas
  de log estruturado. Detalhes completos em `repo/HOW-TO-OBSERVE.md`.

## Problema não-bug (Windows)
- **Output com acentos aparece como mojibake?** O Radahn emite UTF-8 correto. No Windows,
  `curl ... | python -m json.tool` re-codifica o stdin como cp1252. Use `jq` ou defina `PYTHONUTF8=1`.

## O que solicitar ao engenheiro para enriquecer o troubleshooting
- O `radahn.yaml` atual (ou o trecho da rota/step afetado).
- Os logs de stdout do Radahn (com a tag `[rota/step]`).
- A resposta HTTP recebida (status + corpo) e o `curl` usado.
- Uma amostra do payload dos subsistemas quando `extractResult`/`extractFrom` for suspeito.
- As variáveis de ambiente definidas (nomes, sem valores sensíveis) e o ambiente (local/homolog/prod).
