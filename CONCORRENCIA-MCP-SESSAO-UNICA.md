# Concorrência no processo único do `mhl`: causa raiz e solução

## O problema

O Senpai sobe **um único processo `mhl`** (via `mhl serve mcp --http`) por sessão de app,
e o `mhlbridge.Client` abre **uma única sessão MCP** (`Mcp-Session-Id`) para a vida inteira
desse processo. Todo chamador do lado do Senpai — polling de execução de run, geração de
preview de artefato, consulta de uso/tokens — compartilha essa mesma sessão.

Isso é normal e não é, por si só, o bug: sessão única por processo é como o protocolo MCP
foi desenhado para ser usado. O problema aparece quando **mais de uma requisição chega ao
`mhl` ao mesmo tempo carregando esse mesmo `Mcp-Session-Id`**. Nesse caso o `mhl` falhava
de forma intermitente com `Error: decode response: EOF` (e, em alguns casos, `404 Not
Found` ao consultar o status de uma run).

Esse sintoma apareceu na prática ao gerar uma coleção de ADRs: o Senpai disparava vários
`RunStart` em paralelo (um por item da coleção) na mesma sessão, e uma fração deles
quebrava.

## Como a causa raiz foi isolada

A primeira hipótese foi "o `mhl` não aguenta *pipelines* rodando em paralelo" — foi
descartada porque o `mhl` tem `parallel`, `spawn ... wait` e `--max-concurrent-runs`
justamente para isso, e testar com esses recursos configurados (`--max-concurrent-runs 4`)
não eliminou a falha (2/8 falhas nesse limite, e piorou para 4/8 com limite 1 — ou seja,
não era um problema de capacidade de execução).

A hipótese que se confirmou, testada com um cliente HTTP isolado (sem nenhum código do
Senpai envolvido, batendo direto no endpoint MCP do `mhl`):

- **Mesma sessão, várias requisições concorrentes:** 9 falhas em 40 tentativas.
- **Sessões diferentes, uma por requisição, mesma carga concorrente:** 0 falhas em 40
  tentativas.

Ou seja: o `mhl` não é seguro contra múltiplas requisições HTTP em voo simultaneamente
**sob o mesmo `Mcp-Session-Id`**. É um problema do lado do servidor `mhl` (fora do código
do Senpai — ver `mhl-bug-report.md`), mas como o Senpai não pode alterar o runtime `mhl`,
a correção precisou ser feita inteiramente do lado do cliente.

## A solução do lado do cliente

Como o `mhlbridge.Client` mantém uma sessão só para todo o processo, e qualquer chamador
pode competir por ela a qualquer momento, a correção certa não podia ser "serializar só a
geração de preview" — precisava proteger **todo** ponto de entrada MCP, já que run
polling, preview em lote e consulta de uso passam todos pelo mesmo canal.

A solução: um mutex (`sync.Mutex`) dentro de `mhlbridge.Client`, segurado durante a ida e
volta HTTP completa de cada chamada MCP (`postRPC`, em `app/mhlbridge/mhlbridge.go`). Isso
serializa todas as chamadas ao `mhl` nessa sessão — nenhuma delas mais compete com outra
pelo mesmo `Mcp-Session-Id` em voo — sem exigir nenhuma mudança de comportamento nos
chamadores.

Como consequência, o código de UI que gerava os previews de coleção
(`appendPausedPreview`, em `app/frontend/src/views/tab-artefatos.js`) pôde voltar a disparar
todos os itens em paralelo (`Promise.all`), em vez do loop sequencial que tinha sido usado
como paliativo enquanto a causa raiz ainda não era conhecida: a segurança contra a
concorrência agora vive numa camada só, no cliente MCP, não espalhada pelos pontos de
chamada.

## Validação

Foi escrito um teste de regressão real (`app/mhlbridge_concurrency_test.go`,
`TestMHLBridge_ConcurrentCallsOnTheSharedSessionNeverFail`), que dispara 8 chamadas
concorrentes por rodada, em 5 rodadas, usando o `mhlbridge.Client` de produção contra o
binário `mhl` vendorizado real (não um mock).

- Com o mutex **removido** propositalmente: 16 falhas reais de `decode response: EOF` em 2
  das 5 rodadas — confirma que o teste pega a regressão de verdade.
- Com o mutex **restaurado**: 0 falhas em 3 execuções consecutivas, além da suíte completa
  (`go test ./...`) passando limpa.

## Resumo para quem for revisar

- **Sintoma:** `Error: decode response: EOF` ao gerar previews de coleção (ADRs,
  histórias, diagramas, features).
- **Causa raiz:** o `mhl` não suporta múltiplas requisições concorrentes sob o mesmo
  `Mcp-Session-Id`; o Senpai usa uma sessão única por processo `mhl`, então qualquer
  concorrência entre chamadores do lado do cliente expõe esse limite do servidor.
- **Não era:** falta de paralelismo configurado no `mhl` (`--max-concurrent-runs` não
  resolve, porque o limite não é de capacidade de execução).
- **Correção do lado do cliente:** mutex único em `mhlbridge.Client.postRPC`, serializando
  toda chamada MCP dessa sessão — a mudança fica concentrada numa única camada em vez de
  cada chamador ter que coordenar isso por conta própria.
- **Efeito colateral positivo:** o código de UI que gera previews pôde voltar a ser
  paralelo, já que a proteção contra a corrida agora é garantida mais abaixo, no cliente.
