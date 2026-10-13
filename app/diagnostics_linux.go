//go:build linux

package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
	"syscall"
)

// stNoexec: flag ST_NOEXEC de statfs(2) — o mesmo valor em todas as
// arquiteturas Linux.
const stNoexec = 0x8

func platformDiagnostics(base string) []string {
	out := []string{
		"distro=" + osRelease(),
		"kernel=" + readTrim("/proc/sys/kernel/osrelease"),
		"glibc=" + glibcVersion() + " webkit2gtk(runtime)=" + webkitVersion(),
		"selinux=" + selinuxMode(),
		fmt.Sprintf("session: XDG_SESSION_TYPE=%q WAYLAND_DISPLAY=%q DISPLAY=%q GDK_BACKEND=%q",
			os.Getenv("XDG_SESSION_TYPE"), os.Getenv("WAYLAND_DISPLAY"), os.Getenv("DISPLAY"), os.Getenv("GDK_BACKEND")),
		fmt.Sprintf("webkit env: WEBKIT_DISABLE_COMPOSITING_MODE=%q WEBKIT_DISABLE_DMABUF_RENDERER=%q LANG=%q",
			os.Getenv("WEBKIT_DISABLE_COMPOSITING_MODE"), os.Getenv("WEBKIT_DISABLE_DMABUF_RENDERER"), os.Getenv("LANG")),
	}
	// O mhl e extraido para dentro do diretorio do senpai e executado de la:
	// num /home montado com noexec, a inicializacao falha com "permission
	// denied" ao subir o mhl, mesmo com o arquivo em 0755.
	var st syscall.Statfs_t
	if err := syscall.Statfs(base, &st); err != nil {
		out = append(out, fmt.Sprintf("senpai dir mount: statfs falhou: %v", err))
	} else {
		out = append(out, fmt.Sprintf("senpai dir mount: noexec=%t", st.Flags&stNoexec != 0))
	}
	return out
}

func osRelease() string {
	f, err := os.Open("/etc/os-release")
	if err != nil {
		return "? (" + err.Error() + ")"
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		if value, ok := strings.CutPrefix(scanner.Text(), "PRETTY_NAME="); ok {
			return strings.Trim(value, `"`)
		}
	}
	return "?"
}

func selinuxMode() string {
	switch readTrim("/sys/fs/selinux/enforce") {
	case "1":
		return "enforcing"
	case "0":
		return "permissive"
	}
	return "desabilitado ou ausente"
}

func readTrim(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

// redirectNativeStderr aponta o fd 2 do processo para o app.log. So isso
// pega o que nao passa pelo pacote log: avisos/erros da GTK e da WebKitGTK
// (codigo C) e o trace de um panic do Go. Feito so quando o stderr nao e um
// terminal — aberto pelo terminal, tudo continua aparecendo nele.
func redirectNativeStderr(f *os.File) bool {
	if info, err := os.Stderr.Stat(); err == nil && info.Mode()&os.ModeCharDevice != 0 {
		return false
	}
	return syscall.Dup3(int(f.Fd()), int(os.Stderr.Fd()), 0) == nil
}
