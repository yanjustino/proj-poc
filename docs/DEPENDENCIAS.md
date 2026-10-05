# Senpai — Inventário de dependências para liberação no Artifactory

Levantamento: 2026-10-05 · Commit base: `5d2995f` (branch `main`)

O Senpai precisa de **3 ecossistemas de pacotes** liberados no Artifactory (Go modules, npm e imagens/pacotes de sistema para build Linux) e de **binários externos** que não vêm de gerenciador de pacotes. Os pedidos de liberação, por prioridade, estão na seção 1; o inventário completo, pacote a pacote, está nas seções 2 a 6.

| Ecossistema | Total no lockfile | Entra no app distribuído | Só build/desenvolvimento |
| --- | --- | --- | --- |
| Go modules (`app/go.mod`, `app/go.sum`) | 107 | 19 | 88 (grafo de módulos, não compilados) |
| npm (`app/frontend/package-lock.json`) | 259 | 118 | 141 (88 + 53 binários opcionais por plataforma) |
| Binários embarcados (`app/embedded/bin/`) | 8 arquivos | 8 | — |
| Ferramentas de build e runtime | ver seção 4 | Devin CLI (runtime) | Go, Node, Wails CLI, Docker etc. |

Fontes do levantamento: `go list -m all` e `go list -deps -tags desktop,production` por SO em `app/`; `package-lock.json` (lockfileVersion 3) em `app/frontend/`; `scripts/build-*.sh`, `scripts/docker/*.Dockerfile`, `app/embedded/*.sh` e `app/embedded/THIRD_PARTY.md`. Licenças Go lidas do arquivo LICENSE de cada módulo; licenças npm do campo `license` do lockfile.

## 1. Repositórios Artifactory necessários

| # | Tipo no Artifactory | Upstream a espelhar | Para quê | Obrigatório |
| --- | --- | --- | --- | --- |
| 1 | Go (remote) | `https://proxy.golang.org` + checksum DB `https://sum.golang.org` | Módulos Go do app e do Wails CLI | Sim |
| 2 | npm (remote) | `https://registry.npmjs.org` | Frontend (Vite, marked, mermaid) | Sim |
| 3 | Generic (remote) ou upload manual | `https://go.dev/dl/` | Toolchain Go 1.26.x | Sim, se a máquina de build não tiver Go |
| 4 | Generic (remote) ou upload manual | `https://nodejs.org/dist/` | Node.js ≥ 20.19 ou ≥ 22.12 (exigência do Vite 7) | Sim, se a máquina de build não tiver Node |
| 5 | Docker (remote) | Docker Hub | Build Linux: `golang:1.26-bookworm`, `rockylinux:8`, `alpine:3.20`, `debian:bookworm-slim` | Só para build Linux a partir de macOS/Windows e para recompilar o pdftotext |
| 6 | Debian (remote) | `deb.debian.org` (bookworm) + `deb.nodesource.com` (node_22.x) | Pacotes apt do Dockerfile Linux | Só build Linux (Debian/Ubuntu) |
| 7 | RPM (remote) | Repositórios Rocky Linux 8 (BaseOS, AppStream) | Pacotes dnf do Dockerfile RHEL | Só build RHEL 8/9 |
| 8 | Alpine (remote) | `dl-cdn.alpinelinux.org` (v3.20) | Recompilar o pdftotext para Linux | Só ao atualizar o pdftotext |
| 9 | Generic (remote) | `https://poppler.freedesktop.org/`, `https://downloads.sourceforge.net/project/freetype/` | Código-fonte do pdftotext (poppler 26.04.0, freetype 2.14.1) | Só ao atualizar o pdftotext |

Configuração no cliente (sem segredos no repositório; credenciais via `~/.netrc`, `~/.npmrc` do usuário ou variáveis de ambiente do CI):

```sh
# Go
export GOPROXY=https://<artifactory>/artifactory/api/go/<repo-go>
# GOSUMDB: manter sum.golang.org; se o acesso direto for bloqueado,
# apontar para o espelho do checksum DB configurado no Artifactory.

# npm (em app/frontend)
npm config set registry https://<artifactory>/artifactory/api/npm/<repo-npm>/
```

O `package-lock.json` grava a URL `https://registry.npmjs.org` em cada pacote. O `npm ci` respeita o `registry` configurado e baixa do Artifactory, mas a verificação `integrity` (sha512) continua valendo; não é preciso reescrever o lockfile.

## 2. Dependências Go (`app/go.mod`)

Módulo `senpai-app`, `go 1.26.0`. Dependências diretas: `github.com/wailsapp/wails/v2` v2.15.0, `github.com/google/uuid` v1.6.0 e `golang.org/x/net` v0.59.0.

### 2.1 Módulos compilados no binário distribuído (19)

Resultado de `go list -deps -tags desktop,production` para darwin, linux e windows. São os que precisam de análise de segurança/licença mais rigorosa.

| Módulo | Versão | Licença | Tipo | Plataformas onde é compilado |
| --- | --- | --- | --- | --- |
| `git.sr.ht/~jackmordaunt/go-toast/v2` | v2.0.3 | MIT | transitiva | windows |
| `github.com/bep/debounce` | v1.2.1 | MIT | transitiva | windows |
| `github.com/go-ole/go-ole` | v1.3.0 | MIT | transitiva | windows |
| `github.com/godbus/dbus/v5` | v5.2.2 | BSD-2-Clause | transitiva | linux |
| `github.com/google/uuid` | v1.6.0 | BSD-3-Clause | direta | todas |
| `github.com/leaanthony/go-ansi-parser` | v1.6.1 | MIT | transitiva | todas |
| `github.com/leaanthony/slicer` | v1.6.0 | MIT | transitiva | todas |
| `github.com/leaanthony/u` | v1.1.1 | MIT | transitiva | todas |
| `github.com/pkg/browser` | v0.0.0-20240102092130-5ac0b6a4141c | BSD-2-Clause | transitiva | todas |
| `github.com/pkg/errors` | v0.9.1 | BSD-2-Clause | transitiva | todas |
| `github.com/rivo/uniseg` | v0.4.7 | MIT | transitiva | todas |
| `github.com/samber/lo` | v1.53.0 | MIT | transitiva | todas |
| `github.com/tkrajina/go-reflector` | v0.5.8 | Apache-2.0 | transitiva | todas |
| `github.com/wailsapp/go-webview2` | v1.0.23 | MIT | transitiva | windows |
| `github.com/wailsapp/mimetype` | v1.4.1 | MIT | transitiva | windows |
| `github.com/wailsapp/wails/v2` | v2.15.0 | MIT | direta | todas |
| `golang.org/x/net` | v0.59.0 | BSD-3-Clause | direta | todas |
| `golang.org/x/sys` | v0.48.0 | BSD-3-Clause | transitiva | windows |
| `golang.org/x/text` | v0.42.0 | BSD-3-Clause | transitiva | todas |

### 2.2 Demais módulos do grafo (88)

Não entram no binário do Senpai. O Go baixa os arquivos `go.mod` deles para resolver o grafo (`go mod download`, `go mod tidy`, `go test ./...`), então o proxy precisa servi-los. A maioria vem das dependências do próprio Wails (CLI, geração de ícones, git, terminal). "—" na licença indica módulo cujo código-fonte não é baixado no build normal; a licença deve ser confirmada pelo scanner do Artifactory (Xray) se exigido.

| Módulo | Versão | Licença |
| --- | --- | --- |
| `atomicgo.dev/cursor` | v0.2.0 | — |
| `atomicgo.dev/keyboard` | v0.2.9 | — |
| `atomicgo.dev/schedule` | v0.1.0 | — |
| `dario.cat/mergo` | v1.0.0 | — |
| `github.com/Masterminds/semver` | v1.5.0 | — |
| `github.com/Microsoft/go-winio` | v0.6.2 | — |
| `github.com/ProtonMail/go-crypto` | v1.1.6 | — |
| `github.com/acarl005/stripansi` | v0.0.0-20180116102854-5a71ef0e047d | — |
| `github.com/alecthomas/chroma/v2` | v2.14.0 | — |
| `github.com/aymanbagabas/go-osc52/v2` | v2.0.1 | — |
| `github.com/aymerick/douceur` | v0.2.0 | — |
| `github.com/bitfield/script` | v0.24.0 | — |
| `github.com/charmbracelet/glamour` | v0.8.0 | — |
| `github.com/charmbracelet/lipgloss` | v0.12.1 | — |
| `github.com/charmbracelet/x/ansi` | v0.1.4 | — |
| `github.com/cloudflare/circl` | v1.6.3 | — |
| `github.com/containerd/console` | v1.0.3 | — |
| `github.com/cyphar/filepath-securejoin` | v0.6.1 | — |
| `github.com/davecgh/go-spew` | v1.1.1 | ISC |
| `github.com/dlclark/regexp2` | v1.11.0 | — |
| `github.com/emirpasic/gods` | v1.18.1 | — |
| `github.com/flytam/filenamify` | v1.2.0 | — |
| `github.com/fsnotify/fsnotify` | v1.9.0 | — |
| `github.com/go-git/gcfg` | v1.5.1-0.20230307220236-3a3c6141e376 | — |
| `github.com/go-git/go-billy/v5` | v5.9.0 | — |
| `github.com/go-git/go-git/v5` | v5.19.2 | — |
| `github.com/golang/groupcache` | v0.0.0-20241129210726-2c02b8208cf8 | — |
| `github.com/google/shlex` | v0.0.0-20191202100458-e7afc7fbc510 | — |
| `github.com/gookit/color` | v1.5.4 | — |
| `github.com/gorilla/css` | v1.0.1 | — |
| `github.com/gorilla/websocket` | v1.5.3 | BSD-2-Clause |
| `github.com/itchyny/gojq` | v0.12.13 | — |
| `github.com/itchyny/timefmt-go` | v0.1.5 | — |
| `github.com/jackmordaunt/icns` | v1.0.0 | — |
| `github.com/jaypipes/ghw` | v0.21.3 | — |
| `github.com/jaypipes/pcidb` | v1.1.1 | — |
| `github.com/jbenet/go-context` | v0.0.0-20150711004518-d14ea06fba99 | — |
| `github.com/jchv/go-winloader` | v0.0.0-20250406163304-c1995be93bd1 | ISC |
| `github.com/kevinburke/ssh_config` | v1.2.0 | — |
| `github.com/klauspost/cpuid/v2` | v2.3.0 | — |
| `github.com/labstack/echo/v4` | v4.15.4 | MIT |
| `github.com/labstack/gommon` | v0.5.0 | MIT |
| `github.com/leaanthony/clir` | v1.3.0 | — |
| `github.com/leaanthony/debme` | v1.2.1 | MIT |
| `github.com/leaanthony/gosod` | v1.0.4 | MIT |
| `github.com/leaanthony/winicon` | v1.0.0 | — |
| `github.com/lithammer/fuzzysearch` | v1.1.8 | — |
| `github.com/lucasb-eyer/go-colorful` | v1.2.0 | — |
| `github.com/matryer/is` | v1.4.1 | MIT |
| `github.com/mattn/go-colorable` | v0.1.15 | MIT |
| `github.com/mattn/go-isatty` | v0.0.24 | MIT |
| `github.com/mattn/go-runewidth` | v0.0.16 | — |
| `github.com/microcosm-cc/bluemonday` | v1.0.27 | — |
| `github.com/muesli/reflow` | v0.3.0 | — |
| `github.com/muesli/termenv` | v0.15.3-0.20240618155329-98d742f6907a | — |
| `github.com/nfnt/resize` | v0.0.0-20180221191011-83c6a9932646 | — |
| `github.com/pjbgf/sha1cd` | v0.6.0 | — |
| `github.com/pmezard/go-difflib` | v1.0.0 | BSD-3-Clause |
| `github.com/pterm/pterm` | v0.12.80 | — |
| `github.com/sabhiram/go-gitignore` | v0.0.0-20210923224102-525f6e181f06 | — |
| `github.com/sergi/go-diff` | v1.3.2-0.20230802210424-5b0b94c5c0d3 | — |
| `github.com/skeema/knownhosts` | v1.3.1 | — |
| `github.com/stretchr/testify` | v1.11.1 | MIT |
| `github.com/tc-hib/winres` | v0.3.1 | — |
| `github.com/tidwall/gjson` | v1.14.2 | — |
| `github.com/tidwall/match` | v1.1.1 | — |
| `github.com/tidwall/pretty` | v1.2.0 | — |
| `github.com/tidwall/sjson` | v1.2.5 | — |
| `github.com/valyala/bytebufferpool` | v1.0.0 | MIT |
| `github.com/valyala/fasttemplate` | v1.2.2 | MIT |
| `github.com/wzshiming/ctc` | v1.2.3 | — |
| `github.com/wzshiming/winseq` | v0.0.0-20200112104235-db357dc107ae | — |
| `github.com/xanzy/ssh-agent` | v0.3.3 | — |
| `github.com/xo/terminfo` | v0.0.0-20220910002029-abceb7e1c41e | — |
| `github.com/yuin/goldmark` | v1.7.4 | — |
| `github.com/yuin/goldmark-emoji` | v1.0.3 | — |
| `github.com/yusufpapurcu/wmi` | v1.2.4 | — |
| `golang.org/x/crypto` | v0.57.0 | BSD-3-Clause |
| `golang.org/x/image` | v0.41.0 | — |
| `golang.org/x/mod` | v0.41.0 | — |
| `golang.org/x/sync` | v0.23.0 | — |
| `golang.org/x/term` | v0.46.0 | — |
| `golang.org/x/time` | v0.15.0 | — |
| `golang.org/x/tools` | v0.49.0 | — |
| `gopkg.in/warnings.v0` | v0.1.2 | — |
| `gopkg.in/yaml.v3` | v3.0.1 | Apache-2.0 |
| `howett.net/plist` | v1.0.2-0.20250314012144-ee69052608d9 | — |
| `mvdan.cc/sh/v3` | v3.7.0 | — |

### 2.3 Wails CLI

O build usa o CLI `wails`, instalado com `go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0` (versão fixada nos Dockerfiles). O CLI tem árvore de dependências própria, resolvida a partir do `go.mod` do Wails v2.16.0, e não está no `go.sum` do Senpai. Ela inclui a maior parte dos módulos da seção 2.2, em versões possivelmente diferentes. Recomendação: liberar `github.com/wailsapp/wails/v2@v2.16.0` com suas transitivas, ou gerar a lista exata com `go install` numa máquina com acesso à internet e `GOFLAGS=-modcacherw`, inspecionando `$(go env GOMODCACHE)/cache/download`.

## 3. Dependências npm (`app/frontend/package.json`)

Dependências diretas:

| Pacote | Faixa declarada | Versão travada | Licença | Tipo |
| --- | --- | --- | --- | --- |
| `marked` | ^18.0.13 | 18.0.13 | MIT | produção |
| `mermaid` | ^12.0.0 | 12.0.0 | MIT | produção |
| `vite` | ^7.0.0 | 7.3.6 | MIT | build |
| `eslint` | ^10.10.0 | 10.10.0 | MIT | build (lint) |
| `@eslint/js` | ^10.0.1 | 10.0.1 | MIT | build (lint) |

Licenças no lockfile completo (259 pacotes): MIT 184, ISC 38, Apache-2.0 18, BSD-3-Clause 8, BSD-2-Clause 6, e um pacote de cada: `(MPL-2.0 OR Apache-2.0)` (`dompurify`), `EPL-2.0` (`elkjs`), `BlueOak-1.0.0` (`minimatch`, só build), `Unlicense` (`robust-predicates`) e sem campo `license` (`khroma` 2.1.0, MIT no repositório upstream).

### 3.1 Pacotes de produção (118)

Vão para o bundle do frontend embutido no app (são as dependências de `marked` e `mermaid`).

| Pacote | Versão | Licença |
| --- | --- | --- |
| `@antfu/install-pkg` | 2.0.1 | MIT |
| `@braintree/sanitize-url` | 7.1.2 | MIT |
| `@chevrotain/cst-dts-gen` | 11.1.2 | Apache-2.0 |
| `@chevrotain/gast` | 11.1.2 | Apache-2.0 |
| `@chevrotain/regexp-to-ast` | 11.1.2 | Apache-2.0 |
| `@chevrotain/types` | 11.1.2 | Apache-2.0 |
| `@chevrotain/utils` | 11.1.2 | Apache-2.0 |
| `@iconify/types` | 2.0.0 | MIT |
| `@iconify/utils` | 3.1.7 | MIT |
| `@mermaid-js/parser` | 2.0.0 | MIT |
| `@types/d3` | 7.4.3 | MIT |
| `@types/d3-array` | 3.2.2 | MIT |
| `@types/d3-axis` | 3.0.6 | MIT |
| `@types/d3-brush` | 3.0.6 | MIT |
| `@types/d3-chord` | 3.0.6 | MIT |
| `@types/d3-color` | 3.1.3 | MIT |
| `@types/d3-contour` | 3.0.6 | MIT |
| `@types/d3-delaunay` | 6.0.4 | MIT |
| `@types/d3-dispatch` | 3.0.7 | MIT |
| `@types/d3-drag` | 3.0.7 | MIT |
| `@types/d3-dsv` | 3.0.7 | MIT |
| `@types/d3-ease` | 3.0.2 | MIT |
| `@types/d3-fetch` | 3.0.7 | MIT |
| `@types/d3-force` | 3.0.10 | MIT |
| `@types/d3-format` | 3.0.4 | MIT |
| `@types/d3-geo` | 3.1.1 | MIT |
| `@types/d3-hierarchy` | 3.1.7 | MIT |
| `@types/d3-interpolate` | 3.0.4 | MIT |
| `@types/d3-path` | 3.1.1 | MIT |
| `@types/d3-polygon` | 3.0.2 | MIT |
| `@types/d3-quadtree` | 3.0.6 | MIT |
| `@types/d3-random` | 3.0.4 | MIT |
| `@types/d3-scale` | 4.0.9 | MIT |
| `@types/d3-scale-chromatic` | 3.1.0 | MIT |
| `@types/d3-selection` | 3.0.11 | MIT |
| `@types/d3-shape` | 3.2.0 | MIT |
| `@types/d3-time` | 3.0.4 | MIT |
| `@types/d3-time-format` | 4.0.3 | MIT |
| `@types/d3-timer` | 3.0.2 | MIT |
| `@types/d3-transition` | 3.0.9 | MIT |
| `@types/d3-zoom` | 3.0.8 | MIT |
| `@types/geojson` | 7946.0.16 | MIT |
| `@types/trusted-types` | 2.0.7 | MIT |
| `@upsetjs/venn.js` | 2.0.0 | MIT |
| `chevrotain` | 11.1.2 | Apache-2.0 |
| `commander` | 7.2.0 | MIT |
| `commander` | 8.3.0 | MIT |
| `cose-base` | 1.0.3 | MIT |
| `cose-base` | 2.2.0 | MIT |
| `cytoscape` | 3.34.3 | MIT |
| `cytoscape-cose-bilkent` | 4.1.0 | MIT |
| `cytoscape-fcose` | 2.2.0 | MIT |
| `d3` | 7.9.0 | ISC |
| `d3-array` | 2.12.1 | BSD-3-Clause |
| `d3-array` | 3.2.4 | ISC |
| `d3-axis` | 3.0.0 | ISC |
| `d3-brush` | 3.0.0 | ISC |
| `d3-chord` | 3.0.1 | ISC |
| `d3-color` | 3.1.0 | ISC |
| `d3-contour` | 4.0.2 | ISC |
| `d3-delaunay` | 6.0.4 | ISC |
| `d3-dispatch` | 3.0.1 | ISC |
| `d3-drag` | 3.0.0 | ISC |
| `d3-dsv` | 3.0.1 | ISC |
| `d3-ease` | 3.0.1 | BSD-3-Clause |
| `d3-fetch` | 3.0.1 | ISC |
| `d3-force` | 3.0.0 | ISC |
| `d3-format` | 3.1.2 | ISC |
| `d3-geo` | 3.1.1 | ISC |
| `d3-hierarchy` | 3.1.2 | ISC |
| `d3-interpolate` | 3.0.1 | ISC |
| `d3-path` | 1.0.9 | BSD-3-Clause |
| `d3-path` | 3.1.0 | ISC |
| `d3-polygon` | 3.0.1 | ISC |
| `d3-quadtree` | 3.0.1 | ISC |
| `d3-random` | 3.0.1 | ISC |
| `d3-sankey` | 0.12.3 | BSD-3-Clause |
| `d3-scale` | 4.0.2 | ISC |
| `d3-scale-chromatic` | 3.1.0 | ISC |
| `d3-selection` | 3.0.0 | ISC |
| `d3-shape` | 1.3.7 | BSD-3-Clause |
| `d3-shape` | 3.2.0 | ISC |
| `d3-time` | 3.1.0 | ISC |
| `d3-time-format` | 4.1.0 | ISC |
| `d3-timer` | 3.0.1 | ISC |
| `d3-transition` | 3.0.1 | ISC |
| `d3-zoom` | 3.0.0 | ISC |
| `dagre-d3-es` | 7.0.14 | MIT |
| `dayjs` | 1.11.23 | MIT |
| `delaunator` | 5.1.0 | ISC |
| `dompurify` | 3.4.15 | (MPL-2.0 OR Apache-2.0) |
| `elkjs` | 0.9.3 | EPL-2.0 |
| `es-toolkit` | 1.52.0 | MIT |
| `hachure-fill` | 0.5.2 | MIT |
| `iconv-lite` | 0.6.3 | MIT |
| `import-meta-resolve` | 4.2.0 | MIT |
| `internmap` | 1.0.1 | ISC |
| `internmap` | 2.0.3 | ISC |
| `katex` | 0.16.47 | MIT |
| `khroma` | 2.1.0 | (sem campo license) |
| `layout-base` | 1.0.2 | MIT |
| `layout-base` | 2.0.1 | MIT |
| `lodash-es` | 4.17.23 | MIT |
| `marked` | 16.4.2 | MIT |
| `marked` | 18.0.13 | MIT |
| `mermaid` | 12.0.0 | MIT |
| `package-manager-detector` | 1.8.0 | MIT |
| `path-data-parser` | 0.1.0 | MIT |
| `points-on-curve` | 0.2.0 | MIT |
| `points-on-path` | 0.2.1 | MIT |
| `robust-predicates` | 3.0.3 | Unlicense |
| `roughjs` | 4.6.6 | MIT |
| `rw` | 1.3.3 | BSD-3-Clause |
| `safer-buffer` | 2.1.2 | MIT |
| `stylis` | 4.4.0 | MIT |
| `tinyexec` | 1.3.1 | MIT |
| `ts-dedent` | 2.3.0 | MIT |
| `uuid` | 14.0.2 | MIT |

### 3.2 Pacotes de build e lint (88)

Usados só por `npm run build` e `npm run lint`; não vão para o app.

| Pacote | Versão | Licença |
| --- | --- | --- |
| `@cacheable/memory` | 2.2.0 | MIT |
| `@cacheable/utils` | 2.5.0 | MIT |
| `@eslint-community/eslint-utils` | 4.10.1 | MIT |
| `@eslint-community/regexpp` | 4.12.2 | MIT |
| `@eslint/config-array` | 0.23.5 | Apache-2.0 |
| `@eslint/config-helpers` | 0.7.0 | Apache-2.0 |
| `@eslint/core` | 1.2.1 | Apache-2.0 |
| `@eslint/js` | 10.0.1 | MIT |
| `@eslint/object-schema` | 3.0.5 | Apache-2.0 |
| `@eslint/plugin-kit` | 0.7.3 | Apache-2.0 |
| `@humanfs/core` | 0.19.2 | Apache-2.0 |
| `@humanfs/node` | 0.16.8 | Apache-2.0 |
| `@humanfs/types` | 0.15.0 | Apache-2.0 |
| `@humanwhocodes/module-importer` | 1.0.1 | Apache-2.0 |
| `@humanwhocodes/retry` | 0.4.3 | Apache-2.0 |
| `@keyv/bigmap` | 1.3.1 | MIT |
| `@keyv/serialize` | 1.1.1 | MIT |
| `@types/esrecurse` | 4.3.1 | MIT |
| `@types/estree` | 1.0.9 | MIT |
| `@types/json-schema` | 7.0.15 | MIT |
| `acorn` | 8.18.0 | MIT |
| `acorn-jsx` | 5.3.2 | MIT |
| `ajv` | 6.15.0 | MIT |
| `balanced-match` | 4.0.4 | MIT |
| `brace-expansion` | 5.0.9 | MIT |
| `cacheable` | 2.5.0 | MIT |
| `cross-spawn` | 7.0.6 | MIT |
| `debug` | 4.4.3 | MIT |
| `deep-is` | 0.1.4 | MIT |
| `esbuild` | 0.28.2 | MIT |
| `escape-string-regexp` | 4.0.0 | MIT |
| `eslint` | 10.10.0 | MIT |
| `eslint-scope` | 9.1.2 | BSD-2-Clause |
| `eslint-visitor-keys` | 3.4.3 | Apache-2.0 |
| `eslint-visitor-keys` | 5.0.1 | Apache-2.0 |
| `espree` | 11.2.0 | BSD-2-Clause |
| `esquery` | 1.7.0 | BSD-3-Clause |
| `esrecurse` | 4.3.0 | BSD-2-Clause |
| `estraverse` | 5.3.0 | BSD-2-Clause |
| `esutils` | 2.0.3 | BSD-2-Clause |
| `fast-deep-equal` | 3.1.3 | MIT |
| `fast-json-stable-stringify` | 2.1.0 | MIT |
| `fast-levenshtein` | 2.0.6 | MIT |
| `fdir` | 6.5.0 | MIT |
| `file-entry-cache` | 11.1.5 | MIT |
| `find-up` | 5.0.0 | MIT |
| `flat-cache` | 6.1.23 | MIT |
| `flatted` | 3.4.4 | ISC |
| `glob-parent` | 6.0.2 | ISC |
| `hashery` | 1.5.1 | MIT |
| `hookified` | 1.15.1 | MIT |
| `hookified` | 2.2.0 | MIT |
| `ignore` | 5.3.2 | MIT |
| `imurmurhash` | 0.1.4 | MIT |
| `is-extglob` | 2.1.1 | MIT |
| `is-glob` | 4.0.3 | MIT |
| `isexe` | 2.0.0 | ISC |
| `json-schema-traverse` | 0.4.1 | MIT |
| `json-stable-stringify-without-jsonify` | 1.0.1 | MIT |
| `keyv` | 5.6.0 | MIT |
| `levn` | 0.4.1 | MIT |
| `locate-path` | 6.0.0 | MIT |
| `minimatch` | 10.2.6 | BlueOak-1.0.0 |
| `ms` | 2.1.3 | MIT |
| `nanoid` | 3.3.19 | MIT |
| `natural-compare` | 1.4.0 | MIT |
| `optionator` | 0.9.4 | MIT |
| `p-limit` | 3.1.0 | MIT |
| `p-locate` | 5.0.0 | MIT |
| `path-exists` | 4.0.0 | MIT |
| `path-key` | 3.1.1 | MIT |
| `picocolors` | 1.1.1 | ISC |
| `picomatch` | 4.0.7 | MIT |
| `postcss` | 8.5.28 | MIT |
| `prelude-ls` | 1.2.1 | MIT |
| `punycode` | 2.3.1 | MIT |
| `qified` | 0.10.1 | MIT |
| `rollup` | 4.63.2 | MIT |
| `shebang-command` | 2.0.0 | MIT |
| `shebang-regex` | 3.0.0 | MIT |
| `source-map-js` | 1.2.1 | BSD-3-Clause |
| `tinyglobby` | 0.2.17 | MIT |
| `type-check` | 0.4.0 | MIT |
| `uri-js` | 4.4.1 | BSD-2-Clause |
| `vite` | 7.3.6 | MIT |
| `which` | 2.0.2 | ISC |
| `word-wrap` | 1.2.5 | MIT |
| `yocto-queue` | 0.1.0 | MIT |

### 3.3 Binários nativos opcionais por plataforma (53)

Pacotes do `esbuild` e do `rollup` (usados pelo Vite) com executável nativo. O npm instala apenas o da plataforma de build; os demais nunca são baixados. Para os builds atuais bastam: `@esbuild/darwin-arm64`, `@esbuild/linux-x64`, `@esbuild/linux-arm64`, `@esbuild/win32-x64`, `@rollup/rollup-darwin-arm64`, `@rollup/rollup-linux-x64-gnu`, `@rollup/rollup-linux-arm64-gnu`, `@rollup/rollup-win32-x64-msvc` e `fsevents` (macOS). Liberar a lista inteira evita falha se a máquina de build mudar.

| Pacote | Versão | Licença | SO/CPU |
| --- | --- | --- | --- |
| `@esbuild/aix-ppc64` | 0.28.2 | MIT | aix/ppc64 |
| `@esbuild/android-arm` | 0.28.2 | MIT | android/arm |
| `@esbuild/android-arm64` | 0.28.2 | MIT | android/arm64 |
| `@esbuild/android-x64` | 0.28.2 | MIT | android/x64 |
| `@esbuild/darwin-arm64` | 0.28.2 | MIT | darwin/arm64 |
| `@esbuild/darwin-x64` | 0.28.2 | MIT | darwin/x64 |
| `@esbuild/freebsd-arm64` | 0.28.2 | MIT | freebsd/arm64 |
| `@esbuild/freebsd-x64` | 0.28.2 | MIT | freebsd/x64 |
| `@esbuild/linux-arm` | 0.28.2 | MIT | linux/arm |
| `@esbuild/linux-arm64` | 0.28.2 | MIT | linux/arm64 |
| `@esbuild/linux-ia32` | 0.28.2 | MIT | linux/ia32 |
| `@esbuild/linux-loong64` | 0.28.2 | MIT | linux/loong64 |
| `@esbuild/linux-mips64el` | 0.28.2 | MIT | linux/mips64el |
| `@esbuild/linux-ppc64` | 0.28.2 | MIT | linux/ppc64 |
| `@esbuild/linux-riscv64` | 0.28.2 | MIT | linux/riscv64 |
| `@esbuild/linux-s390x` | 0.28.2 | MIT | linux/s390x |
| `@esbuild/linux-x64` | 0.28.2 | MIT | linux/x64 |
| `@esbuild/netbsd-arm64` | 0.28.2 | MIT | netbsd/arm64 |
| `@esbuild/netbsd-x64` | 0.28.2 | MIT | netbsd/x64 |
| `@esbuild/openbsd-arm64` | 0.28.2 | MIT | openbsd/arm64 |
| `@esbuild/openbsd-x64` | 0.28.2 | MIT | openbsd/x64 |
| `@esbuild/openharmony-arm64` | 0.28.2 | MIT | openharmony/arm64 |
| `@esbuild/sunos-x64` | 0.28.2 | MIT | sunos/x64 |
| `@esbuild/win32-arm64` | 0.28.2 | MIT | win32/arm64 |
| `@esbuild/win32-ia32` | 0.28.2 | MIT | win32/ia32 |
| `@esbuild/win32-x64` | 0.28.2 | MIT | win32/x64 |
| `@napi-rs/lzma-linux-x64-gnu` | 1.5.1 | MIT | linux/x64 |
| `@rollup/rollup-android-arm-eabi` | 4.63.2 | MIT | android/arm |
| `@rollup/rollup-android-arm64` | 4.63.2 | MIT | android/arm64 |
| `@rollup/rollup-darwin-arm64` | 4.63.2 | MIT | darwin/arm64 |
| `@rollup/rollup-darwin-x64` | 4.63.2 | MIT | darwin/x64 |
| `@rollup/rollup-freebsd-arm64` | 4.63.2 | MIT | freebsd/arm64 |
| `@rollup/rollup-freebsd-x64` | 4.63.2 | MIT | freebsd/x64 |
| `@rollup/rollup-linux-arm-gnueabihf` | 4.63.2 | MIT | linux/arm |
| `@rollup/rollup-linux-arm-musleabihf` | 4.63.2 | MIT | linux/arm |
| `@rollup/rollup-linux-arm64-gnu` | 4.63.2 | MIT | linux/arm64 |
| `@rollup/rollup-linux-arm64-musl` | 4.63.2 | MIT | linux/arm64 |
| `@rollup/rollup-linux-loong64-gnu` | 4.63.2 | MIT | linux/loong64 |
| `@rollup/rollup-linux-loong64-musl` | 4.63.2 | MIT | linux/loong64 |
| `@rollup/rollup-linux-ppc64-gnu` | 4.63.2 | MIT | linux/ppc64 |
| `@rollup/rollup-linux-ppc64-musl` | 4.63.2 | MIT | linux/ppc64 |
| `@rollup/rollup-linux-riscv64-gnu` | 4.63.2 | MIT | linux/riscv64 |
| `@rollup/rollup-linux-riscv64-musl` | 4.63.2 | MIT | linux/riscv64 |
| `@rollup/rollup-linux-s390x-gnu` | 4.63.2 | MIT | linux/s390x |
| `@rollup/rollup-linux-x64-gnu` | 4.63.2 | MIT | linux/x64 |
| `@rollup/rollup-linux-x64-musl` | 4.63.2 | MIT | linux/x64 |
| `@rollup/rollup-openbsd-x64` | 4.63.2 | MIT | openbsd/x64 |
| `@rollup/rollup-openharmony-arm64` | 4.63.2 | MIT | openharmony/arm64 |
| `@rollup/rollup-win32-arm64-msvc` | 4.63.2 | MIT | win32/arm64 |
| `@rollup/rollup-win32-ia32-msvc` | 4.63.2 | MIT | win32/ia32 |
| `@rollup/rollup-win32-x64-gnu` | 4.63.2 | MIT | win32/x64 |
| `@rollup/rollup-win32-x64-msvc` | 4.63.2 | MIT | win32/x64 |
| `fsevents` | 2.3.3 | MIT | darwin |

## 4. Ferramentas de build e de runtime

| Ferramenta | Versão usada | Origem | Onde é usada | Observação |
| --- | --- | --- | --- | --- |
| Go | 1.26.0 (mínimo do `go.mod`); 1.26.8 no Dockerfile RHEL | `https://go.dev/dl/` / imagem `golang:1.26-bookworm` | Build e testes do app | |
| Node.js + npm | Node 22 nos Dockerfiles; local: Node 25.2.1, npm 11.6.2 | `nodejs.org` / NodeSource / AppStream Rocky 8 | Build do frontend | Vite 7 exige Node 20.19+ ou 22.12+ |
| Wails CLI | v2.16.0 (Dockerfiles); scripts locais sugerem `@latest` | `go install` (Go proxy) | `wails build` | Ver seção 2.3 |
| Docker | qualquer recente | Docker Desktop / Engine | Build Linux a partir de macOS/Windows; build do pdftotext | |
| mingw-w64 | — | Homebrew (`brew install mingw-w64`) | Build Windows a partir de macOS | Homebrew não passa pelo Artifactory |
| Xcode Command Line Tools, cmake, ninja | — | Apple / Homebrew | Build macOS e pdftotext darwin | |
| `mhl` (runtime de workflows) | 1.5.0-alpha.2 | Repositório `mhl-runtime` (fora deste repo) | Embarcado no app; executa `workflows/` | Ver seção 5 |
| Devin CLI (`devin`) | 3000.11.3 na máquina de desenvolvimento | Instalador do fornecedor (Cognition); instalado em `~/.local/bin` | **Runtime em produção**: backend de LLM obrigatório | Não é embarcado; precisa existir na máquina do usuário e estar autenticado |

Pacotes de sistema dos Dockerfiles:

| Imagem base | Pacotes | Arquivo |
| --- | --- | --- |
| `golang:1.26-bookworm` | `build-essential pkg-config git ca-certificates curl libgtk-3-dev libwebkit2gtk-4.1-dev nodejs` (NodeSource 22.x) | `scripts/docker/linux-build.Dockerfile` |
| `rockylinux:8` | `dnf-plugins-core gcc gcc-c++ make pkgconf-pkg-config git tar xz curl ca-certificates gtk3-devel webkit2gtk3-devel nodejs npm` (módulo `nodejs:22`) + Go 1.26.8 de `go.dev/dl` | `scripts/docker/linux-rhel-build.Dockerfile` |
| `alpine:3.20` | `bash build-base cmake samurai curl xz coreutils zlib-dev zlib-static` | `app/embedded/build-pdftotext.sh` |
| `debian:bookworm-slim` | `bash cmake ninja-build curl xz-utils ca-certificates` + mingw-w64 | `app/embedded/build-pdftotext.sh` |

Dependências de sistema na máquina do usuário final (não vêm de gerenciador de pacotes do projeto): WebView2 Runtime no Windows; GTK 3 e WebKitGTK (`libwebkit2gtk-4.1` no Debian/Ubuntu, `webkit2gtk3` no RHEL 8/9) no Linux; WebKit do sistema no macOS.

## 5. Binários embarcados no app

Ficam versionados em `app/embedded/bin/` e são embutidos via `//go:embed`. Não passam por gerenciador de pacotes; o time de segurança precisa avaliá-los como artefatos.

| Arquivo | Componente | Versão | SHA-256 (prefixo) | Licença | Origem |
| --- | --- | --- | --- | --- | --- |
| `mhl-darwin-arm64` | mhl | 1.5.0-alpha.2 | `cdc73e4fe37c49c9` | a confirmar | Build do repositório `mhl-runtime` |
| `mhl-linux-amd64` | mhl | 1.5.0-alpha.2 | `10ebb432a49efa8a` | a confirmar | idem |
| `mhl-linux-arm64` | mhl | não identificada no binário | `d507243124e5373d` | a confirmar | idem |
| `mhl-windows-amd64.exe` | mhl | 1.5.0-alpha.2 | `b929901ffdb694cf` | a confirmar | idem |
| `pdftotext-darwin-arm64` | poppler 26.04.0 + freetype 2.14.1 | 26.04.0 | `a96840a35c8a57e3` | GPL-2.0-or-later; FreeType (FTL/GPL-2.0) | Compilado por `build-pdftotext.sh` a partir dos tarballs upstream com sha256 fixado |
| `pdftotext-linux-amd64` | idem + musl libc (MIT) | 26.04.0 | `e92087a0e6b97c79` | idem | idem |
| `pdftotext-linux-arm64` | idem + musl libc (MIT) | 26.04.0 | `ba1a7d90f6f41c8c` | idem | idem |
| `pdftotext-windows-amd64.exe` | idem + runtime mingw-w64, libgcc/libstdc++ (GPLv3 com GCC Runtime Library Exception) | 26.04.0 | `1483ada17131e2da` | idem | idem |

Também embarcados: `app/embedded/assets/mermaid.min.js` (cópia de `mermaid` 12.0.0 do npm, MIT) e `app/embedded/workflows/` (código do próprio projeto).

## 6. Pontos de atenção para o time de segurança

- **Licença copyleft em binário distribuído:** o `pdftotext` (poppler) é GPL-2.0-or-later. O Senpai o executa como processo separado, sem linkar, mas quem redistribuir o app precisa oferecer o código-fonte correspondente (ver `app/embedded/THIRD_PARTY.md`).
- **EPL-2.0 no bundle de produção:** `elkjs` 0.9.3, dependência do `mermaid`. Licença copyleft fraca, em nível de arquivo.
- **Pré-release em produção:** `mhl` está em 1.5.0-alpha.2 e vem de fora do repositório; não há SBOM nem licença registrada para ele aqui. A versão do binário `mhl-linux-arm64` não foi identificada e pode estar desatualizada.
- **Divergência de versão do Wails:** a biblioteca no `go.mod` é v2.15.0 e o CLI nos Dockerfiles é v2.16.0; os scripts locais sugerem `@latest`. Convém fixar a mesma versão nos dois e liberar só ela.
- **Instaladores fora do Artifactory:** o Dockerfile Debian executa `curl … | bash` do NodeSource, o Dockerfile RHEL baixa o Go de `go.dev`, e o build Windows depende de Homebrew. Em ambiente restrito, troque por imagens base internas já com Go, Node e Wails.
- **Devin CLI** é dependência de runtime em produção e é instalada fora de gerenciador de pacotes. Precisa de avaliação própria (binário do fornecedor, autenticação por token, tráfego de rede para a API do fornecedor).
- **Integridade:** o `package-lock.json` traz hash sha512 de todos os 259 pacotes npm e o `go.sum` traz hash de todos os módulos Go. Use `npm ci` (nunca `npm install`) e mantenha `GOSUMDB` ativo para que pacotes adulterados no proxy sejam rejeitados.
- **Atualização deste inventário:** gerado a partir do commit `5d2995f`. Qualquer mudança em `app/go.mod`, `app/go.sum`, `app/frontend/package-lock.json`, `scripts/docker/` ou `app/embedded/bin/` exige revisar a liberação.
