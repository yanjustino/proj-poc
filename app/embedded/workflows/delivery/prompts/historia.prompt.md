${schema_conventions}

Com base nos artefatos abaixo, preencha toda a estrutura da história: Como/Quero/Para, classificações, contexto, critérios verificáveis, cenários Gherkin, regras, Definition of Done, dependências, fora de escopo, exemplo de uso, contratos de interface e questões abertas. Use string vazia ou array vazio para seções opcionais sem evidência e cite a ausência como `gap`; não invente contratos ou regras.

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
