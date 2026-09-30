//go:build linux && amd64

package main

import _ "embed"

// See vendor_mhl_darwin_arm64.go's doc comment — same mechanism, other
// target.
//
//go:embed embedded/bin/mhl-linux-amd64
var vendoredMHLBinary []byte

const vendoredMHLBinaryName = "mhl"
const vendoredMHLAvailable = true

// The vendored pdftotext (poppler) for this target — what RawExtract shells
// out to for .pdf ingestion. Built by app/embedded/build-pdftotext.sh;
// extracted next to mhl by ensureVendoredPdftotext.
//
//go:embed embedded/bin/pdftotext-linux-amd64
var vendoredPdftotextBinary []byte

const vendoredPdftotextBinaryName = "pdftotext"
const vendoredPdftotextAvailable = true
