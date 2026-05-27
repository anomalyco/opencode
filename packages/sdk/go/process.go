package opencode

import (
	"context"
	"fmt"
	"os/exec"
	"runtime"
)

// Stop terminates a child process gracefully.
// On Windows it uses taskkill /T /F to kill the process tree.
func Stop(cmd *exec.Cmd) {
	if cmd.Process == nil {
		return
	}
	if cmd.ProcessState != nil && cmd.ProcessState.Exited() {
		return
	}
	if runtime.GOOS == "windows" {
		kill := exec.Command("taskkill", "/pid", fmt.Sprintf("%d", cmd.Process.Pid), "/T", "/F")
		kill.Run()
		return
	}
	cmd.Process.Kill()
}

// BindContext returns a cancel function that stops the process when ctx is done.
func BindContext(ctx context.Context, cmd *exec.Cmd) func() {
	if ctx == nil {
		return func() {}
	}

	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			Stop(cmd)
		case <-done:
		}
	}()

	return func() {
		select {
		case <-done:
		default:
			close(done)
		}
	}
}
