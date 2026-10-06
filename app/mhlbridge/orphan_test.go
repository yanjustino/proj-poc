package mhlbridge

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"testing"
	"time"
)

// cleanupStaleMHL doesn't need a real mhl binary to test — a `sleep` this
// test owns stands in for "the previous run's mhl", and its own executable
// path stands in for the vendored mhl path, since the checks only compare
// the recorded executable with the running one.

func startStandIn(t *testing.T) (*exec.Cmd, string, <-chan error) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("uses `sleep`, not available on Windows")
	}
	path, err := exec.LookPath("sleep")
	if err != nil {
		t.Skip("sleep not found")
	}
	cmd := exec.Command(path, "30")
	if err := cmd.Start(); err != nil {
		t.Fatalf("start stand-in process: %v", err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill() })
	// This test is the child's real OS parent — reap it as it dies, or it
	// lingers as a zombie that still answers a liveness signal.
	waited := make(chan error, 1)
	go func() { waited <- cmd.Wait() }()
	return cmd, path, waited
}

// deadPID returns the pid of a process that has already exited.
func deadPID(t *testing.T) int {
	t.Helper()
	cmd := exec.Command("true")
	if err := cmd.Run(); err != nil {
		t.Skipf("run `true`: %v", err)
	}
	return cmd.Process.Pid
}

func assertDies(t *testing.T, waited <-chan error) {
	t.Helper()
	select {
	case <-waited:
	case <-time.After(2 * time.Second):
		t.Fatal("stand-in process still alive 2s after cleanupStaleMHL")
	}
}

func assertSurvives(t *testing.T, waited <-chan error) {
	t.Helper()
	select {
	case <-waited:
		t.Fatal("stand-in process was killed, but it should have been preserved")
	case <-time.After(700 * time.Millisecond):
	}
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func TestCleanupStaleMHL_KillsAnOrphanWhoseOwnerIsGone(t *testing.T) {
	dir := t.TempDir()
	cmd, exe, waited := startStandIn(t)
	file := filepath.Join(dir, "mhl-424242.pid")
	writePidRecord(file, pidRecord{MhlPID: cmd.Process.Pid, OwnerPID: deadPID(t), Exe: exe})

	cleanupStaleMHL(dir, "")

	assertDies(t, waited)
	if exists(file) {
		t.Error("pid file still exists after its orphan was reaped")
	}
}

// The upgrade case: the old version is still open while the new one starts.
func TestCleanupStaleMHL_PreservesTheMHLOfAnotherLiveInstance(t *testing.T) {
	dir := t.TempDir()
	cmd, exe, waited := startStandIn(t)
	owner, _, _ := startStandIn(t) // a live process standing in for the other Senpai
	file := filepath.Join(dir, "mhl-"+strconv.Itoa(owner.Process.Pid)+".pid")
	writePidRecord(file, pidRecord{MhlPID: cmd.Process.Pid, OwnerPID: owner.Process.Pid, Exe: exe})

	cleanupStaleMHL(dir, "")

	assertSurvives(t, waited)
	if !exists(file) {
		t.Error("the live instance's pid file was removed — it would lose track of its own mhl")
	}
}

// A recorded pid the OS handed to some other program must never be killed.
func TestCleanupStaleMHL_NeverKillsAReusedPid(t *testing.T) {
	dir := t.TempDir()
	cmd, _, waited := startStandIn(t)
	file := filepath.Join(dir, "mhl-424242.pid")
	writePidRecord(file, pidRecord{MhlPID: cmd.Process.Pid, OwnerPID: deadPID(t), Exe: "/nao/existe/mhl"})

	cleanupStaleMHL(dir, "")

	assertSurvives(t, waited)
	if exists(file) {
		t.Error("a record pointing at a different program should be discarded")
	}
}

// Releases up to 6.7 wrote <stateDir>/mhl.pid with the bare pid. Its owner
// is the parent process — here, this test itself, i.e. "this instance".
func TestCleanupStaleMHL_LegacyFileIsStillReaped(t *testing.T) {
	dir := t.TempDir()
	cmd, exe, waited := startStandIn(t)
	file := filepath.Join(dir, legacyPidFile)
	if err := os.WriteFile(file, []byte(strconv.Itoa(cmd.Process.Pid)), 0o644); err != nil {
		t.Fatalf("write pid file: %v", err)
	}

	cleanupStaleMHL(dir, exe)

	assertDies(t, waited)
	if exists(file) {
		t.Error("legacy pid file was not consumed")
	}
}

func TestCleanupStaleMHL_LegacyFileOfAnotherBinaryIsNotActedOn(t *testing.T) {
	dir := t.TempDir()
	cmd, _, waited := startStandIn(t)
	file := filepath.Join(dir, legacyPidFile)
	if err := os.WriteFile(file, []byte(strconv.Itoa(cmd.Process.Pid)), 0o644); err != nil {
		t.Fatalf("write pid file: %v", err)
	}

	cleanupStaleMHL(dir, "/nao/existe/mhl")

	assertSurvives(t, waited)
}

func TestCleanupStaleMHL_NoPidFileIsANoop(t *testing.T) {
	cleanupStaleMHL(t.TempDir(), "")
}

func TestCleanupStaleMHL_UnparsableOrDeadRecordsAreConsumed(t *testing.T) {
	dir := t.TempDir()
	garbage := filepath.Join(dir, legacyPidFile)
	if err := os.WriteFile(garbage, []byte("not-a-pid"), 0o644); err != nil {
		t.Fatalf("write pid file: %v", err)
	}
	dead := filepath.Join(dir, "mhl-424242.pid")
	if runtime.GOOS != "windows" {
		writePidRecord(dead, pidRecord{MhlPID: deadPID(t), OwnerPID: 0, Exe: "/x/mhl"})
	}

	cleanupStaleMHL(dir, "")

	if exists(garbage) {
		t.Error("unparsable pid file was not consumed")
	}
	if exists(dead) {
		t.Error("record of an already-dead mhl was not consumed")
	}
}

func TestIsSameMHL(t *testing.T) {
	dir := t.TempDir()
	mhl := filepath.Join(dir, "mhl.exe")
	cases := []struct {
		actual, expected string
		want             bool
	}{
		{mhl, mhl, true},
		{filepath.Join(dir, ".mhl.exe.old-1759750000"), mhl, true}, // moved aside by an update while running
		{filepath.Join(dir, "outro.exe"), mhl, false},
		{filepath.Join(t.TempDir(), "mhl.exe"), mhl, false},
		{"", mhl, false},
		{mhl, "", false},
	}
	for _, c := range cases {
		if got := isSameMHL(c.actual, c.expected); got != c.want {
			t.Errorf("isSameMHL(%q, %q) = %v, want %v", c.actual, c.expected, got, c.want)
		}
	}
}
