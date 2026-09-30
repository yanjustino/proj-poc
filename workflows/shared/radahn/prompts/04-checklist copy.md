# Armadilhas comuns + checklist pré-emissão

## Armadilhas mais comuns na autoria

1. **`NextStep`** é a grafia correta do `onSuccess`.
2. **`LogicalOperator` (alias `StaticValidation`) é uma condição de ERRO por padrão** — `$dataInicial > $dataFinal` falha quando o início é posterior ao fim. Não inverta a lógica. Use `breakByFailure: true` para disparar `onFailure` quando a condição for VERDADEIRA.
3. **`behaviors.<nome>` deve casar exatamente com `routes.<nome>`**, caso contrário a rota não tem pipeline.
4. **Segredos nunca vão no YAML.** Credenciais de banco e OAuth vêm de variáveis de ambiente (`03-env-vars.md`).
5. **Placeholders SQL `$n`** devem estar alinhados com a ordem da lista `parameters:`.
6. **`localStore` antes de `MergeLocalStore`** — só é possível fazer merge de nomes que foram armazenados anteriormente.
7. **JSONPath `extractResult`** deve casar com o shape real do payload do subsistema (`$.data.items`, `$.itens`, `$` para array na raiz, `$.access_token`, ...).
8. **`Finish` é obrigatório** em algum ponto acessível; caso contrário o pipeline encerra implicitamente no último step (ainda retorna o resultado atual, mas seja explícito).
9. **YAML usa espaços, não tabs.** Tabs quebram o parsing.
10. **`correlationId`** — `calculateBy` e `headerName` são mutuamente exclusivos; use apenas um.
11. **`HttpStatusCodeResult`** deve sempre usar `onSuccess: Finish`.
12. **`Parallel` não é skill-folha** — não existe no registry; é um control step do motor. Dentro de uma
    branch, **`Finish` encerra apenas a branch** (não a request). Segredos continuam vindo de variáveis de
    ambiente (uma branch `HttpSearch`/DB não muda essa regra). Nomes de branch devem ser únicos e cada
    branch precisa de ao menos um step; `strategy` só aceita `object|collect|merge`.
13. **`ForEach` não é skill-folha** — control step do motor (sequencial). Dentro dos `steps`, use
    `extractFrom: $.campo` para ler o **item corrente** (o item é o `data`/`body` da sub-sessão), e
    `$item`/`$index` para o elemento inteiro / índice. **`onSuccess: Continue`** avança o loop.
    `extractFrom` do `ForEach` é obrigatório e resolve contra o **data atual**; exige ao menos um step.
14. **Para >1 behavior, use `spec.include`** para dividir o workflow em arquivos e facilitar a manutenção.

## Procedimento de autoria

**Passo A — Entrevista** (pergunte apenas o que está faltando):
- Qual recurso/endpoint? Método HTTP e caminho da URL? Path params vs query params (nome, tipo, obrigatório, default)?
- Fontes de dados: qual(is) banco(s) e tabelas, ou quais APIs HTTP de subsistemas (URL, auth, shape da resposta)?
- Validações: alguma regra de entrada (intervalos de data, campos obrigatórios, schema JSON)? Tratamento de "não encontrado"?
- Shape de saída: quais campos expor e seus nomes (mapeamento)?
- Agregação: combinar múltiplas fontes em uma única resposta?

**Passo B — Designe o pipeline** como lista ordenada de steps. Padrões típicos:
- *Leitura simples*: `Query(Item)` → `EmptyValidation(404)` → `OutputTransformer` → `Finish`.
- *Lista filtrada*: `LogicalOperator` → `Query(Array)` → `EmptyValidation(204)` → `OutputTransformer` → `Finish`.
- *BFF agregado (sequencial)*: `Query` → `EmptyValidation` → `HttpAuthorize` → (`HttpSearch` → `OutputTransformer` → `{localStore}`)×N → `MergeLocalStore` → `Finish`.
- *BFF agregado (paralelo)*: `Parallel` com uma branch por fonte (`HttpSearch`/`Query`) + `consolidate.strategy: object` → `onSuccess: Finish`.
- *Escrita*: `JsonValidation(422)` → `DataValidation(404)` → `PostgresOperation` → `HttpOperation` → `HttpStatusCodeResult(201)` → `Finish`.

**Passo C — Emita o YAML**, depois execute o checklist abaixo.

**Passo D — Informe ao engenheiro quais variáveis de ambiente são necessárias** (`03-env-vars.md`) e forneça um `curl` para testar.

## Checklist pré-emissão (execute antes de retornar o YAML)

- [ ] `kind: ApplicationWorkflow` presente (ou o alias legado `ApiWorkflow`).
- [ ] Todo `routes.<nome>` tem um `behaviors.<nome>` correspondente.
- [ ] Todo `kind` de step é uma skill real (`02-skills.md`) com seu bloco de config correto.
- [ ] Todas as `$vars` usadas são produzidas (params de rota, `putInto`, ou steps anteriores).
- [ ] Contagem e ordem de `$1..$n` SQL casam com a lista `parameters:`.
- [ ] Cada `HttpSearch.extractResult` casa com o shape documentado do payload.
- [ ] Nomes de `localStore` existem antes de qualquer `MergeLocalStore` que os referencie.
- [ ] Ao menos um `Finish` acessível.
- [ ] Códigos de status em `onFailure` fazem sentido (400 entrada, 404 não-encontrado, 204 vazio, 422 schema, 500 inesperado).
- [ ] Nenhum segredo no arquivo; indentação com espaços (não tabs).
- [ ] `HttpStatusCodeResult` encerra com `onSuccess: Finish`.
- [ ] `correlationId` usa apenas `calculateBy` **ou** `headerName`, nunca os dois.
- [ ] Em `Parallel`: cada branch tem `name` único e ≥ 1 step; `consolidate.strategy` ∈ `object|collect|merge`; branches usam `onSuccess: Finish` para encerrar (a branch, não a request).
- [ ] Em `ForEach`: `extractFrom` presente e apontando para uma lista; ≥ 1 step; itens lidos via `$.campo`/`$item`/`$index`; `onSuccess: Continue` para avançar o loop; `breakOnFirstFail` definido conforme o requisito.
- [ ] Para >1 behavior, considerou `spec.include` para dividir o arquivo.
