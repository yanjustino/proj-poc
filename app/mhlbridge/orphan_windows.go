//go:build windows

package mhlbridge

import (
	"errors"
	"unsafe"

	"golang.org/x/sys/windows"
)

type osInspector struct{}

const stillActive = 259 // STILL_ACTIVE, GetExitCodeProcess of a running process

func (osInspector) alive(pid int) bool {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		// Access denied means it exists (another user's or a protected
		// process); anything else (invalid parameter) means it's gone.
		return errors.Is(err, windows.ERROR_ACCESS_DENIED)
	}
	defer windows.CloseHandle(h)
	var code uint32
	if windows.GetExitCodeProcess(h, &code) != nil {
		return false
	}
	return code == stillActive
}

func (osInspector) exe(pid int) string {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(h)
	buf := make([]uint16, windows.MAX_LONG_PATH)
	size := uint32(len(buf))
	if windows.QueryFullProcessImageName(h, 0, &buf[0], &size) != nil {
		return ""
	}
	return windows.UTF16ToString(buf[:size])
}

func (osInspector) parent(pid int) int {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return 0
	}
	defer windows.CloseHandle(snap)
	var entry windows.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	for err = windows.Process32First(snap, &entry); err == nil; err = windows.Process32Next(snap, &entry) {
		if int(entry.ProcessID) == pid {
			return int(entry.ParentProcessID)
		}
	}
	return 0
}

func (osInspector) kill(pid int) { killGracefully(pid) }
