//go:build windows && amd64

package main

import _ "embed"

// See vendor_mhl_darwin_arm64.go's doc comment — same mechanism, other
// target. Extracted filename keeps the .exe suffix Windows expects.
//
//go:embed embedded/bin/mhl-windows-amd64.exe
var vendoredMHLBinary []byte

const vendoredMHLBinaryName = "mhl.exe"
const vendoredMHLAvailable = true

// The vendored pdftotext (poppler) for this target — what RawExtract shells
// out to for .pdf ingestion. Built by app/embedded/build-pdftotext.sh;
// extracted next to mhl by ensureVendoredPdftotext.
//
//go:embed embedded/bin/pdftotext-windows-amd64.exe
var vendoredPdftotextBinary []byte

const vendoredPdftotextBinaryName = "pdftotext.exe"
const vendoredPdftotextAvailable = true
