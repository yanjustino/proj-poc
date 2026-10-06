//go:build darwin

package mhlbridge

import (
	"bytes"
	"encoding/binary"

	"golang.org/x/sys/unix"
)

type osInspector struct{}

func (osInspector) alive(pid int) bool { return unixAlive(pid) }

// exe reads the executable path from kern.procargs2: a 4-byte argc followed
// by the NUL-terminated path the process was exec'd from.
func (osInspector) exe(pid int) string {
	raw, err := unix.SysctlRaw("kern.procargs2", pid)
	if err != nil || len(raw) < 5 {
		return ""
	}
	_ = binary.LittleEndian.Uint32(raw[:4]) // argc
	path := raw[4:]
	if i := bytes.IndexByte(path, 0); i >= 0 {
		path = path[:i]
	}
	return string(path)
}

func (osInspector) parent(pid int) int {
	info, err := unix.SysctlKinfoProc("kern.proc.pid", pid)
	if err != nil {
		return 0
	}
	return int(info.Eproc.Ppid)
}

func (osInspector) kill(pid int) { killGracefully(pid) }
