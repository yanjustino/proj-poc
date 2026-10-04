${schema_conventions}

Analise todas as páginas da wiki abaixo e aponte: contradições entre páginas, alegações que uma fonte mais nova já decidiu ou substituiu, páginas que parecem isoladas do resto da wiki, e conceitos citados repetidamente no texto mas que ainda não têm página própria.

Contradições resolvidas:

- As páginas só acumulam fatos: um fato antigo continua no texto mesmo depois de uma fonte mais nova decidir a questão. Antes de reportar uma contradição, confira se alguma página mais nova a decide — confirma um dos lados, escolhe entre eles ou traz o valor vigente.
- Se decide, reporte cada lado vencido em `stale_claims` (`superseded_by` = a página que decide, `resolution_quote` = o trecho dela que decide). Pode reportar a contradição também, com os dois lados originais: o passo determinístico a fecha sozinho quando os lados vencidos estão em `stale_claims`.
- Uma contradição que nenhuma página mais nova decide continua sendo contradição.

Conceitos sem página — só sugira um conceito que atenda a TODOS os critérios:

- É específico do domínio ou deste work-item: uma regra de negócio, um processo, um termo técnico, financeiro ou regulatório (ex.: "Settlement", "Batch diário", "Marcação a mercado", "Suitability").
- Aparece em pelo menos duas páginas diferentes, e cada uma diz algo sobre ele.
- Renderia uma página com pelo menos dois fatos próprios, além da definição.
- Ainda não tem página — nem com outro nome: confira os títulos das páginas de `entities/` e `concepts/` e o `index`.

Nunca sugira termos genéricos de software, documento ou gestão, mesmo que apareçam em toda página: sistema, aplicação, aplicativo, plataforma, usuário, cliente, dados, banco de dados, API, integração, PDF, arquivo, documento, relatório, tela, interface, funcionalidade, requisito, processo, projeto, MVP, e-mail, login. Na dúvida, não sugira — no máximo 5, os mais citados primeiro.

Regras de evidência (um passo determinístico confere tudo e descarta o que não passar):

- Cada página aparece abaixo sob um cabeçalho `# <pasta>/<slug>` (ex.: `# entities/plataforma-de-motoristas`). Use exatamente essa referência em `page`/`superseded_by`/`orphan_pages`.
- `quote` é um trecho copiado literalmente do texto da página — nunca parafraseado, nunca de uma página diferente da indicada.
- Uma contradição precisa de evidência de pelo menos duas páginas diferentes.
- Em uma alegação superada, `page` é a página com o fato antigo, `superseded_by` a página com o fato mais novo e `resolution_quote` um trecho literal de `superseded_by`. Na dúvida sobre qual é mais nova, o `index` e as datas dos blocos `## Fatos (data)` indicam a ordem de ingestão.
- Em um conceito sem página, cada item de `mentions` cita uma página diferente, e `quote` é um trecho literal dela que contém o nome do conceito (`title`).
- Se não houver evidência literal, não reporte o achado.

## Conteúdo completo da wiki

${wiki_content}
