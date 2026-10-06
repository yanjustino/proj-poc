//go:build !windows && !darwin && !linux

package mhlbridge

// osInspector on a platform Senpai doesn't ship for: no way to confirm a
// pid is really the mhl, so nothing is ever killed (exe "" fails isSameMHL).
type osInspector struct{}

func (osInspector) alive(pid int) bool { return unixAlive(pid) }
func (osInspector) exe(int) string     { return "" }
func (osInspector) parent(int) int     { return 0 }
func (osInspector) kill(pid int)       { killGracefully(pid) }
