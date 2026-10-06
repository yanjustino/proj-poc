package mhlbridge

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// Cleanup of an mhl child left behind by an earlier run of the app that
// ended without calling Stop() (crash, force-quit, killed debug session).
//
// Each Senpai instance records its own mhl in <stateDir>/mhl-<app pid>.pid
// (pidRecord, JSON) and removes it on a clean Stop(). At startup,
// cleanupStaleMHL looks at every record and kills the recorded mhl only when
// all of these hold:
//
//   - the process is still alive;
//   - its executable is really the vendored mhl the record names — a pid the
//     OS reused for some other program is never touched (Windows reuses pids
//     quickly);
//   - the Senpai instance that started it is gone — the mhl of another
//     instance still open (the old version while a new one starts, two
//     windows) is left alone.
//
// Releases up to 6.7 wrote a single <stateDir>/mhl.pid holding only the bare
// pid (legacyPidFile). It is still honored: the owner is then the mhl's
// parent process, read from the OS.

// pidRecord is what an instance writes about its own mhl child.
type pidRecord struct {
	MhlPID   int    `json:"mhl_pid"`
	OwnerPID int    `json:"owner_pid"`
	Exe      string `json:"exe"`
}

const legacyPidFile = "mhl.pid"

func instancePidFile(stateDir string) string {
	return filepath.Join(stateDir, "mhl-"+strconv.Itoa(os.Getpid())+".pid")
}

func writePidRecord(path string, rec pidRecord) {
	body, err := json.Marshal(rec)
	if err != nil {
		return
	}
	_ = os.WriteFile(path, body, 0o644)
}

// processInspector is the OS access cleanupStaleMHL needs, swappable in
// tests. Implementations live in orphan_<os>.go.
type processInspector interface {
	alive(pid int) bool
	// exe returns the absolute path of pid's executable, "" when unknown.
	exe(pid int) string
	// parent returns pid's parent pid, 0 when unknown.
	parent(pid int) int
	kill(pid int)
}

var inspector processInspector = osInspector{}

// cleanupStaleMHL reaps the stale mhl processes recorded under stateDir.
// mhlPath is the vendored binary this app runs — what a legacy record (which
// names no executable) is checked against.
func cleanupStaleMHL(stateDir, mhlPath string) {
	paths, _ := filepath.Glob(filepath.Join(stateDir, "mhl-*.pid"))
	legacy := filepath.Join(stateDir, legacyPidFile)
	if _, err := os.Stat(legacy); err == nil {
		paths = append(paths, legacy)
	}
	for _, path := range paths {
		reapRecord(path, mhlPath)
	}
}

// reapRecord applies the rules above to one pid file. The file is consumed
// whenever there's nothing left to do about it; it is kept only while its
// owner instance is still running, since that instance removes it itself.
func reapRecord(path, mhlPath string) {
	rec, ok := readPidRecord(path)
	if !ok || rec.MhlPID <= 0 {
		_ = os.Remove(path)
		return
	}
	if rec.Exe == "" {
		rec.Exe = mhlPath
	}
	if !inspector.alive(rec.MhlPID) {
		_ = os.Remove(path)
		return
	}
	if actual := inspector.exe(rec.MhlPID); !isSameMHL(actual, rec.Exe) {
		log.Printf("mhl bridge: pid %d de %s não é mais o mhl (%q) — registro descartado, processo preservado", rec.MhlPID, filepath.Base(path), actual)
		_ = os.Remove(path)
		return
	}
	if rec.OwnerPID != 0 && rec.OwnerPID != os.Getpid() && inspector.alive(rec.OwnerPID) {
		log.Printf("mhl bridge: mhl pid %d pertence a outra instância do Senpai ainda aberta (pid %d) — preservado", rec.MhlPID, rec.OwnerPID)
		return
	}
	log.Printf("mhl bridge: encerrando mhl órfão de uma execução anterior (pid %d)", rec.MhlPID)
	inspector.kill(rec.MhlPID)
	_ = os.Remove(path)
}

// readPidRecord reads either format: the JSON record, or a legacy file
// holding only the pid (its owner is then the process's parent).
func readPidRecord(path string) (pidRecord, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return pidRecord{}, false
	}
	text := strings.TrimSpace(string(data))
	if strings.HasPrefix(text, "{") {
		var rec pidRecord
		if json.Unmarshal(data, &rec) != nil {
			return pidRecord{}, false
		}
		return rec, true
	}
	pid, err := strconv.Atoi(text)
	if err != nil {
		return pidRecord{}, false
	}
	owner := inspector.parent(pid)
	if owner == 1 {
		owner = 0 // reparented to init/launchd: its Senpai is gone
	}
	return pidRecord{MhlPID: pid, OwnerPID: owner}, true
}

// isSameMHL: actual is the running process's executable, expected the one
// recorded. A running image that the extraction later moved aside on Windows
// (".mhl.exe.old-<n>", see replaceFile in the app package) still counts.
func isSameMHL(actual, expected string) bool {
	if actual == "" || expected == "" {
		return false
	}
	norm := func(p string) string {
		if resolved, err := filepath.EvalSymlinks(p); err == nil {
			p = resolved
		}
		p = filepath.Clean(p)
		if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
			p = strings.ToLower(p) // case-insensitive file systems by default
		}
		return p
	}
	a, e := norm(actual), norm(expected)
	if a == e {
		return true
	}
	return filepath.Dir(a) == filepath.Dir(e) && strings.HasPrefix(filepath.Base(a), "."+filepath.Base(e)+".old-")
}

// killGracefully asks pid to exit, then force-kills it after a short grace
// window. Shared by the OS inspectors.
func killGracefully(pid int) {
	proc, err := os.FindProcess(pid)
	if err != nil {
		return
	}
	if proc.Signal(os.Interrupt) != nil {
		_ = proc.Kill() // Windows: Signal unsupported there — see terminate()
		return
	}
	time.Sleep(500 * time.Millisecond)
	_ = proc.Kill()
}
