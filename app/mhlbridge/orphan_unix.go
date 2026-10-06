//go:build !windows

package mhlbridge

import (
	"errors"
	"syscall"
)

// unixAlive: signal 0 checks for existence without delivering anything;
// EPERM still means the process exists (owned by someone else).
func unixAlive(pid int) bool {
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}
