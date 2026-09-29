${schema_conventions}

Com base no conteúdo da wiki e do brief abaixo, preencha o conjunto estruturado de requisitos. Inclua requisitos funcionais (FR), integrações (IR), dados (DR), requisitos de negócio (BR), regras de negócio (RN), exclusões, gaps e perguntas abertas. Preserve separadamente título, descrição, critérios de aceitação e prioridade MoSCoW. IDs devem ser sequenciais dentro de cada prefixo. Use arrays vazios para categorias sem evidência e nunca transforme ausência de informação em requisito inventado.

Este projeto pode ser uma evolução sobre um sistema já existente — nunca assuma greenfield por padrão. Cada fonte da wiki abaixo começa com uma linha `Natureza: Sistema atual`, `Natureza: Pedido novo` ou `Natureza: Sistema atual e pedido novo` — leve isso em conta, junto de termos como "estender", "integrar com", "sistema atual", "base legada" no restante do texto. Deixe isso explícito em `contexto` e classifique cada item de `funcionais`, `integracoes`, `dados`, `negocio` e `regras_negocio` pelo campo `mudanca`: `as_is` para o que já existe e só é referenciado, `modificado` para o que este conjunto de requisitos altera, `novo` para o que cria e `removido` para o que deixa de existir. Essa classificação orienta os artefatos seguintes (DER, feature, história). Se nada indicar sistema pré-existente, use `novo` em tudo.

## Brief já gerado

${brief_content}

## Conteúdo da wiki

${wiki_content}

${feedback_content}
