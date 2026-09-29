${schema_conventions}

Leia a fonte abaixo (arquivo: ${source_name}) e devolva os campos pedidos pelo schema desta chamada — título, síntese completa, resumo de 1 linha para o índice, e as entidades/conceitos sobre os quais esta fonte traz fatos novos.

Classifique também a `natureza` desta fonte: `sistema_atual` quando ela descreve, no presente, algo que já existe e roda hoje — documentação técnica, contrato de API, schema de banco (`.sql`), configuração (`.json`/`.yml`/`.yaml`), cenário já implementado (`.feature`) ou qualquer relato de como o sistema funciona agora; `pedido_novo` quando descreve uma mudança, ideia ou requisito ainda não implementado — pedido de cliente, ata de reunião sobre uma funcionalidade nova, e-mail de escopo; `ambos` quando o mesmo documento mistura os dois (ex.: descreve o fluxo atual e já propõe uma mudança nele). Essa classificação alimenta a distinção entre o que já existe e o que é novo nos artefatos gerados a partir da wiki (brief, requisitos, atributos, DER, feature, história).

## Conteúdo da fonte

${source_text}
