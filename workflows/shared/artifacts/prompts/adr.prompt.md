${schema_conventions}

Com base nos requisitos e nos atributos de qualidade abaixo, identifique as decisões arquiteturais relevantes já tomadas ou implícitas neles. Só inclua decisões que os requisitos e atributos realmente sustentem; não invente arquitetura que não foi discutida.

Cada decisão segue o formato MADR (Markdown Architectural Decision Records) — não é um resumo em prosa, é um registro de raciocínio comparativo. Para cada uma:

1. **Contexto e problema**: qual situação ou restrição força esta escolha a ser feita agora. Pode ser formulado como uma pergunta.
2. **Fatores de decisão**: as forças em jogo — normalmente um atributo de qualidade, uma restrição arquitetural ou um requisito não-funcional específico dos artefatos abaixo.
3. **Opções consideradas**: pelo menos duas alternativas genuinamente avaliadas, não uma opção "de verdade" e uma "de fachada" só para preencher o mínimo. Se honestamente só existe uma opção viável, a segunda é a alternativa trivial (ex. "manter como está" / "não adotar X"), mas trate-a com a mesma seriedade nos prós e contras.
4. **Prós e contras de cada opção** (inclusive a escolhida) — argumentos concretos, não genéricos ("mais simples de operar" em vez de "melhor opção").
5. **Decisão final**: qual opção venceu e por que — o critério eliminatório, a força que ela resolve, ou o equilíbrio de trade-offs que a tornou melhor que as demais.
6. **Consequências**, separadas em positivas e negativas. Toda decisão real tem custo — se nada de negativo vier à mente, releia os atributos de qualidade e as opções descartadas em busca do que se perdeu ao não escolhê-las.

Use `links` apenas para relações entre decisões desta mesma lista (ex. uma decisão que refina ou depende de outra que você também está gerando agora); deixe vazio se nenhuma se aplica.

## Requisitos já gerados

${requisitos_content}

## Atributos de qualidade já gerados

${atributos_content}

${feedback_content}
