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
