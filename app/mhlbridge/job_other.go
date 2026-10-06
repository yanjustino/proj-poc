//go:build !windows

package mhlbridge

import "os/exec"

// attachKillOnCloseJob is Windows-only (job_windows.go); elsewhere mhl runs
// in its own process group (setProcessGroup) and this is a no-op.
func attachKillOnCloseJob(*exec.Cmd) func() { return func() {} }
