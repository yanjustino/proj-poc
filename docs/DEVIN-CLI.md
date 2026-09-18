# Execucao no ambiente alvo com Devin CLI

O Senpai usa `devin` como backend de geracao no ambiente alvo. `codex` e
`claude` podem continuar declarados para compatibilidade de desenvolvimento,
mas o seletor de producao nao os executa.

## Preparacao

Requisitos do repositorio:

- `devin` autenticado;
- `mhl` para executar e servir os workflows;
- Go 1.25+ e npm para desenvolver/validar o aplicativo Wails.

Valide a maquina a partir da raiz:

```sh
./scripts/check-devin-environment.sh
```

Em terminal remoto/SSH, autentique com:

```sh
devin auth login --force-manual-token-flow
```

## Uso direto do Devin no repositorio

O arquivo `AGENTS.md` fornece as regras do projeto e `.devin/config.json`
preaprova apenas leitura e comandos usuais de verificacao. Para uma tarefa:

```sh
devin --permission-mode smart -- "implemente a tarefa e rode as verificacoes aplicaveis"
```

Para inspecao sem alteracoes, abra uma sessao e use `/plan` ou `/ask`.
Para automacao nao interativa, use `--print` e, em diretorios ainda nao
confiaveis, `--respect-workspace-trust false`.

## Integracao MHL

`workflows/shared/agents/agents.mh` chama:

```text
devin --model <modelo> --respect-workspace-trust false \
  --permission-mode auto --prompt-file <arquivo-temporario> --print
```

**TEMPORARIO:** `--config <workflows>/shared/agents/devin-generator.json` foi
removido de `agents.mh` porque, combinado com `--permission-mode`, estava
derrubando a chamada com `connection error`/`cognition.ai/errorKind:
unavailable` mesmo com o valor de permission-mode corrigido. Sem `--config`,
o Devin roda SEM o deny-list abaixo — ele pode ler/executar/fazer fetch no
CWD do `mhl` (que contem work-items de outros projetos). Restaurar assim que
a causa raiz for confirmada via a tela de Logs (ver "Visibilidade de
execucao" abaixo).

O prompt e gravado num arquivo temporario dentro do proprio work-item e
removido ao final da chamada. Isso evita o limite de aproximadamente 32 KiB
da linha de comando do Windows sem truncar o documento ou o JSON Schema.

O modelo padrao e `swe-1-6-slow`, disponivel inclusive no plano Free. Defina
`SENPAI_DEVIN_MODEL` para usar outro
modelo permitido pela organizacao; confirme os nomes com
`devin models list --format json`.

O prompt inclui o JSON Schema e exige somente JSON. A configuracao dedicada
`devin-generator.json` bloqueia leitura, busca, edicao, execucao, fetch e MCP.
Isso e intencional: o processo `mhl` trabalha num diretorio que pode conter
varios work-items; o Devin recebe todo o contexto necessario no prompt e nao
deve explorar esse diretorio. O mesmo perfil usa `theme_mode: "nocolor"` e
desliga notificacoes; sem isso, sequencias ANSI podem contaminar o stdout de
`--print` e tornar o JSON invalido para o MHL. O adaptador tambem remove uma
cerca Markdown externa (` ```json ... ``` `), que o CLI pode emitir mesmo
quando o prompt pede JSON cru; cercas dentro de campos sao preservadas.
Respostas vazias observadas em chamadas reais entram na politica de retry do
agente (ate cinco tentativas), junto com timeout, rate limit, erros 500/503 e
falhas transitorias que o CLI marca com `cognition.ai/retryable: true`.
O perfil nao inclui `org_id`, credenciais nem estado de setup: esses dados sao
especificos da instalacao autenticada do usuario e nao podem ser sobrescritos
por uma configuracao distribuida com o aplicativo.

## Visibilidade de execucao

O app tem uma tela de Logs separada da tela principal (icone de terminal na
barra lateral, `data-open-logs` em `shell.js`) que le `mhl_run_logs`
(`app.GetRunLogs` -> `mhlbridge.Client.RunLogs`) e mostra a saida retida de
cada execucao, incluindo o stdout/stderr bruto que os agentes CLI
(Devin/Codex/Claude) produzem via `Writer.generate`. Ela lista as execucoes
da sessao atual (`mhl_run_list`), faz polling do log da execucao selecionada
e tem um botao "Copiar" para levar o texto para um relatório de bug. Antes
dela nao havia nenhum lugar na UI para ver essa saida quando uma chamada de
agente falhava.

## Diferencas em relacao ao Codex/Claude

- O Devin CLI nao possui flag de saida estruturada/JSON Schema. O schema vai
  no prompt e a validacao continua sendo feita pelo fluxo MHL. Uma resposta
  fora do contrato falha antes de qualquer artefato ser gravado.
- `devin --print` nao publica contagem de tokens. `tokens_in` e `tokens_out`
  ficam em `0`, significando "indisponivel", nao consumo zero. A visibilidade
  exata de tokens (C5) fica pendente de suporte oficial da CLI.
- Nao se usa `--sandbox` no gerador: ele permitiria execucoes autonomas e
  ainda exigiria dependencias de plataforma (`bwrap` e `socat` no Linux).
  O gerador nao precisa de ferramentas, que sao negadas na configuracao.
- `--respect-workspace-trust false` e necessario porque `--print` nao pode
  exibir o prompt de confianca usado em sessoes interativas.
- A autenticacao fica na credencial mantida por `devin auth login`; nenhum
  token deve ser versionado ou repassado em argumentos.

## Verificacao antes da entrega

```sh
mhl lint workflows
mhl test workflows
(cd app && go test ./... && go vet ./...)
(cd app/frontend && npm run build)
```

Uma chamada real de geracao exige conta autenticada e consome creditos. Rode
um workflow pequeno no ambiente alvo para homologar modelo, latencia e
conformidade JSON antes da liberacao.
