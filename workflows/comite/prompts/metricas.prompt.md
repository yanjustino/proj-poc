${schema_conventions}

${metodologia}

## Tarefa: Métricas

Registre as métricas que fecham o ciclo de governança desta demanda, **somente com o que as fontes sustentam**:

- `tempo_producao`: data de abertura da demanda e data em que a decisão chegou em produção. Se ainda não chegou, `data_producao: ""` e `situacao: "em_andamento"`.
- `adocao`: o retrato do período (AAAA-MM) — percentual de decisões registradas e de squads usando os templates — quando a reunião trouxer esses números.
- `indicadores`: os indicadores padronizados que as fontes permitem medir. Não inclua "Artefatos materializados por padrão": esse é calculado pelo sistema a partir do catálogo de artefatos.

Um valor sem fonte fica "" e vira um `gap` — nunca estime um número.

## Demanda

${demanda_content}

## ADRs do comitê

${decisoes_content}

## Artefatos executáveis

${artefatos_content}

## Transcrições e wiki do work-item

${wiki_content}

${feedback_content}
