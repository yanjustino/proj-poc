${schema_conventions}

${metodologia}

## Tarefa: ADRs do comitê

Registre cada **decisão arquitetural tomada** nas reuniões como uma ADR. Só entra o que a transcrição mostra como acordado ("decidimos", "fica decidido", "acordamos", aprovação explícita).

Para cada ADR:

1. `strength`: DEVE, DEVERIA ou PODE, pelo que foi dito. Na dúvida entre DEVE e DEVERIA, escolha DEVERIA e registre a dúvida em `contexto`.
2. `mecanismo_conformidade` é obrigatório e concreto:
   - **DEVE** exige um mecanismo que impeça o desvio (`artefato`, `gate` ou `preventivo`) — um documento sozinho não basta.
   - **DEVERIA** exige `caminho_excecao` (ADR própria justificando o desvio).
   - **PODE** pode ficar em `documento`, acompanhado por indicador de adoção.
   Se a reunião não definiu o mecanismo, proponha o mais simples coerente com a força e marque `inferência`.
3. `reversibilidade`: estime o custo de reverter. Uma decisão reversível em dias provavelmente pertence ao time, não ao comitê — diga isso em `contexto` quando for o caso.
4. `consequencias_negativas`: toda decisão real tem custo.
5. `artefatos_relacionados`: templates, catálogo de serviços, runbooks, dashboards ou policies citados na reunião como materialização. Uma ADR `aprovada` sem nenhum artefato é um alerta: registre o artefato necessário mesmo que ainda não exista.
6. `rfc_origem`: o título exato de uma RFC abaixo quando a decisão a resolve; senão "".

## Demanda

${demanda_content}

## RFCs em aberto

${rfc_content}

## Transcrições e wiki do work-item

${wiki_content}

${feedback_content}
