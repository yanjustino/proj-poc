//go:build darwin && arm64

package main

import _ "embed"

// The vendored mhl binary for this exact build target — see
// app/embedded/README.md for how/when to refresh it. Extracted to a real file
// at runtime by ensureVendoredMHL (vendor_extract.go); embed alone can't
// exec a byte slice.
//
//go:embed embedded/bin/mhl-darwin-arm64
var vendoredMHLBinary []byte

const vendoredMHLBinaryName = "mhl"
const vendoredMHLAvailable = true
