${schema_conventions}

Com base nos artefatos abaixo, preencha toda a estrutura da história: tipo, enunciado adequado ao tipo, classificações, contexto, critérios verificáveis, cenários Gherkin, regras, Definition of Done, dependências, fora de escopo, exemplo de uso, contratos de interface e questões abertas. Use string vazia ou array vazio para seções opcionais sem evidência e cite a ausência como `gap`; não invente contratos ou regras.

Classifique `story_type` como:

- `historia_usuario`: comportamento funcional percebido por uma persona. Preencha `como`, `quero` e `para`; deixe `resultado_tecnico`, `habilita` e `evidenciado_por` vazios; use `nature: "funcional"`.
- `historia_habilitadora`: resultado técnico conhecido que habilita outra história ou feature. Deixe `como`, `quero` e `para` vazios; preencha `resultado_tecnico`, `habilita` e `evidenciado_por`; use `nature: "tecnica"`. Não invente uma persona como "desenvolvedor" apenas para caber em Como/Quero/Para.
- `spike`: investigação timeboxed para responder uma pergunta ainda incerta. Deixe `como`, `quero` e `para` vazios; em `resultado_tecnico`, declare a pergunta; em `habilita`, a decisão ou item desbloqueado; em `evidenciado_por`, a evidência esperada; use `nature: "pesquisa"`. Um spike não promete implementação produtiva.

Use sempre `work_item_type: "historia"`. Use `subclassification` para a forma de entrega, por exemplo `interface`, `api_gateway`, `backend`, `worker`, `dados`, `infraestrutura`, `arquitetura`, `conformidade` ou `exploracao`, e `specialty` para a especialidade principal responsável. Para histórias habilitadoras e spikes, critérios de aceite e Definition of Done devem comprovar o resultado técnico, aprendizado ou decisão, não apenas listar atividades executadas.

Esta história pode ser uma evolução sobre um sistema já existente — nunca assuma greenfield por padrão. Se os requisitos, ADRs, DER ou diagramas acima descreverem comportamento, entidades ou dependências que já existem hoje (termos como "estender", "integrar com", "sistema atual", "base legada"), marque esses itens com o prefixo `[AS-IS]` no início do texto em `contexto_negocio`, `regras_negocio` e `dependencias_impedimentos`; marque o que é novo ou alterado por esta história com `[MODIFICAÇÃO]`. Se nada indicar sistema pré-existente, trate tudo como novo e não use os prefixos.

## Requisitos já gerados

${requisitos_content}

## Decisões arquiteturais (ADR) já geradas

${adr_content}

## Modelo de dados (DER) já gerado

${der_content}

## Diagramas já gerados

${diagramas_content}

${feedback_content}
