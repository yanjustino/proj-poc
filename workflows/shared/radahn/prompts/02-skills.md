# Catálogo de skills (config exata)

## Control step: `Parallel` (não é skill-folha)

`Parallel` é um **control step do motor** — **não** é uma skill de folha e **não** aparece no
registry de skills. Ele executa várias **branches** (sub-pipelines ordenados) concorrentemente,
cada uma reusando toda a maquinaria existente (skills, `retry`, `onSuccess`/`onFailure` internos).
Uma branch com **um único step** cobre o caso "skill simples". Ao terminar, o motor consolida os
resultados via `consolidate.strategy` e devolve ao pipeline principal, onde o `onSuccess`/`onFailure`
do próprio step `Parallel` roteia normalmente.

```yaml
- name: coletasParalelas
  kind: Parallel
  parallel:
    maxConcurrency: 4          # opcional (default = nº de branches)
    failFast: true             # opcional (default true)
    branches:
      - name: saldo
        steps:                 # 1..N steps; 1 step = "skill simples"
          - kind: HttpSearch
            name: buscarSaldo
            httpSearch: { url: "$urlSaldo", bearerToken: $accessToken, extractResult: $.saldo }
            onSuccess: Finish  # Finish encerra A BRANCH, não a request
      - name: limites
        steps:
          - kind: PostgresQuery
            name: buscarLimites
            postgresQuery: { resultType: Item, sql: "SELECT ...", parameters: [$codigoCliente] }
            onSuccess: Finish
    consolidate:
      strategy: object         # object | merge | collect
      putInto: $               # onde gravar o consolidado (default: data)
  onSuccess: NextStep
  onFailure: { statusCode: 502, message: "falha ao consolidar dados do cliente" }
```

**Estratégias de consolidação:**

| `strategy` | Resultado |
|------------|-----------|
| `object` (default) | `{ "<branch>": <data>, ... }` — BFF agregado, keyed pelo nome da branch |
| `collect` | array com o `data` de cada branch, **na ordem declarada** |
| `merge` | merge raso (arrays concatenam; chaves de objeto sobrescrevem na ordem das branches) |

- `maxConcurrency` limita quantas branches rodam ao mesmo tempo (default = nº de branches).
- `failFast: true` (default): a primeira branch que falha cancela as branches ainda não iniciadas e
  dispara o `onFailure` do step `Parallel`. `failFast: false`: todas rodam até o fim e o primeiro erro é reportado.
- `putInto`: vazio ou `$` grava o consolidado no `data` da resposta; `$var` grava em uma variável de sessão.
- **Anti-loop:** o teto de **100 execuções de step por request** é compartilhado (contador atômico) entre
  todas as branches — o fan-out não fura o limite.
- **Isolamento:** cada branch opera sobre um **clone profundo** da sessão (vars/data/store), então não há
  corrida de dados. Os clientes de infra (db/aws/redis/http) são pools thread-safe e permanecem compartilhados.

## Control step: `ForEach` (não é skill-folha)

`ForEach` é um **control step do motor** — como o `Parallel`, **não** aparece no registry de
skills. Ele **varre uma lista** (`extractFrom`) e executa um **sub-pipeline ordenado** (`steps`)
uma vez por elemento, **sequencialmente**. Cada iteração roda sobre um **clone profundo** da
sessão onde o elemento é exposto de três formas:

- como **`data`** e como o **`body`** da sub-sessão → `extractFrom: $.campo` nas skills-folha
  (ex.: `PostgresOperation`) resolve contra o **item corrente**;
- como a variável **`$item`** (o elemento inteiro);
- como a variável **`$index`** (índice inteiro, base 0).

O `data` final de cada iteração bem-sucedida é **agregado, na ordem**, num array gravado em
`putInto` (ou no `data` do pipeline quando ausente/`$`). Ao terminar, o `onSuccess`/`onFailure`
do próprio step `ForEach` roteia normalmente.

```yaml
- name: SalvarClientes
  kind: ForEach
  forEach:
    extractFrom: $.data       # lista resolvida contra o data atual ($, $.a.b, $var ou literal)
    breakOnFirstFail: true    # opcional (default false)
    putInto: $inseridos       # opcional (default: grava no data)
    steps:                    # sub-pipeline executado por elemento (1..N)
      - name: RegistrarCliente
        kind: PostgresOperation
        postgresOperation:
          sql: "INSERT INTO clientes (nome) VALUES ($1) RETURNING id"
          parameters:
            - extractFrom: $.nome     # $.campo = campo do item corrente
          putInto: $clientId
          putIntoAs: integer
        onSuccess: Continue           # encerra a iteração corrente e vai ao próximo item
        onFailure:
          statusCode: 502
          message: "falha ao inserir cliente indice $index"  # $item/$index disponíveis
  onSuccess: Finish
  onFailure:
    statusCode: 502
    message: "não foi possivel importar os clientes"
```

**Semântica:**

| Campo / statement | Efeito |
|-------------------|--------|
| `extractFrom` | seleciona a lista (contra o **data atual**, não o body): `""`/`"$"` = data inteiro, `"$.a.b"` = JSONPath no data, `"$var"` = variável, resto = literal. Lista vazia/ausente = sucesso (agrega `[]`). |
| `breakOnFirstFail: true` | aborta na **primeira** iteração que falha, disparando o `onFailure` do step `ForEach`. |
| `breakOnFirstFail: false` (default) | **pula** o item que falhou e prossegue; itens bem-sucedidos são agregados. |
| `onSuccess: Continue` | **novo statement**: encerra o sub-pipeline do item corrente (equivale a um `Finish`-da-iteração) e avança o loop para o próximo elemento. |
| `putInto` | destino do array agregado: vazio/`$` grava no `data`; `$var` grava numa variável de sessão. |

- **Sequencial:** ao contrário do `Parallel`, as iterações rodam **em ordem**, uma de cada vez.
- **Anti-loop:** o teto de **100 execuções de step por request** é compartilhado com as iterações
  do `ForEach` (não fura o limite ao varrer listas grandes).
- **Item não-mapa:** um escalar ainda é acessível via `$item`/`$` (o `$.campo` retorna nulo).

## Skills de leitura / validação

| Skill | Propósito | Bloco de config |
|-------|-----------|-----------------|
| `LogicalOperator` | Avalia lista de condições booleanas (OR entre itens; AND com `&&` dentro de cada condição). Suporta `putInto`, `breakBySuccess`, `breakByFailure`. Alias retrocompat: `StaticValidation`. | `logicalOperator: [{condition, putInto, breakBySuccess, breakByFailure}]` |
| `EmptyValidation` | Falha quando o resultado anterior é vazio/nulo/zero/`[]`/`{}` | (nenhum) |
| `JsonValidation` | Valida dados contra JSON Schema (draft 2020-12); define `$jsonValidationErrors` ao falhar. Aceita schema inline ou `schemaPath` (arquivo relativo ao dir de `RADAHN_CONFIG`) com `putSuccessInto`/`putFailureInto`. | `jsonValidation: \|` (schema inline) ou `jsonValidation: {schemaPath, putSuccessInto, putFailureInto}` |
| `PostgresQuery` | Consulta Postgres; placeholders `$1..$n` | `postgresQuery: {resultType, sql, parameters}` |
| `MySqlQuery` | Consulta MySQL; `$1..$n` reescritos para `?` | `mysqlQuery: {resultType, sql, parameters}` |
| `HttpAuthorize` | Token OAuth2 client_credentials | `httpAuthorize: {extractResult, putInto}` |
| `HttpSearch` | GET/OPTIONS a subsistema + extração JSONPath | `httpSearch: {url, method, bearerToken, headers: [{name, value|extractFrom|calculateBy}], extractResult, putInto}` |
| `OutputTransformer` | Remapeia campos `from`→`to` (caminhos pontuados aninhados aceitos) | `fields: [{from,to}]` (ou `outputTransformer:`) |
| `MergeLocalStore` | Concatena resultados armazenados anteriormente | `mergeLocalStore: [nome, ...]` |
| `HttpStatusCodeResult` | Encerra com status HTTP customizado + corpo opcional | `httpStatusCodeResult: {statusCode, body}` |
| `HttpProblemDetailsResponse` | Emite resposta de erro HTTP com status, headers e corpo customizado (RFC 9457) | `httpProblemDetailsResponse: {statusCode, contentType, parameters, headers, body}` |
| `StringOperator` | Executa cadeia de transformações sobre string (`trim`, `lower`, `upper`, `substring`, `replace`, `regexReplace`, `regexExtract`, `lpad`, `rpad`, `split`, `contains`) | `stringOperator: {extractFrom, putInto, operations: [{function, args}]}` |
| `JsonTransformer` | Cadeia de transformações sobre coleções/objetos JSON: array (`filter`, `map`/`project`, `sort`, `limit`, `offset`/`skip`, `slice`, `distinct`, `reverse`, `pluck`, `flatten`, `groupBy`), agregação (`aggregate`, `count`), objeto (`pick`, `omit`, `rename`, `set`, `merge`, `unwrap`) | `jsonTransformer: {extractFrom, putInto, operations: [{function, args}]}` |

## Skills de cálculo

| Skill | Propósito | Bloco de config |
|-------|-----------|-----------------|
| `MathOperator` | Avalia expressões aritméticas de **3 tokens** (`A op B`) em sequência; cada resultado é gravado em `putInto`. Operadores: `+ - * / **`. Operandos: `$var`, `$.jsonpath` ou literal numérico. | `mathOperator: {putIntoAs, expressions: [{expression, putInto, roundBy\|floor\|ceil}]}` |
| `MathDateTimeOperator` | Operações temporais sobre uma data-base (`extractFrom`): deslocamentos aditivos, comparações (booleano), diferença (segundos) ou extração de componente (inteiro). Honra `spec.timezone`. | `mathOperator: {extractFrom, putInto, putIntoAs, addYears\|addHours\|addMinutes\|addSeconds\|addMiliseconds, beforeThan\|afterThan\|equals, diffThan, extractYears\|extractHours\|extractMinutes\|extractSeconds\|extractMiliseconds}` |

## Skills de escrita

| Skill | Propósito | Bloco de config |
|-------|-----------|-----------------|
| `DataValidation` | Valida um dado contra SQL ou DynamoDB via `condition` (falso → onFailure) | `dataValidation: {source, sql\|dynamodb, parameters, condition, putInto, putIntoAs}` |
| `PostgresOperation` | INSERT/UPDATE/DELETE no Postgres (RETURNING → putInto) | `postgresOperation: {sql, parameters, putInto, putIntoAs, condition}` |
| `MysqlOperation` | INSERT/UPDATE/DELETE no MySQL (`$1..$n`→`?`; LAST_INSERT_ID) | `mysqlOperation: {sql, parameters, putInto, putIntoAs, condition}` |
| `HttpOperation` | Escrita HTTP (POST/PUT/PATCH/DELETE) a subsistema. `body.type` aceita `Json`, `FormData` (`multipart/form-data`), `FormUrlEncoded` (`application/x-www-form-urlencoded`) e `File` (upload multipart; `files` obrigatório). Em `Json`, o `body` monta o objeto por `properties` **ou** envia um documento opaco na raiz por `extractFrom` (mutuamente exclusivos; declarar os dois falha o boot); `extractFrom` não é suportado em `FormData`/`FormUrlEncoded`/`File`. `FormData`/`FormUrlEncoded`/`File` são exclusivos de `HttpOperation` (rejeitados em `SnsPublish`/`SqsSend`/`KafkaPublish`, que só aceitam `Json`). | `httpOperation: {method, url, authentication, headers: [{name, value\|extractFrom\|calculateBy}], body: {type: Json\|FormData\|FormUrlEncoded\|File, properties\|extractFrom, files: [{name, path}]}, extractResult, putInto}` |

## Skills AWS

| Skill | Propósito | Bloco de config |
|-------|-----------|-----------------|
| `SnsPublish` | Publica mensagem em tópico SNS (AWS SDK v2) | `snsPublish: {topicArn\|targetArn, subject, message\|body, putInto}` |
| `SqsSend` | Envia mensagem para fila SQS (AWS SDK v2) | `sqsSend: {queueUrl, message\|body, delaySeconds, messageGroupId, messageDeduplicationId, putInto}` |
| `SqsGetMessages` | Recebe (faz *poll*) mensagens de uma fila SQS via `ReceiveMessage`. Grava em `data` um array `[{messageId, receiptHandle, body}]` (pronto para `ForEach`). | `sqsGetMessages: {queueUrl, maxNumberOfMessages(1..10, default 1), waitTimeSeconds(0..20), visibilityTimeout, deleteAfterRead: bool, putInto}` |
| `SqsDeleteMessage` | Remove **uma** mensagem da fila via `DeleteMessage` (por `receiptHandle`). Use para deletar **somente após o processamento** — combine com `SqsGetMessages` (`deleteAfterRead: false`) dentro de um `ForEach`. `receiptHandle` aceita literal, `$var` ou `$.jsonpath` (ex.: `$.receiptHandle`). | `sqsDeleteMessage: {queueUrl, receiptHandle}` |
| `CloudwatchMetric` | Publica métrica custom (PutMetricData) | `cloudwatchMetric: {namespace, metricName, value, unit, dimensions:[{name,value\|extractFrom}]}` |
| `AwsSendMessage` | Envia mensagem para **SQS ou SNS** (Standard/FIFO) | `awsSqsSendMessage: {type: SQS\|SNS, queue, message, fifoOptions:{groupId,deduplicationId}, putInto}` |
| `AwsDynamoPutItem` | Persiste um item (objeto JSON) em uma tabela | `awsDynamoPutItem: {table, item}` |
| `AwsDynamoGetItem` | Consulta item por chave primária | `awsDynamoGetItem: {table, key, keyName, putInto}` |
| `AwsDynamoUpdateItem` | Atualiza via `UpdateExpression` | `awsDynamoUpdateItem: {table, key, keyName, expression, expressionValues:[{name,value\|extractFrom}]}` |
| `AwsDynamoDeleteItem` | Remove item por chave primária | `awsDynamoDeleteItem: {table, key, keyName}` |
| `AwsDynamoQuery` | Consulta via `KeyConditionExpression` | `awsDynamoQuery: {table, indexName, expression, expressionValues, putInto}` |

## Skills Redis

| Skill | Propósito | Bloco de config |
|-------|-----------|-----------------|
| `RedisPutItem` | Salva valor em uma chave com TTL opcional (minutos) | `redisPutItem: {key, data, expireIn}` |
| `RedisGetItem` | Lê valor por chave para uma variável (parse JSON opcional) | `redisGetItem: {key, putInto, desserializeByJson}` |
| `RedisIncrementItem` | Incrementa atomicamente um contador inteiro (INCRBY) | `redisIncrementItem: {key, value, putInto}` |
| `RedisDeleteItem` | Remove uma chave (DEL) | `redisDeleteItem: {key}` |

## Skills Kafka

O `cluster` é um **nome lógico** resolvido a partir de `KAFKA_<NOME>_*` (o nome sofre *fold* de caracteres não alfanuméricos para `_`; ex.: `data-transfer` → `KAFKA_DATA_TRANSFER_*`). Nada sensível (brokers, credenciais, certificados) vai no YAML. Avro usa o *wire format* Confluent via Schema Registry (`KAFKA_SR_*`). Apenas SASL `PLAIN` é suportado; em clusters mTLS (como o KaaS corporativo) **não se usa SASL** — o par certificado/chave é a credencial.

O `client.id` vem de `KAFKA_<NOME>_CLIENT_ID`; sem ele o cliente se anuncia como `sarama` (default da biblioteca), o que brokers que autorizam por identidade de cliente podem recusar.

Políticas de `onError` do `KafkaConsume` — valem **somente** para registros que falham a decodificação (os decodificados seguem o `autoCommit`); toda falha é sempre logada:

- `fail` — aborta o lote e dispara o `onFailure` do step.
- `commit` — comita o registro ruim e o emite com `decodeError` (e `value: null`).
- `ignore` — **não** comita e emite com `decodeError`; o registro será reentregue.
- `discard` — comita e **omite** o registro do array de saída.

Em `commit` e `discard` o commit do registro com falha ocorre independente de `autoCommit`, para não travar a partição.

| Skill | Propósito | Bloco de config |
|-------|-----------|-----------------|
| `KafkaPublish` | Produz **uma** mensagem (produtor síncrono) para um tópico. `value` (expressão) ou `body` (JSON). `encode`: `raw`\|`json`\|`avro`. Schema Avro resolvido na ordem `schemaUrl` > `schemaFile` > `schema`; `schemaUrl` é baixado por HTTP e cacheado em memória (1x por processo). Captura `{partition, offset}`. | `kafkaPublish: {cluster, topic, key, value\|body, headers:[{name,value\|extractFrom}], encode: raw\|json\|avro, schemaRegistry, subject, schemaUrl\|schemaFile\|schema, putInto}` |
| `KafkaConsume` | Faz *poll* de um lote de um *consumer group*. Grava em `data` um array `[{topic,partition,offset,key,value,headers,timestamp,schemaId}]` (pronto para `ForEach`). `decode`: `raw`\|`json`\|`avro` — em Avro o schema é resolvido por mensagem via schema id, suportando tópicos multi-schema. **`autoCommit` e `onError` são obrigatórios** (ausência falha o boot). | `kafkaConsume: {cluster, groupId, topics:[...], maxMessages(default 1), pollTimeout(default "1s"), decode: raw\|json\|avro, schemaRegistry, autoCommit(OBRIGATÓRIO), onError: fail\|commit\|ignore\|discard (OBRIGATÓRIO), putInto}` |
| `KafkaAck` | Comita o offset de **um** registro processado. Use dentro de um `ForEach` sobre a saída do `KafkaConsume` para *at-least-once*. `topic`/`partition`/`offset` aceitam literal, `$var` ou `$.jsonpath`. | `kafkaAck: {cluster, groupId, topic, partition, offset}` |
| `KafkaCertDownload` | Emite/baixa o certificado de cliente para `certDir` (típico em `spec.hooks.onStart`). `profile: http` (GET genérico, default) ou `kaas` (**KCert v2**: POST autenticado, resposta **201** com zip contendo `<USUARIO>-cert.pem`, `<USUARIO>-key.pem`, `<USUARIO>.p12` e a cadeia `CARoot.crt`). No perfil `kaas` a skill **publica** `KAFKA_<CLUSTER>_TLS_CERT/_TLS_KEY/_TLS_CA` (e as `KAFKA_SR_TLS_*` com `applyToSchemaRegistry`), sem sobrescrever valores já definidos no ambiente. `cached` valida a validade real do x509 (`NotAfter`), reemitindo dentro da janela `renewMinimumDays` (default 30). Credenciais em `KAFKA_CERT_*`. | `kafkaCertDownload: {url, profile: http\|kaas, appName, environment: sandbox\|development\|homologation\|production, certDir, format: zip\|pem, cached, renew, renewMinimumDays, cluster, applyToSchemaRegistry, putCertInto, putKeyInto}` |

### Diagnóstico de consumo

Falhas do broker **não** derrubam o worker: o lote volta vazio e o consumo segue tentando. Elas são logadas com `component: kafka` (`kafka: consumer group session failed...` / `kafka: consumer group error`) — sem nenhuma dessas linhas, o lote vazio significa que o tópico realmente não tem novidade para aquele *consumer group*.

- `The client is not authorized to access this group` → `groupId` não autorizado para a identidade (no KaaS o nome costuma levar o sufixo do ambiente, ex.: `..._hom`) ou ACL ausente.
- `x509: certificate signed by unknown authority` → `TLS_CA` ausente ou apontando para o certificado do **cliente** em vez da cadeia da CA.
- `401` no `KafkaCertDownload` → usuário fora do grupo `G_EMITE_CERT_KAAS` ou senha de dupla custódia inválida/expirada.

## Skills de sistema

| Skill | Propósito | Bloco de config |
|-------|-----------|-----------------|
| `Command` | Executa uma ou mais linhas de shell (`sh -c` no unix, `cmd /c` no Windows). Cada linha é interpolada (`$var`); exit != 0 (ou timeout) falha o step. | `command:` como **lista** de strings, **ou** `command: {commands: [...], timeout: "30s", workingDir: <path>}` |
| `UnzipFile` | Extrai um arquivo zip de `from` para o diretório `to` (criado se ausente); protegido contra zip-slip. | `unzipFile: {from, to}` |

> `Command` e `UnzipFile` foram desenhadas para **hooks de ciclo de vida** (ver abaixo), mas são
> skills normais do registry e também podem ser usadas em rotas.

## Hooks de ciclo de vida (`spec.hooks`)

`spec.hooks` declara pipelines executados **fora de qualquer requisição HTTP**, reusando a mesma
maquinaria de skills com uma **sessão sintética** (sem body/params de rota):

- **`onStart`**: roda no boot, **antes** do servidor HTTP subir. Falha (ex.: `StopApplication`)
  aborta o boot com exit != 0 e a porta HTTP não abre.
- **`onStop`**: roda no desligamento gracioso (`SIGINT`/`SIGTERM`), **antes** do `Shutdown`.

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

Fluxo dentro de hooks: `onSuccess: NextStep | Finish | { localStore }`;
`onFailure: StopApplication | <nomeDoStep>`. Mesmo teto anti-loop (100 execuções).

## Workers em segundo plano (`spec.workers`)

`spec.workers` declara **processos contínuos** que rodam em segundo plano **enquanto o servidor
HTTP está exposto**. Cada chave deve casar com um pipeline em `spec.behaviors` (mesmo nome). O motor
executa esse pipeline **em loop**, reusando **a mesma API de pipeline do workflow** (`onSuccess`/
`onFailure`, `Finish`/`Continue`/`NextStep`/`localStore`, control steps `ForEach`/`Parallel`, `retry`
e o teto anti-loop de 100 execuções por iteração), com uma **sessão sintética** (sem body/params).

- Os workers **iniciam depois** que os hooks `onStart` concluem com sucesso e **param (graciosamente)
  antes** dos hooks `onStop` rodarem.
- Cada worker pode usar `loopWait` (duração Go: `"5s"`, `"500ms"`, `"1m"`) ou `schedule` (expressão
  cron padrão de 5 campos: `min hora dia mês dia-da-semana`). Um deles é obrigatório.
- Quando `schedule` é usado, o worker dispara nos horários absolutos respeitando `spec.timezone`
  (UTC por padrão). Se `loopWait` também estiver presente, ele funciona como cooldown/respeito
  mínimo após cada execução agendada.
- `breakOnFailure: true` → uma iteração que falha **para** o worker; `false` (padrão) → a falha é
  logada e o loop continua.
- Se `spec.timezone` for inválido, o worker agendado é **desabilitado com log** e o resto da
  aplicação continua funcionando.

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
          queueUrl: "https://sqs.us-east-1.amazonaws.com/000000000000/posicoes"
          maxNumberOfMessages: 10
          deleteAfterRead: false   # deletar só APÓS processar (ver SqsDeleteMessage)
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
              httpOperation: { method: POST, url: https://sink/consumir, body: { type: Json, properties: [{name: body, extractFrom: $.body}] } }
              onSuccess: NextStep
              onFailure: { statusCode: 502, message: "falha ao processar" }
            - name: Confirmar
              kind: SqsDeleteMessage   # ack: remove da fila só depois do sucesso
              sqsDeleteMessage:
                queueUrl: "https://sqs.us-east-1.amazonaws.com/000000000000/posicoes"
                receiptHandle: $.receiptHandle
              onSuccess: Continue
              onFailure: { statusCode: 502, message: "falha ao confirmar" }
        onSuccess: Finish
        onFailure: { statusCode: 500, message: "falha no lote" }
```

## Notas importantes sobre as skills

- **`resultType`**: `Item` (objeto único, primeira linha) ou `Array` (lista).
- **`LogicalOperator`** (alias `StaticValidation`): a expressão descreve a **condição de erro** — se verdadeira, o step falha. Operadores: `>`, `<`, `>=`, `<=`, `==`, aliases `gt`, `lte`. `breakByFailure: true` dispara `onFailure` quando a condição for VERDADEIRA; `breakBySuccess: true` dispara `onSuccess` antecipadamente.
- **`HttpSearch.method`**: `GET` ou `OPTIONS`. `bearerToken` normalmente é `$accessToken`.
- **`HttpOperation.body`**: `type: FormData` e `type: FormUrlEncoded` montam o corpo a partir de `properties` (campos de formulário/urlencoded); não aceitam `extractFrom`. `type: File` exige `files: [{name, path}]` não vazio (upload multipart) e pode combinar com `properties` (campos de texto no mesmo multipart); `path` aponta para um arquivo no filesystem local do processo. Declarar `body.type` fora de `Json`/`FormData`/`FormUrlEncoded`/`File`, ou `files` fora de `type: File`, falha o boot. Esses três tipos só existem em `HttpOperation` — `SnsPublish`/`SqsSend`/`KafkaPublish` só aceitam `body.type: Json`.
- **`OutputTransformer`**: aplica-se a um objeto ou a cada elemento de um array. `from`/`to` aceitam chave simples ou JSONPath pontuado.
- **`MergeLocalStore`**: concatena arrays; um objeto armazenado é adicionado como elemento único.
- **`HttpStatusCodeResult`**: define o status de **sucesso** (ex.: `201`, `202`, `204`) e, opcionalmente, um `body` customizado. Escalares que são exatamente `$var`/`$.jsonpath` preservam o tipo nativo; `$vars` embutidos em strings são interpolados; mapas/listas aninhados são reconstruídos recursivamente. Status sem corpo (`204`, `304`, `1xx`) sempre respondem sem payload. Deve encerrar com `onSuccess: Finish`.
- **`HttpProblemDetailsResponse`**: semelhante, mas para respostas de erro (`400`, `403`, `404`, `422`, ...). Aceita `statusCode`, `contentType`, `parameters`, `headers` e `body`. Os parâmetros são resolvidos para variáveis de sessão (`$nome`) e podem usar `calculateBy` (`GENERATE_NEW_UUID_V4`, `DATETIME_NOW`). Deve encerrar com `onSuccess: Finish`.
- **`MathOperator`**: cada `expression` deve ter **exatamente 3 tokens** separados por espaço (`A op B`) — expressões maiores (ex.: `(25 + 75) / 4`) **falham no start** e devem ser quebradas em múltiplas expressões encadeadas via `putInto`. Operadores: `+ - * /` e `**` (potência). Operandos são `$var`, `$.jsonpath` ou literais numéricos (negativos exigem espaço explícito: `10 + -5`). Por expressão, `roundBy` (N casas), `floor` e `ceil` são **mutuamente exclusivos** (mais de um → falha no start). `putIntoAs` converte todos os resultados para `decimal` (padrão) ou `integer`. Operando não numérico em runtime → `onFailure`.
- **`MathDateTimeOperator`**: usa o mesmo bloco `mathOperator:`. `extractFrom` é a data-base (`$var`, `$.jsonpath`, literal ou a constante `DATETIME_NOW`). Operações: aditivas (`addYears`/`addHours`/`addMinutes`/`addSeconds`/`addMiliseconds`, podem ser **negativas** para subtrair, e acumulam); comparações (`beforeThan`/`afterThan`/`equals` → booleano); `diffThan` → diferença em **segundos** (base − operando); extrações (`extractYears`/`extractHours`/`extractMinutes`/`extractSeconds`/`extractMiliseconds` → inteiro). Saída de data é string `YYYY-MM-DD HH:MM:SS` por padrão, ou **unix seconds** quando `putIntoAs: UNIXTIME`. Todos os cálculos respeitam `spec.timezone`. Data inválida em runtime → `onFailure`.
- **`StringOperator`**: transforma o valor de `extractFrom` por uma cadeia de operações (cada uma recebe a saída da anterior). Operações: `trim`, `lower`, `upper`, `substring [start,end]` (runas UTF-8), `replace [old,new]`, `regexReplace [pattern,replacement]`, `regexExtract [pattern,groupIndex]` (string vazia se não houver match/índice), `lpad`/`rpad [targetLength,padChar]` (runas), `split [delimiter]` → `[]interface{}`, `contains [substring]` → `bool`. Erro em função desconhecida, argumentos insuficientes, índice não numérico ou regex inválido.
- **`JsonTransformer`**: complementa o `OutputTransformer` com uma cadeia de operações sobre coleções/objetos JSON. O `extractFrom` resolve **contra o `data` atual do pipeline** (não o corpo da requisição): `""`/`"$"` = data inteiro, `"$.a.b"` = JSONPath no data, `"$nome"` = variável, resto = literal. A saída de cada operação alimenta a próxima e **o tipo pode mudar** (ex.: `groupBy` array→objeto, `pluck` array→escalares, `aggregate`/`count` array→objeto/int). Operações de **array**: `filter {where}`, `map`/`project {fields:[{from,to}]}` (projeta, descartando campos não listados), `sort {by,order}`, `limit N`, `offset`/`skip N`, `slice {start,end}`, `distinct [campo]`, `reverse`, `pluck campo`, `flatten`, `groupBy campo`. Operações de **agregação**: `aggregate {ops:[{fn:sum|avg|min|max|count,field,to}]}`, `count`. Operações de **objeto**: `pick [chaves]`, `omit [chaves]`, `rename {fields:[{from,to}]}` (preserva as demais), `set {to,value|extractFrom|calculateBy}`, `merge ($var|objeto)`, `unwrap campo`. No `filter`, `$.campo` é o campo do **elemento** corrente e `$nome` é uma **variável de sessão**. Função desconhecida, `args` inválido ou tipo incompatível (ex.: `sort`/`pick` sobre tipo errado) → `onFailure`; coleção vazia é sucesso.

## Operações de escrita — fontes de valor

O **corpo JSON** da requisição é lido e endereçável via JSONPath (`$.campo`, `$.a.b`). Cada parâmetro/propriedade das skills de escrita usa **uma** fonte de valor:

| Campo | Origem |
|-------|--------|
| `value` | literal ou `$var` do pipeline |
| `extractFrom` | JSONPath no corpo (`$.a.b`) **ou** `$var` |
| `calculateBy` | função de cálculo: `GENERATE_NEW_UUID_V4` ou `DATETIME_NOW` |

- `putInto` grava o resultado em variável; `putIntoAs` converte o tipo (`integer`, `decimal`, `string`, `boolean`).
- `condition` é uma expressão booleana de 3 tokens (`$x op $y`); falsa → dispara `onFailure`. **Use apenas `statusCode`** em `onFailure` de skills de escrita (`status` é alias deprecated nesses contextos).

## Notas sobre skills AWS

- Todas usam o **AWS SDK for Go v2**. Credenciais e região vêm da cadeia padrão da AWS (`AWS_*`) — **nunca do YAML**.
- Emuladores locais (LocalStack, DynamoDB Local): `AWS_ENDPOINT_URL` ou overrides por serviço (`DYNAMODB_ENDPOINT`, `SNS_ENDPOINT`, `SQS_ENDPOINT`, `CLOUDWATCH_ENDPOINT`).
- **`AwsSendMessage`**: o bloco de config é `awsSqsSendMessage` (usado tanto para SQS quanto para SNS). `type: SQS|SNS`; `queue` = URL da fila (SQS) ou nome/ARN do tópico (SNS — nome é resolvido para ARN via `CreateTopic` idempotente). `message` apontando para objeto/array é serializado automaticamente como string JSON. FIFO exige `fifoOptions: {groupId, deduplicationId}`.
- **`AwsDynamo*`**: `key` é o **valor** da chave de partição; o nome do atributo é `keyName` (padrão `id`). `expressionValues` infere tipos escalares automaticamente (`true`→bool, números→number).

## Notas sobre skills Redis

- Conexão via `REDIS_*` (`REDIS_ADDR` padrão `localhost:6379`, `REDIS_TLS`, `REDIS_USERNAME`, `REDIS_PASSWORD`, `REDIS_DB`, `REDIS_CLUSTER_MODE`) — **nunca no YAML**. `REDIS_ADDR` pode ser `host:port`, `redis://host:port` ou `rediss://host:port` (`rediss://` força TLS).
- `REDIS_CLUSTER_MODE=true` conecta a um Redis/Valkey em **modo cluster** (ex.: o configuration endpoint `clustercfg.*` do AWS ElastiCache/Valkey). `REDIS_ADDR` continua sendo um **único** `host:port` — o cliente (`go-redis` `ClusterClient`) descobre a topologia (`CLUSTER SHARDS`) a partir desse nó seed e roteia cada comando para o shard correto. Nenhuma skill/schema muda. Default `false`. Cluster não suporta múltiplos `REDIS_DB` (mantenha `0`).
- `key` é interpolada (`cliente-$codigoCliente-aporte-$id`).
- `RedisPutItem.data` apontando para objeto/array é serializado automaticamente como JSON; `expireIn` é TTL em **minutos** (0 ou ausente = sem expiração).
- `RedisGetItem.desserializeByJson: true` faz parse do valor como JSON (chave ausente → `null`, step ainda tem sucesso).
- `RedisIncrementItem.value` padrão é `1`.
- Todas aceitam a política `retry`.
