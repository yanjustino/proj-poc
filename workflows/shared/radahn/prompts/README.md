# Radahn

**Radahn** é um motor de execução de APIs REST orientado por configuração (*low-code*).
Em vez de escrever código imperativo por caso de uso, o engenheiro **declara** as rotas HTTP
e o comportamento de cada uma em um arquivo de metadados YAML (`radahn.yaml`, do tipo
`ApplicationWorkflow`). O motor **interpreta** esse arquivo em tempo de execução e passa a servir
as rotas — validando entradas, consultando bancos, enriquecendo dados via subsistemas
(padrão BFF), transformando e agregando resultados.

O desenvolvedor que consome o Radahn precisa apenas de **três coisas**:

1. O executável **`radahn.exe`**.
2. Um **`radahn.yaml`** na mesma pasta (ou apontado por `RADAHN_CONFIG`).
3. As **variáveis de ambiente** exigidas pelas skills usadas no workflow.

Nenhum código é escrito por caso de uso, e nenhuma recompilação é necessária para alterar
o comportamento de uma rota — basta editar o YAML e reiniciar o binário.

---

## Sumário

- [Vantagens do Radahn (visão executiva)](#vantagens-do-radahn-visão-executiva)
- [Como funciona](#como-funciona)
- [Build](#build)
- [Execução](#execução)
- [Executando com Docker (imagem)](#executando-com-docker-imagem)
- [Esquema `ApplicationWorkflow`](#esquema-applicationworkflow)
  - [Rotas e parâmetros](#rotas-e-parâmetros)
  - [Defaults de parâmetros](#defaults-de-parâmetros)
  - [Pipeline de behaviors](#pipeline-de-behaviors)
  - [Controle de fluxo (`onSuccess` / `onFailure`)](#controle-de-fluxo-onsuccess--onfailure)
  - [Interpolação de variáveis](#interpolação-de-variáveis)
  - [`localStore` e agregação multifonte](#localstore-e-agregação-multifonte)
  - [Execução paralela (`Parallel`)](#execução-paralela-parallel)
  - [Varredura de lista (`ForEach`)](#varredura-de-lista-foreach)
- [Modo Debug](#modo-debug)
- [Health-check endpoints](#health-check-endpoints)
- [Validação de startup](#validação-de-startup)
- [Catálogo de skills](#catálogo-de-skills)
- [Skills CSV](#skills-csv)
- [Skills MongoDB](#skills-mongodb)
- [Contribuindo com skills (innersource)](#contribuindo-com-skills-innersource)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Roadmap e backlog](#roadmap-e-backlog)
- [Limitações conhecidas](#limitações-conhecidas)

---

## Vantagens do Radahn (visão executiva)

> **Resumo para liderança:** o Radahn transforma a criação de APIs REST de integração/BFF de
> um trabalho de **codificação** para um trabalho de **configuração**. O que hoje leva dias de
> desenvolvimento, testes e revisão passa a levar horas de escrita de YAML — com **padronização,
> segurança e governança embutidas**.

### Proposta de valor em uma frase

Menos código proprietário para escrever, testar e manter → **entrega mais rápida, custo menor e
menor risco operacional** em toda a esteira de APIs de integração.

### Simulação de esforço por endpoint

Estimativas para os três cenários deste repositório, comparando três formas de trabalho:
**(A) codificação tradicional sem IA**, **(B) codificação assistida por IA** (ex.: Copilot) e
**(C) configuração no Radahn**. As horas incluem design, implementação, tratamento de erros,
testes e code review.

| Cenário | Complexidade | (A) Sem IA | (B) Com IA | (C) Radahn | Economia vs. A |
|---------|--------------|:---------:|:---------:|:---------:|:--------------:|
| Extrato conta-corrente (BFF simples: OAuth + 1 subsistema + transform) | Média | ~16 h | ~6 h | ~1 h | **~94%** |
| Previdência (3 rotas: banco, filtros, BFF com merge) | Alta | ~40 h | ~16 h | ~3 h | **~92%** |
| Termos assinados (BFF de 21 steps: banco + OAuth + 3 subsistemas + merges) | Muito alta | ~56 h | ~24 h | ~4 h | **~93%** |

> As horas são estimativas ilustrativas para um desenvolvedor pleno; o ponto não é o número
> exato, e sim a **ordem de grandeza**: o Radahn remove a maior parte do esforço de código
> repetitivo (boilerplate de rotas, clientes HTTP, OAuth, parsing, mapeamento e testes).

### Projeção anualizada (exemplo)

Suponha uma organização que entrega **50 endpoints de integração/BFF por ano**, com esforço
médio de **~35 h/endpoint sem IA** vs. **~3 h/endpoint no Radahn**, a um custo totalmente
carregado de **R$ 120/h**:

| Métrica | Sem IA | Com Radahn | Ganho |
|---------|:------:|:---------:|:-----:|
| Horas/ano (50 endpoints) | 1.750 h | 150 h | **-1.600 h** |
| Custo de construção/ano | R$ 210.000 | R$ 18.000 | **~R$ 192.000** |
| Time-to-market por endpoint | ~1 semana | ~horas | **dias → horas** |

E isso é apenas **construção**. Como manutenção costuma representar a maior fatia do custo total
de software (ver referências), a economia recorrente em correções e mudanças tende a **superar**
a economia de construção ao longo do ciclo de vida.

### Vantagens qualitativas

- **Padronização por construção:** toda API segue o mesmo modelo (validação → consulta →
  transformação → agregação), eliminando divergências entre times.
- **Segurança e governança:** segredos ficam **fora** do artefato (só em variáveis de ambiente);
  o `radahn.yaml` é auditável, versionável e revisável como qualquer config.
- **Menos superfície de bug:** o comportamento vem de um motor testado uma vez, não de N
  implementações artesanais. Menos código proprietário = menos vulnerabilidades e menos regressões.
- **Time-to-market:** mudança de regra vira edição de YAML + restart, sem recompilar/redeployar
  código de aplicação.
- **Onboarding rápido:** um engenheiro lê o esquema e produz endpoints no primeiro dia; não
  precisa dominar o framework HTTP, o driver de banco ou o fluxo OAuth.
- **Democratização assistida:** com o agente **Radahn Copilot**, um engenheiro descreve o caso de
  uso em linguagem natural e recebe o `radahn.yaml` pronto e validado.

### Redução de risco

- **Consistência de segurança** (tratamento uniforme de tokens, timeouts e erros).
- **Auditabilidade** (o que a API faz está declarado em um único arquivo legível).
- **Reversibilidade** (rollback = trocar o YAML pela versão anterior).
- **Menor dependência de conhecimento tribal** (o comportamento não está espalhado em código).

### Fatos externos que justificam o investimento

> As referências abaixo são de mercado e servem para **contextualizar** a ordem de grandeza dos
> ganhos; recomenda-se validar os números com as fontes originais antes de citá-los em decisões
> formais.

- **Adoção de low-code:** a Gartner projetou que, até 2025, **~70% das novas aplicações**
  desenvolvidas por organizações usariam tecnologias low-code/no-code (ante <25% em 2020),
  refletindo a pressão por velocidade de entrega e escassez de desenvolvedores.
- **Custo de manutenção domina o TCO:** é amplamente reportado na engenharia de software que a
  **manutenção representa a maior parcela** do custo total de propriedade de um sistema ao longo
  da vida (frequentemente citado na faixa de **60–75%**). Reduzir código proprietário ataca
  justamente essa fatia recorrente.
- **Integração/BFF é um gargalo real:** relatórios de indústria (ex.: pesquisas sobre APIs e
  o *State of API*) apontam que integração e trabalho de "cola" entre sistemas consomem parte
  significativa do tempo de backend — exatamente o que o Radahn padroniza.
- **Escassez de talento:** a demanda por desenvolvedores segue superando a oferta; abordagens que
  **multiplicam a produtividade por engenheiro** (low-code + IA) endereçam diretamente essa
  restrição de capacidade.
- **Produtividade com assistentes de IA:** estudos de campo com assistentes de código
  (ex.: experimentos com GitHub Copilot) reportaram tarefas concluídas de forma
  **significativamente mais rápida**. O Radahn **soma-se** a esse ganho: a IA gera a configuração,
  e o motor elimina o código a ser gerado.

**Síntese:** o Radahn combina duas alavancas comprovadas — **low-code** (menos código para manter)
e **IA** (geração assistida da configuração) — sobre a categoria de trabalho mais repetitiva e
cara do backend (APIs de integração/BFF).

---

## Como funciona

```
                ┌──────────────────────────────────────────────────────┐
   radahn.yaml → │  radahn.exe                                           │
   env vars   → │  ┌───────────┐   registra     ┌─────────────────┐    │
                │  │  loader   │──────────────► │  router (chi)   │    │
                │  └───────────┘                └────────┬────────┘    │
                │                                        │ request     │
                │                         ┌──────────────▼───────────┐ │
   HTTP req   ──┼────────────────────────►│  pipeline de behaviors   │ │
                │                         │  step 1 → step 2 → ...   │ │
                │                         │  (skills + interpolação) │ │
   HTTP resp ◄──┼─────────────────────────└──────────────────────────┘ │
                └──────────────────────────────────────────────────────┘
```

1. No startup, o motor lê o `radahn.yaml`, valida (`kind: ApplicationWorkflow`) e **registra cada rota**.
2. Cada requisição entra em um **pipeline de behaviors** — uma lista ordenada de *steps*.
3. Cada *step* executa uma **skill** (validação, query, HTTP, transformação, merge...).
4. O resultado de um *step* é passado ao próximo (interpolação de variáveis disponível).
5. `onSuccess`/`onFailure` controlam o fluxo (avançar, encerrar, armazenar, ou falhar com status HTTP).

---

## Build

O Radahn é compilado com **Go 1.24+** e gera um único binário autossuficiente (sem runtime externo).

### Windows — testes locais

```powershell
cd app
go mod tidy
go build -o radahn.exe ./cmd/radahn
```

### Linux — deploy em container

Para compilar o binário Linux a partir de qualquer sistema operacional (Windows, macOS ou Linux),
use as variáveis de ambiente `GOOS` e `GOARCH` do toolchain Go:

```bash
cd app
go mod tidy
```

#### Linux amd64 (x86_64) — arquitetura padrão de servidores e containers ECS/EKS

```bash
# Windows PowerShell
$env:GOOS="linux"; $env:GOARCH="amd64"; go build -o radahn ./cmd/radahn

# Linux / macOS / WSL / Git Bash
GOOS=linux GOARCH=amd64 go build -o radahn ./cmd/radahn
```

#### Linux arm64 (AWS Graviton, Apple Silicon, etc.)

```bash
# Windows PowerShell
$env:GOOS="linux"; $env:GOARCH="arm64"; go build -o radahn ./cmd/radahn

# Linux / macOS / WSL / Git Bash
GOOS=linux GOARCH=arm64 go build -o radahn ./cmd/radahn
```

#### Compilar todas as variantes de uma vez (Linux / macOS / WSL)

```bash
cd app
GOOS=linux GOARCH=amd64 go build -o radahn-linux-amd64 ./cmd/radahn
GOOS=linux GOARCH=arm64 go build -o radahn-linux-arm64 ./cmd/radahn
GOOS=windows GOARCH=amd64 go build -o radahn.exe       ./cmd/radahn
```

> **Nota:** o binário Linux não tem extensão (ex.: `radahn`), enquanto o binário Windows usa
> `.exe`. Ambos são gerados sem nenhuma dependência de sistema — basta copiá-los para o container.

### Dockerfile de exemplo (multistage)

> **Nota:** este repositório já inclui um Dockerfile pronto para produção em
> [`app/Dockerfile`](app/Dockerfile) (multi-stage, imagem mínima, usuário não-root e
> `HEALTHCHECK`). Para o passo a passo de build/execução com ele, veja
> [Executando com Docker (imagem)](#executando-com-docker-imagem). O bloco abaixo é
> apenas um exemplo didático simplificado.

```dockerfile
FROM golang:1.24-alpine AS builder
WORKDIR /src
COPY app/ .
RUN go mod tidy && \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /radahn ./cmd/radahn

FROM alpine:3.20
WORKDIR /app
COPY --from=builder /radahn ./radahn
COPY radahn.yaml ./radahn.yaml
ENV RADAHN_CONFIG=/app/radahn.yaml
EXPOSE 8080
ENTRYPOINT ["./radahn"]
```

Para arm64 (Graviton), troque `GOARCH=amd64` por `GOARCH=arm64` e o `FROM` base por
`golang:1.24-alpine` (que resolve a plataforma automaticamente em builds multi-arch com
`docker buildx`):

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t minha-org/radahn:latest --push .
```

> `CGO_ENABLED=0` garante que o binário seja **totalmente estático** (sem dependência de libc),
> tornando-o compatível com imagens minimalistas (`alpine`, `scratch`, `distroless`).

---

## Execução

```bash
# a partir da pasta que contém radahn.exe e radahn.yaml
cp .env.example .env         # ajuste os valores conforme necessário
export $(grep -v '^#' .env | xargs)
./radahn.exe
```

Saída típica no startup:

```
radahn loaded workflow "radahn.yaml" with 3 route(s)
radahn route registered: GET    /previdencia/clientes/{codigoCliente} (consultaCliente, 3 steps)
radahn route registered: GET    /previdencia/aportes (consultaAportes, 4 steps)
radahn route registered: GET    /previdencia/posicoes/{codigoCliente} (consultaPosicoes, 8 steps)
radahn listening on :8080
```

O endpoint **`GET /healthz`** está sempre disponível e retorna `{"status":"ok"}`.
Os endpoints **`GET /liveness`** e **`GET /readiness`** também estão disponíveis (ver [Health-check endpoints](#health-check-endpoints)).

Configuração do processo (via ambiente):

| Variável | Default | Descrição |
|----------|---------|-----------|
| `RADAHN_ADDR` | `:8080` | Endereço/porta de escuta |
| `RADAHN_CONFIG` | `radahn.yaml` | Caminho do arquivo de workflow |

---

## Executando com Docker (imagem)

O modelo de entrega recomendado é distribuir o Radahn como **imagem Docker imutável**. O
desenvolvedor **não recompila nada**: ele apenas **monta o `radahn.yaml` como volume** e
**injeta as variáveis de ambiente** exigidas pelas skills do seu workflow. A mesma imagem
serve todos os ambientes (dev, homolog, prod) — só mudam o YAML e as variáveis.

O Dockerfile de produção está em [`app/Dockerfile`](app/Dockerfile):

- **Multi-stage** — compila em `golang:1.24-alpine` e roda em `alpine` mínimo (~48 MB).
- **Binário estático** (`CGO_ENABLED=0`, `-trimpath -ldflags="-s -w"`) — imagem enxuta.
- **Build offline** via `vendor/` (`-mod=vendor`) — não depende de `GOPROXY`/CA no build.
- **Usuário não-root** (`radahn`, uid 10001) e **sem segredos** embutidos.
- **`HEALTHCHECK`** integrado apontando para `/liveness` (`wget -Y off`, ignora proxy).
- **`tzdata` embutido** no binário (`time/tzdata`) e `TZ=America/Sao_Paulo` — sem pacote de SO.
- Imagens base parametrizadas por `ARG REGISTRY` (default: registry corporativo
  `docker-remotes.artifactory.prod.aws.cloud.ihf/`).

> **Importante:** o `radahn.yaml` **não** é copiado para dentro da imagem — ele é fornecido em
> tempo de execução via volume. Assim a mesma imagem atende qualquer workflow.

### 1. Build da imagem

As dependências Go estão **vendorizadas** (`app/vendor/`), então o build é totalmente offline.
O contexto de build é a pasta `app/` (onde está o `Dockerfile`).

**Na esteira (registry corporativo — default):**

```bash
# imagens base vêm de docker-remotes.artifactory.prod.aws.cloud.ihf/
docker build -t radahn:local ./app
```

**Localmente (imagens públicas do Docker Hub):** sobrescreva o registry com `--build-arg`:

```bash
docker build --build-arg REGISTRY= -t radahn:local ./app
```

> Se atualizar dependências (`go.mod`), regenere o vendor antes do build: `cd app && go mod vendor`.

### 2. Fornecer o `radahn.yaml` via volume

Monte seu arquivo no caminho apontado por `RADAHN_CONFIG` (padrão da imagem:
`/etc/radahn/radahn.yaml`), preferencialmente como **somente leitura** (`:ro`):

```bash
# Linux / macOS / WSL / Git Bash
docker run --rm -p 8080:8080 \
  -v "$(pwd)/radahn.yaml:/etc/radahn/radahn.yaml:ro" \
  radahn:local
```

```powershell
# Windows PowerShell
docker run --rm -p 8080:8080 `
  -v "${PWD}\radahn.yaml:/etc/radahn/radahn.yaml:ro" `
  radahn:local
```

> Para apontar para outro caminho dentro do container, defina `-e RADAHN_CONFIG=/caminho/arquivo.yaml`
> e monte o volume no mesmo caminho.

### 3. Injetar as variáveis de ambiente

As skills leem segredos e coordenadas de conexão **apenas de variáveis de ambiente** (nada
sensível no YAML). Há duas formas de passá-las:

**a) Individualmente com `-e`:**

```bash
docker run --rm -p 8080:8080 \
  -v "$(pwd)/radahn.yaml:/etc/radahn/radahn.yaml:ro" \
  -e DB_HOST=meu-postgres \
  -e DB_PORT=5432 \
  -e DB_NAME=previdencia \
  -e DB_USER=svc_radahn \
  -e DB_PASSWORD=troque-me \
  -e HTTP_AUTHORIZE_URL=https://idp/oauth/token \
  -e HTTP_AUTHORIZE_CLIENT_ID=radahn-client \
  -e HTTP_AUTHORIZE_CLIENT_SECRET=troque-me \
  radahn:local
```

**b) Via arquivo `--env-file`** (recomendado — mantém segredos fora do histórico do shell):

```bash
# radahn.env  (NÃO versionar este arquivo)
# DB_HOST=meu-postgres
# DB_PORT=5432
# DB_NAME=previdencia
# DB_USER=svc_radahn
# DB_PASSWORD=troque-me

docker run --rm -p 8080:8080 \
  -v "$(pwd)/radahn.yaml:/etc/radahn/radahn.yaml:ro" \
  --env-file ./radahn.env \
  radahn:local
```

Consulte [`app/.env.example`](app/.env.example) para o conjunto de variáveis mais comuns e a
seção [Variáveis de ambiente](#variáveis-de-ambiente) para a lista completa por skill. As
variáveis de processo `RADAHN_ADDR` e `RADAHN_CONFIG` já têm defaults na imagem (`:8080` e
`/etc/radahn/radahn.yaml`).

### 4. `docker compose` (forma mais confortável)

```yaml
services:
  radahn:
    image: radahn:local
    ports:
      - "8080:8080"
    environment:
      RADAHN_CONFIG: /etc/radahn/radahn.yaml
    env_file:
      - ./radahn.env
    volumes:
      - ./radahn.yaml:/etc/radahn/radahn.yaml:ro
```

```bash
docker compose up
```

### 5. Verificar

```bash
docker ps                                   # STATUS deve ficar "healthy" após ~5s
curl http://localhost:8080/liveness         # {"status":"ok"}
curl http://localhost:8080/readiness        # {"status":"ok"} (ou "degraded" se deps caírem)
```

Se o `radahn.yaml` for inválido, o container **falha no boot** com uma mensagem de erro
explícita nos logs (`docker logs <container>`) — a validação ocorre no startup, não na
primeira requisição.

> **Multi-arquitetura (opcional):** para publicar imagens amd64 + arm64 (ex.: AWS Graviton),
> use `docker buildx`:
>
> ```bash
> docker buildx build --platform linux/amd64,linux/arm64 \
>   -t minha-org/radahn:1.0.0 --push ./app
> ```

---

## Esquema `ApplicationWorkflow`

Estrutura geral do `radahn.yaml`:

```yaml
kind: ApplicationWorkflow
spec:
  obfuscation:                    # opcional — ofuscação de dados sensíveis em logs
    logs:
      placeholder: "********"     # substituto do match (padrão: "********")
      patterns:                   # regex Go compiladas no boot (inválida = boot abortado)
        - "\\d{3}\\.?\\d{3}\\.?\\d{3}-?\\d{2}"
  requiredSkills:                 # skills usadas por este workflow (documental)
    - StaticValidation
    - PostgresQuery
    # ...
  routes:                         # endpoints HTTP
    <nomeDaRota>:
      method: GET
      url: /caminho/$pathVar      # $var no path vira parâmetro de rota
      pathParameters:  [ { name, type, required, default } ]
      queryParameters: [ { name, type, required, default } ]
      headers:         [ { name, header, type, required, default } ]
  behaviors:                      # pipeline por rota (a chave casa com nomeDaRota)
    <nomeDaRota>:
      - name: <nome do step>
        kind: <NomeDaSkill>
        # configuração específica da skill
        onSuccess: NextStep | Finish | { localStore: <nome> }
        onFailure: { statusCode: <código>, message: "<msg com $variaveis>" }
```

### Rotas e parâmetros

Cada rota define `method`, `url` e opcionalmente `pathParameters` / `queryParameters` / `headers`.

```yaml
routes:
  consultaCliente:
    method: GET
    url: /previdencia/clientes/$codigoCliente   # $codigoCliente é path param
    pathParameters:
      - name: codigoCliente
        type: uuid
        required: true

  consultaAportes:
    method: GET
    url: /previdencia/aportes
    queryParameters:
      - name: codigoCliente
        type: uuid
        required: true
      - name: dataInicial
        type: datetime
        required: false
        default: "today"
```

- `$nome` na `url` é convertido para o padrão de rota `{nome}` (path parameter).
- Uma query string pode ser **declarada** na `url` (documental); o Radahn roteia apenas
  pelo *path* e casa os valores de query via `queryParameters`.
- Campos de cada parâmetro: `name`, `type` (`uuid`, `datetime`, `int`, `bool`, ...),
  `required` (bool), `default` (opcional).
- Parâmetro `required` ausente resulta em **HTTP 400**.
- Para `headers`, `name` é a variável do workflow e `header` é o nome do cabeçalho HTTP (ex.: `x-xxxx-correlationID`).

### Defaults de parâmetros

O valor especial `default: "today"` é resolvido em runtime:

- Se o nome do parâmetro indicar **fim** de intervalo (contém `final`, `fim` ou `end`),
  resolve para **fim do dia** (`23:59:59`).
- Caso contrário, resolve para **início do dia** (`00:00:00`).

Formato produzido: `YYYY-MM-DD HH:MM:SS`.

### Pipeline de behaviors

A chave em `behaviors` **deve casar** com o nome da rota. O valor é uma lista ordenada de
*steps*. Cada step:

```yaml
- name: ConsultaCliente        # identificador do step
  kind: PostgresQuery          # skill a executar
  postgresQuery:               # bloco de config específico da skill
    resultType: Item
    sql: "SELECT * FROM cliente WHERE cliente_id = $1"
    parameters: [ $codigoCliente ]
  onSuccess: NextStep
  onFailure:
    statusCode: 500
    message: "erro ao consultar cliente $codigoCliente"
```

O **resultado** de um step (ex.: linhas do banco, JSON de uma API) torna-se o **input**
implícito do próximo step.

### Controle de fluxo (`onSuccess` / `onFailure`)

**`onSuccess`** aceita:

| Valor | Efeito |
|-------|--------|
| `NextStep` | Passa o resultado adiante e executa o próximo step |
| `Finish` | Encerra o pipeline e **retorna** o resultado atual (HTTP 200 por padrão, ou o status definido por `HttpStatusCodeResult`) |
| `{ localStore: <nome> }` | Armazena o resultado em memória para `MergeLocalStore` e continua |
| `<nomeDoStep>` (scalar) | Redireciona o fluxo para o step com esse nome (ex.: `onSuccess: TratarErro`) |

**`onFailure`** aceita:

| Valor | Efeito |
|-------|--------|
| `{ statusCode: <N>, message: "..." }` | Encerra o pipeline com erro HTTP; a mensagem interpola variáveis |
| `<nomeDoStep>` (scalar) | Redireciona o fluxo para o step com esse nome **sem** encerrar com erro |

```yaml
onFailure:
  statusCode: 422        # ou "status:" (aceitos como sinônimos)
  message: "cliente $codigoCliente inválido"   # a mensagem interpola variáveis
```

- Se o status for `204`, ou não houver `message`, o corpo é vazio.
- Caso contrário, o corpo é `{"message": "<mensagem interpolada>"}`.
- **Proteção anti-loop:** o motor limita cada request a **100 execuções de step**. Se o limite for excedido, retorna HTTP 500.

**Exemplo de redirecionamento:**

```yaml
- name: ValidarAlgo
  kind: LogicalOperator
  logicalOperator:
    - condition: $.campo == valor
      breakByFailure: true
  onFailure: TratarErro   # redireciona para o step TratarErro
  onSuccess: Finish

- name: TratarErro
  kind: HttpStatusCodeResult
  httpStatusCodeResult:
    status: 422
    body: '{"message":"Valor inválido"}'
```

### Hooks de ciclo de vida (`spec.hooks`)

`spec.hooks` declara pipelines executados **fora de qualquer requisição HTTP**, reusando a mesma
maquinaria de skills com uma **sessão sintética** (sem body/params de rota):

- **`onStart`** — roda no boot, **antes** do servidor HTTP subir. Se um step falhar com
  `onFailure: StopApplication`, o processo encerra com código != 0 e a porta HTTP **não** abre.
- **`onStop`** — roda no desligamento gracioso (`SIGINT`/`SIGTERM`), **antes** do `Shutdown`.

```yaml
spec:
  hooks:
    onStart:
      - name: PreparaCertificados
        kind: Command
        command:
          - "update-ca-certificates 2>/dev/null"
        onSuccess: NextStep
        onFailure: StopApplication
      - name: ExtraiPacote
        kind: UnzipFile
        unzipFile: { from: certs.zip, to: /opt/certs }
        onSuccess: Finish
        onFailure: StopApplication
    onStop:
      - name: Desligamento
        kind: Command
        command: ["echo bye"]
        onSuccess: Finish
```

- Dentro de hooks, `onSuccess` aceita `NextStep`, `Finish` e `{ localStore: <nome> }`.
- `onFailure: StopApplication` é **exclusivo de hooks** (aborta o hook / o boot); `onFailure: <step>`
  redireciona o fluxo. O mesmo teto anti-loop de 100 execuções se aplica.

### Skills CSV

Cinco skills cobrem o ciclo leitura → transformação → escrita de arquivos `.csv`, todas operando
sobre a pipeline de `data` como array de `map[string]interface{}`:

- **`CsvReader`** — lê o arquivo. A 1ª linha é **sempre** usada para resolver os nomes das colunas
  (necessário para `filterFields` por nome); `ignoreHeader` só controla se essa linha também é
  emitida como um registro de dados. `strategy: ReadAll` (padrão) carrega tudo de uma vez;
  `ReadLine` lê registro a registro (mais econômico em memória para arquivos grandes) — o
  resultado final é o mesmo array completo nos dois casos.
- **`CsvRowFilter`** — mantém apenas os registros que atendem a uma condição de 3 tokens
  (`campo op valor`), reaproveitando a semântica de comparação do `LogicalOperator`.
- **`CsvFieldMapper`** — renomeia (`from`/`to`), tipa (`as: string|integer|decimal|boolean`) ou
  deriva (`value`, aceitando `$var`, `$.campo` do próprio registro, ou literal) campos.
- **`CsvAggregator`** — agrupa por `groupBy` (uma ou mais chaves) e aplica `sum`/`count`/`avg`/
  `min`/`max` por grupo; `putInto` opcionalmente captura o array agregado em uma variável de sessão.
- **`CsvWriter`** — grava um array de registros (`items`, aceitando `""`/`"$"` para os dados atuais,
  `$.a.b` ou `$nome`). O header é declarado explicitamente (`header`) ou inferido do 1º item;
  `append: true` acrescenta linhas sem reescrever o header em um arquivo já existente (default:
  sobrescreve do zero).

```yaml
- name: LerCsv
  kind: CsvReader
  csvReader:
    path: /dados/posicoes.csv
    strategy: ReadAll          # ou ReadLine
    ignoreHeader: true
    filterFields: [clienteCodigo, ativoCodigo, quantidade]
  onSuccess: NextStep
  onFailure: { statusCode: 500, message: "falha ao ler o csv" }

- name: FiltrarQuantidadePositiva
  kind: CsvRowFilter
  csvRowFilter:
    condition: "quantidade > 0"
  onSuccess: NextStep
  onFailure: { statusCode: 500, message: "falha ao filtrar" }

- name: MapearCampos
  kind: CsvFieldMapper
  csvFieldMapper:
    mappings:
      - from: clienteCodigo
        to: clienteId
        as: integer
      - from: quantidade
        as: decimal
  onSuccess: NextStep
  onFailure: { statusCode: 500, message: "falha ao mapear campos" }

- name: AgregarPorCliente
  kind: CsvAggregator
  csvAggregator:
    groupBy: [clienteId]
    aggregations:
      - field: quantidade
        op: sum
        as: total
    putInto: $resultado
  onSuccess: NextStep
  onFailure: { statusCode: 500, message: "falha ao agregar" }

- name: GravarResultado
  kind: CsvWriter
  csvWriter:
    path: /dados/resultado.csv
    items: "$resultado"
  onSuccess: Finish
  onFailure: { statusCode: 500, message: "falha ao gravar o csv" }
```

Cenário de integração completo (com asserts do HTTP e do arquivo gerado):
[`app/tests/integrated-tests/scenario-20260904-103000`](app/tests/integrated-tests/scenario-20260904-103000).

> **Ideias para skills futuras de transformação CSV** (ainda não implementadas): conversores
> dedicados `CsvToJson`/`JsonToCsv` para interoperar diretamente com `JsonTransformer`, e um
> `CsvSchemaValidator` para validar registros contra um JSON Schema antes de gravar.

### Skills MongoDB

Três skills cobrem leitura, escrita e agregação contra uma coleção MongoDB, seguindo o mesmo
padrão dual leitura/escrita já usado pelas skills Postgres/MySQL:

- **`MongoQuery`** — busca documentos (`filter`/`projection`/`sort`/`limit`); `resultType: Item`
  usa `FindOne` (nenhum documento encontrado → `data`/`putInto` recebem `nil`, **não é erro**),
  `resultType: Array` (padrão) usa `Find` e retorna todos os documentos casados.
- **`MongoOperation`** — escreve na coleção: `action` pode ser `insertOne`, `insertMany`,
  `updateOne`, `updateMany`, `deleteOne`, `deleteMany` ou `findOneAndUpdate`. O `document`
  estático (YAML) define a forma fixa; `parameters` (mesmo formato de `extractFrom` usado em
  `PostgresOperation`) mescla campos vindos da requisição — em `insertOne`/`insertMany` como
  campos de nível superior, em `update*`/`findOneAndUpdate` dentro do operador `$set`. `upsert`
  habilita upsert nas ações de update.
- **`MongoAggregate`** — executa um pipeline de agregação (`pipeline`, sequência de estágios
  `$match`/`$group`/`$sort`/...); `resultType` funciona como em `MongoQuery`.

Em todas as três, `filter`/`document`/`pipeline` são blocos YAML arbitrários resolvidos
recursivamente: uma string que é **exatamente** um token `$nome` é substituída pelo valor
tipado da variável de sessão correspondente (`$codigoCliente`, `$sku`, ...) — mas **apenas
quando essa variável existe**; caso contrário o literal `$nome` é preservado, o que é essencial
para operadores/referências de campo do próprio Mongo, que usam a mesma sintaxe (`$gte`, `$in`,
`$categoria` dentro de um `$group`, `$sum` dentro de um `$group`, etc.). Chaves de mapa (os
operadores) nunca são resolvidas — só valores.

```yaml
- name: InserirProduto
  kind: MongoOperation
  mongoOperation:
    collection: produtos
    action: insertOne
    document:
      ativo: true
    parameters:
      - name: sku
        extractFrom: $.sku
      - name: nome
        extractFrom: $.nome
      - name: preco
        extractFrom: $.preco
    putInto: $insertedId
  onSuccess: NextStep
  onFailure: { statusCode: 500, message: "falha ao inserir produto" }

- name: BuscarProduto
  kind: MongoQuery
  mongoQuery:
    collection: produtos
    filter:
      sku: $sku
    resultType: Item
    putInto: $produto
  onSuccess: NextStep
  onFailure: { statusCode: 500, message: "falha ao buscar produto" }

- name: RelatorioPorCategoria
  kind: MongoAggregate
  mongoAggregate:
    collection: produtos
    pipeline:
      - $group:
          _id: $categoria       # referência de campo do Mongo — preservada como literal
          total:
            $sum: $preco        # idem
      - $sort:
          _id: 1
    resultType: Array
    putInto: $relatorio
  onSuccess: NextStep
  onFailure: { statusCode: 500, message: "falha ao gerar relatorio" }
```

Cenário de integração completo (CRUD + relatório contra um MongoDB real via Docker):
[`app/tests/integrated-tests/scenario-20260908-154300`](app/tests/integrated-tests/scenario-20260908-154300).

### Workers em segundo plano (`spec.workers`)

`spec.workers` declara **processos contínuos** que rodam em segundo plano **enquanto o servidor
HTTP está exposto**. Cada chave **deve casar** com um pipeline em `spec.behaviors` (mesmo nome); o
motor executa esse pipeline **em loop**, reusando **a mesma API de pipeline do workflow**
(`onSuccess`/`onFailure`, `Finish`/`Continue`/`NextStep`/`localStore`, control steps
`ForEach`/`Parallel`, `retry` e o teto anti-loop de 100 execuções por iteração), com uma **sessão
sintética** (sem body/params de rota).

- Os workers **iniciam depois** que os hooks `onStart` concluem com sucesso e **param
  (graciosamente) antes** dos hooks `onStop` rodarem.
- `loopWait` (**obrigatório**, duração Go `"5s"`/`"500ms"`/`"1m"`, positiva) é o intervalo entre
  iterações.
- `breakOnFailure: true` → uma iteração que falha **para** o worker; `false` (padrão) → a falha é
  logada e o loop continua após `loopWait`.

```yaml
spec:
  workers:
    consolidarPosicoesRendaFixa:
      loopWait: "5s"
      breakOnFailure: false
  behaviors:
    consolidarPosicoesRendaFixa:
      - name: ObterMensagens
        kind: SqsGetMessages
        sqsGetMessages:
          queueUrl: https://sqs.us-east-1.amazonaws.com/123456789012/posicoes
          maxNumberOfMessages: 10
          deleteAfterRead: true
          putInto: $mensagens
        onSuccess: NextStep
        onFailure: { statusCode: 500, message: "falha ao consumir SQS" }
      - name: Processar
        kind: ForEach
        forEach:
          extractFrom: $mensagens
          steps:
            - name: Tratar
              kind: HttpOperation
              httpOperation:
                method: POST
                url: https://sink.interno/consumir
                body:
                  type: Json
                  properties:
                    - { name: body, extractFrom: $.body }
              onSuccess: Continue
              onFailure: { statusCode: 502, message: "falha ao processar item" }
        onSuccess: Finish
        onFailure: { statusCode: 500, message: "falha no lote" }
```

### Overlays de configuração (`spec.overlays` / `FROM_OVERLAY`)

`spec.overlays` declara **valores de configuração por ambiente** (ex.: `dev`, `hom`, `prod`),
resolvidos **uma única vez no boot** a partir da variável de ambiente obrigatória
`RADAHN_ENVIRONMENT`. Qualquer string do documento pode referenciar um valor com a função
`FROM_OVERLAY(chave)`; a substituição acontece antes da validação estrutural do workflow.

```yaml
spec:
  overlays:
    - name: dev
      values:
        - name: kaasEnvironment
          value: DEVELOPMENT
        - name: kafkaGroupId
          value: mm8_group-mm8-kaas_dev
    - name: hom
      values:
        - name: kaasEnvironment
          value: HOMOLOGATION
        - name: kafkaGroupId
          value: mm8_group-mm8-kaas_hom
    - name: prod
      values:
        - name: kaasEnvironment
          value: PRODUCTION
        - name: kafkaGroupId
          value: mm8_group-mm8-kaas_prod

  hooks:
    onStart:
      - name: EmitirCertificadoKaaS
        kind: KafkaCertDownload
        kafkaCertDownload:
          profile: kaas
          environment: FROM_OVERLAY(kaasEnvironment)
          cached: true
          # Diretório de destino: variável de ambiente KAFKA_CERT_PATH (default "/tmp"), não yaml.

  behaviors:
    consumirFila:
      - name: ConsumirLoteKafka
        kind: KafkaConsume
        kafkaConsume:
          groupId: FROM_OVERLAY(kafkaGroupId)
          topics: [ meu-topico ]
```

- Cada item de `spec.overlays[].values` é um par `name`/`value`; `name` deve ser
  **camelCase**, sem espaços e com no máximo **64 caracteres**.
- **`RADAHN_ENVIRONMENT`** se torna **obrigatória** assim que `spec.overlays` é declarado. Se a
  variável estiver ausente, ou não casar com nenhum `overlays[].name`, o **boot falha** (o
  servidor HTTP nunca inicia).
- `FROM_OVERLAY(chave)` é resolvida **em qualquer campo string do spec** (rotas, behaviors,
  hooks, workers, otel, etc.) — inclusive dentro de mapeamentos/listas genéricos (ex.: o `body`
  de um `HttpStatusCodeResult`). A validação garante que `chave` existe no overlay do **ambiente
  ativo**; se não existir, o boot falha citando a chave e o ambiente.
- Usar `FROM_OVERLAY(...)` sem declarar `spec.overlays` também falha o boot.
- `spec.overlays` participa do merge de `spec.include` como as demais seções: um overlay com o
  mesmo `name` sobrescreve o correspondente já declarado.

### Variáveis de ambiente (`FROM_ENV`)

`FROM_ENV(NOME)` lê o valor de uma variável de ambiente do processo, resolvida **uma única
vez no boot** — mesmo contrato de `FROM_OVERLAY`: a substituição roda em qualquer campo
string do spec antes da validação estrutural do workflow.

```yaml
spec:
  hooks:
    onStart:
      - name: EmitirCertificadoKaaS
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

- `NOME` deve ser um identificador válido de variável de ambiente (letras, dígitos e `_`,
  não pode começar com dígito).
- Se `NOME` não estiver definida no ambiente do processo, o **boot falha** citando a
  variável (mesmo comportamento de `RADAHN_ENVIRONMENT` ausente com `spec.overlays`
  declarado). Uma variável definida com valor vazio é aceita normalmente.
- Diferente de `FROM_OVERLAY`, `FROM_ENV` não depende de nenhuma declaração prévia no spec
  (não existe um `spec.envVars`); qualquer variável do ambiente do processo pode ser lida.

### Interpolação de variáveis

| Sintaxe | Onde | Exemplo |
|---------|------|---------|
| `$nome` | URLs, mensagens, tokens, parâmetros | `/clientes/$codigoCliente` |
| `$1`, `$2`, ... | SQL (placeholders posicionais) | `WHERE id = $1 AND data BETWEEN $2 AND $3` |
| JSONPath (`$.a.b`, `$`) | extração de respostas HTTP | `extractResult: $.data.posicoes` |

- Variáveis vêm dos **parâmetros de rota** e de **steps anteriores** (ex.: `$accessToken`
  produzido por `HttpAuthorize`, ou `putInto` de `HttpSearch`).
- Valores interpolados **dentro de URLs de saída** são automaticamente *URL-encoded*
  (ex.: `datetime` com espaços vira `2026-07-01+00%3A00%3A00`).
- Em SQL, os placeholders `$1..$n` são preenchidos pela lista `parameters` (que resolve
  cada `$var`). Para MySQL, `$1..$n` são reescritos para `?` na ordem correta.

### `localStore` e agregação multifonte

Steps podem gravar seu resultado em memória e, mais adiante, um `MergeLocalStore`
consolida tudo — o núcleo do comportamento BFF:

```yaml
- name: TransformarPrevidenciaFechada
  kind: OutputTransformer
  fields: [ ... ]
  onSuccess: { localStore: posicoesFechadas }   # guarda em memória
- name: TransformarPrevidenciaAberta
  kind: OutputTransformer
  fields: [ ... ]
  onSuccess: { localStore: posicoesAbertas }
- name: ConsolidarResultados
  kind: MergeLocalStore
  mergeLocalStore: [ posicoesFechadas, posicoesAbertas ]   # concatena os arrays
  onSuccess: Finish
```

> Estratégia de merge atual: **concatenação** de arrays (a especificação de join/dedupe
> ainda está em aberto na Discovery).

### Execução paralela (`Parallel`)

`Parallel` é um **control step do motor** (não é uma skill de folha) que executa várias
**branches** — sub-pipelines ordenados — **concorrentemente** e consolida os resultados. É o
caminho recomendado para BFFs que agregam múltiplas fontes independentes (várias APIs de
subsistema e/ou consultas de banco) sem pagar a latência somada de chamadas sequenciais.

```yaml
- name: coletasParalelas
  kind: Parallel
  parallel:
    maxConcurrency: 4          # opcional (default = nº de branches)
    failFast: true             # opcional (default true)
    branches:
      - name: saldo            # cada branch é um sub-pipeline (1..N steps)
        steps:
          - name: buscarSaldo
            kind: HttpSearch
            httpSearch: { url: "$urlSaldo", bearerToken: $accessToken, extractResult: $.saldo }
            onSuccess: Finish  # Finish encerra a BRANCH, não a requisição
      - name: limites
        steps:
          - name: buscarLimites
            kind: PostgresQuery
            postgresQuery: { resultType: Item, sql: "SELECT ...", parameters: [ $codigoCliente ] }
            onSuccess: Finish
    consolidate:
      strategy: object         # object | collect | merge
      putInto: $               # onde gravar o consolidado (vazio/$ = data; $var = variável)
  onSuccess: Finish
  onFailure:
    statusCode: 502
    message: "falha ao consolidar dados do cliente"
```

Estratégias de consolidação (`consolidate.strategy`):

| Estratégia | Resultado |
|------------|-----------|
| `object` (default) | `{ "<branch>": <data>, ... }` — objeto keyed pelo nome de cada branch |
| `collect` | `[ <data-branch-1>, <data-branch-2>, ... ]` — array na **ordem declarada** |
| `merge` | merge raso: arrays concatenam; chaves de objeto sobrescrevem na ordem das branches |

Semântica e garantias:

- **Isolamento:** cada branch roda sobre um **clone profundo** da sessão (variáveis, `data` e
  `store`), então não há corrida de dados entre branches. Os pools de infraestrutura
  (Postgres/MySQL/Redis/HTTP/AWS) são thread-safe e permanecem compartilhados.
- **`failFast: true`** (default): a primeira branch que falha cancela as branches ainda não
  iniciadas e dispara o `onFailure` do step `Parallel`. Com `failFast: false`, todas as branches
  rodam até o fim e o primeiro erro é reportado.
- **`maxConcurrency`** limita quantas branches executam simultaneamente (default = nº de branches).
- **`Finish` dentro de uma branch** encerra apenas aquela branch (não a requisição).
- **Anti-loop:** o teto de **100 execuções de step por requisição** é compartilhado por todas as
  branches — o fan-out não fura o limite.

### Varredura de lista (`ForEach`)

`ForEach` é um **control step do motor** (não é uma skill de folha) que **varre uma lista** e
executa um **sub-pipeline** (`steps`) uma vez por elemento, **sequencialmente**. É o caminho
recomendado para aplicar ações (INSERTs, publicações, chamadas HTTP) sobre cada item de uma
coleção.

```yaml
- name: SalvarClientes
  kind: ForEach
  forEach:
    extractFrom: $.data        # lista resolvida contra o data atual ($, $.a.b, $var ou literal)
    breakOnFirstFail: true     # opcional (default false): aborta na 1ª falha
    putInto: $inseridos        # opcional (default: grava o array agregado no data)
    steps:                     # sub-pipeline executado por elemento (1..N)
      - name: RegistrarCliente
        kind: PostgresOperation
        postgresOperation:
          sql: "INSERT INTO clientes (nome) VALUES ($1) RETURNING id"
          parameters:
            - extractFrom: $.nome    # $.campo lê o item corrente
          putInto: $clientId
          putIntoAs: integer
        onSuccess: Continue          # encerra a iteração e avança para o próximo item
        onFailure:
          statusCode: 502
          message: "falha ao inserir cliente indice $index"
  onSuccess: Finish
  onFailure:
    statusCode: 502
    message: "não foi possivel importar os clientes"
```

Semântica e garantias:

- **Contexto do item:** cada iteração expõe o elemento como o **`data`** e o **`body`** da
  sub-sessão (então `extractFrom: $.campo` lê o item corrente), além das variáveis **`$item`**
  (elemento inteiro) e **`$index`** (índice base 0).
- **`breakOnFirstFail: true`** aborta na primeira iteração que falha e dispara o `onFailure` do
  step `ForEach`; **`false`** (default) pula o item que falhou e continua.
- **`onSuccess: Continue`** encerra o sub-pipeline da iteração corrente e avança o loop.
- **Agregação:** o `data` final de cada iteração bem-sucedida é acumulado, na ordem, num array
  gravado em `putInto` (ou no `data` quando ausente/`$`).
- **Sequencial** (ao contrário do `Parallel`) e sujeito ao mesmo teto anti-loop de 100 execuções
  de step por requisição.

---

## Ofuscação de logs (`spec.obfuscation.logs`)

Permite mascarar dados sensíveis (CPF, CNPJ, ...) nos **logs estruturados** emitidos a cada step,
evitando que valores em claro cheguem ao coletor de logs.

```yaml
spec:
  obfuscation:
    logs:
      placeholder: "********"   # opcional — padrão "********"
      patterns:
        - "\\d{3}\\.?\\d{3}\\.?\\d{3}-?\\d{2}"        # CPF
        - "\\d{2}\\.?\\d{3}\\.?\\d{3}/?\\d{4}-?\\d{2}" # CNPJ
```

- **`patterns`** são expressões regulares Go **compiladas no boot**. Uma regex inválida
  **aborta a inicialização** (o servidor HTTP não sobe).
- **`placeholder`** substitui cada trecho casado. Quando omitido, usa `"********"`.
- **Aplicação:** cada regex é aplicada à **linha de log inteira** (o registro JSON serializado),
  na ordem declarada, antes de escrever no log. Afeta apenas os logs estruturados de step — não as
  linhas de ciclo de vida (boot, hooks, workers, shutdown).
- **Atenção às âncoras:** `^...$` casam a **linha inteira**; para ofuscar valores **embutidos**
  no JSON (ex.: um CPF dentro de `vars`), use patterns **sem** âncoras (que casam substring).

---

## Modo Debug

Ative o modo debug em `spec.debug.enabled: true` para enriquecer **toda resposta HTTP**
(sucesso e falha) com um envelope `debug` contendo o contexto completo da requisição.
Útil em desenvolvimento local para diagnóstico sem precisar de logs externos.

```yaml
spec:
  debug:
    enabled: true   # default: false
```

Estrutura do campo `debug` na resposta:

```json
{
  "meuCampo": "...",
  "debug": {
    "correlationId": "<uuid>",
    "endpoint": "/aportes/APT-001",
    "method": "GET",
    "queryStringParameters": [ { "name": "page", "value": "1" } ],
    "pathParameters":        [ { "name": "codigoAporte", "value": "APT-001" } ],
    "headers":               [ { "name": "x-flow", "value": "ion-web" } ],
    "body": "{\"valor\": 500}",
    "result": "SUCCESS",
    "error": "",
    "sessionVariables": [
      { "name": "codigoAporte", "type": "string", "value": "APT-001" }
    ],
    "environmentVariables": [ { "name": "RADAHN_ADDR", "value": ":8080" } ]
  }
}
```

> **Atenção:** `environmentVariables` expõe variáveis de ambiente do processo, incluindo
> credenciais. Use **apenas em ambientes de desenvolvimento** — nunca em produção.

---

## Health-check endpoints

Três endpoints de saúde estão sempre disponíveis:

| Endpoint | Método | Propósito |
|----------|--------|-----------|
| `/healthz` | GET | Compatibilidade retroativa — sempre `200 {"status":"ok"}` |
| `/liveness` | GET | Processo vivo — sempre `200 {"status":"ok"}` |
| `/readiness` | GET | Dependências disponíveis — `200` se OK, `503` se degradado |

`/readiness` itera sobre `spec.requiredSkills` e executa:
- **Redis** (`RedisPutItem`, `RedisGetItem`, etc.) → `PING`
- **Postgres** (`PostgresQuery`, `PostgresOperation`, `DataValidation`) → `db.Ping()`
- **MySQL** (`MySqlQuery`, `MysqlOperation`) → `db.Ping()`
- **MongoDB** (`MongoQuery`, `MongoOperation`, `MongoAggregate`) → `client.Ping()`

Resposta em caso de falha:

```json
{
  "status": "degraded",
  "checks": {
    "postgres": "FAIL: pinging postgres: dial tcp ...",
    "redis": "OK"
  }
}
```

Workflows que não usam Redis/DB em `requiredSkills` retornam sempre `200`.

---

## Validação de startup

Ao carregar o `radahn.yaml`, o Radahn executa validações de configuração antes de aceitar
requisições:

- **`kind: ApplicationWorkflow`** obrigatório — qualquer outro valor falha com erro explícito.
- **`spec.routes` não vazio** — workflow sem rotas é inválido.
- **`spec.requiredSkills`** — cada skill listada deve existir no registro do motor;
  skills desconhecidas causam falha imediata com o nome exato do item inválido.
- **Kinds nos behaviors** — cada `kind:` declarado nos steps é verificado contra o
  catálogo de skills registradas; erro indica o nome e a rota do step inválido.
- **Steps `Parallel`** — a validação é recursiva: cada branch precisa de `name` único e ≥ 1 step,
  `consolidate.strategy` deve ser `object|collect|merge`, e os `kind:` internos das branches são
- **Steps `ForEach`** — validação recursiva: exige o bloco `forEach` com `extractFrom` não-vazio
  e ≥ 1 step; os `kind:` internos do sub-pipeline são validados como qualquer outro step.
  validados como qualquer outro step.
- **`spec.overlays`** — nomes de chave inválidos (fora do padrão camelCase, ≤ 64 caracteres) ou
  duplicados falham o boot; se `spec.overlays` estiver declarado, `RADAHN_ENVIRONMENT` passa a
  ser obrigatória e deve casar com um `overlays[].name`; toda ocorrência de `FROM_OVERLAY(chave)`
  no documento é resolvida e validada contra o overlay do ambiente ativo.
- **`FROM_ENV(nome)`** — toda ocorrência no documento é resolvida contra o ambiente do processo;
  se `nome` não estiver definida, o boot falha citando a variável.
- **`HttpOperation.body.type`** — `FormData`/`FormUrlEncoded`/`File` só são aceitos em
  `HttpOperation` (rejeitados em `SnsPublish`/`SqsSend`/`KafkaPublish`); `FormData`/`FormUrlEncoded`
  rejeitam `extractFrom`; `File` exige `files` não vazio, com `name`/`path` em cada item.

Isso garante que erros de configuração aparecem no startup e não apenas na primeira
requisição que ativa o step problemático.

---

## Catálogo de skills

| Skill | Propósito | Config | Env vars |
|-------|-----------|--------|----------|
| `LogicalOperator` | Avalia uma lista de condições booleanas (semântica OR entre itens; AND com `&&` dentro de cada condição). Suporta `putInto` (armazenar resultado em variável de sessão), `breakBySuccess` e `breakByFailure`. Alias retrocompat: `StaticValidation`. | `logicalOperator` | — |
| `EmptyValidation` | Falha se o resultado anterior for vazio/nulo/zero | — | — |
| `JsonValidation` | Valida input contra JSON Schema (draft 2020-12) | `jsonValidation` | — |
| `PostgresQuery` | Consulta Postgres (`$1..$n`) | `postgresQuery` | `DB_*` / `POSTGRES_DB_*` |
| `MySqlQuery` | Consulta MySQL (`$1..$n` → `?`) | `mysqlQuery` | `DB_*` / `MYSQL_DB_*` |
| `MongoQuery` | Consulta MongoDB (`Find`/`FindOne`; `filter`/`projection`/`sort`/`limit`) | `mongoQuery` | `MONGO_URI` / `MONGO_DB_*` |
| `HttpAuthorize` | Token OAuth2 client_credentials | `httpAuthorize` | `HTTP_AUTHORIZE_*` |
| `HttpSearch` | GET/OPTIONS a subsistema + extração JSONPath | `httpSearch` | — |
| `HttpOperation` | Escrita HTTP (`POST/PUT/PATCH/DELETE`) a subsistema, com corpo `Json`/`FormData`/`FormUrlEncoded`/`File` | `httpOperation` | — |
| `OutputTransformer` | Remapeia campos (`from` → `to`) | `fields` / `outputTransformer` | — |
| `MergeLocalStore` | Concatena resultados de `localStore` | `mergeLocalStore` | — |
| `MathOperator` | Expressões aritméticas de 3 tokens (`A op B`), com `roundBy`/`floor`/`ceil` | `mathOperator` | — |
| `MathDateTimeOperator` | Operações temporais (shift/comparação/diff/extração) honrando `spec.timezone` | `mathOperator` | — |
| `StringOperator` | Cadeia de transformações de string (`trim`, `lower`, `upper`, `substring`, `replace`, `regexReplace`, `regexExtract`, `lpad`, `rpad`, `split`, `contains`) | `stringOperator` | — |
| `JsonTransformer` | Cadeia de transformações sobre coleções/objetos JSON: arrays (`filter`, `map`, `sort`, `limit`, `offset`, `slice`, `distinct`, `reverse`, `pluck`, `flatten`, `groupBy`), agregação (`aggregate`, `count`) e objeto (`pick`, `omit`, `rename`, `set`, `merge`, `unwrap`) | `jsonTransformer` | — |
| `Parallel` | **Control step** (não é skill de folha): executa branches concorrentes e consolida (`object`/`collect`/`merge`). Ver [Execução paralela](#execução-paralela-parallel) | `parallel` | — |
| `ForEach` | **Control step** (não é skill de folha): varre uma lista e executa um sub-pipeline por item (sequencial), agregando os resultados. Ver [Varredura de lista](#varredura-de-lista-foreach) | `forEach` | — |
| `HttpStatusCodeResult` | Encerra com status HTTP customizado + corpo opcional | `httpStatusCodeResult` | — |
| `HttpProblemDetailsResponse` | Emite resposta de erro HTTP com status, headers e corpo arbitrário (RFC 9457) | `httpProblemDetailsResponse` | — |
| `DataValidation` | Valida um dado contra o datastore (SQL ou DynamoDB) via `condition` | `dataValidation` | `DB_*` / `POSTGRES_DB_*` · `AWS_*` |
| `PostgresOperation` | `INSERT`/`UPDATE`/`DELETE` no Postgres (com `RETURNING`) | `postgresOperation` | `DB_*` / `POSTGRES_DB_*` |
| `MysqlOperation` | `INSERT`/`UPDATE`/`DELETE` no MySQL (com `LAST_INSERT_ID()`) | `mysqlOperation` | `DB_*` / `MYSQL_DB_*` |
| `MongoOperation` | `insertOne`/`insertMany`/`updateOne`/`updateMany`/`deleteOne`/`deleteMany`/`findOneAndUpdate` no MongoDB; `parameters` mescla campos da requisição no `document`/`$set` | `mongoOperation` | `MONGO_URI` / `MONGO_DB_*` |
| `MongoAggregate` | Pipeline de agregação MongoDB (`$match`/`$group`/`$sort`/...) | `mongoAggregate` | `MONGO_URI` / `MONGO_DB_*` |
| `SnsPublish` | Publica mensagem em um tópico SNS (AWS SDK v2) | `snsPublish` | `AWS_*` · `SNS_ENDPOINT` |
| `SqsSend` | Envia mensagem a uma fila SQS (AWS SDK v2) | `sqsSend` | `AWS_*` · `SQS_ENDPOINT` |
| `SqsGetMessages` | Recebe (faz *poll*) mensagens de uma fila SQS via `ReceiveMessage`; grava `[{messageId,receiptHandle,body}]` em `data` | `sqsGetMessages` | `AWS_*` · `SQS_ENDPOINT` |
| `SqsDeleteMessage` | Remove **uma** mensagem da fila SQS via `DeleteMessage` (por `receiptHandle`) — permite deletar **somente após o processamento** | `sqsDeleteMessage` | `AWS_*` · `SQS_ENDPOINT` |
| `CloudwatchMetric` | Publica métrica custom (`PutMetricData`) no CloudWatch | `cloudwatchMetric` | `AWS_*` · `CLOUDWATCH_ENDPOINT` |
| `AwsSendMessage` | Envia mensagem para **SQS ou SNS** (Standard/FIFO) | `awsSqsSendMessage` | `AWS_*` · `SQS_ENDPOINT`/`SNS_ENDPOINT` |
| `AwsDynamoPutItem` | Persiste um item em uma tabela DynamoDB | `awsDynamoPutItem` | `AWS_*` · `DYNAMODB_ENDPOINT` |
| `AwsDynamoGetItem` | Consulta um item por chave primária | `awsDynamoGetItem` | `AWS_*` · `DYNAMODB_ENDPOINT` |
| `AwsDynamoUpdateItem` | Atualiza um item via `UpdateExpression` | `awsDynamoUpdateItem` | `AWS_*` · `DYNAMODB_ENDPOINT` |
| `AwsDynamoDeleteItem` | Remove um item por chave primária | `awsDynamoDeleteItem` | `AWS_*` · `DYNAMODB_ENDPOINT` |
| `AwsDynamoQuery` | Consulta itens via `KeyConditionExpression` | `awsDynamoQuery` | `AWS_*` · `DYNAMODB_ENDPOINT` |
| `S3CheckBucketExists` | Verifica se um bucket existe (`HeadBucket`); ausência é falha normal (`onFailure`), não erro de infraestrutura | `s3CheckBucketExists` | `AWS_*` · `S3_ENDPOINT` |
| `S3UploadObject` | Envia um objeto (`PutObject`); `body` aceita `$var`/JSONPath (string/`[]byte`) ou caminho de arquivo local; `multipartUpload` habilita upload em partes via `feature/s3/manager` | `s3UploadObject` | `AWS_*` · `S3_ENDPOINT` |
| `S3DeleteObject` | Remove um objeto (`DeleteObject`) | `s3DeleteObject` | `AWS_*` · `S3_ENDPOINT` |
| `S3CopyObject` | Copia um objeto (`CopyObject`); `copySource` é relativo ao mesmo `bucketName` por padrão, ou a `sourceBucket` quando informado | `s3CopyObject` | `AWS_*` · `S3_ENDPOINT` |
| `S3GetObject` | Lê um objeto (`GetObject`) e grava o conteúdo em `putInto` (string); `saveToFile` opcionalmente persiste em disco | `s3GetObject` | `AWS_*` · `S3_ENDPOINT` |
| `S3ListObjects` | Lista objetos por `prefix` (`ListObjectsV2`); grava `[{key,size,lastModified}]` em `data`/`putInto` | `s3ListObjects` | `AWS_*` · `S3_ENDPOINT` |
| `S3PresignUrl` | Gera uma URL pré-assinada (`GetObject`) válida por `expiration` (default 15m) | `s3PresignUrl` | `AWS_*` · `S3_ENDPOINT` |
| `RedisPutItem` | Salva um valor em uma chave com TTL opcional (minutos) | `redisPutItem` | `REDIS_*` |
| `RedisGetItem` | Lê um valor por chave para uma variável (parse JSON opcional) | `redisGetItem` | `REDIS_*` |
| `RedisIncrementItem` | Incrementa atomicamente um contador inteiro (`INCRBY`) | `redisIncrementItem` | `REDIS_*` |
| `RedisDeleteItem` | Remove uma chave (`DEL`) | `redisDeleteItem` | `REDIS_*` |
| `KafkaPublish` | Produz **uma** mensagem (produtor síncrono) para um tópico; `encode` `raw`/`json`/`avro`; schema Avro por `schemaUrl` (baixado e cacheado) > `schemaFile` > `schema`; captura `{partition, offset}` | `kafkaPublish` | `KAFKA_<NOME>_*` · `KAFKA_SR_*` |
| `KafkaConsume` | Faz *poll* de um lote de um *consumer group*; grava `[{topic,partition,offset,key,value,headers,timestamp,schemaId}]` em `data`; `decode` `raw`/`json`/`avro` (suporta tópicos multi-schema); `autoCommit` e `onError` (`fail`/`commit`/`ignore`/`discard`) são **obrigatórios** | `kafkaConsume` | `KAFKA_<NOME>_*` · `KAFKA_SR_*` |
| `KafkaAck` | Comita o offset de **um** registro (use em `ForEach` sobre `KafkaConsume` p/ *at-least-once*) | `kafkaAck` | `KAFKA_<NOME>_*` |
| `KafkaCertDownload` | Emite/baixa o certificado de cliente p/ o diretório de `KAFKA_CERT_PATH` (default `/tmp`, típico em `onStart`); `profile` `http` (GET genérico) ou `kaas` (contrato **KCert v2**, que também publica `KAFKA_<CLUSTER>_TLS_CERT/_KEY/_CA`) | `kafkaCertDownload` | `KAFKA_CERT_*` |
| `Command` | Executa linhas de shell (`sh -c`/`cmd /c`); exit != 0 ou timeout falha o step | `command` | — |
| `UnzipFile` | Extrai um zip de `from` para o diretório `to` (protegido contra zip-slip) | `unzipFile` | — |
| `CsvReader` | Lê um `.csv` para `data` como array de `map[string]interface{}` (header sempre resolve os nomes de coluna); `strategy` `ReadAll`/`ReadLine` (mesmo resultado, só varia a estratégia interna de leitura); `filterFields` seleciona colunas por nome | `csvReader` | — |
| `CsvWriter` | Grava um array de registros (`items`) em um `.csv`; header explícito (`header`) ou inferido do 1º item; `append` controla sobrescrever (default) vs. acrescentar | `csvWriter` | — |
| `CsvFieldMapper` | Renomeia/tipa (`as: string\|integer\|decimal\|boolean`) ou deriva (`value`) campos de registros já carregados (ex.: saída de `CsvReader`) | `csvFieldMapper` | — |
| `CsvAggregator` | Agrupa registros por `groupBy` e aplica `sum`/`count`/`avg`/`min`/`max` por grupo | `csvAggregator` | — |
| `CsvRowFilter` | Filtra registros por uma condição de 3 tokens (`field op value`) | `csvRowFilter` | — |

> `Command` e `UnzipFile` são **skills de sistema**, pensadas para os [hooks de ciclo de vida](#hooks-de-ciclo-de-vida-spechooks),
> mas também podem ser usadas em rotas.

> `CsvReader`, `CsvWriter`, `CsvFieldMapper`, `CsvAggregator` e `CsvRowFilter` compõem as
> **skills CSV** — ver [Skills CSV](#skills-csv) para exemplos completos de uso encadeado.

> As skills de escrita e as skills AWS compõem o **suporte a operações de escrita** (ver
> [Operações de escrita](#operações-de-escrita-postputpatchdelete)). Elas aceitam a política
> transversal `retry` e reutilizam a interpolação de variáveis / JSONPath.

### `StaticValidation`

A expressão descreve a **condição de erro**: se ela for **verdadeira**, o step falha.

```yaml
- name: ValidarDataInicial
  correlatedFields: [ dataInicial, dataFinal ]
  kind: StaticValidation
  staticValidation: $dataInicial > $dataFinal   # se verdadeiro → onFailure
  onSuccess: NextStep
  onFailure:
    statusCode: 400
    message: "dataInicial não pode ser superior a dataFinal"
```

Operadores: `>`, `<`, `>=`, `<=`, `==` e aliases `gt`, `lte`. Operandos numéricos,
datas (vários formatos ISO) ou strings.

### `EmptyValidation`

```yaml
- name: ValidarClienteInexistente
  kind: EmptyValidation
  onSuccess: NextStep
  onFailure:
    status: 404
    message: "cliente $codigoCliente inexistente"
```

Falha quando o resultado do step anterior é `nil`, `""`, `0`, array vazio ou objeto vazio.

### `JsonValidation`

```yaml
- name: ValidacaoJson
  kind: JsonValidation
  jsonValidation: |-
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "required": ["codigoCliente", "nomeCliente"],
      "properties": {
        "codigoCliente": { "type": "string", "format": "uuid" },
        "nomeCliente":   { "type": "string", "minLength": 1 }
      }
    }
  onSuccess: NextStep
  onFailure:
    statusCode: 422
    message: $jsonValidationErrors   # variável gerada com os detalhes dos erros
```

### `PostgresQuery` / `MySqlQuery`

```yaml
- name: ConsultaAportes
  kind: PostgresQuery
  postgresQuery:
    resultType: Array          # "Array" (várias linhas) ou "Item" (uma linha/objeto)
    sql: "SELECT * FROM aportes WHERE cliente_id = $1 AND data_aporte BETWEEN $2 AND $3"
    parameters:
      - $codigoCliente
      - $dataInicial
      - $dataFinal
  onSuccess: NextStep
  onFailure:
    statusCode: 500
    message: "erro ao consultar aportes"
```

`MySqlQuery` é idêntica, trocando o bloco por `mysqlQuery`. Ambas usam as env vars de
conexão (ver [Variáveis de ambiente](#variáveis-de-ambiente)).

### `MongoQuery` / `MongoOperation` / `MongoAggregate`

Ver [Skills MongoDB](#skills-mongodb) para o detalhamento completo (semântica de cada
`action`, resolução de `$var` vs. referências de campo do Mongo) e exemplos YAML encadeados.

### `HttpAuthorize`

```yaml
- name: AutenticacaoSts
  kind: HttpAuthorize
  httpAuthorize:
    extractResult: $.access_token   # JSONPath para extrair o token
    putInto: $accessToken           # variável que recebe o token
  onSuccess: NextStep
  onFailure:
    status: 500
    message: "ocorreu um erro interno inesperado"
```

Faz `POST` OAuth2 `client_credentials` para `HTTP_AUTHORIZE_URL` (form-encoded) e
disponibiliza o token para os próximos steps.

### `HttpSearch`

```yaml
- name: PosicaoPrevidenciaFechada
  kind: HttpSearch
  httpSearch:
    url: http://subsistema/v1/posicoes/$codigoCliente
    bearerToken: $accessToken       # opcional (Authorization: Bearer ...)
    method: GET                     # GET ou OPTIONS
    headers:                        # opcional
      - name: X-Custom
        value: $variavel
    extractResult: $.data.posicoes  # JSONPath do resultado
    # putInto: $posicoes            # opcional: também guarda em variável
  onSuccess: NextStep
  onFailure:
    status: 500
    message: "erro ao obter posições"
```

### `OutputTransformer`

Remapeia campos do input para um novo formato. Aceita `fields` ou `outputTransformer`.
Aplica-se a um objeto (`Item`) ou a cada elemento de um array (`Array`).

```yaml
- name: TransformarAportes
  kind: OutputTransformer
  fields:
    - { from: cliente_id,            to: codigoCliente }
    - { from: carteira_id,           to: carteiraId }
    - { from: valor_aporte_engajado, to: valorAporte }
  onSuccess: Finish
```

`from`/`to` aceitam chave simples (`cliente_id`) ou JSONPath pontuado (`$.data.cliente_id`).

### `MergeLocalStore`

Ver [`localStore` e agregação multifonte](#localstore-e-agregação-multifonte).

### `MathOperator`

Avalia uma lista ordenada de expressões aritméticas de **exatamente 3 tokens** (`A op B`),
gravando cada resultado em `putInto`. Operadores: `+`, `-`, `*`, `/` e `**` (potência).
Os operandos são `$var`, `$.jsonpath` do corpo ou literais numéricos (números negativos
exigem espaço explícito, ex.: `10 + -5`).

```yaml
- name: CalcularValorTotalPedido
  kind: MathOperator
  mathOperator:
    putIntoAs: decimal        # decimal (padrão) ou integer
    expressions:
      - expression: "$quantidade * $precoUnitario"
        putInto: $totalPedidoSemDesconto
      - expression: "$totalPedidoSemDesconto * 0.5"
        putInto: $valorDesconto
      - expression: "$totalPedidoSemDesconto - $valorDesconto"
        putInto: $totalPedido
        roundBy: 2            # roundBy | floor | ceil (mutuamente exclusivos)
  onSuccess: NextStep
  onFailure: { statusCode: 400, message: "erro no cálculo" }
```

- Expressões com **mais de 3 tokens** (ex.: `(25 + 75) / 4`) **falham no start** — quebre-as
  em múltiplas expressões encadeadas via `putInto`.
- `roundBy` (N casas decimais), `floor` e `ceil` são **mutuamente exclusivos** por expressão;
  informar mais de um **falha no start**.
- `putIntoAs` converte o resultado para `decimal` (padrão) ou `integer`.
- Operando que não converte para número em runtime dispara `onFailure`.

### `MathDateTimeOperator`

Executa cálculos temporais sobre uma data-base (`extractFrom`), usando o mesmo bloco
`mathOperator:`. Respeita `spec.timezone` (padrão UTC). `extractFrom` aceita `$var`,
`$.jsonpath`, literal ou a constante `DATETIME_NOW`.

```yaml
- name: AdicionaTempoPlano
  kind: MathDateTimeOperator
  mathOperator:
    extractFrom: $dataAdesao
    addYears: 10              # add* aceitam negativos e acumulam
    putInto: $dataVencimento
  onSuccess: NextStep
  onFailure: { statusCode: 400, message: "erro de data" }
```

- **Deslocamentos** (acumulam, podem ser negativos): `addYears`, `addHours`, `addMinutes`,
  `addSeconds`, `addMiliseconds`.
- **Comparações** (→ booleano): `beforeThan`, `afterThan`, `equals`.
- **Diferença** (→ segundos, base − operando): `diffThan`.
- **Extração de componente** (→ inteiro): `extractYears`, `extractHours`, `extractMinutes`,
  `extractSeconds`, `extractMiliseconds`.
- Saída de data: string `YYYY-MM-DD HH:MM:SS` por padrão, ou **unix seconds** com
  `putIntoAs: UNIXTIME`.
- Data inválida em runtime dispara `onFailure`.

### `StringOperator`

Executa uma cadeia de transformações de string sobre um valor (`extractFrom`), gravando o resultado
em `putInto` e/ou mantendo-o no `data` do pipeline. Operações processam **runas UTF-8**. Valores
inexistentes são tratados como string vazia.

```yaml
- name: NormalizaNome
  kind: StringOperator
  stringOperator:
    extractFrom: $.nome
    putInto: $nomeNormalizado
    operations:
      - function: trim
      - function: lower
      - function: substring
        args: [0, 30]
      - function: lpad
        args: [10, "0"]
  onSuccess: NextStep
```

**Campos e funções:**

- `extractFrom`: `$var`, `$.jsonpath` ou literal. Se ausente/`nil`, inicia como string vazia.
- `putInto` (opcional): grava o resultado final em variável de sessão.
- `operations`: lista ordenada; a saída de uma operação é a entrada da próxima.
- Sem argumentos: `trim`, `lower`, `upper`.
- `substring`: `[start, end]` — índices em runas; valores fora do intervalo ou negativos são truncados para os limites válidos.
- `replace`: `[old, new]` — substitui todas as ocorrências de `old` por `new`.
- `regexReplace`: `[pattern, replacement]` — substitui todas as ocorrências da regex.
- `regexExtract`: `[pattern, group]` — retorna o grupo `$group` do primeiro match; se inexistente, retorna `""`.
- `lpad` / `rpad`: `[targetLength, padString]` — preenche com a primeira runa de `padString` até atingir `targetLength`.
- `split`: `[delimiter]` — retorna `[]interface{}`.
- `contains`: `[substring]` — retorna `true`/`false`.
- Função desconhecida ou número de argumentos incorreto dispara `onFailure`.

### `JsonTransformer`

Executa uma **cadeia de operações** sobre coleções/objetos JSON, complementando o
`OutputTransformer` (que apenas remapeia campos) com filtragem, ordenação, agrupamento,
agregação e projeção. A entrada é resolvida por `extractFrom` **contra o `data` atual do
pipeline** (não contra o corpo da requisição); a saída de cada operação é a entrada da
próxima e o **tipo pode mudar** ao longo da cadeia (ex.: `groupBy` transforma array em objeto).

```yaml
- name: processarFundos
  kind: JsonTransformer
  jsonTransformer:
    extractFrom: $.fundos          # "$"/vazio = data inteiro · $.path = JSONPath no data · $var = variável
    putInto: $fundosAtivos         # opcional: também captura o resultado em variável
    operations:
      - function: filter
        args: { where: "$.ativo == true" }
      - function: sort
        args: { by: nome, order: asc }
      - function: map
        args:
          fields:
            - { from: codigo, to: id }
            - { from: nome,   to: descricao }
      - function: limit
        args: 10
  onSuccess: NextStep
  onFailure: { statusCode: 500, message: "falha ao processar fundos" }
```

**Resolução de `extractFrom`:** `""`/`"$"` → `data` inteiro · `"$.a.b"` → JSONPath no `data` ·
`"$nome"` → variável de sessão · caso contrário → literal.

**Operações de array:**

| `function` | `args` | O que faz |
|------------|--------|-----------|
| `filter` | `{ where: "$.campo op valor" }` | Mantém elementos onde a condição de 3 tokens é verdadeira |
| `map` / `project` | `{ fields: [{from,to}] }` | Projeta/renomeia cada elemento (semântica do `OutputTransformer`; descarta campos não listados) |
| `sort` | `{ by: campo, order: asc\|desc }` | Ordena por um campo (numérico/temporal/lexical); `by` vazio ordena pelo próprio elemento |
| `limit` | `<int>` | Mantém os N primeiros |
| `offset` / `skip` | `<int>` | Descarta os N primeiros |
| `slice` | `{ start, end }` | Recorta o array (`end` opcional = fim) |
| `distinct` | `<campo>` (opcional) | Remove duplicatas (por campo, ou pelo valor inteiro se ausente) |
| `reverse` | — | Inverte a ordem |
| `pluck` | `<campo>` | Extrai um campo → array de escalares |
| `flatten` | — | Achata arrays aninhados em um nível |
| `groupBy` | `<campo>` | Agrupa em `{ "<valor>": [ ...elementos ] }` |

**Operações de agregação (array → objeto/escalar):**

| `function` | `args` | Saída |
|------------|--------|-------|
| `aggregate` | `{ ops: [{fn: sum\|avg\|min\|max\|count, field, to}] }` | Objeto `{ to: valor }` |
| `count` | — | Escalar (int) |

**Operações de objeto:**

| `function` | `args` | O que faz |
|------------|--------|-----------|
| `pick` | `[campo, ...]` | Mantém apenas essas chaves |
| `omit` | `[campo, ...]` | Remove essas chaves |
| `rename` | `{ fields: [{from,to}] }` | Renomeia chaves (preserva as demais) |
| `set` | `{ to, value\|extractFrom\|calculateBy }` | Adiciona/sobrescreve um campo (mesmas fontes de valor das skills de escrita) |
| `merge` | `$var` / objeto | Merge raso de outro objeto |
| `unwrap` | `<campo>` | Promove um objeto aninhado para a raiz |

**Regras:**

- No `filter`, `$.campo` refere-se ao **elemento** corrente; `$nome` a uma **variável de sessão**; o restante é literal.
- Função desconhecida, `args` inválido ou **tipo incompatível** (ex.: `sort` sobre objeto) disparam `onFailure`.
- Uma coleção vazia é um resultado válido (segue `onSuccess`).

### `HttpStatusCodeResult`

Encerra a rota com um **status HTTP customizado** e um **corpo opcional**. Resolve o Bug
histórico em que todo sucesso retornava `200`: agora é possível devolver `201`, `202`, `204`, etc.

```yaml
# Com corpo customizado (ex.: 202 Accepted)
- name: ResultadoAporte
  kind: HttpStatusCodeResult
  httpStatusCodeResult:
    statusCode: 202
    body: { resultado: $aporteRegistrado, mensagem: "aporte realizado com sucesso" }
  onSuccess: Finish

# Sem corpo (ex.: 204 No Content)
- name: ResultadoAporte
  kind: HttpStatusCodeResult
  httpStatusCodeResult:
    statusCode: 204
  onSuccess: Finish
```

**Campos:**
- `statusCode`: status HTTP de sucesso (`0`/ausente = `200`).
- `body` (opcional): corpo da resposta. Escalares que são exatamente `$var` ou `$.jsonpath`
  preservam o **tipo nativo**; `$vars` embutidos em strings são interpolados; mapas/listas
  aninhados são reconstruídos recursivamente.
- Status sem corpo (`204`, `304`, `1xx`) sempre respondem **sem payload**, mesmo com `body`.
- Deve encerrar com `onSuccess: Finish`.

### `HttpProblemDetailsResponse`

Emite uma **resposta de erro HTTP** com status customizado, headers, `Content-Type` e corpo arbitrário.
Compatível com RFC 9457 quando o autor montar o `body` com `type`, `title`, `status`, `detail`, `instance`, etc.

```yaml
- name: ErroValidacao
  kind: HttpProblemDetailsResponse
  httpProblemDetailsResponse:
    statusCode: 400
    contentType: application/problem+json   # opcional
    parameters:
      - name: dataHora
        calculateBy: DATETIME_NOW
      - name: requestId
        calculateBy: GENERATE_NEW_UUID_V4
    headers:
      - name: X-Request-Id
        value: "$requestId"
    body:
      type: "about:blank"
      title: "Bad Request"
      status: 400
      detail: "$mensagemErro"
      timestamp: "$dataHora"
  onSuccess: Finish
```

**Campos:**
- `statusCode`: status HTTP de erro (`100..599`). Aceita literal, `$var` ou path param `int`.
- `contentType`: `Content-Type` da resposta (padrão `application/problem+json`).
- `parameters`: lista de `OpParameter` resolvidos para variáveis (`$nome`) usadas no `body`/`headers`.
- `headers`: lista de `OpParameter` escritos como headers HTTP (protegido contra injeção de `\r\n`).
- `body`: corpo arbitrário. Escalares `$var`/`$.jsonpath` preservam tipo; `$vars` embutidos são interpolados; mapas/listas são reconstruídos recursivamente.
- Deve encerrar com `onSuccess: Finish`.

---

## Operações de escrita (POST/PUT/PATCH/DELETE)

Além das rotas de leitura, o Radahn interpreta **operações de escrita** de forma declarativa.
Em rotas de escrita, o **corpo JSON** da requisição é lido e fica disponível para
interpolação via JSONPath (`$.campo`, `$.a.b`). Os parâmetros das skills de escrita usam
uma fonte de valor explícita:

| Campo do parâmetro | Origem do valor |
|--------------------|-----------------|
| `value` | literal ou `$var` do pipeline |
| `extractFrom` | JSONPath no corpo (`$.a.b`) **ou** `$var` |
| `calculateBy` | função de cálculo (`GENERATE_NEW_UUID_V4`, `DATETIME_NOW`) |

`putInto` grava o resultado em uma variável; `putIntoAs` converte o tipo
(`integer`, `decimal`, `string`, `boolean`). `condition` é uma expressão booleana de
aprovação (`$x op $y`); quando falsa, dispara `onFailure`.

### Manifesto, correlationId, retry e logs

```yaml
apiVersion: worflows.workflow.radahn.com/v1alpha   # cabeçalho no estilo Kubernetes
kind: ApplicationWorkflow
metadata:
  name: aportes-api
  namespace: investimentos
spec:
  timezone: "America/Sao_Paulo"            # opcional — timezone IANA dos cálculos temporais (padrão UTC)
  correlationId:
    calculateBy: GENERATE_NEW_UUID_V4       # OU headerName: X-Correlation-Id (exclusivos)
  # ...
```

- **`timezone`**: timezone IANA (ex.: `America/Sao_Paulo`) honrada pelas skills de cálculo
  temporal (`MathDateTimeOperator`). Quando ausente ou inválida, o motor usa **UTC**.
- **`correlationId`**: gerado por `calculateBy` **ou** lido de um header (`headerName`) — os
  dois campos são mutuamente exclusivos.
- **`retry`** (por step): política transversal de *exponential backoff*. Para skills HTTP,
  `filterStatus` restringe o retry aos status listados.
- **Logs estruturados**: **todo** log sai em JSON de uma linha (`tool`, `level`, `timestamp`
  RFC3339). Cada evento de skill emite uma linha com `correlationId`, `source`, `message`,
  `skillContent` e `skillContext`; boot/hooks/workers/shutdown emitem linhas com `component`,
  `phase`, `worker`, etc. Detalhes em [`docs/HOW-TO-OBSERVE.md`](docs/HOW-TO-OBSERVE.md).

> **Fora de escopo deste release:** transações/rollback em pipelines multi-escrita, e a
> configuração de exporters/endpoints OTLP + mascaramento de dados sensíveis nos logs.

### `JsonValidation` por arquivo

```yaml
- name: ValidarPayload
  kind: JsonValidation
  jsonValidation:
    schemaPath: aporte.schema.json   # relativo ao diretório de RADAHN_CONFIG
    putSuccessInto: $payloadValido
    putFailureInto: $erroSchema
  onSuccess: NextStep
  onFailure:
    statusCode: 422
    message: "payload inválido: $erroSchema"
```

> A forma antiga (schema inline como string) continua suportada por retrocompatibilidade.

### `DataValidation`

```yaml
- name: ValidarClienteExiste
  kind: DataValidation
  dataValidation:
    source: sql                       # "sql" (default) | "dynamodb"
    sql: "SELECT count(1) FROM cliente WHERE cliente_id = $1"
    parameters:
      - extractFrom: $codigoCliente
    putInto: $qtdCliente
    putIntoAs: integer
    condition: $qtdCliente > 0         # falso → onFailure
  onSuccess: NextStep
  onFailure:
    statusCode: 404
    message: "cliente $codigoCliente inexistente"
```

Para `source: dynamodb`, use o bloco `dynamodb` (`table`, `key`, `field`); as credenciais
vêm das variáveis `AWS_*` (e `DYNAMODB_ENDPOINT` opcional para DynamoDB Local).

### `PostgresOperation` / `MysqlOperation`

```yaml
- name: RegistrarAporte
  kind: PostgresOperation
  postgresOperation:
    sql: "INSERT INTO aportes (cliente_id, carteira_id, data_aporte, valor_aporte_engajado) VALUES ($1, $2, $3, $4) RETURNING id"
    parameters:
      - extractFrom: $codigoCliente
      - extractFrom: $.carteiraId
      - calculateBy: DATETIME_NOW
      - extractFrom: $.valorAporte
    putInto: $aporteId
    putIntoAs: integer
  onSuccess: NextStep
  onFailure:
    statusCode: 500
    message: "erro ao registrar aporte"
```

`MysqlOperation` usa o bloco `mysqlOperation` (placeholders `$1..$n` reescritos para `?`;
`INSERT` captura `LAST_INSERT_ID()`).

### `HttpOperation`

```yaml
- name: NotificarSubsistema
  kind: HttpOperation
  httpOperation:
    method: POST
    url: http://subsistema/v1/aportes/notificacoes
    authentication:
      bearerToken: $accessToken       # opcional
    headers:                          # opcional
      - name: X-Idempotency-Key
        calculateBy: GENERATE_NEW_UUID_V4
    body:
      type: Json
      properties:
        - name: aporteId
          extractFrom: $aporteId
        - name: registradoEm
          calculateBy: DATETIME_NOW
    extractResult: $
    putInto: $notificacao
  retry:
    maxRetries: 3
    initialDelay: "200ms"
    multiplier: 2.0
    jitter: true
    filterStatus: [502, 503, 504]
  onSuccess: Finish
  onFailure:
    statusCode: 502
    message: "falha ao notificar o subsistema"
```

**Corpo opaco (`body.extractFrom`)** — `properties` monta um objeto campo a campo; quando o corpo
**já é** o documento que se quer enviar (um registro consumido do Kafka, a resposta de outro step),
use `extractFrom` para postá-lo **na raiz**, sem envelope:

```yaml
body:
  type: Json
  extractFrom: $.value      # $var ou $.jsonpath; o valor resolvido vira o corpo inteiro
```

`extractFrom` e `properties` são **mutuamente exclusivos** no mesmo bloco `body` (declarar os dois
falha o boot). O valor resolvido pode ser objeto ou array; um valor vazio/nulo falha o step em vez
de enviar `null` silenciosamente. O mesmo bloco `body` vale para `KafkaPublish` e `AwsSendMessage`.

**`body.type: FormData` / `FormUrlEncoded` / `File`** — exclusivos de `HttpOperation` (não
suportados por `SnsPublish`/`SqsSend`/`KafkaPublish`), para enviar `multipart/form-data`,
`application/x-www-form-urlencoded` ou upload de arquivo(s):

```yaml
# multipart/form-data — properties vira campos de formulário
- name: CriarRecurso
  kind: HttpOperation
  httpOperation:
    method: POST
    url: https://api.exemplo.com/recursos
    body:
      type: FormData
      properties:
        - name: nome
          extractFrom: $.nome
        - name: valor
          extractFrom: $.valor
    extractResult: $.id
    putInto: $recursoId
  onSuccess: NextStep
  onFailure: { statusCode: 502, message: "erro ao criar recurso" }

# application/x-www-form-urlencoded — mesma forma de properties
- name: CriarRecursoUrlEncoded
  kind: HttpOperation
  httpOperation:
    method: POST
    url: https://api.exemplo.com/recursos
    body:
      type: FormUrlEncoded
      properties:
        - name: nome
          extractFrom: $.nome
        - name: valor
          extractFrom: $.valor

# upload de arquivo(s) — files é obrigatório; properties é opcional (campos de
# texto combinados no mesmo multipart)
- name: CriarRecursoComAnexos
  kind: HttpOperation
  httpOperation:
    method: POST
    url: https://api.exemplo.com/recursos
    body:
      type: File
      properties:
        - name: descricao
          value: "anexos do cliente"
      files:
        - name: anexo1            # nome do campo multipart
          path: /tmp/recursos/xpto.md
        - name: anexo2
          path: /tmp/recursos/optx.md
```

- `FormData`/`FormUrlEncoded` só suportam `properties` (`extractFrom` na raiz não é
  suportado, pois não há como serializar um objeto arbitrário como campos de formulário).
- `File` exige `files` não vazio; cada item precisa de `name` (campo multipart) e `path`
  (caminho do arquivo no filesystem onde o processo do Radahn está rodando). `properties`
  é opcional e vira campos de texto no mesmo multipart.
- O header `Content-Type` é calculado automaticamente por tipo
  (`application/x-www-form-urlencoded`, ou `multipart/form-data; boundary=...` para
  `FormData`/`File`). Se `headers` declarar um `Content-Type` customizado, o valor
  informado é respeitado como base, mas o `boundary` real é sempre acrescentado
  automaticamente — sem ele, o servidor de destino não conseguiria decodificar o
  multipart.

### Skills AWS (`SnsPublish`, `SqsSend`, `CloudwatchMetric`)

Usam o **AWS SDK for Go v2**. Credenciais e região vêm da cadeia padrão da AWS
(variáveis `AWS_*`, perfis, IAM role) — **nunca do YAML**. Para emuladores locais
(LocalStack, DynamoDB Local), defina `AWS_ENDPOINT_URL` ou o override por serviço
(`DYNAMODB_ENDPOINT`, `SNS_ENDPOINT`, `SQS_ENDPOINT`, `CLOUDWATCH_ENDPOINT`).

```yaml
# SNS — publicar em um tópico
- name: PublicarEventoAporte
  kind: SnsPublish
  snsPublish:
    topicArn: arn:aws:sns:us-east-1:123456789012:aportes-eventos
    subject: "Novo aporte"
    body:                       # OU: message: "texto simples com $var"
      type: Json
      properties:
        - name: aporteId
          extractFrom: $aporteId
        - name: clienteId
          extractFrom: $codigoCliente
    putInto: $snsMessageId
  onSuccess: NextStep
  onFailure: { statusCode: 502, message: "falha ao publicar no SNS" }

# SQS — enviar para uma fila (FIFO opcional)
- name: EnfileirarProcessamento
  kind: SqsSend
  sqsSend:
    queueUrl: https://sqs.us-east-1.amazonaws.com/123456789012/aportes.fifo
    messageGroupId: aportes
    messageDeduplicationId: $aporteId
    body:
      type: Json
      properties:
        - name: aporteId
          extractFrom: $aporteId
    putInto: $sqsMessageId
  onSuccess: NextStep
  onFailure: { statusCode: 502, message: "falha ao enfileirar no SQS" }

# CloudWatch — publicar métrica custom
- name: RegistrarMetricaAporte
  kind: CloudwatchMetric
  cloudwatchMetric:
    namespace: Radahn/Aportes
    metricName: AportesRegistrados
    value: "1"                  # literal ou $var (convertido para número)
    unit: Count
    dimensions:
      - name: Ambiente
        value: producao
      - name: Carteira
        extractFrom: $.carteiraId
  onSuccess: Finish
  onFailure: { statusCode: 500, message: "falha ao publicar métrica" }
```

### `AwsSendMessage` (SQS / SNS, Standard e FIFO)

Skill única para envio de mensagens. `type` seleciona o serviço (`SQS` ou `SNS`); `queue` é a
**URL da fila** (SQS) ou o **nome/ARN do tópico** (SNS — o nome é resolvido para ARN via
`CreateTopic`, idempotente). `message` é resolvido por JSONPath/`$var`; se apontar para um
objeto/array, é serializado como string JSON automaticamente. FIFO exige `fifoOptions`.

```yaml
# SQS Standard
- name: EnviaEmailCliente
  kind: AwsSendMessage
  awsSqsSendMessage:
    type: SQS
    queue: https://sqs.sa-east-1.amazonaws.com/611521750000/email-confirmacao-aporte
    message: $.emailContent        # objeto → enviado como string JSON
  onSuccess: NextStep
  onFailure: NextStep

# SNS Standard (nome do tópico resolvido para ARN)
- name: EnviaEmailCliente
  kind: AwsSendMessage
  awsSqsSendMessage:
    type: SNS
    queue: topic-email-confirmacao-aporte
    message: $.emailContent
  onSuccess: NextStep
  onFailure: NextStep

# SQS FIFO
- name: EnviaEmailCliente
  kind: AwsSendMessage
  awsSqsSendMessage:
    type: SQS
    queue: https://sqs.sa-east-1.amazonaws.com/611521750000/email-confirmacao-aporte.fifo
    message: $.emailContent
    fifoOptions:
      groupId: $.segmentClientId
      deduplicationId: $codigoCliente
  onSuccess: NextStep
  onFailure:
    statusCode: 500
    message: "ocorreu um erro inesperado ao tentar enviar email para o cliente"
```

### Skills DynamoDB (`AwsDynamoPutItem` / `GetItem` / `UpdateItem` / `DeleteItem` / `Query`)

Todas usam o **AWS SDK v2** (`attributevalue` para (un)marshal). `key` é o **valor** da chave
de partição; o nome do atributo é `keyName` (padrão `id`). `expressionValues` tipa valores
literais automaticamente (`true`→bool, `42`→número); use `extractFrom`/`value`/`calculateBy`.

```yaml
# PutItem — persiste um objeto (do corpo/JSONPath) na tabela
- name: SalvarCertificado
  kind: AwsDynamoPutItem
  awsDynamoPutItem:
    table: clientes-certificados
    item: $.data.cliente.certificados[0]
  onSuccess: NextStep
  onFailure: { statusCode: 500, message: "ocorreu um erro inesperado" }

# GetItem — consulta por chave primária; resultado em $certificado / s.data
- name: ConsultarCertificado
  kind: AwsDynamoGetItem
  awsDynamoGetItem:
    table: clientes-certificados
    keyName: uuid                       # opcional (padrão: id)
    key: $.data.cliente.certificados[0].uuid
    putInto: $certificado
  onSuccess: NextStep
  onFailure: { statusCode: 500, message: "ocorreu um erro inesperado" }

# UpdateItem — UpdateExpression + ExpressionAttributeValues
- name: AtivarCertificadosCliente
  kind: AwsDynamoUpdateItem
  awsDynamoUpdateItem:
    table: clientes-certificados
    keyName: clienteId
    key: $.clienteId
    expression: "SET ativo = :ativo"
    expressionValues:
      - name: ":ativo"
        value: true
  onSuccess: NextStep
  onFailure: { statusCode: 500, message: "ocorreu um erro inesperado" }

# DeleteItem — remove por chave primária
- name: DeletarCertificado
  kind: AwsDynamoDeleteItem
  awsDynamoDeleteItem:
    table: clientes-certificados
    keyName: uuid
    key: $.data.cliente.certificados[0].uuid
  onSuccess: NextStep
  onFailure: { statusCode: 500, message: "ocorreu um erro inesperado" }

# Query — KeyConditionExpression; lista de itens em $certificados / s.data
- name: ListarCertificadosCliente
  kind: AwsDynamoQuery
  awsDynamoQuery:
    table: clientes-certificados
    expression: "clienteId = :id"
    expressionValues:
      - name: ":id"
        extractFrom: $clienteId
    putInto: $certificados
  onSuccess: NextStep
  onFailure: { statusCode: 500, message: "ocorreu um erro inesperado" }
```

> **Nota:** o bloco de config de `AwsSendMessage` chama-se `awsSqsSendMessage` (também para SNS).
> Para o `DeleteItem`, use o bloco `awsDynamoDeleteItem`.

### Skills S3 (`S3CheckBucketExists` / `UploadObject` / `DeleteObject` / `CopyObject` / `GetObject` / `ListObjects` / `PresignUrl`)

Usam o **AWS SDK for Go v2** (`service/s3` + `feature/s3/manager` para multipart). Credenciais e
região vêm da cadeia padrão da AWS (`AWS_*`, perfis, IAM role) — **nunca do YAML**. Para
emuladores locais (LocalStack, MinIO), defina `S3_ENDPOINT` e `S3_FORCE_PATH_STYLE=true`.

```yaml
# CheckBucketExists — ausência do bucket é falha normal (onFailure), não erro de infra
- name: VerificarBucket
  kind: S3CheckBucketExists
  s3CheckBucketExists:
    bucketName: relatorios-clientes
  onSuccess: NextStep
  onFailure: { statusCode: 404, message: "bucket inexistente" }

# UploadObject — body aceita $var/JSONPath (string/[]byte) OU caminho de arquivo local
- name: EnviarArquivoCliente
  kind: S3UploadObject
  s3UploadObject:
    bucketName: relatorios-clientes
    key: "clientes/$codigoCliente/relatorio.pdf"
    body: $arquivoCliente          # conteúdo em memória OU caminho de arquivo em disco
    metadata:
      - name: clienteId
        value: $codigoCliente
    multipartUpload:                # opcional — necessário só para arquivos grandes
      partSize: "10Mb"
      concurrency: 4
  onSuccess: NextStep
  onFailure: { statusCode: 502, message: "falha ao enviar arquivo" }

# ListObjects — lista por prefixo; grava [{key,size,lastModified}] em $arquivos / data
- name: ListarArquivosCliente
  kind: S3ListObjects
  s3ListObjects:
    bucketName: relatorios-clientes
    prefix: "clientes/$codigoCliente/"
    putInto: $arquivos
  onSuccess: NextStep
  onFailure: { statusCode: 502, message: "falha ao listar arquivos" }

# GetObject — grava o conteúdo (string) em putInto; saveToFile persiste em disco (opcional)
- name: LerArquivoCliente
  kind: S3GetObject
  s3GetObject:
    bucketName: relatorios-clientes
    key: "clientes/$codigoCliente/relatorio.pdf"
    putInto: $conteudoArquivo
  onSuccess: NextStep
  onFailure: { statusCode: 502, message: "falha ao ler arquivo" }

# CopyObject — copySource é relativo ao mesmo bucketName (ou a sourceBucket, se informado)
- name: ArquivarRelatorio
  kind: S3CopyObject
  s3CopyObject:
    bucketName: relatorios-clientes
    key: "arquivados/$codigoCliente/relatorio.pdf"
    copySource: "clientes/$codigoCliente/relatorio.pdf"
  onSuccess: NextStep
  onFailure: { statusCode: 502, message: "falha ao arquivar relatório" }

# DeleteObject — remove o objeto original após o arquivamento
- name: RemoverArquivoOriginal
  kind: S3DeleteObject
  s3DeleteObject:
    bucketName: relatorios-clientes
    key: "clientes/$codigoCliente/relatorio.pdf"
  onSuccess: NextStep
  onFailure: { statusCode: 502, message: "falha ao remover arquivo original" }

# PresignUrl — URL temporária para GetObject (expiration default: 15m)
- name: GerarLinkDownload
  kind: S3PresignUrl
  s3PresignUrl:
    bucketName: relatorios-clientes
    key: "arquivados/$codigoCliente/relatorio.pdf"
    expiration: "30m"
    putInto: $linkDownload
  onSuccess: Finish
  onFailure: { statusCode: 502, message: "falha ao gerar link de download" }
```

> **Notas:**
> - `body` (UploadObject) resolve para `$var`/JSONPath: se o valor for uma string apontando para
>   um arquivo existente em disco, o conteúdo é *streamado* a partir do arquivo; caso contrário o
>   próprio valor resolvido (string/`[]byte`) é enviado como conteúdo do objeto.
> - `multipartUpload` é opcional; quando omitido, o upload é um `PutObject` simples.
> - `saveToFile` (GetObject) e `sourceBucket` (CopyObject) são campos opcionais.

### Skills Redis (`RedisPutItem`, `RedisGetItem`, `RedisIncrementItem`, `RedisDeleteItem`)

Integração com **Redis** para cache e idempotência. A conexão vem das variáveis `REDIS_*`
(`REDIS_ADDR` padrão `localhost:6379`, `REDIS_TLS`, `REDIS_USERNAME`, `REDIS_PASSWORD`, `REDIS_DB`,
`REDIS_CLUSTER_MODE`) — nunca do `radahn.yaml`. O `REDIS_ADDR` aceita `host:port`, `redis://host:port`
ou `rediss://host:port` (o esquema `rediss://` força TLS). A `key` é interpolada
(`cliente-$codigoCliente-...`). Todas aceitam `retry`.

**`REDIS_CLUSTER_MODE=true`** — conecta a um Redis/Valkey em **modo cluster** (ex.: o configuration
endpoint `clustercfg.*` do AWS ElastiCache/Valkey). `REDIS_ADDR` continua sendo um **único**
`host:port` — o cliente (`go-redis` `ClusterClient`) descobre a topologia completa (`CLUSTER SHARDS`)
a partir desse nó seed e roteia cada comando (`GET`/`SET`/`INCRBY`/`DEL`) para o shard correto,
seguindo `MOVED`/`ASK` automaticamente. Nenhuma skill ou o schema do `radahn.yaml` muda — é puramente
uma configuração de infraestrutura via variável de ambiente. Default `false` (client single-node,
comportamento inalterado). **Redis Cluster não suporta múltiplos bancos lógicos**: com
`REDIS_CLUSTER_MODE=true`, mantenha `REDIS_DB` em `0` (ou omitido).

```yaml
# PutItem — grava um valor com TTL opcional (em minutos); objeto/array vira JSON
- name: SalvarAporteIdempotencia
  kind: RedisPutItem
  redisPutItem:
    key: "cliente-$codigoCliente-aporte-$codigoAporte"
    data: "processed"   # $var, JSONPath ($.x) ou literal
    expireIn: 60         # TTL em minutos (0 ou ausente = sem expiração)
  onSuccess: NextStep
  onFailure: { statusCode: 502, message: "falha ao salvar idempotência" }

# GetItem — lê para uma variável; desserializeByJson faz parse do valor como JSON
- name: VerificarAporteIdempotencia
  kind: RedisGetItem
  redisGetItem:
    key: "cliente-$codigoCliente-aporte-$codigoAporte"
    putInto: $codigoIdempotenciaAporte   # chave ausente → null (o step ainda tem sucesso)
    desserializeByJson: true             # opcional
  onSuccess: NextStep
  onFailure: { statusCode: 502, message: "falha ao consultar idempotência" }

# IncrementItem — INCRBY atômico; value padrão 1; total capturável via putInto
- name: TotalizadorAportesProcessados
  kind: RedisIncrementItem
  redisIncrementItem:
    key: "total-aportes-processados"
    value: 1
    putInto: $totalAportes   # opcional
  onSuccess: NextStep
  onFailure: { statusCode: 502, message: "falha ao incrementar totalizador" }

# DeleteItem — DEL por chave
- name: RemoverTotalAportesProcessados
  kind: RedisDeleteItem
  redisDeleteItem:
    key: "total-aportes-processados"
  onSuccess: Finish
  onFailure: { statusCode: 502, message: "falha ao remover chave" }
```

### Skills Kafka (`KafkaPublish`, `KafkaConsume`, `KafkaAck`, `KafkaCertDownload`)

O `cluster` é um **nome lógico**: `cluster: events` resolve `KAFKA_EVENTS_*` (caracteres não
alfanuméricos viram `_`, então `data-transfer` → `KAFKA_DATA_TRANSFER_*`). Brokers, certificados e
credenciais **nunca** aparecem no YAML. Avro usa o *wire format* Confluent via Schema Registry
(`KAFKA_SR_*`); dos mecanismos SASL, apenas `PLAIN` é suportado.

#### Consumo com *ack* explícito

`KafkaConsume` grava um array pronto para `ForEach`; `KafkaAck` comita **um** registro por vez, o
que dá semântica *at-least-once* de verdade (só comita o que foi processado com sucesso):

```yaml
- name: ConsumirLote
  kind: KafkaConsume
  kafkaConsume:
    cluster: events
    groupId: meu-grupo
    topics: [meu-topico]
    maxMessages: 10
    pollTimeout: "5s"
    decode: avro
    schemaRegistry: true
    autoCommit: false          # OBRIGATÓRIO
    onError: commit            # OBRIGATÓRIO: fail|commit|ignore|discard
    putInto: $mensagens
  onSuccess: NextStep
  onFailure: { statusCode: 500, message: "falha ao consumir" }

- name: Processar
  kind: ForEach
  forEach:
    extractFrom: $mensagens
    breakOnFirstFail: false
    steps:
      - name: Encaminhar
        kind: HttpOperation
        httpOperation:
          method: POST
          url: "http://api-destino/mensagens"
          body: { type: Json, extractFrom: $.value }   # registro na raiz, sem envelope
        onSuccess: NextStep
        onFailure: { statusCode: 502, message: "falha ao encaminhar" }
      - name: ConfirmarOffset
        kind: KafkaAck
        kafkaAck:
          cluster: events
          groupId: meu-grupo
          topic: $.topic
          partition: $.partition
          offset: $.offset
        onSuccess: Continue
        onFailure: { statusCode: 502, message: "falha ao comitar offset" }
  onSuccess: Finish
```

O consumidor sempre parte de `OffsetOldest`, mas o *consumer group* só reprocessa o que **ainda não
comitou** — reiniciar a aplicação com o mesmo `groupId` retoma de onde parou.

#### `KafkaCertDownload` e o KaaS corporativo (mTLS)

O broker do **KaaS autentica por mTLS puro — não há SASL**: o par certificado/chave emitido pelo
KCert **é** a credencial. O `profile: kaas` implementa o contrato **KCert v2** (POST autenticado
que responde **201** com um zip contendo `<USUARIO>-cert.pem`, `<USUARIO>-key.pem`, `<USUARIO>.p12`
e a cadeia `CARoot.crt`) e, ao materializar o bundle, **publica sozinho** as variáveis TLS:

```yaml
spec:
  hooks:
    onStart:
      - name: EmitirCertificadoKaaS
        kind: KafkaCertDownload
        kafkaCertDownload:
          profile: kaas
          environment: homologation      # sandbox|development|homologation|production
          appName: meu-worker
          cached: true                   # não reemite a cada boot
          renewMinimumDays: 30           # reemite quando faltar menos que isso p/ expirar
          cluster: events                # → KAFKA_EVENTS_TLS_CERT/_TLS_KEY/_TLS_CA
          applyToSchemaRegistry: true    # → KAFKA_SR_TLS_CERT/_TLS_KEY/_TLS_CA
          putCertInto: $certificado
          putKeyInto: $chave
        onSuccess: Finish
        onFailure: StopApplication
```

Pontos que costumam custar horas de depuração:

- **Diretório de destino via `KAFKA_CERT_PATH`, nunca no yaml.** O campo `certDir` foi removido:
  um `radahn.yaml` que ainda o declare falha no boot. A skill materializa o bundle no diretório da
  variável de ambiente `KAFKA_CERT_PATH` (default `"/tmp"`) — aponte-a para um volume gravável do
  deployment (ex.: ECS) para evitar `mkdir: permission denied`.
- **Não declare** `KAFKA_<CLUSTER>_TLS_CERT/_KEY/_CA` no ambiente se usa o hook: um valor já
  definido tem precedência e **desativa** a publicação automática correspondente.
- **`TLS_CA` é a CA, não o certificado do cliente.** Apontar `TLS_CA` para o `-cert.pem` produz
  `x509: certificate signed by unknown authority`. A cadeia correta é o `CARoot.crt` do bundle
  (root + intermediária), que a skill localiza sozinha.
- **`KAFKA_SR_USER` / `KAFKA_SR_PASSWORD` não existem no KaaS**: o Schema Registry usa o mesmo par
  mTLS. Preenchê-las com placeholder faz o motor enviar um Basic Auth inválido (o cabeçalho só é
  omitido quando **ambas** estão vazias).
- **`client.id`**: o KaaS autoriza por identidade de cliente. Sem `KAFKA_<CLUSTER>_CLIENT_ID` o
  cliente se anuncia como `sarama` (default da biblioteca) e o broker pode recusar.
- O `cached: true` valida a **validade real** do certificado (campo `NotAfter` do x509), não só a
  presença do arquivo.

#### Diagnóstico

Falhas do lado do broker **não** interrompem o worker: o lote volta vazio e o consumo continua
tentando. Elas aparecem no log com `component: kafka`, e é aí que se distingue "tópico vazio" de
"não estou conseguindo consumir":

```json
{"level":"error","component":"kafka","cluster":"events","groupId":"meu-grupo",
 "error":"kafka server: The client is not authorized to access this group",
 "message":"kafka: consumer group session failed, retrying in 1s"}
```

| Erro no log | Causa provável |
|-------------|----------------|
| `The client is not authorized to access this group` | O `groupId` não é o autorizado para essa identidade (no KaaS o nome costuma ter o sufixo do ambiente, ex.: `..._hom`), ou falta a ACL. |
| `x509: certificate signed by unknown authority` | `TLS_CA` ausente ou apontando para o certificado do cliente. |
| `401` no `KafkaCertDownload` | Usuário fora do grupo `G_EMITE_CERT_KAAS` ou senha de dupla custódia inválida/expirada. |
| Lote sempre vazio e **nenhum** log `component: kafka` | Tópico realmente sem mensagens novas para esse *consumer group*. |

---

## Contribuindo com skills (innersource)

Quer **adicionar uma skill nova** ao motor? O protocolo técnico completo — o contrato da
skill, a interface `skillctx.Context`, onde o código vive, o checklist de contribuição, um
**exemplo prático de ponta a ponta** e o **fluxo Git Flow** — está documentado em
**[`SKILL-PROTOCOL.md`](SKILL-PROTOCOL.md)**.

Em resumo, uma skill é uma função Go `func(ctx skillctx.Context, b *workflow.Behavior) (bool, error)`
registrada no mapa `registry` (`app/engine/skills.go`), com sua configuração declarada no
`struct Behavior` e no mapa `knownSkills` (`app/workflow/model.go`). Contribuições
seguem o **Git Flow** descrito em [`app/CONTRIBUTING.md`](app/CONTRIBUTING.md).

---

## Variáveis de ambiente

Nenhum segredo é lido do `radahn.yaml` — tudo vem do ambiente.

```bash
# Engine
RADAHN_ADDR=:8080
RADAHN_CONFIG=radahn.yaml
# RADAHN_ENVIRONMENT=hom   # obrigatória somente quando spec.overlays é declarado

# Banco (defaults compartilhados por PostgresQuery / MySqlQuery)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=logan
DB_USER=root
DB_PASSWORD=1234
DB_SSL_MODE=disable       # Postgres e MySQL compartilham DB_SSL_MODE (use POSTGRES_DB_SSL_MODE / MYSQL_DB_SSL_MODE para overrides)
                          # Opções possíveis (texto, deve ser válido para o driver em uso): disable|allow|prefer|require|verify-ca|verify-full|true|false|skip-verify|preferred

# Overrides opcionais por driver (para usar Postgres e MySQL no mesmo workflow)
# POSTGRES_DB_HOST=...   POSTGRES_DB_PORT=5432   (fallback: DB_*)
# POSTGRES_DB_SSL_MODE=...                        # Postgres: disable|allow|prefer|require|verify-ca|verify-full (fallback: DB_SSL_MODE)
# MYSQL_DB_HOST=...      MYSQL_DB_PORT=3306      (fallback: DB_*)
# MYSQL_DB_SSL_MODE=true                            # MySQL: true|false|skip-verify|preferred (fallback: DB_SSL_MODE)

# MongoDB (MongoQuery / MongoOperation / MongoAggregate)
# MONGO_URI=mongodb://localhost:27017/radahn        # caminho principal (aceita mongodb+srv://; pode já incluir o database no path)
# MONGO_DB_HOST=localhost   MONGO_DB_PORT=27017      # usados só quando MONGO_URI está vazia
# MONGO_DB_USER=...         MONGO_DB_PASSWORD=...
# MONGO_DB_NAME=radahn                                # obrigatória quando a URI (explícita ou composta) não tem path de database

# OAuth2 (HttpAuthorize)
HTTP_AUTHORIZE_URL=http://localhost:8090/oauth/token
HTTP_AUTHORIZE_CLIENT_ID=radahn-client
HTTP_AUTHORIZE_CLIENT_SECRET=radahn-secret

# AWS (DynamoDB / SNS / SQS / CloudWatch) — cadeia de credenciais padrão do SDK v2
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
# AWS_SESSION_TOKEN=...            # opcional (credenciais temporárias)
# Endpoints locais (LocalStack / DynamoDB Local) — opcionais:
# AWS_ENDPOINT_URL=http://localhost:4566          # override genérico
# DYNAMODB_ENDPOINT=http://localhost:8000         # override por serviço
# SNS_ENDPOINT / SQS_ENDPOINT / CLOUDWATCH_ENDPOINT

# Redis (RedisPutItem / RedisGetItem / RedisIncrementItem / RedisDeleteItem)
REDIS_ADDR=localhost:6379
# REDIS_ADDR=rediss://localhost:6379  # redis:// e rediss:// também são aceitos (rediss força TLS)
# REDIS_TLS=true                      # ativa TLS explicitamente
# REDIS_USERNAME=...                  # opcional (Redis 6+ ACL)
# REDIS_PASSWORD=...                  # opcional
# REDIS_DB=0                          # índice do banco (default 0; deve ficar 0 em modo cluster)
# REDIS_CLUSTER_MODE=true             # true = Redis/Valkey cluster (ex.: clustercfg.* do ElastiCache)

# Kafka — cluster lógico <NOME> (cluster: events → KAFKA_EVENTS_*)
KAFKA_EVENTS_BROKERS=broker-1:9092,broker-2:9092   # CSV
# KAFKA_EVENTS_CLIENT_ID=...          # client.id; sem isto o cliente se anuncia como "sarama"
# KAFKA_EVENTS_TLS_ENABLED=true
# KAFKA_EVENTS_TLS_CERT=...           # certificado do cliente (PEM) — mTLS
# KAFKA_EVENTS_TLS_KEY=...            # chave privada (PEM)
# KAFKA_EVENTS_TLS_CA=...             # CADEIA da CA (NUNCA o certificado do cliente)
# KAFKA_EVENTS_TLS_INSECURE=false     # true desliga a verificação do servidor (só p/ debug)
# KAFKA_EVENTS_SASL_MECHANISM=PLAIN   # único mecanismo suportado; omita em clusters mTLS
# KAFKA_EVENTS_SASL_USER=... KAFKA_EVENTS_SASL_PASSWORD=...

# Schema Registry (Avro)
# KAFKA_SR_URL=https://schema-registry:8081
# KAFKA_SR_TLS_CERT=... KAFKA_SR_TLS_KEY=... KAFKA_SR_TLS_CA=...
# KAFKA_SR_USER=... KAFKA_SR_PASSWORD=...   # Basic Auth; NÃO use em Schema Registry mTLS

# KafkaCertDownload — profile: kaas (KCert v2)
# KAFKA_CERT_URL=https://kcert.<amb>.aws.cloud.ihf/api/v2/cert   # opcional: `environment` resolve por alias
# KAFKA_CERT_PATH=/tmp                # diretório de destino do bundle (default "/tmp"); aponte p/ um volume gravável no ECS
# KAFKA_CERT_USER=...                 # usuário de serviço (nome dos arquivos do bundle)
# KAFKA_CERT_PASSWORD=...             # senha de dupla custódia (criptografada)
# KAFKA_CERT_P12_PASSWORD=...         # senha do .p12 gerado
# KAFKA_CERT_COMMUNITY=... KAFKA_CERT_SIGLA=...
```

> **Múltiplos bancos:** `PostgresQuery` e `MySqlQuery` usam por padrão as mesmas `DB_*`.
> Para usar os dois simultaneamente, defina os prefixos `POSTGRES_DB_*` e `MYSQL_DB_*`,
> que sobrescrevem as `DB_*` base.

> **Kafka com `KafkaCertDownload`:** as variáveis `TLS_CERT`/`TLS_KEY`/`TLS_CA` (do cluster e do
> Schema Registry) são publicadas **pela própria skill** quando ela roda em `onStart`. Declará-las
> manualmente tem precedência e desativa a publicação automática — ver
> [Skills Kafka](#skills-kafka-kafkapublish-kafkaconsume-kafkaack-kafkacertdownload).

---

## Estrutura do projeto

```
app/
  cmd/radahn/main.go            # entrypoint: carrega o workflow e sobe o servidor
  engine/
    engine.go                   # roteamento, pipeline, parâmetros, respostas
    session.go                  # estado mutável da requisição + sessionCtx
    debug.go                    # envelope debug (buildDebugEnvelope, wrapDebug)
    healthcheck.go              # /liveness e /readiness com pings de dependências
    skills.go                   # registro das skills (registry map)
    db.go                       # conexões Postgres/MySQL, placeholders, scan
    redis.go                    # conexão Redis lazy
    skills/                     # implementações das skills por categoria
  internal/
    config/config.go            # configuração via variáveis de ambiente
    logging/logging.go          # logger JSON (zerolog): Event, Line, Fatal
    workflow/model.go           # modelo do ApplicationWorkflow + loader + Validate()
  tests/
    unit-tests/                 # testes Go em processo (sem infra externa)
      workflow_test.go          # testes unitários do modelo YAML
      skills_test.go            # testes unitários das skills
      calc_test.go              # testes de Calculate/CoerceType
      fake_ctx_test.go          # fake skillctx.Context compartilhado
      scenario8_test.go         # debug mode + health-check (httptest in-process)
      scenario8/radahn.yaml      # fixture do cenário 8
    integrated-tests/           # cenários ponta a ponta (cada um self-contained)
      scenario9_integration_test.go  # sobe Docker + radahn.exe real (tag: integration)
      scenario-YYYYMMDD-HHMMSS/    # cenários com nomes baseados em timestamp para evitar conflitos de merge
                                  # inclui cenários manuais (docker-compose + mock FastAPI)
                                  # e cenários automatizados (docker-compose + seed.sql + radahn.yaml)
  radahn.yaml                    # workflow de exemplo (= cenário 1)
  .env.example                  # template de variáveis de ambiente
  HOW-IT-WORKS.md               # anatomia do código (para contribuidores)
  CONTRIBUTING.md               # fluxo de contribuição (Git Flow)
```

---

## Limitações conhecidas

- **Proteção anti-loop:** o motor limita cada request a 100 execuções de step. Pipelines
  circulares que excedam esse limite retornam HTTP 500.
- **`FormData`/`FormUrlEncoded`** não suportam `extractFrom` — apenas `properties`.
- **`body.type: File`** é exclusivo de `HttpOperation`.
- **Redis Cluster (`REDIS_CLUSTER_MODE=true`):** `REDIS_DB` deve permanecer em `0` —
  Redis Cluster não suporta múltiplos databases lógicos.

---

![Radahn](.github/radahn.jpg)