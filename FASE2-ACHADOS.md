# Fase 2 — Achados dos spikes (`workflow Wiki`)

> Segue o mesmo espírito de [FASE0-ACHADOS.md](FASE0-ACHADOS.md), mas escopado à Fase 2. Criado à parte porque "FASE0" já não descreve achados específicos de construir a Wiki.

## 1. Achado crítico de segurança — `claude --allowed-tools ""` NÃO bloqueia nada; usar `--disallowed-tools` com lista explícita

Ao implementar a mitigação de C2 (todo `agent` usado por `Wiki`/`Discovery`/`Delivery` precisa restringir ferramentas — achado #9 do FASE0-ACHADOS.md), testei duas formas de "não deixar o `claude` tocar em nada além do prompt":

- `claude -p "..." --allowed-tools ""` — **não bloqueia nada**. Testado com um prompt pedindo explicitamente para rodar `Bash: ls` e `Read: secret.txt` — o modelo executou os dois, leu o conteúdo real de um arquivo secreto no diretório, e devolveu tudo, com `permission_denials: []` (zero negações — ele nem tentou e foi barrado, ele **conseguiu de verdade**). Uma string vazia em `--allowed-tools` aparentemente é tratada como "nenhuma restrição informada", não como "permitir nada" — um footgun sério: quem assumir que isso bloqueia por padrão está exposto sem saber.
- `claude -p "..." --disallowed-tools "Bash,Read,Write,Edit,MultiEdit,NotebookEdit,WebFetch,WebSearch,Glob,Grep,Task"` — **bloqueia de verdade**. Mesmo prompt, mesmo arquivo secreto: o modelo respondeu "I don't have access to Bash, Read, Glob, or Grep tools in this session... I'm not able to list directory contents or read secret.txt" — recusa completa, sem tentativa de contornar.

**Ação adotada:** o `agent Writer` (Fase 2, `workflows/shared/agents.mh`) usa `--disallowed-tools` com a lista explícita acima, nunca `--allowed-tools ""`. Registrar isso como uma correção ao texto da constraint C2 no plano macro (§2.1) — a flag certa importa, não só "ter uma flag qualquer de restrição".

## 2. Achado crítico de arquitetura — `fs.read` resolve contra o CWD do processo; `prompt ... from "arquivo"` resolve contra o diretório do `.mh` que declara

Testado diretamente: um `tool` declarado em `subdir/lib.mh` chamando `fs.read("data.txt")` (esperando achar `subdir/data.txt`) falha com `no such file or directory` **tanto rodando com CWD na raiz do projeto quanto rodando de qualquer outro CWD** — `fs.read`/`fs.write`/`dir.*` resolvem caminho relativo contra o diretório de onde o processo `mhl` foi invocado, nunca contra onde o `.mh` que fez a chamada está salvo.

Em contraste, `prompt Greet(...) from "greet.prompt.md"` declarado no mesmo `subdir/lib.mh` funciona **de qualquer CWD** — inclusive rodando com CWD em `/tmp`, completamente fora da árvore do projeto. `prompt ... from` resolve o caminho relativo ao arquivo `.mh` que faz a declaração, não ao processo.

**Por que isso importa (achado que evita um problema real de empacotamento):** o design original do §3.4 do plano (`fs.read("schemas/brief.schema.json")` para carregar o JSON Schema antes de passar pra `agent.run(schema:)`) quebraria silenciosamente no momento em que o `mhl` fosse invocado de um CWD diferente de onde o `.mh` está — exatamente o que acontece na Fase 5/7, quando o shell Wails spawna `mhl serve mcp --http` de um CWD que não necessariamente é o diretório `workflows/`. Descoberto agora (Fase 2, primeiro uso real de arquivo de schema), antes de isso se tornar um bug de produção descoberto tarde.

**Mecanismo adotado, para todo carregamento de arquivo estático "vizinho" de um `.mh` (schema JSON, e qualquer outro asset de texto):** declarar um `prompt <Nome>() from "caminho/relativo/ao/arquivo.ext"` **sem parâmetros** — carrega o conteúdo cru do arquivo, verbatim, resolvido contra o `.mh` declarante, funcionando de qualquer CWD (confirmado por spike: um JSON estático sem nenhum `${...}` é devolvido byte a byte). Nomeado de forma que deixe claro que não é uma instrução de LLM (ex. `IngestSchemaFile()`), com um comentário explicando o porquê — é uma reutilização deliberada do motor de template como "carregador de arquivo relativo", não uma alegação de que `schemas/*.json` são prompts de verdade.

**Consequência para todas as fases futuras:** todo `fs.read`/`fs.write` sobre um caminho que precisa ser estável independente de onde o `mhl` foi invocado (schemas, templates carregados fora do mecanismo `prompt...from`, assets) deve ser revisto com isso em mente. `templates/*.html`/`templates/*.md` já usam `prompt ... from` nativamente (§3.4), então já estão seguros; o risco real era especificamente `schemas/*.json`, que o plano original presumia via `fs.read`.

## 3. Achado de confiabilidade — `claude --json-schema` vaza a própria tag de fechamento em campos de texto longo

Reproduzido em chamadas reais (não um caso isolado): ao chamar `query` sobre a wiki, o campo `answer_body` (texto livre, gerado pela LLM via `--json-schema`) veio consistentemente com um sufixo vazado — `...texto real da resposta.</answer_body>\n</invoke>\n` — em mais de uma chamada, com perguntas diferentes. `json.parse` não falha (o JSON em si é válido — o vazamento é só texto dentro do valor da string), então o problema não aparece como erro, só como conteúdo sujo gravado no arquivo final.

Hipótese (não confirmada com o mantenedor do `claude`, mas consistente com o padrão observado): o mecanismo interno do CLI para gerar saída estruturada via `--json-schema` parece envolver algo como uma chamada de "ferramenta" com o nome do campo como tag XML (`<answer_body>...</answer_body>`), e ocasionalmente a tag de fechamento vaza para dentro do próprio valor do campo — sobretudo em campos de texto longo, no fim da geração.

**Mitigação adotada:** `tool ClaudeQuirks.strip_trailing_tag_leak(text, field_name)` (`workflows/shared/claude_quirks.mh`) — corta a string no primeiro `</<field_name>>` encontrado, se houver; devolve o texto intacto se não houver vazamento. Aplicado nos três campos de texto longo do `workflow Wiki` (`source_summary` no ingest, `answer_body` na query, `notes` no lint) logo após o `json.parse`. Testado e confirmado: a mesma pergunta que antes gravava `</answer_body>` no arquivo final agora grava só o texto limpo.

**Não resolvido, só mitigado:** isso é uma correção no lado do Senpai para uma peculiaridade observada de um CLI de terceiros — não uma correção do MHL nem uma garantia de que o padrão de vazamento é sempre exatamente esse (`</nome_do_campo>` no fim). Se aparecer em outro formato (ex. no meio do texto, ou com um nome de tag diferente), a mitigação atual não pega. Tratar como vigilância contínua, não como resolvido de vez — revisitar se `codex`/`devin` entrarem em uso e mostrarem o mesmo tipo de vazamento (ou um diferente).

## Consequência prática

- `PLANO-MACRO-MHL-SENPAI.md` (C2) deve citar `--disallowed-tools` com a lista explícita, não `--allowed-tools ""`, como o mecanismo validado. Feito.
- Qualquer `agent` futuro (Discovery/Delivery, Fase 3/4) reaproveita a mesma lista — candidata a virar uma constante/comentário compartilhado perto da declaração do agente, não redigitada em cada lugar.
- `fs.read`/`fs.write`/`dir.*` nunca devem ser usados para carregar um arquivo "vizinho" de um `.mh` (schema, asset) — só `prompt ... from "arquivo"` (mesmo sem parâmetros) é seguro contra variação de CWD. Vale para todo `schemas/*.json` de Discovery/Delivery nas Fases 3/4, não só Wiki.
- `ClaudeQuirks.strip_trailing_tag_leak` deve ser considerado (e testado de novo) em todo campo de texto longo gerado por `claude` em Discovery/Delivery — o vazamento não é específico da Wiki, é do backend.
