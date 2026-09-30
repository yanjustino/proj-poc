# Protocolo de Skills do Radahn (Innersource)

Este documento descreve o **protocolo de skills** do Radahn: o contrato técnico que toda
skill implementa, onde o código vive e o **passo a passo completo** para que qualquer time
possa contribuir com uma skill nova via **innersource**, seguindo o **Git Flow** do projeto.

Uma _skill_ é a unidade de comportamento executada por um _step_ do pipeline de um
`radahn.yaml`. O engenheiro de consumo escreve YAML; o time de plataforma (e qualquer
contribuidor innersource) adiciona skills novas ao motor.

Leia também:
- [`README.md`](README.md) — uso do engine, esquema do `radahn.yaml` e catálogo de skills.
- [`HOW-RADAHN-WORKS.md`](HOW-RADAHN-WORKS.md) — anatomia interna do código.
- [`app/CONTRIBUTING.md`](app/CONTRIBUTING.md) — fluxo de contribuição (Git Flow), commits e PRs.

---

## Sumário

- [1. O contrato de uma skill](#1-o-contrato-de-uma-skill)
- [2. A interface `skillctx.Context`](#2-a-interface-skillctxcontext)
- [3. Onde as skills vivem](#3-onde-as-skills-vivem)
- [4. Semântica de retorno e controle de fluxo](#4-semântica-de-retorno-e-controle-de-fluxo)
- [5. Protocolo de contribuição de uma skill (checklist)](#5-protocolo-de-contribuição-de-uma-skill-checklist)
- [6. Exemplo prático — skill `HashSha256`](#6-exemplo-prático--skill-hashsha256)
- [7. Fluxo Git (Git Flow)](#7-fluxo-git-git-flow)
- [8. Regras de ouro](#8-regras-de-ouro)

---

## 1. O contrato de uma skill

Toda skill é uma função Go com **exatamente** esta assinatura (`app/engine/skills.go`):

```go
type skillFunc func(ctx skillctx.Context, b *workflow.Behavior) (bool, error)
```

- `ctx skillctx.Context` — a interface que expõe o estado da sessão e os clientes de
  infraestrutura (ver seção 2). O motor cria **um por requisição**.
- `b *workflow.Behavior` — o step declarado no YAML; a skill lê **seu próprio bloco de
  configuração** a partir daqui (ex.: `b.RedisPutItem`, `b.HashSha256`).
- Retorno `(bool, error)`:
  - `(true, nil)` → sucesso; o motor segue o `onSuccess`.
  - `(false, nil)` → **falha de negócio**; o motor segue o `onFailure`.
  - `(_, err)` → **erro de execução**; tratado como falha, com log de erro.

O motor localiza a implementação pelo `kind` do step, via o mapa `registry` em
`app/engine/skills.go`:

```go
var registry = map[string]skillFunc{
    "LogicalOperator": skills.LogicalOperator,
    "RedisPutItem":    cacheskills.PutItem,
    // ...
}
```

> O binário ativo (`app/cmd/radahn`) usa a árvore `app/engine/` (skills em sub-pacotes que
> recebem `skillctx.Context`). A antiga árvore `app/internal/engine/` foi **removida**.

---

## 2. A interface `skillctx.Context`

Definida em `app/engine/skillctx/context.go`, é o **único ponto de acesso** que uma skill
tem ao mundo. Ela evita ciclos de import entre o motor e os sub-pacotes de skill. Principais
capacidades:

**Interpolação / resolução de variáveis**
- `Interpolate(s)` / `InterpolateURL(s)` — substitui `$nome` (a segunda faz URL-encode).
- `ResolveVar(token)` — resolve `$nome` → valor, ou literal.
- `ResolveExtract(expr)` — resolve JSONPath (`$.a.b`, `$`), `$nome` ou literal.
- `ExtractJSONBody(path)` — aplica JSONPath sobre o corpo bruto da requisição.

**Dados da sessão**
- `Data()` / `SetData(v)` — lê/escreve o "resultado atual" que flui entre steps.
- `Body()` — bytes crus do corpo (nil em GET).
- `Vars()` / `SetVar(name, value)` — variáveis nomeadas de sessão.
- `Store()` — acumulador do `localStore`.
- `LastHTTPStatus()` / `SetLastHTTPStatus(code)` — último status HTTP observado.
- `SetSuccessStatus(code)` / `SetNoBody(v)` — customiza a resposta de sucesso.

**Clientes de infraestrutura (lazy)**
- `Postgres()`, `MySQL()`, `RedisClient(ctx)`, `AWS()`, `HTTPClient()`.

**Helpers**
- `Capture(putInto, putIntoAs, value)` — grava variável com coerção de tipo opcional.
- `EvalCondition(expr)` — avalia expressão booleana de 3 tokens.
- `ResolveOpParam` / `ResolveOpParams` / `BuildMessagePayload` — para skills de escrita.

Uma skill **só** deve interagir com o mundo através desta interface. Não acesse
`os.Getenv`, DBs ou HTTP diretamente — use os métodos do `ctx`.

---

## 3. Onde as skills vivem

```
app/
  engine/
    skillctx/context.go     # a interface Context (contrato de acesso)
    skills.go               # registry: mapeia "Kind" → função da skill
    skills/                 # implementações, organizadas por categoria
      logical_operator.go   #   skills gerais (package skills)
      empty_validation.go
      http/                 #   package http     (Authorize, Search, Operation, ...)
      database/             #   package database (PostgresQuery, DataValidation, ...)
      cache/                #   package cache    (Redis*)
      aws/                  #   package aws      (Sns, Sqs, Dynamo*, ...)
  internal/
    workflow/model.go       # struct Behavior (config das skills) + knownSkills + Validate()
```

Regra de organização: skills **genéricas** ficam no pacote `skills`; skills que compartilham
um recurso (HTTP, banco, cache, AWS) ficam no sub-pacote correspondente. Crie um novo
sub-pacote apenas quando a categoria for genuinamente nova.

---

## 4. Semântica de retorno e controle de fluxo

| Retorno da skill | Efeito no motor |
|------------------|-----------------|
| `(true, nil)`  | Segue `onSuccess` (`NextStep` / `Finish` / `localStore` / `<step>`) |
| `(false, nil)` | Segue `onFailure` (`{ statusCode, message }` ou `<step>`) |
| `(_, err)`     | Log de erro + segue `onFailure`; sem `onFailure` de redirect, encerra |

- O **resultado** (`ctx.SetData(...)`) de um step vira o **input** implícito do próximo.
- Proteção anti-loop: máximo de **100 execuções de step** por requisição → HTTP 500.
- Sempre valide o bloco de config no início e retorne um `error` claro se ausente:
  `if cfg == nil { return false, fmt.Errorf("missing hashSha256 config") }`.

> **Control step `Parallel` (não é skill).** O `kind: Parallel` **não** é uma skill de folha e
> **não** entra no `registry`/`knownSkills` como as demais — é interceptado pelo próprio loop do
> motor (`runPipeline`/`runParallel`). Ele roda `branches` (sub-pipelines) concorrentemente sobre
> **clones profundos** da sessão e consolida os resultados (`consolidate.strategy: object|collect|merge`)
> de volta em `data` (ou em `putInto: $var`). O par `(success, err)` do step reflete o join: uma
> branch que falha faz o step cair no `onFailure` do `Parallel`. O teto anti-loop de 100 execuções é
> **compartilhado atomicamente** entre todas as branches. Ao criar uma skill nova, você **não** precisa
> tocar nesse mecanismo.

---

## 5. Protocolo de contribuição de uma skill (checklist)

Adicionar uma skill nova envolve **cinco pontos de código** e a documentação. Todos são
obrigatórios — pular o `knownSkills` faz a validação de startup rejeitar o workflow.

1. **Config no modelo** — em `app/internal/workflow/model.go`:
   - Crie o `struct` de configuração da skill (campos com tags `yaml`).
   - Adicione o campo correspondente ao `struct Behavior` com a tag YAML do bloco.
2. **Registro de conhecimento** — adicione o `Kind` ao mapa `knownSkills` (mesmo arquivo).
   É o que a `Validate()` usa para checar `requiredSkills` e `kind` de cada step no startup.
3. **Implementação** — crie a função da skill no sub-pacote adequado em `app/engine/skills/…`
   respeitando a assinatura `func(ctx skillctx.Context, b *workflow.Behavior) (bool, error)`.
4. **Registro no motor** — mapeie o `Kind` → função em `registry` (`app/engine/skills.go`).
5. **Readiness (se aplicável)** — se a skill depende de infra (DB/Redis), garanta que o
   probe de `/readiness` cubra a dependência (`app/engine/healthcheck.go`).
6. **Testes** — teste unitário usando o `fakeCtx` (implementação de `skillctx.Context` em
   `app/tests/unit-tests/fake_ctx_test.go`) e/ou um cenário ponta a ponta em `app/tests/`.
7. **Documentação** — atualize:
   - [`README.md`](README.md) — tabela do catálogo de skills + seção com exemplo YAML.
   - [`HOW-RADAHN-WORKS.md`](HOW-RADAHN-WORKS.md) — descrição interna, se relevante.
   - [`agent/radahn-agent.md`](agent/radahn-agent.md) — base de conhecimento do Radahn Copilot.

---

## 6. Exemplo prático — skill `HashSha256`

Vamos criar uma skill que calcula o **SHA-256** de um valor e o guarda numa variável de
sessão (útil, por exemplo, para chaves de idempotência). Ela não usa infraestrutura externa,
então ilustra o protocolo de ponta a ponta de forma enxuta.

YAML alvo que a skill deve interpretar:

```yaml
- name: GerarHashIdempotencia
  kind: HashSha256
  hashSha256:
    input: $codigoCliente     # $var ou JSONPath ($.campo) ou literal
    putInto: $idempotencyKey  # variável que recebe o hash
  onSuccess: NextStep
  onFailure:
    statusCode: 500
    message: "falha ao gerar hash de idempotência"
```

### Passo 1 — Config no modelo (`app/internal/workflow/model.go`)

```go
// HashSha256 configura a skill HashSha256: calcula o SHA-256 de Input
// e o disponibiliza (hex) na variável PutInto.
type HashSha256 struct {
    Input   string `yaml:"input"`
    PutInto string `yaml:"putInto"`
}
```

E no `struct Behavior`, junto dos demais blocos de skill:

```go
HashSha256 *HashSha256 `yaml:"hashSha256"`
```

### Passo 2 — `knownSkills` (mesmo arquivo)

```go
var knownSkills = map[string]bool{
    // ...
    "HashSha256": true,
}
```

### Passo 3 — Implementação (`app/engine/skills/crypto/sha256.go`)

```go
// Package crypto contém skills criptográficas do Radahn.
package crypto

import (
    "crypto/sha256"
    "encoding/hex"
    "fmt"

    "radahn/engine/skillctx"
    "radahn/internal/workflow"
)

// Sha256 calcula o SHA-256 de um valor resolvido e o grava (hex) em putInto.
func Sha256(ctx skillctx.Context, b *workflow.Behavior) (bool, error) {
    cfg := b.HashSha256
    if cfg == nil {
        return false, fmt.Errorf("missing hashSha256 config")
    }

    raw := fmt.Sprint(ctx.ResolveExtract(cfg.Input))
    if raw == "" {
        return false, nil // falha de negócio → onFailure
    }

    sum := sha256.Sum256([]byte(raw))
    hashHex := hex.EncodeToString(sum[:])

    ctx.SetData(hashHex)
    if cfg.PutInto != "" {
        ctx.SetVar(cfg.PutInto, hashHex)
    }
    return true, nil
}
```

### Passo 4 — Registro no motor (`app/engine/skills.go`)

```go
import (
    // ...
    cryptoskills "radahn/engine/skills/crypto"
)

var registry = map[string]skillFunc{
    // ...
    "HashSha256": cryptoskills.Sha256,
}
```

### Passo 5 — Teste unitário (`app/tests/unit-tests/`)

```go
func TestHashSha256(t *testing.T) {
    ctx := newFakeCtx()
    ctx.SetVar("codigoCliente", "ABC-123")

    b := &workflow.Behavior{
        Kind:       "HashSha256",
        HashSha256: &workflow.HashSha256{Input: "$codigoCliente", PutInto: "$idempotencyKey"},
    }

    ok, err := crypto.Sha256(ctx, b)
    if err != nil || !ok {
        t.Fatalf("esperava sucesso, obteve ok=%v err=%v", ok, err)
    }
    if got := ctx.Vars()["idempotencyKey"]; got == "" || got == nil {
        t.Fatalf("idempotencyKey não foi preenchida: %v", got)
    }
}
```

### Passo 6 — Build e verificação

```bash
cd app
gofmt -w .
go vet ./...
go build -o radahn.exe ./cmd/radahn
go test ./...
```

### Passo 7 — Documentação

Adicione a linha no catálogo de skills do [`README.md`](README.md):

```
| `HashSha256` | Calcula o SHA-256 de um valor e grava em variável | `hashSha256` | — |
```

E registre a skill na base do agente em [`agent/radahn-agent.md`](agent/radahn-agent.md).

---

## 7. Fluxo Git (Git Flow)

Toda contribuição de skill segue o **Git Flow** descrito em
[`app/CONTRIBUTING.md`](app/CONTRIBUTING.md). Resumo aplicado ao exemplo acima:

```bash
# 1. parta de develop atualizado
git checkout develop
git pull origin develop

# 2. crie a feature branch (convenção: feature/skill-<nome>)
git checkout -b feature/skill-hashsha256

# 3. implemente os passos 1..7 em commits pequenos (Conventional Commits)
git add -A
git commit -m "feat(skills): add HashSha256 skill"
git commit -m "docs(readme): document HashSha256 in the skill catalog"
git commit -m "test(skills): cover HashSha256 happy path and empty input"

# 4. mantenha a branch atualizada (rebase preferível a merge)
git fetch origin
git rebase origin/develop

# 5. suba e abra o Pull Request PARA develop
git push -u origin feature/skill-hashsha256
```

Regras do fluxo (detalhes em [`app/CONTRIBUTING.md`](app/CONTRIBUTING.md)):

- **Branches:** `feature/*` sai de `develop` e volta para `develop`; `release/*` e `hotfix/*`
  vão para `main` **e** `develop`. Delete a branch após o merge.
- **Commits:** Conventional Commits (`feat`, `fix`, `docs`, `test`, `refactor`, `chore`,
  `perf`); escopo `skills` para skills novas.
- **PR:** alvo `develop`; escopo pequeno; descreva o que muda, por quê e como testar
  (comandos/`curl`). Merge por **squash** para `feature/*`.
- **Checklist do autor:** `go build ./...` compila, `gofmt`/`go vet` limpos,
  `go test ./...` passa, docs atualizadas e **sem segredos** no código ou no YAML.
- **Versionamento (SemVer):** uma skill nova retrocompatível é um bump **MINOR**.

---

## 8. Regras de ouro

- **Não invente** campos ou skills fora do protocolo; siga a assinatura e o `registry`.
- **Sem segredos** no `radahn.yaml` nem no código — apenas variáveis de ambiente.
- **Acesse o mundo só via `skillctx.Context`** — nada de `os.Getenv`/DB/HTTP direto.
- **Registre em três lugares:** `Behavior` + `knownSkills` (model) e `registry` (engine).
- **Prefira falha de negócio** (`false, nil`) a `error` quando o caso for esperado.
- **Adicione skills na árvore ativa** `app/engine/` (a antiga `app/internal/engine/` foi removida).
- **Teste** com o `fakeCtx` antes de abrir o PR.
