# Radahn — Modelo mental e princípios

> **Fonte de conhecimento** do Radahn-Agent. Os agentes (`spec`/`debug`/`help`) carregam
> estas sources conforme o modo. Se você é um agente de IA, **leia a source relevante ao
> seu modo completamente antes de agir**.

O **motor Radahn** é um motor de execução de APIs REST orientado por configuração (*low-code*)
que serve rotas HTTP declaradas em um arquivo `radahn.yaml` (`kind: ApplicationWorkflow`; o
legado `ApiWorkflow` é aceito como alias retrocompatível).

Capacidades do agente:

1. **Autoria (modo `spec`)** — transformar um caso de uso / história em um `radahn.yaml` correto.
2. **Diagnóstico (modo `debug`)** — analisar métricas/logs/tracing e propor correções.
3. **Ajuda (modo `help`)** — explicar o que é o Radahn e esclarecer dúvidas.

## Regras fundamentais
- Nunca invente skills, campos ou comportamentos que não estejam listados nas sources.
- Nunca coloque segredos (senhas, client secrets, tokens) no `radahn.yaml` — eles vêm
  exclusivamente de variáveis de ambiente.
- Prefira o pipeline mínimo que satisfaça o caso de uso; cada step deve justificar sua presença.
- Quando houver dúvida sobre o caso de uso, **faça perguntas objetivas antes de emitir YAML**.

## Fluxo

```
radahn.yaml (rotas + behaviors)  +  variáveis de ambiente  →  radahn (container/binário)  →  API HTTP ativa
```

- Uma **rota** = um endpoint HTTP (método + url + parâmetros).
- Um **behavior** = o **pipeline ordenado de steps** para aquela rota (a chave deve casar com o nome da rota).
- Cada **step** executa uma **skill**; o resultado do step torna-se o input do próximo.
- `onSuccess` / `onFailure` controlam o fluxo e a resposta HTTP.

## Índice das sources
| Arquivo | Conteúdo |
|---------|----------|
| `01-schema.md` | Esquema `ApplicationWorkflow` (referência autoritativa) |
| `02-skills.md` | Catálogo de skills e control steps (config exata) |
| `03-env-vars.md` | Variáveis de ambiente (nunca no YAML) |
| `04-checklist.md` | Armadilhas comuns + checklist pré-emissão |
| `05-diagnostico.md` | Playbook de logs, erros e status HTTP |
| `06-dockerfile.md` | Dockerfile correto para o Radahn |
| `07-validacao-local.md` | Validação local ping/pong via docker/podman |
| `08-iupipes-fake-app.md` | Detecção de `.iupipes.yaml` e app FAKE por linguagem |
| `examples/ping-pong/` | `radahn.yaml` + `Dockerfile` mínimos para validação |
| `repo/` | Documentação completa copiada do repositório |
