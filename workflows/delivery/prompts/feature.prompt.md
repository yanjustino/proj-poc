${schema_conventions}

Com base nos artefatos abaixo, preencha toda a estrutura do detalhamento do item no nível de feature: classificação, hipótese de benefício, itens habilitados, resumo, objetivo, personas, escopo, regras de negócio, interações com entidades e dados, aderência arquitetural, critérios FAC, histórias propostas, dependências, gaps e questões abertas. Use arrays vazios para seções sem evidência e não invente conteúdo apenas para completar o template.

Classifique `tipo_item` como `feature_negocio` quando a entrega produzir uma capacidade ou resultado diretamente percebido por usuário ou stakeholder. Nesse caso, use `subtipo_enabler: "nao_aplicavel"` e `itens_habilitados: []`.

Classifique `tipo_item` como `enabler` somente quando a entrega produzir valor indireto ao habilitar requisitos de negócio próximos ou reduzir um risco/uma restrição explícita. Use `subtipo_enabler` igual a `exploracao`, `arquitetura`, `infraestrutura` ou `conformidade`. Fundação compartilhada pode ser enabler; trabalho técnico local de uma única entrega deve permanecer como história habilitadora da feature de negócio. Não transforme um conjunto especulativo como "preparar toda a infraestrutura" em enabler: descreva um resultado incremental e verificável. Em `itens_habilitados`, referencie somente itens beneficiados que estejam sustentados pelos artefatos; caso não sejam nomeados, deixe o array vazio e registre a ausência em `gaps`. Para um enabler, `interacoes_entidades_dados` também pode registrar componentes, ambientes e outros ativos técnicos relevantes.

Em `classificacao_fontes`, cite os requisitos ou decisões que justificam o tipo e o subtipo escolhidos. Em `hipotese_beneficio`, explicite o benefício direto da feature de negócio ou o valor indireto/redução de risco do enabler. Em `medicao_beneficio`, torne a hipótese verificável: `metrica` (o indicador que deve mudar — para um enabler, o indicador técnico ou de risco que ele melhora), `baseline` (valor atual; num sistema novo, sem valor atual, escreva `inexistente — sistema novo`; se o valor existe mas é desconhecido, deixe vazio e registre em `gaps`), `meta`, `janela` de medição e `guardrails` (indicadores que não podem piorar). Em `historias_propostas`, informe para cada proposta o `tipo` (`historia_usuario`, `historia_habilitadora` ou `spike`), o `titulo` e o `resultado` observável que ela entrega; use spike apenas para uma incerteza cuja saída seja aprendizado ou decisão verificável. Cada endpoint REST novo continua gerando duas histórias (API Gateway e Backend), e um worker/job permanece como uma única história.

Este item pode ser uma evolução sobre um sistema já existente — nunca assuma greenfield por padrão. Se os requisitos, ADRs, DER ou diagramas acima descreverem comportamento, entidades ou dependências que já existem hoje (termos como "estender", "integrar com", "sistema atual", "base legada"), classifique cada item de `em_escopo`, `regras_negocio`, `interacoes_entidades_dados` e `dependencias_sistema` pelo campo `mudanca`: `as_is` para o que já existe e só é referenciado, `modificado` para o que este item altera, `novo` para o que cria e `removido` para o que deixa de existir. Se nada indicar sistema pré-existente, use `novo` em tudo.

Em `aderencia_arquitetural`, ligue o item à arquitetura de solução acima: uma entrada por elemento que ele usa, altera ou precisa respeitar, com `tipo` (`conteiner` para um elemento dos diagramas C4 — contêiner, banco ou sistema externo; `entidade` para uma entidade do DER; `adr` para uma decisão; `atributo` para um requisito não funcional, restrição arquitetural ou item de compliance), `ref` com o identificador exato como aparece no artefato (id ou nome do elemento C4, nome da entidade, `ADR-NNN`, id do atributo), `como` o item o usa ou respeita e `mudanca`. Cite os ADRs e as restrições que condicionam a implementação do item, não só os que ele cria. Um elemento que a arquitetura ainda não tem só entra como `novo` se um ADR o decidir (cite-o) ou se o item for o enabler de arquitetura/infraestrutura que o introduz; caso contrário, registre a divergência em `gaps` — não invente componente para encaixar o item. Um enabler de arquitetura cita o ADR que materializa. Só um enabler de exploração pode deixar o array vazio.

## Requisitos já gerados

${requisitos_content}

## Decisões arquiteturais (ADR) já geradas

${adr_content}

## Modelo de dados (DER) já gerado

${der_content}

## Diagramas já gerados

${diagramas_content}

${feedback_content}
