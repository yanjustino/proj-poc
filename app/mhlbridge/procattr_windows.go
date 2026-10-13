//go:build windows

package mhlbridge

import (
	"os/exec"
	"syscall"
)

const createNoWindow = 0x08000000

// setProcessGroup gives the child its own process group and prevents Windows
// from allocating a visible console for console-subsystem executables. Wails
// is a GUI process, so without CREATE_NO_WINDOW every mhl/devin helper can
// briefly create a terminal window.
func setProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP | createNoWindow,
		HideWindow:    true,
	}
}

// detachFromTerminal: no Windows nao ha terminal de controle nem SIGTTIN, e
// loginShellPath nem e chamado (enrichedEnv retorna antes).
func detachFromTerminal(*exec.Cmd) {}
