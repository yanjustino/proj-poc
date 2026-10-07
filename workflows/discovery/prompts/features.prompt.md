${schema_conventions}

Com base nos artefatos abaixo, detalhe itens de backlog no nível de feature. A quebra da oportunidade já foi decidida num roteiro (no fim deste pedido): detalhe só os itens que ele indica para esta resposta, com o mesmo título, tipo e subtipo, e use o roteiro inteiro para manter cobertura e dependências coerentes com os demais itens. Cada item deve ser classificado como `feature_negocio` ou `enabler` e deve preencher toda a estrutura de detalhamento: classificação, hipótese de benefício, itens habilitados, resumo, objetivo, personas, escopo, regras de negócio, interações com dados, aderência arquitetural, critérios FAC, histórias propostas, dependências, gaps e questões abertas. Use arrays vazios para seções sem evidência; não invente conteúdo para completar o template.

Aplique estas regras de classificação:

- `feature_negocio` entrega uma capacidade ou resultado diretamente percebido por usuário ou stakeholder; use `subtipo_enabler: "nao_aplicavel"` e `itens_habilitados: []`.
- `enabler` entrega valor indireto ao habilitar requisitos de negócio próximos ou reduzir um risco/uma restrição explícita. Classifique-o como `exploracao`, `arquitetura`, `infraestrutura` ou `conformidade`. Em `interacoes_entidades_dados`, também podem aparecer componentes, ambientes e outros ativos técnicos relevantes ao enabler.
- Fundação compartilhada por várias features pode ser um enabler. Trabalho técnico necessário apenas para uma feature deve permanecer como história habilitadora dentro dela, não virar um item deste nível.
- Incerteza técnica deve ser proposta como `spike` nas histórias, com pergunta e evidência esperada; não a descreva como implementação já conhecida.
- Não crie um enabler genérico como "preparar toda a infraestrutura". Decomponha somente resultados técnicos incrementais, verificáveis e necessários às entregas próximas. Não antecipe componentes sem requisito, risco ou restrição que os justifique.

Em `classificacao_fontes`, cite os requisitos, atributos ou decisões que justificam o tipo e o subtipo escolhidos. Em `hipotese_beneficio`, explicite o benefício direto da feature de negócio ou o valor indireto/redução de risco do enabler. Em `medicao_beneficio`, torne a hipótese verificável: `metrica` (o indicador que deve mudar — para um enabler, o indicador técnico ou de risco que ele melhora), `baseline` (valor atual; num sistema novo, sem valor atual, escreva `inexistente — sistema novo`; se o valor existe mas é desconhecido, deixe vazio e registre em `gaps`), `meta`, `janela` de medição e `guardrails` (indicadores que não podem piorar). Em `itens_habilitados`, um enabler deve referenciar pelos títulos os itens deste mesmo lote que ele habilita quando essa relação estiver sustentada; uma feature de negócio deixa o array vazio. A dependência deve aparecer também no sentido executável em `dependencias_integridade`: o item beneficiado depende do enabler.

A quebra deve manter integridade entre todos os itens: cada requisito relevante dos artefatos acima precisa estar coberto por exatamente um item (cobertura total, sem sobreposição — se dois itens tocarem o mesmo requisito, referencie o item dono em `dependencias_integridade` em vez de duplicar a regra). Registre ali toda dependência com direção coerente (a origem depende do destino) e sinalize como gap qualquer dependência circular em vez de omiti-la. Em `historias_propostas`, informe para cada proposta o `tipo` (`historia_usuario`, `historia_habilitadora` ou `spike`), o `titulo` e o `resultado` observável que ela entrega; cada endpoint REST novo continua gerando duas histórias (API Gateway e Backend), e um worker/job permanece como uma única história. Em `em_escopo`, `regras_negocio`, `interacoes_entidades_dados` e `dependencias_sistema`, `mudanca` indica se o item é `novo`, `modificado` (altera algo existente), `as_is` (já existe e só é referenciado) ou `removido` — numa oportunidade sem sistema pré-existente, tudo é `novo`.

Em `aderencia_arquitetural`, ligue o item à arquitetura de solução acima: uma entrada por elemento que ele usa, altera ou precisa respeitar, com `tipo` (`conteiner` para um elemento dos diagramas C4 — contêiner, banco ou sistema externo; `entidade` para uma entidade do DER; `adr` para uma decisão; `atributo` para um requisito não funcional, restrição arquitetural ou item de compliance), `ref` com o identificador exato como aparece no artefato (id ou nome do elemento C4, nome da entidade, `ADR-NNN`, id do atributo), `como` o item o usa ou respeita e `mudanca`. Cite os ADRs e as restrições que condicionam a implementação do item, não só os que ele cria. Um elemento que a arquitetura ainda não tem só entra como `novo` se um ADR o decidir (cite-o) ou se o item for o enabler de arquitetura/infraestrutura que o introduz; caso contrário, registre a divergência em `gaps` — não invente componente para encaixar o item. Um enabler de arquitetura cita o ADR que materializa. Só um enabler de exploração pode deixar o array vazio.

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

${lote_content}

${feedback_content}
