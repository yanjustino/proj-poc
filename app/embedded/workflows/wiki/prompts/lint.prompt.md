${schema_conventions}

Analise todas as páginas da wiki abaixo e aponte: contradições entre páginas, alegações que uma fonte mais nova já decidiu ou substituiu, páginas que parecem isoladas do resto da wiki, e conceitos citados repetidamente no texto mas que ainda não têm página própria.

Contradições resolvidas:

- As páginas só acumulam fatos: um fato antigo continua no texto mesmo depois de uma fonte mais nova decidir a questão. Antes de reportar uma contradição, confira se alguma página mais nova a decide — confirma um dos lados, escolhe entre eles ou traz o valor vigente.
- Se decide, reporte cada lado vencido em `stale_claims` (`superseded_by` = a página que decide, `resolution_quote` = o trecho dela que decide). Pode reportar a contradição também, com os dois lados originais: o passo determinístico a fecha sozinho quando os lados vencidos estão em `stale_claims`.
- Uma contradição que nenhuma página mais nova decide continua sendo contradição.

Regras de evidência (um passo determinístico confere tudo e descarta o que não passar):

- Cada página aparece abaixo sob um cabeçalho `# <pasta>/<slug>` (ex.: `# entities/plataforma-de-motoristas`). Use exatamente essa referência em `page`/`superseded_by`/`orphan_pages`.
- `quote` é um trecho copiado literalmente do texto da página — nunca parafraseado, nunca de uma página diferente da indicada.
- Uma contradição precisa de evidência de pelo menos duas páginas diferentes.
- Em uma alegação superada, `page` é a página com o fato antigo, `superseded_by` a página com o fato mais novo e `resolution_quote` um trecho literal de `superseded_by`. Na dúvida sobre qual é mais nova, o `index` e as datas dos blocos `## Fatos (data)` indicam a ordem de ingestão.
- Se não houver evidência literal, não reporte o achado.

## Conteúdo completo da wiki

${wiki_content}
