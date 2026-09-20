${schema_conventions}

Com base nos artefatos abaixo, quebre a oportunidade em features e preencha para cada uma toda a estrutura de detalhamento: resumo, objetivo, personas, escopo, regras de negócio, interações com dados, critérios FAC, histórias propostas, dependências, gaps e questões abertas. Use arrays vazios para seções sem evidência; não invente conteúdo para completar o template.

A quebra em features deve manter integridade entre si: cada requisito relevante dos artefatos acima precisa estar coberto por exatamente uma feature (cobertura total, sem sobreposição — se duas features tocarem o mesmo requisito, referencie a feature dona em `dependencias_integridade` em vez de duplicar a regra em ambas). Registre em `dependencias_integridade` toda dependência entre features com direção coerente (a origem depende do destino) e sinalize como gap qualquer dependência circular em vez de omiti-la. Ao propor `historias_propostas`, já considere que cada endpoint REST novo vai gerar duas histórias (API Gateway e Backend) e que um worker/job permanece como uma única história.

## Requisitos já gerados

${requisitos_content}

## Decisões arquiteturais (ADRs) já geradas

${adr_content}

## Modelo de dados (DER) já gerado

${der_content}

## Diagramas C4 já gerados

${diagramas_content}

${feedback_content}
