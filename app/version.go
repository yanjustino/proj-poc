package main

import (
	"runtime/debug"
	"strings"
)

// buildVersion is replaced by release builds with:
//
//	-ldflags "-X main.buildVersion=<tag-or-commit>"
//
// Keeping a useful fallback makes ad-hoc `wails build` artifacts identifiable
// even when the caller did not use the repository build script.
var buildVersion = "dev"

func currentAppVersion() string {
	if version := strings.TrimSpace(buildVersion); version != "" && version != "dev" {
		return version
	}
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return "dev"
	}
	var revision string
	modified := false
	for _, setting := range info.Settings {
		switch setting.Key {
		case "vcs.revision":
			revision = setting.Value
		case "vcs.modified":
			modified = setting.Value == "true"
		}
	}
	if revision == "" {
		return "dev"
	}
	if len(revision) > 12 {
		revision = revision[:12]
	}
	if modified {
		revision += "-dirty"
	}
	return revision
}

// AppVersion is bound to the frontend so support screenshots and reports can
// identify the exact installed build on every operating system.
func (a *App) AppVersion() string {
	return currentAppVersion()
}
