${schema_conventions}

Com base no conteúdo da wiki abaixo, preencha integralmente o resumo estratégico: resumo executivo (3 a 5 frases), contexto de negócio, objetivos com resultados esperados, escopo, stakeholders e seus interesses, métricas, marcos, riscos/dependências e perguntas abertas. Datas só podem aparecer quando explicitamente sustentadas. Use arrays vazios quando uma seção opcional não tiver evidência; não invente itens para preencher espaço.

Separe o problema de negócio da hipótese de solução: escreva resumo executivo, objetivos e escopo em termos de capacidades e resultados de negócio (ex. "agilidade para alterar regras", "redução de abandono"), nunca em termos de tecnologia. Nomes de componentes técnicos (AWS, Lambda, filas, frameworks etc.) só podem aparecer em riscos/dependências ou perguntas abertas — se a wiki citar uma tecnologia como se fosse objetivo, extraia o benefício de negócio por trás dela para a seção correta e mova o nome da tecnologia para riscos/dependências.

Este projeto pode ser uma evolução sobre um sistema já existente — nunca assuma greenfield por padrão. Cada fonte da wiki abaixo começa com uma linha `Natureza: Sistema atual` (já existe e roda hoje), `Natureza: Pedido novo` (ainda não implementado) ou `Natureza: Sistema atual e pedido novo` (mistura os dois) — leve isso em conta, junto de termos como "estender", "integrar com", "sistema atual", "base legada". Deixe a distinção explícita em `contexto_negocio`: o que já roda hoje, separado do que este projeto pretende mudar ou adicionar. Ela orienta a classificação `mudanca` dos artefatos seguintes (requisitos, DER, feature, história). Se nada indicar sistema pré-existente, trate o contexto como uma iniciativa nova.

## Conteúdo da wiki

${wiki_content}

${feedback_content}
