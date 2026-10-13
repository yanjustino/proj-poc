//go:build !windows

package mhlbridge

import (
	"context"
	"testing"
)

// O login shell interativo nao pode compartilhar sessao/grupo com o app: um
// `bash -i` em segundo plano manda SIGTTIN ao proprio grupo e parava o app.
func TestLoginShellCommandIsDetachedFromTheAppTerminal(t *testing.T) {
	cmd := loginShellCommand(context.Background(), "/bin/sh")
	if cmd.SysProcAttr == nil || !cmd.SysProcAttr.Setsid {
		t.Fatal("login shell sem Setsid: um bash -i pode parar o app inteiro com SIGTTIN")
	}
	if cmd.WaitDelay <= 0 {
		t.Fatal("login shell sem WaitDelay: um processo do .bashrc segurando o stdout trava Output()")
	}
}
