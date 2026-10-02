${schema_conventions}

Com base nos artefatos abaixo, faça o **roteiro** da quebra da oportunidade em itens de backlog no nível de feature: a lista completa de itens, na ordem em que devem ser entregues, com título, classificação, uma frase de resumo, os requisitos que cada um cobre e, para enablers, os itens que ele habilita. **Não detalhe os itens** — escopo, regras, critérios, histórias e demais seções são produzidos depois, item a item, a partir deste roteiro.

Aplique estas regras de classificação:

- `feature_negocio` entrega uma capacidade ou resultado diretamente percebido por usuário ou stakeholder; use `subtipo_enabler: "nao_aplicavel"` e `habilita: []`.
- `enabler` entrega valor indireto ao habilitar requisitos de negócio próximos ou reduzir um risco/uma restrição explícita. Classifique-o como `exploracao`, `arquitetura`, `infraestrutura` ou `conformidade`.
- Fundação compartilhada por várias features pode ser um enabler. Trabalho técnico necessário apenas para uma feature deve permanecer como história habilitadora dentro dela, não virar um item deste nível.
- Não crie um enabler genérico como "preparar toda a infraestrutura". Decomponha somente resultados técnicos incrementais, verificáveis e necessários às entregas próximas. Não antecipe componentes sem requisito, risco ou restrição que os justifique.

A quebra deve manter integridade entre todos os itens: cada requisito relevante dos artefatos abaixo precisa estar em `requisitos` de **exatamente um** item (cobertura total, sem sobreposição). Em `habilita`, um enabler cita pelos títulos exatos os itens deste roteiro que ele habilita, quando essa relação estiver sustentada pelas fontes.

## Atributos de qualidade e restrições arquiteturais já gerados

${atributos_content}

## Requisitos já gerados

${requisitos_content}

## Decisões arquiteturais (ADRs) já geradas

${adr_content}

## Modelo de dados (DER) já gerado

${der_content}

## Diagramas C4 já gerados

${diagramas_content}

${feedback_content}
