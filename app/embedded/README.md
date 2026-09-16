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

1. Get (or build) the `mhl` binary for that exact `GOOS`/`GOARCH`.
2. Copy it to `bin/mhl-<goos>-<goarch>` (add `.exe` on Windows).
3. `chmod 755` it (harmless on Windows, required on macOS/Linux).
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
sha256 so a stale copy doesn't go unnoticed.

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
