${schema_conventions}

${metodologia}

## Tarefa: Artefatos executáveis

Monte o catálogo de **artefatos executáveis** que materializam as ADRs abaixo: templates (código, configuração, IaC), itens do catálogo de serviços, runbooks, dashboards e policies.

- Toda ADR com status `aprovada`, `em-execucao` ou `em-homologacao` precisa de pelo menos um artefato. Se a reunião não citou nenhum, proponha o artefato necessário (`situacao: "necessario"`) coerente com o mecanismo de conformidade da ADR e marque `inferência`.
- `adr_ids` usa os ids das ADRs exatamente como aparecem nos cabeçalhos abaixo (ex.: `decisoes/ADR-0001-titulo` → `"ADR-0001"`).
- `nivel_mecanismo` segue os quatro níveis: documento → artefato reutilizável → gate no pipeline → controle preventivo.
- Paved road: descreva por que usar o artefato é mais rápido que o atalho.

## ADRs do comitê

${decisoes_content}

${feedback_content}
