//go:build linux

package mhlbridge

import (
	"os"
	"strconv"
	"strings"
)

type osInspector struct{}

func (osInspector) alive(pid int) bool { return unixAlive(pid) }

func (osInspector) exe(pid int) string {
	path, err := os.Readlink("/proc/" + strconv.Itoa(pid) + "/exe")
	if err != nil {
		return ""
	}
	// A running image whose file was replaced reads "<path> (deleted)".
	return strings.TrimSuffix(path, " (deleted)")
}

// parent reads field 4 of /proc/<pid>/stat; the command name (field 2) can
// hold spaces and parentheses, so fields are counted after its closing ")".
func (osInspector) parent(pid int) int {
	data, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/stat")
	if err != nil {
		return 0
	}
	text := string(data)
	end := strings.LastIndexByte(text, ')')
	if end < 0 {
		return 0
	}
	fields := strings.Fields(text[end+1:])
	if len(fields) < 2 {
		return 0
	}
	ppid, _ := strconv.Atoi(fields[1])
	return ppid
}

func (osInspector) kill(pid int) { killGracefully(pid) }
