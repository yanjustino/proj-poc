${schema_conventions}

Analise todas as páginas da wiki abaixo e aponte: contradições entre páginas, alegações que uma fonte mais nova provavelmente já superou, páginas que parecem isoladas do resto da wiki, e conceitos citados repetidamente no texto mas que ainda não têm página própria.

Regras de evidência (um passo determinístico confere tudo e descarta o que não passar):

- Cada página aparece abaixo sob um cabeçalho `# <pasta>/<slug>` (ex.: `# entities/plataforma-de-motoristas`). Use exatamente essa referência em `page`/`superseded_by`/`orphan_pages`.
- `quote` é um trecho copiado literalmente do texto da página — nunca parafraseado, nunca de uma página diferente da indicada.
- Uma contradição precisa de evidência de pelo menos duas páginas diferentes.
- Em uma alegação superada, `page` é a página com o fato antigo e `superseded_by` a página com o fato mais novo. Na dúvida sobre qual é mais nova, o `index` e as datas dos blocos `## Fatos (data)` indicam a ordem de ingestão.
- Se não houver evidência literal, não reporte o achado.

## Conteúdo completo da wiki

${wiki_content}
