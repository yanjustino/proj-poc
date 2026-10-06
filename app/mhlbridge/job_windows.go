//go:build windows

package mhlbridge

import (
	"log"
	"os/exec"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

// attachKillOnCloseJob puts the freshly started mhl into a Job Object with
// JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE. Processes mhl spawns afterwards (the
// devin/claude/codex agents) join the same job, and Windows kills the whole
// job when its last handle closes: on Stop() (the returned func), and also
// when this app dies without Stop() — the handle is not inheritable, so only
// this process holds it. Without it, Kill() ended mhl.exe alone and left the
// agents running. Best-effort: on failure mhl just runs outside a job, as
// before, and the returned func does nothing.
func attachKillOnCloseJob(cmd *exec.Cmd) func() {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		log.Printf("mhl bridge: job object: create: %v", err)
		return func() {}
	}
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{
		BasicLimitInformation: windows.JOBOBJECT_BASIC_LIMIT_INFORMATION{
			LimitFlags: windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
		},
	}
	if _, err := windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info))); err != nil {
		log.Printf("mhl bridge: job object: set kill-on-close: %v", err)
		windows.CloseHandle(job)
		return func() {}
	}
	proc, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(cmd.Process.Pid))
	if err != nil {
		log.Printf("mhl bridge: job object: open mhl process: %v", err)
		windows.CloseHandle(job)
		return func() {}
	}
	defer windows.CloseHandle(proc)
	if err := windows.AssignProcessToJobObject(job, proc); err != nil {
		log.Printf("mhl bridge: job object: assign mhl: %v", err)
		windows.CloseHandle(job)
		return func() {}
	}
	var once sync.Once
	return func() { once.Do(func() { windows.CloseHandle(job) }) }
}
