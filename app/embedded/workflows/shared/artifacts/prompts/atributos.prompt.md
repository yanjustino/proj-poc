${schema_conventions}

Com base no conteúdo da wiki e do brief abaixo, preencha o artefato de atributos de qualidade e restrições: contexto, requisitos não-funcionais mensuráveis (NFR), restrições arquiteturais (AC), obrigações de compliance (CO), exclusões e perguntas abertas. IDs devem ser sequenciais por prefixo. Use arrays vazios quando não houver evidência e não invente metas, padrões ou órgãos reguladores.

Este projeto pode ser uma evolução sobre um sistema já existente — nunca assuma greenfield por padrão. Cada fonte da wiki abaixo começa com uma linha `Natureza: Sistema atual`, `Natureza: Pedido novo` ou `Natureza: Sistema atual e pedido novo` — leve isso em conta, junto de qualquer outra indicação de restrições, integrações ou comportamento de um sistema que já roda hoje, e registre isso em `contexto` e classifique cada item de `requisitos_nao_funcionais`, `restricoes_arquiteturais` e `compliance` pelo campo `mudanca`: `as_is` para o que já vale hoje e só é referenciado, `modificado` para o que este projeto altera, `novo` para o que introduz e `removido` para o que deixa de valer. Se nada indicar sistema pré-existente, use `novo` em tudo.

## Brief já gerado

${brief_content}

## Conteúdo da wiki

${wiki_content}

${feedback_content}
