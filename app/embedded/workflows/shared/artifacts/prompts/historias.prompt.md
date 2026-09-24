${schema_conventions}

Com base no item de backlog abaixo, quebre-o em histórias. Para cada história, preencha toda a estrutura: tipo de história, enunciado adequado ao tipo, classificações, contexto, critérios verificáveis, cenários Gherkin, regras, Definition of Done, dependências, fora de escopo, exemplo de uso, contratos de interface e questões abertas. Use string vazia ou array vazio para seções opcionais sem evidência e cite a ausência como `gap`; não invente contratos ou regras.

Classifique `story_type` como:

- `historia_usuario`: comportamento funcional percebido por uma persona. Preencha `como`, `quero` e `para`; deixe `resultado_tecnico`, `habilita` e `evidenciado_por` vazios; use `nature: "funcional"`.
- `historia_habilitadora`: resultado técnico conhecido que habilita outra história ou feature. Deixe `como`, `quero` e `para` vazios; preencha `resultado_tecnico`, `habilita` e `evidenciado_por`; use `nature: "tecnica"`. Não invente uma persona como "desenvolvedor" apenas para caber em Como/Quero/Para.
- `spike`: investigação timeboxed para responder uma pergunta ainda incerta. Deixe `como`, `quero` e `para` vazios; em `resultado_tecnico`, declare a pergunta a responder; em `habilita`, declare a decisão ou item desbloqueado; em `evidenciado_por`, declare a evidência esperada; use `nature: "pesquisa"`. Um spike não promete implementação produtiva.

Use sempre `work_item_type: "historia"`. Use `subclassification` para a forma de entrega, por exemplo `interface`, `api_gateway`, `backend`, `worker`, `dados`, `infraestrutura`, `arquitetura`, `conformidade` ou `exploracao`, e `specialty` para a especialidade principal responsável. Para histórias habilitadoras e spikes, critérios de aceite e Definition of Done devem comprovar o resultado técnico, aprendizado ou decisão — não apenas listar atividades executadas.

Ao decidir os limites de cada história, siga: cada endpoint REST novo vira duas histórias — uma de API Gateway (escopo, autenticação, autorização, throttling, mapeamento) e outra de Backend (lógica, validações, persistência, testes, contrato) — ligadas em `dependencias_impedimentos`; um worker ou job vira uma única história completa (consumo/agendamento, processamento, retry e persistência juntos), pois essas partes não podem ser implantadas de forma independente. Trabalho técnico necessário exclusivamente para uma história funcional fica ligado a ela; fundação compartilhada deve conservar a relação com os itens que habilita. Antes de finalizar a quebra, avalie histórias de usuário e habilitadoras quanto a INVEST (Independente, Negociável, Valiosa, Estimável, Pequena, Testável) e ajuste o escopo se alguma falhar. Para spikes, substitua "Valiosa" por "gera aprendizado decisório" e garanta pergunta, timebox e evidência de saída.

## Item de backlog já gerado

${feature_content}

${feedback_content}
