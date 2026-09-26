${schema_conventions}

Produza o **plano de implementação** da história abaixo — o documento que um desenvolvedor (ou um agente de código) segue para construí-la. A história já define o comportamento, os critérios de aceite, a rastreabilidade e os contratos de interface; o plano define **como** implementar, respeitando a arquitetura já decidida.

- `abordagem`: a estratégia de implementação em um parágrafo.
- `componentes`: onde o código muda — o contêiner **exato** do diagrama C4 e o componente/módulo dentro dele, com o que muda em cada um.
- `adrs`: as decisões arquiteturais que se aplicam e como cada uma restringe esta implementação.
- `dados`: as entidades **exatas** do DER que a história cria, lê, atualiza ou remove, com os campos envolvidos e a migração necessária, se houver.
- `fluxo`: os passos do fluxo principal entre participantes (a pessoa, os contêineres, componentes e sistemas externos), em ordem — marque as respostas com `retorno: true`. Os endpoints e eventos devem ser os dos contratos da história.
- `erros`, `seguranca`, `observabilidade`: o tratamento de falhas previstas pelas regras e critérios, os controles de segurança exigidos pelos atributos e ADRs, e os logs/métricas/traces necessários para operar a funcionalidade.
- `tarefas`: passos pequenos (poucas horas cada), ordenados (`T1`, `T2`…) e verificáveis. Escreva as tarefas de **teste antes** das de implementação que elas cobrem (TDD). Toda tarefa referencia em `criterios` os critérios de aceite que ajuda a satisfazer — `CA1` é o primeiro item de `criterios_aceite` da história, `CA2` o segundo, e assim por diante — e em `depende_de` só tarefas anteriores. **Todo critério de aceite precisa de ao menos um teste.**
- `testes`: a estratégia por nível (unitário, integração, contrato a partir do OpenAPI/AsyncAPI da história, e2e — os testes de aceitação partem dos `cenarios` da história, gravados como `historia.feature`), cada um com os critérios que cobre.
- `riscos`: riscos técnicos e questões em aberto que podem bloquear a implementação.

Use somente o que os artefatos sustentam. Onde faltar informação (ex.: um componente que o C4 não detalha), faça a dedução razoável marcada como `inferência` ou registre como `gap` e em `riscos`.

## História a implementar

${historia_content}

## Item de backlog (feature) da história

${feature_content}

## Requisitos

${requisitos_content}

## Atributos de qualidade

${atributos_content}

## Decisões arquiteturais (ADRs)

${adr_content}

## Modelo de dados (DER)

${der_content}

## Diagramas de arquitetura

${diagramas_content}

${feedback_content}
