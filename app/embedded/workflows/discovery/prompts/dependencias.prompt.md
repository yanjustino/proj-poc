${schema_conventions}

Com base no backlog de features de negócio e enablers abaixo (cada item já com seu código `FT00N` definitivo, no cabeçalho `# features/FT00N-slug` que antecede seu conteúdo), monte o mapa de dependências entre os itens e uma ordem de execução sugerida.

Para cada item listado em `features`, preencha `depende_de` com uma entrada por item do qual ele depende — releia com atenção as seções "Classificação do Item", "Itens Habilitados" e "Dependências e Relações de Integridade" de cada um. Um item beneficiado por um enabler depende desse enabler, e não o inverso. As relações já foram escritas referenciando títulos porque os códigos ainda não existiam; aqui você tem ambos, então resolva cada referência para o `feature_codigo` real. Um item sem dependências tem `depende_de: []` — não invente uma dependência para preencher o campo. Nunca inclua o próprio item em seu `depende_de`.

Em `ordem_execucao`, devolva todo `feature_codigo`/`feature_titulo` exatamente uma vez, numa ordem onde toda feature aparece depois de tudo que está no seu próprio `depende_de` (ordenação topológica). Se houver uma dependência circular real entre features, registre isso em `gaps` com as duas (ou mais) features envolvidas e ainda assim devolva uma ordem completa (quebre o ciclo pela dependência mais fraca/menos citada, deixando claro em `gaps` que foi uma escolha arbitrária).

Em `diagrama_mermaid`, produza um `graph LR` do Mermaid com um nó por `feature_codigo` (rótulo = o próprio código) e uma seta de cada pré-requisito para quem depende dele (`FT001 --> FT002` significa "FT002 depende de FT001"). Mesmo grafo que `depende_de` descreve, só que desenhado.

## Backlog de features já gerado

${features_content}

${feedback_content}
