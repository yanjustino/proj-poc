${schema_conventions}

Com base nos artefatos abaixo, preencha toda a estrutura do detalhamento do item no nível de feature: classificação, hipótese de benefício, itens habilitados, resumo, objetivo, personas, escopo, regras de negócio, interações com entidades e dados, critérios FAC, histórias propostas, dependências, gaps e questões abertas. Use arrays vazios para seções sem evidência e não invente conteúdo apenas para completar o template.

Classifique `tipo_item` como `feature_negocio` quando a entrega produzir uma capacidade ou resultado diretamente percebido por usuário ou stakeholder. Nesse caso, use `subtipo_enabler: "nao_aplicavel"` e `itens_habilitados: []`.

Classifique `tipo_item` como `enabler` somente quando a entrega produzir valor indireto ao habilitar requisitos de negócio próximos ou reduzir um risco/uma restrição explícita. Use `subtipo_enabler` igual a `exploracao`, `arquitetura`, `infraestrutura` ou `conformidade`. Fundação compartilhada pode ser enabler; trabalho técnico local de uma única entrega deve permanecer como história habilitadora da feature de negócio. Não transforme um conjunto especulativo como "preparar toda a infraestrutura" em enabler: descreva um resultado incremental e verificável. Em `itens_habilitados`, referencie somente itens beneficiados que estejam sustentados pelos artefatos; caso não sejam nomeados, deixe o array vazio e registre a ausência em `gaps`. Para um enabler, `interacoes_entidades_dados` também pode registrar componentes, ambientes e outros ativos técnicos relevantes.

Em `classificacao_fontes`, cite os requisitos ou decisões que justificam o tipo e o subtipo escolhidos. Em `hipotese_beneficio`, explicite o benefício direto da feature de negócio ou o valor indireto/redução de risco do enabler. Ao propor `historias_propostas`, identifique no início do texto se a proposta é `[historia_usuario]`, `[historia_habilitadora]` ou `[spike]`; use spike apenas para uma incerteza cuja saída seja aprendizado ou decisão verificável. Cada endpoint REST novo continua gerando duas histórias (API Gateway e Backend), e um worker/job permanece como uma única história.

Este item pode ser uma evolução sobre um sistema já existente — nunca assuma greenfield por padrão. Se os requisitos, ADRs, DER ou diagramas acima descreverem comportamento, entidades ou dependências que já existem hoje (termos como "estender", "integrar com", "sistema atual", "base legada"), marque esses itens com o prefixo `[AS-IS]` no início do texto em `em_escopo`, `regras_negocio`, `interacoes_entidades_dados` e `dependencias_sistema`; marque o que é novo ou alterado por este item com `[MODIFICAÇÃO]`. Se nada indicar sistema pré-existente, trate tudo como novo e não use os prefixos.

## Requisitos já gerados

${requisitos_content}

## Decisões arquiteturais (ADR) já geradas

${adr_content}

## Modelo de dados (DER) já gerado

${der_content}

## Diagramas já gerados

${diagramas_content}

${feedback_content}
