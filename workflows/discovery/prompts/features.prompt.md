${schema_conventions}

Com base nos artefatos abaixo, quebre a oportunidade em itens de backlog no nível de feature. Cada item deve ser classificado como `feature_negocio` ou `enabler` e deve preencher toda a estrutura de detalhamento: classificação, hipótese de benefício, itens habilitados, resumo, objetivo, personas, escopo, regras de negócio, interações com dados, critérios FAC, histórias propostas, dependências, gaps e questões abertas. Use arrays vazios para seções sem evidência; não invente conteúdo para completar o template.

Aplique estas regras de classificação:

- `feature_negocio` entrega uma capacidade ou resultado diretamente percebido por usuário ou stakeholder; use `subtipo_enabler: "nao_aplicavel"` e `itens_habilitados: []`.
- `enabler` entrega valor indireto ao habilitar requisitos de negócio próximos ou reduzir um risco/uma restrição explícita. Classifique-o como `exploracao`, `arquitetura`, `infraestrutura` ou `conformidade`. Em `interacoes_entidades_dados`, também podem aparecer componentes, ambientes e outros ativos técnicos relevantes ao enabler.
- Fundação compartilhada por várias features pode ser um enabler. Trabalho técnico necessário apenas para uma feature deve permanecer como história habilitadora dentro dela, não virar um item deste nível.
- Incerteza técnica deve ser proposta como `spike` nas histórias, com pergunta e evidência esperada; não a descreva como implementação já conhecida.
- Não crie um enabler genérico como "preparar toda a infraestrutura". Decomponha somente resultados técnicos incrementais, verificáveis e necessários às entregas próximas. Não antecipe componentes sem requisito, risco ou restrição que os justifique.

Em `classificacao_fontes`, cite os requisitos, atributos ou decisões que justificam o tipo e o subtipo escolhidos. Em `hipotese_beneficio`, explicite o benefício direto da feature de negócio ou o valor indireto/redução de risco do enabler. Em `itens_habilitados`, um enabler deve referenciar pelos títulos os itens deste mesmo lote que ele habilita quando essa relação estiver sustentada; uma feature de negócio deixa o array vazio. A dependência deve aparecer também no sentido executável em `dependencias_integridade`: o item beneficiado depende do enabler.

A quebra deve manter integridade entre todos os itens: cada requisito relevante dos artefatos acima precisa estar coberto por exatamente um item (cobertura total, sem sobreposição — se dois itens tocarem o mesmo requisito, referencie o item dono em `dependencias_integridade` em vez de duplicar a regra). Registre ali toda dependência com direção coerente (a origem depende do destino) e sinalize como gap qualquer dependência circular em vez de omiti-la. Ao propor `historias_propostas`, identifique no início do texto se a proposta é `[historia_usuario]`, `[historia_habilitadora]` ou `[spike]`; cada endpoint REST novo continua gerando duas histórias (API Gateway e Backend), e um worker/job permanece como uma única história.

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
