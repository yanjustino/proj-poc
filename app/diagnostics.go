package main

import (
	"fmt"
	"log"
	"os"
	"runtime"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/logger"
)

// SENPAI_DEBUG=1 liga o modo de diagnostico: o logger do Wails passa a
// DEBUG (por padrao, num build de producao, ele so registra ERROR) e o
// ambiente de inicializacao sai mais detalhado. Pensado para quando o app
// falha ao abrir numa maquina que nao e a nossa — p. ex. um RHEL — e o
// app.log e a unica coisa que o usuario consegue mandar de volta.
func debugEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("SENPAI_DEBUG"))) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

func wailsLogLevel() logger.LogLevel {
	if debugEnabled() {
		return logger.DEBUG
	}
	return logger.INFO
}

// wailsLogger manda o log interno do Wails (erros de asset server, de
// binding, de origem bloqueada, mensagens desconhecidas do webview) para o
// mesmo destino do log padrao — o app.log. O logger padrao do Wails escreve
// no stdout, que num app aberto pelo menu/duplo clique nao vai a lugar
// nenhum.
type wailsLogger struct{}

func (wailsLogger) Print(message string)   { log.Printf("wails: %s", message) }
func (wailsLogger) Trace(message string)   { log.Printf("wails TRACE: %s", message) }
func (wailsLogger) Debug(message string)   { log.Printf("wails DEBUG: %s", message) }
func (wailsLogger) Info(message string)    { log.Printf("wails INFO: %s", message) }
func (wailsLogger) Warning(message string) { log.Printf("wails WARN: %s", message) }
func (wailsLogger) Error(message string)   { log.Printf("wails ERROR: %s", message) }

// Fatal: o Wails encerra o processo logo depois de chamar isto.
func (wailsLogger) Fatal(message string) { log.Printf("wails FATAL: %s", message) }

// logStartupEnvironment registra, no inicio de cada sessao, o que costuma
// explicar uma falha de inicializacao que so acontece numa maquina: SO,
// arquitetura, onde o app esta e para onde ele extrai o mhl, e — no Linux —
// WebKitGTK, SELinux, sessao grafica e se o diretorio de dados permite
// executar binarios (platformDiagnostics).
func logStartupEnvironment() {
	exe, err := os.Executable()
	if err != nil {
		exe = fmt.Sprintf("? (%v)", err)
	}
	base, err := senpaiBaseDir()
	if err != nil {
		base = fmt.Sprintf("? (%v)", err)
	}
	log.Printf("startup: os=%s arch=%s go=%s debug=%t", runtime.GOOS, runtime.GOARCH, runtime.Version(), debugEnabled())
	log.Printf("startup: executable=%s", exe)
	log.Printf("startup: senpai dir=%s", base)
	for _, line := range platformDiagnostics(base) {
		log.Printf("startup: %s", line)
	}
	if debugEnabled() {
		wd, _ := os.Getwd()
		log.Printf("startup: cwd=%s", wd)
		log.Printf("startup: PATH=%s", os.Getenv("PATH"))
	}
}
