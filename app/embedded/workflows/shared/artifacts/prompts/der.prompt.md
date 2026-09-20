${schema_conventions}

Com base nos requisitos e nos atributos de qualidade abaixo, preencha integralmente o DER. Classifique o modo como `greenfield`, `as-is` ou `evolucao`; produza Mermaid `erDiagram`; documente glossário de entidades, relacionamentos confirmados e inferidos separadamente, atributos e, no modo evolução, o delta do modelo. Inclua gaps e questões abertas. Use arrays vazios nas seções que não se aplicam e não invente tipos, cardinalidades ou atributos sem marcar a fonte como inferência/gap.

Para decidir se algo é uma entidade de domínio, aplique o teste: "o sistema precisa armazenar e consultar registros deste objeto em um banco de dados?" — só inclua no DER o que passar nesse teste. Nunca inclua como entidade pessoas, papéis, equipes ou organizações externas (stakeholders), nem metodologias, capacidades do sistema ou requisitos não-funcionais (conceitos de processo) — nenhum desses é uma tabela de banco de dados.

## Requisitos já gerados

${requisitos_content}

## Atributos de qualidade já gerados

${atributos_content}

${feedback_content}
