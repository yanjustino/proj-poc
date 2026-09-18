//go:build windows

package mhlbridge

import (
	"os/exec"
	"syscall"
	"testing"
)

func TestSetProcessGroupHidesConsoleWindow(t *testing.T) {
	command := exec.Command("cmd.exe", "/c", "exit", "0")
	setProcessGroup(command)
	if command.SysProcAttr == nil {
		t.Fatal("setProcessGroup left SysProcAttr nil")
	}
	if !command.SysProcAttr.HideWindow {
		t.Error("setProcessGroup did not set HideWindow")
	}
	want := uint32(syscall.CREATE_NEW_PROCESS_GROUP | createNoWindow)
	if command.SysProcAttr.CreationFlags&want != want {
		t.Errorf("CreationFlags = %#x, want flags %#x", command.SysProcAttr.CreationFlags, want)
	}
}
