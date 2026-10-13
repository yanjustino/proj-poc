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

// detachFromTerminal roda o filho numa sessao propria, sem terminal de
// controle. Necessario para o login shell interativo de loginShellPath: um
// `bash -i` que encontra o terminal do app e nao esta em primeiro plano
// manda SIGTTIN para o proprio grupo de processos — que, sem isto, e o do
// app. O app inteiro parava (estado T): o GNOME mostrava "not responding" e
// o app.log terminava em "arquivos prontos" (RHEL, app aberto do terminal).
func detachFromTerminal(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
}
