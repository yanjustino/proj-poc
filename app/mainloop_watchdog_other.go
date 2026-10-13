//go:build !(linux && cgo)

package main

// O watchdog existe so no Linux (mainloop_watchdog_linux.go): e onde o loop
// da GTK trava e o GNOME mostra "not responding".
func startMainLoopWatchdog() {}
