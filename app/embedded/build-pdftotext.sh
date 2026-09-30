#!/usr/bin/env bash
# Builds the vendored `pdftotext` (poppler) for one platform into
# bin/pdftotext-<goos>-<goarch>[.exe] — the binary tool RawExtract
# (workflows/shared/wiki/raw_extract.mh) shells out to for .pdf ingestion.
# The app extracts it next to the vendored mhl and puts that directory on
# PATH (see ensureVendoredPdftotext in embedded_extract.go), so a packaged
# Senpai never depends on the end-user having poppler installed.
#
#   ./build-pdftotext.sh darwin-arm64    native, needs Xcode CLT (or a clang) + cmake + ninja
#   ./build-pdftotext.sh linux-amd64     via docker (alpine, fully static, musl)
#   ./build-pdftotext.sh windows-amd64   via docker (debian + mingw-w64 cross, static)
#
# Why build from source instead of copying Homebrew's/apt's binary: those
# link poppler as shared libraries (22 dylibs on macOS: nss, gpgme, lcms,
# tiff, ...) built for a very recent OS, so they can't be shipped as one
# file. Here poppler and freetype are linked statically with everything
# optional switched off (no fontconfig/nss/gpg/curl/jpeg/png/tiff/lcms/
# openjpeg). The result is one self-contained executable that only needs
# the OS's own libs (libSystem/libc++/libz on macOS, nothing on Linux,
# Windows system DLLs on Windows). Text extraction is unaffected — verified
# byte-identical to the Homebrew build on a real PDF — but images are not
# decoded (no DCT/JPX decoder), which pdftotext never needs; it only prints
# a harmless "Unknown filter 'DCTDecode'" on stderr and still exits 0.
#
# poppler is GPL-2.0-or-later, freetype is FTL/GPLv2 — see
# app/embedded/THIRD_PARTY.md for the redistribution notes.
set -euo pipefail

POPPLER_VERSION=26.04.0
POPPLER_SHA256=b0955163114af96bc0106f68cb24daf973a629462453d8b82775f81b0d4e0693
FREETYPE_VERSION=2.14.1
FREETYPE_SHA256=32427e8c471ac095853212a37aef816c60b42052d4d9e48230bab3bdf2936ccc

# Target of the darwin build; linux/windows ignore it.
export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-12.0}"

fetch() { # url sha256 dest
  curl -fsSL --retry 3 -o "$3" "$1"
  echo "$2  $3" | shasum -a 256 -c - >/dev/null 2>&1 || echo "$2  $3" | sha256sum -c - >/dev/null
}

# build_inside <platform> <outfile> — runs wherever the toolchain lives
# (the host for darwin, the container for the others).
build_inside() {
  local platform="$1" out="$2"
  local work; work="$(mktemp -d)"
  trap 'rm -rf "$work"' RETURN
  cd "$work"

  fetch "https://poppler.freedesktop.org/poppler-$POPPLER_VERSION.tar.xz" "$POPPLER_SHA256" poppler.tar.xz
  fetch "https://downloads.sourceforge.net/project/freetype/freetype2/$FREETYPE_VERSION/freetype-$FREETYPE_VERSION.tar.xz" "$FREETYPE_SHA256" freetype.tar.xz
  tar xf poppler.tar.xz
  tar xf freetype.tar.xz

  local -a common=(-G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF "-DCMAKE_PREFIX_PATH=$work/prefix")
  local font_config=generic
  case "$platform" in
    darwin-arm64)
      common+=(-DCMAKE_OSX_ARCHITECTURES=arm64 "-DCMAKE_OSX_DEPLOYMENT_TARGET=$MACOSX_DEPLOYMENT_TARGET")
      ;;
    linux-amd64)
      common+=(-DCMAKE_EXE_LINKER_FLAGS=-static -DZLIB_USE_STATIC_LIBS=ON)
      ;;
    windows-amd64)
      font_config=win32
      common+=(
        -DCMAKE_SYSTEM_NAME=Windows
        -DCMAKE_C_COMPILER=x86_64-w64-mingw32-gcc-posix
        -DCMAKE_CXX_COMPILER=x86_64-w64-mingw32-g++-posix
        -DCMAKE_RC_COMPILER=x86_64-w64-mingw32-windres
        -DCMAKE_FIND_ROOT_PATH=/usr/x86_64-w64-mingw32
        -DCMAKE_FIND_ROOT_PATH_MODE_PROGRAM=NEVER
        -DCMAKE_FIND_ROOT_PATH_MODE_LIBRARY=BOTH
        -DCMAKE_FIND_ROOT_PATH_MODE_INCLUDE=BOTH
        -DZLIB_USE_STATIC_LIBS=ON
        "-DCMAKE_EXE_LINKER_FLAGS=-static -static-libgcc -static-libstdc++"
      )
      ;;
    *) echo "plataforma desconhecida: $platform" >&2; exit 2 ;;
  esac

  cmake -S "freetype-$FREETYPE_VERSION" -B ft-build "${common[@]}" \
    "-DCMAKE_INSTALL_PREFIX=$work/prefix" \
    -DFT_DISABLE_ZLIB=ON -DFT_DISABLE_BZIP2=ON -DFT_DISABLE_PNG=ON \
    -DFT_DISABLE_HARFBUZZ=ON -DFT_DISABLE_BROTLI=ON >/dev/null
  cmake --build ft-build >/dev/null
  cmake --install ft-build >/dev/null

  cmake -S "poppler-$POPPLER_VERSION" -B pp-build "${common[@]}" \
    "-DFONT_CONFIGURATION=$font_config" \
    -DENABLE_UTILS=ON -DENABLE_QT5=OFF -DENABLE_QT6=OFF -DENABLE_GLIB=OFF \
    -DENABLE_CPP=OFF -DENABLE_BOOST=OFF -DENABLE_NSS3=OFF -DENABLE_GPGME=OFF \
    -DENABLE_LIBCURL=OFF -DENABLE_LCMS=OFF -DENABLE_LIBOPENJPEG=none \
    -DENABLE_LIBTIFF=OFF -DENABLE_LIBPNG=OFF -DENABLE_DCTDECODER=none \
    -DENABLE_ZLIB_UNCOMPRESS=OFF -DWITH_JPEG=OFF -DWITH_PNG=OFF -DWITH_Cairo=OFF \
    -DBUILD_GTK_TESTS=OFF -DBUILD_QT5_TESTS=OFF -DBUILD_QT6_TESTS=OFF \
    -DBUILD_CPP_TESTS=OFF -DBUILD_MANUAL_TESTS=OFF -DTESTDATADIR=/nonexistent >/dev/null
  cmake --build pp-build --target pdftotext

  local built="pp-build/utils/pdftotext"
  [ "$platform" = windows-amd64 ] && built="$built.exe"
  case "$platform" in
    windows-amd64) x86_64-w64-mingw32-strip "$built" ;;
    linux-amd64) strip "$built" ;;
    darwin-arm64) strip -x "$built" ;;
  esac
  cp "$built" "$out"
  chmod 755 "$out"
}

# ---- entry point ----------------------------------------------------------
if [ "${1:-}" = "--inside" ]; then
  build_inside "$2" "$3"
  exit 0
fi

platform="${1:?uso: $0 darwin-arm64|linux-amd64|windows-amd64}"
cd "$(dirname "${BASH_SOURCE[0]}")"
mkdir -p bin
case "$platform" in
  darwin-arm64) dest="bin/pdftotext-darwin-arm64" ;;
  linux-amd64) dest="bin/pdftotext-linux-amd64" ;;
  windows-amd64) dest="bin/pdftotext-windows-amd64.exe" ;;
  *) echo "plataforma desconhecida: $platform" >&2; exit 2 ;;
esac

case "$platform" in
  darwin-arm64)
    (build_inside "$platform" "$PWD/$dest")
    ;;
  linux-amd64)
    docker run --rm --platform linux/amd64 -v "$PWD:/embedded" alpine:3.20 sh -c '
      apk add --no-cache bash build-base cmake samurai curl xz coreutils zlib-dev zlib-static >/dev/null &&
      ln -sf /usr/bin/samu /usr/local/bin/ninja &&
      bash /embedded/build-pdftotext.sh --inside linux-amd64 /embedded/'"$dest"
    ;;
  windows-amd64)
    docker run --rm -v "$PWD:/embedded" debian:bookworm-slim sh -c '
      apt-get update -qq >/dev/null &&
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq bash cmake ninja-build curl xz-utils ca-certificates \
        g++-mingw-w64-x86-64-posix libz-mingw-w64-dev >/dev/null &&
      bash /embedded/build-pdftotext.sh --inside windows-amd64 /embedded/'"$dest"
    ;;
esac

echo "built $dest (sha256 $(shasum -a 256 "$dest" | cut -d' ' -f1))"
