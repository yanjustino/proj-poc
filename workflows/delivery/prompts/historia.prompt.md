${schema_conventions}

Com base nos artefatos abaixo, preencha toda a estrutura da história: tipo, enunciado adequado ao tipo, classificações, contexto, critérios verificáveis, cenários de aceite, regras, Definition of Done, dependências, fora de escopo, exemplo de uso, rastreabilidade, contratos de interface e questões abertas. Distinga o que **não se aplica** do que **falta**: uma seção que não se aplica a esta história (ex.: exemplo de uso de uma migração interna) fica vazia — string vazia ou array vazio, com fontes vazias —, sem citar `gap`; uma informação que a história precisaria ter e as fontes não trazem vai para `gaps` (fonte `gap`) e, se bloquear a implementação, também para `questoes_abertas`. Não invente contratos ou regras.

Classifique `story_type` como:

- `historia_usuario`: comportamento funcional percebido por uma persona. Preencha `como`, `quero` e `para`; deixe `resultado_tecnico`, `habilita` e `evidenciado_por` vazios; use `nature: "funcional"`.
- `historia_habilitadora`: resultado técnico conhecido que habilita outra história ou feature. Deixe `como`, `quero` e `para` vazios; preencha `resultado_tecnico`, `habilita` e `evidenciado_por`; use `nature: "tecnica"`. Não invente uma persona como "desenvolvedor" apenas para caber em Como/Quero/Para.
- `spike`: investigação timeboxed para responder uma pergunta ainda incerta. Deixe `como`, `quero`, `para`, `resultado_tecnico`, `habilita` e `evidenciado_por` vazios e preencha o objeto `spike`: `pergunta`, `timebox` (ex.: "2 dias"), `metodo`, `evidencia_saida`, `decisao_habilitada` e `criterio_encerramento`; use `nature: "pesquisa"`. Um spike não promete implementação produtiva. Nos demais tipos, deixe todas as strings de `spike` vazias.

Use sempre `work_item_type: "historia"`. Use `subclassification` para a forma de entrega, por exemplo `interface`, `api_gateway`, `backend`, `worker`, `dados`, `infraestrutura`, `arquitetura`, `conformidade` ou `exploracao`, e `specialty` para a especialidade principal responsável. Para histórias habilitadoras e spikes, critérios de aceite e Definition of Done devem comprovar o resultado técnico, aprendizado ou decisão, não apenas listar atividades executadas.

Esta história pode ser uma evolução sobre um sistema já existente — nunca assuma greenfield por padrão. Se os requisitos, ADRs, DER ou diagramas acima descreverem comportamento, entidades ou dependências que já existem hoje (termos como "estender", "integrar com", "sistema atual", "base legada"), descreva em `contexto_negocio` o que já existe e o que esta história muda, e classifique cada item de `regras_negocio` e `dependencias_impedimentos` pelo campo `mudanca`: `as_is` para o que já existe e só é referenciado, `modificado` para o que esta história altera, `novo` para o que cria e `removido` para o que deixa de existir. Se nada indicar sistema pré-existente, use `novo` em tudo.

${spec_conventions}

## Requisitos já gerados

${requisitos_content}

## Decisões arquiteturais (ADR) já geradas

${adr_content}

## Modelo de dados (DER) já gerado

${der_content}

## Diagramas já gerados

${diagramas_content}

${feedback_content}
