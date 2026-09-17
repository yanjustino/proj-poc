# mhl-runtime: 2 bugs

_mh-language/mhl-core-runtime · v1.4.0-beta.11-dirty · 16 set 2026_

Encontrados testando o app Senpai — um em produção real, no primeiro smoke test em Windows; o outro reproduzido de forma determinística com um teste concorrente. Os dois têm uma correção candidata descrita abaixo, já validada localmente (build limpo + suíte completa), mas não aplicada a este repositório.

## #1 — dir.list / fs.list devolvem separador nativo do SO [Alta]

**Onde:** `internal/features/nativeops/fs.go`, `func listDir` (linha ~194), `func Join` (linha ~208)

**Sintoma:** No Windows, criar um work-item no app Senpai funciona (o arquivo é escrito), mas ele nunca aparece na listagem — e abrir logo em seguida mostra "não encontrado". Reproduzido numa VM Windows 11 real.

**Causa raiz:** `listDir` (por trás de `dir.list`/`fs.list`) e `Join` montam o caminho com `filepath.Join`, que usa o separador nativo do SO (`\` no Windows). Código `.mh` assume `/` sempre (contrato documentado em `workflows/shared/core/paths.mh`), fazendo string ops manuais como `entry.replace("projects/", "")`. No Windows essa troca nunca bate, o candidate_id falha na validação, e a entrada é descartada silenciosamente.

**Reprodução mínima:**
```
dir.create("projects/abc123")
fs.write("projects/abc123/project.json", "{}")
for (var entry in dir.list("projects")) {
    log(entry)
    // macOS/Linux: "projects/abc123"
    // Windows:     "projects\abc123"  <- quebra .replace("projects/", "")
}
```

**Correção candidata:** normalizar a saída de `listDir` e `Join` com `filepath.ToSlash(...)`. Não muda nenhuma chamada real ao filesystem (os.ReadDir/os.Open já aceitam `/` no Windows), só a string devolvida ao `.mh`.

**Validado:** build limpo + suíte completa de `internal/features/nativeops` passando; 2 testes novos fixam o contrato.

## #2 — Corrida no ponteiro .latest entre sessões concorrentes do mesmo pipeline [Alta]

**Onde:** `internal/engine/runtime/session.go`, `func writeLatest` (linha ~42)

**Sintoma:** rodar N sessões do mesmo pipeline ao mesmo tempo falha com:
```
runtime: committing latest pointer: rename
  .../ArtifactPreview.latest.tmp .../ArtifactPreview.latest:
  no such file or directory
```

**Causa raiz:** `writeLatest(baseDir, pipeline, id)` usa um `.tmp` com nome fixo e compartilhado entre toda execução do mesmo pipeline (`<pipeline>.latest.tmp`). Duas sessões concorrentes escrevem no mesmo arquivo e chamam os.Rename pro mesmo destino; a primeira consome o arquivo, a segunda encontra a origem já sumida.

**Reprodução:** 20 goroutines chamando `Store.Session(NewSessionID()).Save(...)` pro mesmo pipeline — falha 100% das vezes (5/5, com -race) no código atual.

**Correção candidata:** sufixar o `.tmp` com o `id` da sessão: `<pipeline>.latest.<id>.tmp`. O os.Rename final continua atômico (semântica "último vence" preservada); só para de colidir com o arquivo temporário de outro escritor.

**Validado:** mesmo teste de 20 goroutines — 0/10 falhas com -race após o fix; suíte completa do repositório passando.

## À parte — não é bug, vale considerar

### route só aceita argumento posicional

Uma declaração `route Nome(param) { ... }` rejeita `goto Nome(param: valor)` com `"route %s arguments are positional"` — todo outro callable do mhl (tool, prompt) aceita nomeado. Causou confusão real numa migração de if/goto match pra route nesta sessão. Não reportando como bug — pode ser intencional — só registrando que vale uma decisão consciente e documentada.

---

Preparado a partir de uma sessão de depuração do app Senpai contra este runtime. As correções candidatas foram implementadas e testadas numa cópia local do repositório da linguagem, sem nada commitado lá.
