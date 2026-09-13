//go:build windows

package mhlbridge

import (
	"os/exec"
	"syscall"
)

// setProcessGroup gives the mhl child its own process group on Windows
// (CREATE_NEW_PROCESS_GROUP) — the closest equivalent to Setpgid on Unix,
// so Ctrl+C/console signals aimed at this app don't also reach mhl directly.
func setProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP}
}
