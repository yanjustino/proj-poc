# Variáveis de ambiente (nunca no YAML)

> **Regra de ouro:** segredos e configuração de infraestrutura **nunca** vão no `radahn.yaml`.
> Eles vêm exclusivamente de variáveis de ambiente. O agente **não** faz o setup dessas
> variáveis — apenas gera um arquivo `.env` com os nomes e comentários para o engenheiro preencher.

| Variável | Usada por | Default |
|----------|-----------|---------|
| `RADAHN_ADDR` | endereço de escuta do motor | `:8080` |
| `RADAHN_CONFIG` | caminho para o radahn.yaml | `radahn.yaml` |
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASSWORD` | Postgres e MySQL (compartilhadas) | host `localhost`, porta pg `5432`, mysql `3306` |
| `DB_SSL_MODE` | Postgres e MySQL compartilham `DB_SSL_MODE`; valores possíveis (texto, deve ser válido para o driver): `disable`, `allow`, `prefer`, `require`, `verify-ca`, `verify-full`, `true`, `false`, `skip-verify`, `preferred` | `disable` |
| `POSTGRES_DB_*` | override Postgres (fallback para `DB_*`); `POSTGRES_DB_SSL_MODE` aceita `disable`, `allow`, `prefer`, `require`, `verify-ca`, `verify-full` | — |
| `MYSQL_DB_*` | override MySQL (fallback para `DB_*`) | — |
| `MYSQL_DB_SSL_MODE` | MySQL (`go-sql-driver/mysql`); valores literais do driver: `true`, `false`, `skip-verify`, `preferred` | `false` |
| `HTTP_AUTHORIZE_URL` `HTTP_AUTHORIZE_CLIENT_ID` `HTTP_AUTHORIZE_CLIENT_SECRET` | `HttpAuthorize` | — |
| `AWS_REGION` `AWS_ACCESS_KEY_ID` `AWS_SECRET_ACCESS_KEY` `AWS_SESSION_TOKEN` | Skills AWS (SNS/SQS/CloudWatch/DynamoDB) | cadeia padrão AWS SDK |
| `AWS_ENDPOINT_URL` | override genérico de endpoint AWS (LocalStack) | — |
| `DYNAMODB_ENDPOINT` `SNS_ENDPOINT` `SQS_ENDPOINT` `CLOUDWATCH_ENDPOINT` | overrides por serviço | — |
| `REDIS_ADDR` `REDIS_TLS` `REDIS_USERNAME` `REDIS_PASSWORD` `REDIS_DB` `REDIS_CLUSTER_MODE` | Skills `Redis*`. `REDIS_CLUSTER_MODE=true` conecta a um Redis/Valkey em modo cluster (ex.: `clustercfg.*` do ElastiCache) — `REDIS_ADDR` continua sendo um único `host:port` (nó seed); a topologia é descoberta automaticamente (`CLUSTER SHARDS`). Cluster não suporta múltiplos `REDIS_DB`. | addr `localhost:6379`, db `0`, cluster mode `false` |
| `KAFKA_<NOME>_BROKERS` (CSV) `_CLIENT_ID` `_TLS_ENABLED` `_TLS_CERT` `_TLS_KEY` `_TLS_CA` `_TLS_INSECURE` `_SASL_MECHANISM` `_SASL_USER` `_SASL_PASSWORD` | Cluster lógico `<nome>` das skills Kafka (`<nome>` com *fold* p/ `_`, ex.: `data-transfer` → `DATA_TRANSFER`). `_TLS_CA` é a **cadeia da CA**, nunca o certificado do cliente. | sem TLS/SASL; `client.id` = `sarama` |
| `KAFKA_SR_URL` `KAFKA_SR_USER` `KAFKA_SR_PASSWORD` `KAFKA_SR_TLS_*` | Schema Registry (Avro) das skills Kafka. `USER`/`PASSWORD` = Basic Auth; **omita as duas** em Schema Registry mTLS (preencher só uma envia Basic Auth inválido). | — |
| `KAFKA_CERT_URL` `KAFKA_CERT_USER` `KAFKA_CERT_PASSWORD` `KAFKA_CERT_P12_PASSWORD` `KAFKA_CERT_COMMUNITY` `KAFKA_CERT_SIGLA` | `KafkaCertDownload`. No `profile: kaas` a skill **publica** `KAFKA_<CLUSTER>_TLS_CERT/_TLS_KEY/_TLS_CA` (e `KAFKA_SR_TLS_*` com `applyToSchemaRegistry`) — declará-las manualmente tem precedência e desativa a publicação. `KAFKA_CERT_URL` é opcional quando `environment` resolve o endpoint por alias. | — |
| `OTEL_EXPORTER_OTLP_ENDPOINT` `OTEL_EXPORTER_OTLP_PROTOCOL` `OTEL_EXPORTER_OTLP_HEADERS` `OTEL_EXPORTER_OTLP_INSECURE` `OTEL_SERVICE_NAME` `OTEL_TRACES_SAMPLER[_ARG]` `OTEL_RESOURCE_ATTRIBUTES` `RADAHN_TRACING_ENABLED` | Tracing OpenTelemetry (`spec.otel`) | tracing desligado |

> **Múltiplos bancos:** `PostgresQuery` e `MySqlQuery` usam por padrão as mesmas `DB_*`. Para usar os dois simultaneamente, defina `POSTGRES_DB_*` e `MYSQL_DB_*`.

## Modelo de `.env` gerado pelo agente

O agente gera um `.env` **apenas com nomes e comentários**, sem valores reais. Exemplo:

```dotenv
# ==========================================================================
# Configuração do Radahn — PREENCHA os valores conforme o seu ambiente.
# NÃO faça commit de segredos. Estas variáveis vêm da infraestrutura em prod.
# ==========================================================================

# Endereço de escuta e caminho do arquivo de configuração
RADAHN_ADDR=:8080
RADAHN_CONFIG=radahn.yaml

# --- Banco de dados (preencha se usar PostgresQuery/MySqlQuery/*Operation) ---
# DB_HOST=
# DB_PORT=
# DB_NAME=
# DB_USER=
# DB_PASSWORD=
# DB_SSL_MODE=disable

# --- OAuth2 client_credentials (preencha se usar HttpAuthorize) ---
# HTTP_AUTHORIZE_URL=
# HTTP_AUTHORIZE_CLIENT_ID=
# HTTP_AUTHORIZE_CLIENT_SECRET=

# --- Kafka (preencha se usar KafkaPublish/KafkaConsume/KafkaAck) -------------
# <NOME> = nome logico do cluster no YAML (cluster: events -> KAFKA_EVENTS_*)
# KAFKA_<NOME>_BROKERS=
# KAFKA_<NOME>_CLIENT_ID=          # client.id; obrigatorio em brokers que autorizam por cliente
# KAFKA_<NOME>_TLS_ENABLED=true
# KAFKA_<NOME>_TLS_CA=             # CADEIA da CA (nunca o certificado do cliente)
# KAFKA_SR_URL=                    # Schema Registry, se decode/encode avro

# --- KafkaCertDownload, profile kaas (KCert v2) ------------------------------
# As TLS_CERT/TLS_KEY/TLS_CA do cluster e do Schema Registry sao publicadas pela
# propria skill; declara-las aqui desativa a publicacao automatica.
# KAFKA_CERT_URL=                  # opcional se `environment` resolve por alias
# KAFKA_CERT_USER=
# KAFKA_CERT_PASSWORD=             # senha de dupla custodia (criptografada)
# KAFKA_CERT_P12_PASSWORD=
# KAFKA_CERT_COMMUNITY=
# KAFKA_CERT_SIGLA=
```

> O agente inclui **apenas** os blocos correspondentes às skills efetivamente usadas no
> `radahn.yaml` gerado, sempre comentados e com instrução clara de preenchimento.
