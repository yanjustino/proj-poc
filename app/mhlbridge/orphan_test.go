package mhlbridge

import (
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"testing"
	"time"
)

// killStaleOrphan doesn't need a real mhl binary to test — any process this
// test itself owns and can independently verify the death of stands in for
// "the previous run's mhl child" fine, since the function only ever acts on
// a bare pid.
func TestKillStaleOrphan_TerminatesALeftoverProcessAndConsumesTheFile(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses `sleep`, not available on Windows")
	}
	dir := t.TempDir()
	pidFile := pidFilePath(dir)

	cmd := exec.Command("sleep", "30")
	if err := cmd.Start(); err != nil {
		t.Fatalf("start stand-in process: %v", err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill() }) // in case the assertion below fails first

	if err := os.WriteFile(pidFile, []byte(strconv.Itoa(cmd.Process.Pid)), 0o644); err != nil {
		t.Fatalf("write pid file: %v", err)
	}

	// This test is also this child's real OS parent (exec.Command, not a
	// re-attached pid the way killStaleOrphan itself sees it) — reap it via
	// Wait() as it dies, same as any parent must, or it lingers as a zombie
	// that still answers a liveness signal despite being functionally dead.
	waited := make(chan error, 1)
	go func() { waited <- cmd.Wait() }()

	killStaleOrphan(pidFile)

	if _, err := os.Stat(pidFile); !os.IsNotExist(err) {
		t.Errorf("pid file still exists after killStaleOrphan (stat err: %v) — next Start() would try this same pid again", err)
	}

	select {
	case <-waited:
	case <-time.After(2 * time.Second):
		t.Fatal("stand-in process still alive 2s after killStaleOrphan")
	}
}

// The common case on a healthy first run: no previous Start() ever wrote a
// pid file here. Must be a quiet no-op, not an error or a panic.
func TestKillStaleOrphan_NoPidFileIsANoop(t *testing.T) {
	killStaleOrphan(pidFilePath(t.TempDir()))
}

// A pid file whose content isn't a valid pid (corrupt write, truncated by a
// crash mid-write) must not be treated as a live process to signal — just
// consumed and ignored, same as the "nothing there" case above.
func TestKillStaleOrphan_UnparsablePidFileIsConsumedNotActedOn(t *testing.T) {
	dir := t.TempDir()
	pidFile := pidFilePath(dir)
	if err := os.WriteFile(pidFile, []byte("not-a-pid"), 0o644); err != nil {
		t.Fatalf("write pid file: %v", err)
	}

	killStaleOrphan(pidFile) // must not panic

	if _, err := os.Stat(pidFile); !os.IsNotExist(err) {
		t.Errorf("unparsable pid file was not consumed (stat err: %v)", err)
	}
}
