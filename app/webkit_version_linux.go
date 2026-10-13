//go:build linux && cgo

package main

// Mesmas tags do Wails (internal/frontend/desktop/linux/webkit2.go): o build
// RHEL linka webkit2gtk-4.0, os demais webkit2gtk-4.1 (-tags webkit2_41).

/*
#cgo !webkit2_41 pkg-config: webkit2gtk-4.0
#cgo webkit2_41 pkg-config: webkit2gtk-4.1
#include <webkit2/webkit2.h>
#include <gnu/libc-version.h>
*/
import "C"
import "fmt"

// webkitVersion: a WebKitGTK carregada de fato (a do sistema), nao a do build.
func webkitVersion() string {
	return fmt.Sprintf("%d.%d.%d", C.webkit_get_major_version(), C.webkit_get_minor_version(), C.webkit_get_micro_version())
}

func glibcVersion() string { return C.GoString(C.gnu_get_libc_version()) }
