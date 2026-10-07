${schema_conventions}

Leia a fonte abaixo (arquivo: ${source_name}) e devolva os campos pedidos pelo schema desta chamada — título, síntese completa, resumo de 1 linha para o índice, e as entidades/conceitos sobre os quais esta fonte traz fatos novos.

Se a fonte traz código — um arquivo de código-fonte, ou blocos de código, consultas SQL, schemas, payloads ou configuração dentro do texto —, devolva em `code_snippets` os trechos que importam para entender o sistema: assinaturas e contratos, regras de negócio implementadas, consultas, estruturas de dados, exemplos de payload. Copie cada trecho literalmente, com as quebras de linha e a indentação originais; nunca reescreva, resuma ou corrija o código. Se um arquivo for longo, escolha os trechos relevantes em vez de copiar tudo. Na `source_summary`, descreva em prosa o que o código faz, sem repetir os trechos. Sem código na fonte, devolva `code_snippets` vazio.

Classifique também a `natureza` desta fonte: `sistema_atual` quando ela descreve, no presente, algo que já existe e roda hoje — documentação técnica, código-fonte, contrato de API, schema de banco (`.sql`), configuração (`.json`/`.yml`/`.yaml`), cenário já implementado (`.feature`) ou qualquer relato de como o sistema funciona agora; `pedido_novo` quando descreve uma mudança, ideia ou requisito ainda não implementado — pedido de cliente, ata de reunião sobre uma funcionalidade nova, e-mail de escopo; `ambos` quando o mesmo documento mistura os dois (ex.: descreve o fluxo atual e já propõe uma mudança nele). Essa classificação alimenta a distinção entre o que já existe e o que é novo nos artefatos gerados a partir da wiki (brief, requisitos, atributos, DER, feature, história).

## Páginas que já existem nesta wiki

${catalog_content}

Antes de listar uma entidade ou um conceito, procure-o nesta lista. Se o assunto já tem página — mesmo que a fonte use outro nome, uma sigla ou um nível de detalhe diferente —, use o título exatamente como aparece na lista e coloque em `aliases` o nome que a fonte usa. Crie um título novo só para um assunto que de fato não está na lista. Prefira títulos curtos e gerais ("Compliance regulatório") a títulos que juntam dois assuntos ("Compliance e auditoria") ou que repetem um detalhe ("SLA 99,9%" é um fato de "Alta disponibilidade", não uma página).

## Conteúdo da fonte

${source_text}
