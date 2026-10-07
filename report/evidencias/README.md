# Evidências — IT26019, Relatório de Resposta v1

Anexo do [relatório](../IT26019-Relatorio-Resposta-v1.md). Gerado em 07/10/2026 a partir do commit `9c5678c83a9e52f9130d8a00718986cc60c81988`.

## Conteúdo

| Pasta ou arquivo | O que contém |
|---|---|
| [`codigo/`](codigo/) | Cópias integrais e congeladas dos 31 arquivos-fonte citados no relatório, com a estrutura de diretórios e a numeração de linhas originais. |
| [`fontes-sha256.json`](fontes-sha256.json) | Para cada arquivo: caminho original, SHA-256, número de linhas, primeiro commit em que apareceu e indicação de modificação local não versionada (nenhum tinha). |
| [`testes/`](testes/) | Saídas completas de `mhl lint workflows`, `mhl test workflows`, `go test -short -count=1 -v ./...` e `go vet ./...`, executados em 07/10/2026. |
| [`demonstracao/`](demonstracao/) | Demonstração reproduzível do gateway: o script [`it26019_demo.mh`](demonstracao/it26019_demo.mh), a saída da execução e, em [`saida/`](demonstracao/saida/), o work item sintético, a classificação de prontidão e o pacote de handoff gerado. |
| [`historico/`](historico/) | Histórico completo de commits; trecho do handoff com bloqueio rígido (`441a008`, 26/09/2026); diff da transição para bloqueio por instrução (`c059c57`, 29/09/2026). |
| [`saidas-sha256.txt`](saidas-sha256.txt) | SHA-256 de cada arquivo em `testes/`, `demonstracao/` e `historico/`. |

## Resultados

| Verificação | Resultado |
|---|---|
| `mhl lint workflows` | Sem problemas (`exit=0`) |
| `mhl test workflows` | 64 arquivos, 57 com testes, 397 casos, **1.181 asserções aprovadas, 0 falhas** |
| `go test -short ./...` (em `app/`) | **130 testes e subtestes aprovados, 0 falhas.** 1 omitido por usar LLM real (`TestModoBuddyPauseResume_WikiIngest`) |
| `go vet ./...` | Sem diagnósticos |
| Demonstração do gateway | **16 de 16 asserções aprovadas** |

## Como reproduzir

Requisitos: MHL `1.5.0-alpha.2`, Go compatível com `app/go.mod` e o repositório no commit acima.

```bash
# 1. Testes dos workflows — numa cópia, para não criar fixtures em projects/
cp -R workflows /tmp/senpai-copia/
mhl lint /tmp/senpai-copia/workflows
mhl test /tmp/senpai-copia/workflows

# 2. Testes do app
cd app && go test -short -count=1 ./... && go vet ./...

# 3. Demonstração do gateway (dados sintéticos)
cp report/evidencias/demonstracao/it26019_demo.mh /tmp/senpai-copia/workflows/shared/artifacts/
cd /tmp/senpai-copia && mhl test workflows/shared/artifacts/it26019_demo.mh
# o pacote gerado fica em /tmp/senpai-copia/projects/it26019-demo/handoff/
```

Para conferir as cópias congeladas: `shasum -a 256 <arquivo>` deve coincidir com o valor em `fontes-sha256.json`.

## O que a demonstração prova

O script monta um work item **sintético** com uma feature aprovada (4 histórias) e uma feature rejeitada (1 história), executa as ferramentas reais do SENPAI e verifica:

1. **Classificação determinística, sem LLM:**
   - "Consultar ordem" fica **pronta**;
   - "Cancelar ordem" fica **não pronta**, com `CA2` sem cenário, referência a `CA7` inexistente e plano sem teste;
   - "Notificar execução" fica **pronta com ressalvas**, por ter uma lacuna e depender de uma história não pronta;
   - "Exportar extrato" fica **não pronta**, por estar sem plano.
2. **Bloqueio por rejeição:** gerar ou aprovar histórias da feature rejeitada falha com "foi rejeitada".
3. **Bloqueio por predecessor:** gerar requisitos sem brief falha antes de qualquer chamada ao LLM.
4. **Handoff:**
   - a feature rejeitada é excluída;
   - as histórias não prontas são exportadas com o motivo do bloqueio;
   - o `AGENTS.md` proíbe o agente de código de implementar uma história bloqueada sem confirmação.

Arquivos gerados para inspeção: [`saida/readiness.json`](demonstracao/saida/readiness.json), [`saida/demo-resultado.json`](demonstracao/saida/demo-resultado.json), [`saida/handoff/README.md`](demonstracao/saida/handoff/README.md) e [`saida/handoff/specs/FT001-consulta/US002-cancelar-ordem/spec.md`](demonstracao/saida/handoff/specs/FT001-consulta/US002-cancelar-ordem/spec.md).

## Limites

- Nenhum dado de work item real foi lido. Todos os dados são fixtures sintéticas.
- Os testes omitem chamadas reais ao LLM. Eles provam os mecanismos determinísticos e as integrações locais, e não a qualidade das respostas do modelo.
- As saídas de teste contêm caminhos locais da máquina de análise. Isso é irrelevante para o conteúdo.
