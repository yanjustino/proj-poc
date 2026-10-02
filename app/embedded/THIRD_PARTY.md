# Third-party binaries vendored under `bin/`

## pdftotext (poppler)

- Files: `bin/pdftotext-darwin-arm64`, `bin/pdftotext-linux-amd64`,
  `bin/pdftotext-linux-arm64`, `bin/pdftotext-windows-amd64.exe`
- Upstream: <https://poppler.freedesktop.org/> — version pinned in
  `build-pdftotext.sh` (`POPPLER_VERSION`), source tarball checked by sha256.
- License: GPL-2.0-or-later. The binaries are built unmodified from the
  upstream release tarball by `build-pdftotext.sh`, which together with the
  pinned upstream URL is the corresponding source for them. Senpai runs it as
  a separate process (`cmd.exec`), never links against it.
- Statically linked freetype (`FREETYPE_VERSION`): FreeType License (FTL) /
  GPL-2.0, <https://freetype.org/>.
- On linux-amd64 and linux-arm64 the static binary also contains musl libc (MIT) and, on
  windows-amd64, the mingw-w64 runtime (permissive) and libgcc/libstdc++
  (GPLv3 with the GCC Runtime Library Exception).

Anyone redistributing a Senpai build that embeds these files must comply with
the GPL for them (offer the source above along with the binary).
