//go:build linux && arm64

package main

import _ "embed"

// See vendor_mhl_darwin_arm64.go's doc comment — same mechanism, other
// target (Ubuntu ARM64, e.g. a Parallels/UTM VM on Apple Silicon).
//
//go:embed embedded/bin/mhl-linux-arm64
var vendoredMHLBinary []byte

const vendoredMHLBinaryName = "mhl"
const vendoredMHLAvailable = true

// The vendored pdftotext (poppler) for this target — what RawExtract shells
// out to for .pdf ingestion. Built by app/embedded/build-pdftotext.sh;
// extracted next to mhl by ensureVendoredPdftotext.
//
//go:embed embedded/bin/pdftotext-linux-arm64
var vendoredPdftotextBinary []byte

const vendoredPdftotextBinaryName = "pdftotext"
const vendoredPdftotextAvailable = true
