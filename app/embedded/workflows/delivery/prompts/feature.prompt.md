${schema_conventions}

Com base nos artefatos abaixo, preencha toda a estrutura do detalhamento da feature: resumo, objetivo, personas, escopo, regras de negócio, interações com entidades e dados, critérios FAC, histórias propostas, dependências, gaps e questões abertas. Use arrays vazios para seções sem evidência e não invente conteúdo apenas para completar o template.

Esta feature pode ser uma evolução sobre um sistema já existente — nunca assuma greenfield por padrão. Se os requisitos, ADRs, DER ou diagramas acima descreverem comportamento, entidades ou dependências que já existem hoje (termos como "estender", "integrar com", "sistema atual", "base legada"), marque esses itens com o prefixo `[AS-IS]` no início do texto em `em_escopo`, `regras_negocio`, `interacoes_entidades_dados` e `dependencias_sistema`; marque o que é novo ou alterado por esta feature com `[MODIFICAÇÃO]`. Se nada indicar sistema pré-existente, trate tudo como novo e não use os prefixos. Ao propor `historias_propostas`, considere que cada endpoint REST novo vai gerar duas histórias (API Gateway e Backend) e que um worker/job permanece como uma única história.

## Requisitos já gerados

${requisitos_content}

## Decisões arquiteturais (ADR) já geradas

${adr_content}

## Modelo de dados (DER) já gerado

${der_content}

## Diagramas já gerados

${diagramas_content}

${feedback_content}
