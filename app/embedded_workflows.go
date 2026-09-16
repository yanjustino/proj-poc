package main

import "embed"

// vendoredWorkflowsFS is a copy of the repo's own workflows/ tree — the
// program mhl actually runs (WorkItem/Wiki/Discovery/Delivery, their
// schemas/templates/prompts). resolveWorkflowsDir (vendor_extract.go) only
// falls back to extracting this when no live workflows/ checkout can be
// found next to the running binary — see that function's doc comment for
// why dev/test deliberately prefers the live tree instead of this one.
// Refresh via app/embedded/sync.sh whenever workflows/ changes, before a
// release build.
//
//go:embed all:embedded/workflows
var vendoredWorkflowsFS embed.FS

// vendoredWorkflowsRoot is the embed.FS-relative prefix every path inside
// vendoredWorkflowsFS starts with, per Go's embed rules (the directive's own
// pattern becomes part of the FS root) — factored out so extraction code
// doesn't repeat the literal string.
const vendoredWorkflowsRoot = "embedded/workflows"
