${schema_conventions}

Com base nos requisitos, nos atributos de qualidade e nas decisões arquiteturais abaixo, produza o **modelo arquitetural** do sistema: os diagramas C4 de **contexto** e de **contêiner**, descritos como dados — elementos e relações.

O modelo é revisado e editado por uma pessoa, em tabelas, **antes** dos demais diagramas. Você não escreve Mermaid: o desenho, a legenda e as cores são gerados por código a partir dos dados. Por isso cada tabela precisa ser fácil de revisar: nomes curtos, sem repetição dentro do mesmo diagrama, e só o que as fontes sustentam.

## `sistema` — o sistema em escopo

**Um** sistema de software — o que o time constrói ou evolui. Ele é a caixa central do contexto e a fronteira do diagrama de contêiner; não entra em `elementos` de nenhum dos dois.

## `contexto` — diagrama de contexto

- Elementos: as `pessoa` (usuários, papéis, personas) e os `sistema_externo` (sistemas fora da responsabilidade do time) que interagem **diretamente** com o sistema em escopo.
- Relações: cada uma liga um elemento ao sistema em escopo, ou o sistema a um elemento, usando o id reservado **`sistema`** (ex.: `cliente` → `sistema` "Compra produtos em"). Escreva a relação como ela deve aparecer para quem vê o sistema de fora — uma por par, resumindo a interação.
- **Sem tecnologia, protocolo ou detalhe de implementação**: `tecnologia` vazia em todos os elementos e relações. É o diagrama para pessoas não técnicas.

## `conteineres` — diagrama de contêiner

- Elementos principais: `container` para uma aplicação (API, aplicação web, SPA, app mobile, worker, função) e `banco_dados` para um armazenamento de dados (banco, schema, bucket, fila persistida). Cada um **com tecnologia**.
- Fronteiras (`fronteiras`): normalmente **uma**, o sistema em escopo (mesmo nome de `sistema`). Use mais de uma só quando as fontes mostrarem contêineres de outro sistema de software sob responsabilidade do time que precisam aparecer no mesmo diagrama. Cada `container` e `banco_dados` informa em `fronteira` o id da fronteira onde está.
- Elementos de apoio: as pessoas e os sistemas externos ligados diretamente aos contêineres, com `fronteira` vazia. Repita aqui os do contexto que se ligam a contêineres, **com o mesmo nome** — os ids são de cada diagrama e podem repetir.
- Relações: quem chama quem, ligando pessoas e sistemas externos ao contêiner específico com que interagem. Entre dois contêineres, **com tecnologia/protocolo** (HTTPS/JSON, gRPC, JDBC, AMQP…); com um sistema externo, o protocolo quando as fontes o definem.
- **Não modele implantação** (cluster, balanceador, replicação, failover, região, Kubernetes/EKS) nem componentes internos de um contêiner.

## Regras comuns

- Todo elemento precisa aparecer em ao menos uma relação do seu diagrama.
- Cada `id` é curto e único **dentro do seu diagrama** (ex.: `cliente`, `api-pedidos`).
- **Textos curtos — eles aparecem dentro das caixas e setas do desenho**, como nos exemplos de https://c4model.com:
  - `nome`: poucas palavras (ex.: "Worker de Conciliação").
  - `descricao`: **uma frase curta, até ~80 caracteres**, só com a responsabilidade principal. Sem códigos de transação, nomes de tabela, listas de casos ou justificativas — esse detalhe fica nos requisitos e nas ADRs.
  - `tecnologia`: só o nome, até ~30 caracteres (ex.: "Java/Quarkus", "Amazon S3", "Kafka"). Alternativas, ressalvas e "a confirmar" não entram aqui — pertencem a uma ADR.
  - `descricao` da relação: com verbo, até ~45 caracteres (ex.: "Consome mensagens de", "Grava resultados em").
- Tecnologia ou protocolo que não esteja nos artefatos abaixo (em especial nas ADRs): deixe `tecnologia` **vazia**, cite `gap` nas `fontes` e registre a lacuna em `gaps` — nunca escreva "não definido nas fontes" ou equivalente no texto. Uma dedução razoável usa `inferência`.

## Requisitos já gerados

${requisitos_content}

## Atributos de qualidade já gerados

${atributos_content}

## Decisões arquiteturais (ADRs) já geradas

${adr_content}

${feedback_content}
