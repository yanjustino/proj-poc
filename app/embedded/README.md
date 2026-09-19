# app/embedded/

Everything under here gets baked into the Wails binary via `//go:embed`
(see `app/embedded_*.go`) so a packaged Senpai app never depends on the
end-user's machine having `mhl` installed, or `workflows/` checked out next
to it. This directory is **not** named `vendor/` on purpose — Go treats a
top-level `vendor/` specially (Go module dependency vendoring) and refuses
to build otherwise.

## `bin/mhl-<goos>-<goarch>[.exe]`

The `mhl` runtime binary, one per supported platform. **Comes from outside
this repo** — a real `mhl` release build for that platform, not something
`go build`/`npm` produces here. To add or refresh one:

1. Get (or build) the `mhl` binaries — `./build.sh release` in the
   `mhl-runtime` source tree produces `dist/<goos>-<goarch>/mhl[.exe]` for
   all supported platforms in one go.
2. Copy (or `rsync -a`) that `dist/` tree to `dist/` at this repo's root
   (next to `workflows/`) — `./sync.sh` reads from there by default (pass a
   different path as its one argument to read from somewhere else).
3. Run `./sync.sh` (from this directory). It copies each platform's binary
   to `bin/mhl-<goos>-<goarch>` (`.exe` on Windows), `chmod 755`s it, and
   prints its sha256 — skipping any platform whose `dist/` copy is missing
   (with a warning) rather than clobbering a working binary with nothing.
4. Rebuild — `app/embedded_mhl_<goos>_<goarch>.go` already has the matching
   `//go:embed` directive for the 4 platforms the plan targets
   (`darwin/arm64`, `linux/amd64`, `windows/amd64`; `darwin/amd64` has no
   binary yet — add `bin/mhl-darwin-amd64` and a matching
   `embedded_mhl_darwin_amd64.go` file when one becomes available).

The app **always** runs this vendored copy, never whatever `mhl` happens to
be on `PATH` — deliberate, since `mhl` is still pre-1.0 and gets upgraded
often during this project's own development; PATH-first would risk a
packaged build silently depending on whichever version a given dev machine
has installed. This means: **whenever you upgrade your local dev `mhl`
install and validate the new version, also refresh the matching file here**
— otherwise `go test`/`wails build` keep exercising the older vendored
binary. `app.go`'s startup log always prints the vendored binary's path and
sha256 so a stale copy doesn't go unnoticed — but that only helps if you
actually go read the log; nothing surfaces the mismatch anywhere in the UI.

Real incident this bit: `bin/mhl-darwin-arm64` sat on `v1.4.0-beta.14`
(before `mhl` added `stdin:` support to `agent` blocks) for a day after the
local `mhl` install moved to `v1.4.0-beta.15`. Nothing errored — the app
built and ran fine, `mhl lint`/`mhl test` on the CLI passed, and the only
symptom was Claude Code CLI silently getting empty stdin at runtime, which
looked exactly like an upstream CLI bug until the vendored binary's own
version was checked directly.

**`./sync-dev-mhl.sh`** exists for exactly this: run from this directory (or
via the "sync vendored mhl binary" VS Code task, wired as a `preLaunchTask`
dependency ahead of both debug configs in `.vscode/tasks.json`, so it runs
automatically before every local Run/Debug) to copy whatever `mhl` is
currently on `PATH` into `bin/mhl-<goos>-<goarch>` **for the current
machine only** — a no-op if it's already up to date. This is the dev-loop
counterpart to the numbered `./sync.sh` procedure above, which stays the
right tool for a real release (all platforms at once, from a `dist/` tree
built by `mhl-runtime`'s own `./build.sh release`).

## `workflows/`

A copy of the repo's own `workflows/` tree. Refreshed by `./sync.sh` — run
it before a release build whenever `workflows/*.mh` changed.

Unlike the `mhl` binary, `resolveWorkflowsDir` (`app/embedded_extract.go`)
prefers a **live** `../workflows` checkout when one exists next to the
running binary or its CWD (true for `go test`/`go run`/`wails dev`) — only a
packaged app with no dev tree nearby extracts this embedded copy. So this
directory going stale doesn't affect the dev loop; it only matters for a
release build.

## `assets/mermaid.min.js`

The mermaid UMD bundle the frontend already depends on
(`app/frontend/node_modules/mermaid/dist/mermaid.min.js`) — copied here so
`ensureArtifactMermaidAsset` can seed `projects/<id>/artifacts/assets/
mermaid.min.js` for every project, letting a diagram/DER artifact render
when its `.html` is opened outside the app (no running Senpai, no network).
Refreshed by `./sync.sh` whenever the frontend's `mermaid` dependency is
bumped.
