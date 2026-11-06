# Bibliotecas vendorizadas

O frontend não usa npm nem etapa de build. O navegador carrega os módulos ES de
`src/` direto, e as bibliotecas de terceiros ficam aqui, em arquivo único e sem
dependências externas.

| Arquivo | Pacote | Versão | Origem no pacote |
|---|---|---|---|
| `marked.esm.js` | `marked` | 18.0.13 | `lib/marked.esm.js` |
| `turndown.browser.es.js` | `turndown` | 7.2.4 | `lib/turndown.browser.es.js` |
| `turndown-plugin-gfm.browser.es.js` | `turndown-plugin-gfm` | 1.0.2 | `lib/turndown-plugin-gfm.browser.es.js` |

O mermaid 12.0.0 fica em `app/embedded/assets/mermaid.min.js`, de onde o Go também
o copia para os projetos. A página o recebe em `/embedded/mermaid.min.js`.

## Atualizar uma biblioteca

Atualizações são manuais, inclusive as de segurança. Baixe o tarball do pacote por
um canal aprovado, substitua o arquivo correspondente e a licença em `licenses/`, e
atualize a tabela acima. Depois, rode `go test ./...` em `app/`.
