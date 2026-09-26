${schema_conventions}

Com base no item de backlog abaixo e nos artefatos da oportunidade (requisitos, atributos de qualidade, ADRs, DER e diagramas), quebre-o em histórias. Para cada história, preencha toda a estrutura: tipo de história, enunciado adequado ao tipo, classificações, contexto, critérios verificáveis, cenários de aceite, regras, Definition of Done, dependências, fora de escopo, exemplo de uso, rastreabilidade, contratos de interface e questões abertas. Distinga o que **não se aplica** do que **falta**: uma seção que não se aplica a esta história (ex.: exemplo de uso de uma migração interna) fica vazia — string vazia ou array vazio, com fontes vazias —, sem citar `gap`; uma informação que a história precisaria ter e as fontes não trazem vai para `gaps` (fonte `gap`) e, se bloquear a implementação, também para `questoes_abertas`. Não invente contratos ou regras.

Classifique `story_type` como:

- `historia_usuario`: comportamento funcional percebido por uma persona. Preencha `como`, `quero` e `para`; deixe `resultado_tecnico`, `habilita` e `evidenciado_por` vazios; use `nature: "funcional"`.
- `historia_habilitadora`: resultado técnico conhecido que habilita outra história ou feature. Deixe `como`, `quero` e `para` vazios; preencha `resultado_tecnico`, `habilita` e `evidenciado_por`; use `nature: "tecnica"`. Não invente uma persona como "desenvolvedor" apenas para caber em Como/Quero/Para.
- `spike`: investigação timeboxed para responder uma pergunta ainda incerta. Deixe `como`, `quero`, `para`, `resultado_tecnico`, `habilita` e `evidenciado_por` vazios e preencha o objeto `spike`: `pergunta`, `timebox` (ex.: "2 dias"), `metodo`, `evidencia_saida`, `decisao_habilitada` e `criterio_encerramento`; use `nature: "pesquisa"`. Um spike não promete implementação produtiva. Nos demais tipos, deixe todas as strings de `spike` vazias.

Use sempre `work_item_type: "historia"`. Use `subclassification` para a forma de entrega, por exemplo `interface`, `api_gateway`, `backend`, `worker`, `dados`, `infraestrutura`, `arquitetura`, `conformidade` ou `exploracao`, e `specialty` para a especialidade principal responsável. Para histórias habilitadoras e spikes, critérios de aceite e Definition of Done devem comprovar o resultado técnico, aprendizado ou decisão — não apenas listar atividades executadas.

Ao decidir os limites de cada história, siga: cada endpoint REST novo que o sistema **expõe** vira duas histórias — uma de API Gateway (escopo, autenticação, autorização, throttling, mapeamento) e outra de Backend (lógica, validações, persistência, testes, contrato) — ligadas em `dependencias_impedimentos` — a de API Gateway depende da de Backend, nunca o contrário; uma integração de saída (o sistema chama um sistema externo) vira uma única história de backend, com o contrato em `integracoes`; um worker ou job vira uma única história completa (consumo/agendamento, processamento, retry e persistência juntos), pois essas partes não podem ser implantadas de forma independente. Trabalho técnico necessário exclusivamente para uma história funcional fica ligado a ela; fundação compartilhada deve conservar a relação com os itens que habilita. Antes de finalizar a quebra, avalie histórias de usuário e habilitadoras quanto a INVEST (Independente, Negociável, Valiosa, Estimável, Pequena, Testável) e ajuste o escopo se alguma falhar. Para spikes, substitua "Valiosa" por "gera aprendizado decisório" e garanta pergunta, timebox e evidência de saída.

${spec_conventions}

## Item de backlog já gerado

${feature_content}

## Requisitos já gerados

${requisitos_content}

## Atributos de qualidade já gerados

${atributos_content}

## Decisões arquiteturais (ADRs) já geradas

${adr_content}

## Modelo de dados (DER) já gerado

${der_content}

## Diagramas de arquitetura já gerados

${diagramas_content}

${feedback_content}
