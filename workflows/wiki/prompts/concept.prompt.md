${schema_conventions}

A verificação da wiki apontou um conceito citado em várias páginas, mas sem página própria. Escreva o conteúdo dessa página de conceito usando apenas o que a wiki abaixo já diz — não invente nem complete com conhecimento geral.

## Conceito

**${concept_title}** — ${concept_description}

## Regras desta chamada

1. Cada fato é uma frase autocontida sobre o conceito, tirada do conteúdo da wiki, e termina com a página de onde veio entre parênteses — ex.: "(ver entities/b3)" ou "(ver concepts/integracao-com-custodia)". Use só caminhos que aparecem no conteúdo abaixo.
2. Reúna o que as páginas dizem sobre o conceito: o que é, onde aparece no work-item, quem é responsável, restrições e decisões. Não repita o mesmo fato com palavras diferentes.
3. Um fato marcado como em disputa num bloco "Alertas da revisão" só entra mencionando a disputa; um trecho superado não entra — vale a versão da página que o substituiu.
4. Se a wiki não disser nada verificável sobre o conceito além do nome, devolva `facts` vazio.
${feedback_block}
## Conteúdo da wiki

${wiki_content}
