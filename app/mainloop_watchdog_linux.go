//go:build linux && cgo

package main

// Watchdog da thread principal da GTK. Sintoma que motivou: no RHEL o app
// abre, desenha parte da tela e o GNOME mostra "senpai-app is not
// responding" — o loop da GTK parou, sem erro nenhum no log. Um heartbeat no
// proprio loop (g_timeout_add) marca a hora a cada 500ms; uma goroutine
// confere essa hora e, se ela parar, registra quanto tempo o loop ficou
// travado e o stack de todas as goroutines. Se a thread principal estiver
// presa num callback do Wails em Go (p. ex. um envio para messageBuffer ou
// requestBuffer cheio), ela aparece no dump; se nao aparecer, o travamento
// esta no codigo C (GTK/WebKitGTK) — ai so um `gdb -p` mostra onde.

/*
#cgo !webkit2_41 pkg-config: webkit2gtk-4.0
#cgo webkit2_41 pkg-config: webkit2gtk-4.1
#include <glib.h>

static volatile gint64 senpai_last_tick = 0;

static gboolean senpai_tick(gpointer data) {
	senpai_last_tick = g_get_monotonic_time();
	return G_SOURCE_CONTINUE;
}

static void senpai_install_heartbeat(void) {
	g_timeout_add(500, senpai_tick, NULL);
}

static gint64 senpai_tick_age_us(void) {
	gint64 last = senpai_last_tick;
	if (last == 0) return -1;
	return g_get_monotonic_time() - last;
}
*/
import "C"

import (
	"log"
	"runtime"
	"time"
)

const (
	mainLoopStallAfter  = 3 * time.Second
	mainLoopSecondDump  = 15 * time.Second
	mainLoopCheckPeriod = time.Second
)

func startMainLoopWatchdog() {
	C.senpai_install_heartbeat()
	go func() {
		var stalledFor time.Duration
		dumps := 0
		for range time.Tick(mainLoopCheckPeriod) {
			ageUs := int64(C.senpai_tick_age_us())
			if ageUs < 0 {
				continue // o loop da GTK ainda nao comecou
			}
			age := time.Duration(ageUs) * time.Microsecond
			if age < mainLoopStallAfter {
				if stalledFor > 0 {
					log.Printf("watchdog: thread da GTK voltou a responder depois de ~%s travada", stalledFor.Round(time.Second))
				}
				stalledFor, dumps = 0, 0
				continue
			}
			stalledFor = age
			// Um dump logo no inicio e outro mais adiante: comparar os dois
			// mostra se a thread esta parada no mesmo ponto.
			if dumps == 0 || (dumps == 1 && age >= mainLoopSecondDump) {
				dumps++
				log.Printf("watchdog: thread da GTK sem responder ha %s — stack de todas as goroutines (dump %d):\n%s", age.Round(time.Second), dumps, allGoroutineStacks())
				if dumps == 1 {
					log.Printf("watchdog: para testar a hipotese de renderizacao, abra com WEBKIT_DISABLE_COMPOSITING_MODE=1 ou WEBKIT_DISABLE_DMABUF_RENDERER=1")
				}
			}
		}
	}()
}

func allGoroutineStacks() []byte {
	buf := make([]byte, 1<<20)
	for {
		n := runtime.Stack(buf, true)
		if n < len(buf) || len(buf) >= 16<<20 {
			return buf[:n]
		}
		buf = make([]byte, 2*len(buf))
	}
}
