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
