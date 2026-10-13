//go:build linux && !cgo

package main

func webkitVersion() string { return "? (build sem cgo)" }

func glibcVersion() string { return "? (build sem cgo)" }
