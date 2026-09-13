//go:build !windows

package mhlbridge

import (
	"os/exec"
	"syscall"
)

// setProcessGroup puts the mhl child in its own process group so a signal
// meant for this app's process group doesn't also hit mhl directly — Stop()
// is the only intended way to end it.
func setProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}
