//go:build !(darwin && arm64) && !(linux && amd64) && !(windows && amd64)

package main

// No vendored mhl binary exists for this GOOS/GOARCH combination yet (see
// app/embedded/README.md for the full list and how to add one — today that's
// darwin/amd64 and anything else). This file exists so the build still
// compiles cleanly for every target instead of failing with a cryptic
// "undefined: vendoredMHLBinary" — ensureVendoredMHL (vendor_extract.go)
// checks vendoredMHLAvailable and fails with a clear, actionable message at
// runtime instead.
var vendoredMHLBinary []byte

const vendoredMHLBinaryName = ""
const vendoredMHLAvailable = false
