//go:build !linux

package main

import "os"

func platformDiagnostics(string) []string { return nil }

// No macOS e no Windows o stderr nativo continua onde estava; o panic do Go
// chega ao app.log por debug.SetCrashOutput (setupFileLogging).
func redirectNativeStderr(*os.File) bool { return false }
