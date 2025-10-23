package util

import (
	"log/slog"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea/v2"
)

func CmdHandler(msg tea.Msg) tea.Cmd {
	return func() tea.Msg {
		return msg
	}
}

func Clamp(v, low, high int) int {
	// Swap if needed to ensure low <= high
	if high < low {
		low, high = high, low
	}
	return min(high, max(low, v))
}

func IsWsl() bool {
	// Check for WSL environment variables
	if os.Getenv("WSL_DISTRO_NAME") != "" {
		return true
	}

	// Check /proc/version for WSL signature
	if data, err := os.ReadFile("/proc/version"); err == nil {
		version := strings.ToLower(string(data))
		return strings.Contains(version, "microsoft") || strings.Contains(version, "wsl")
	}

	return false
}

func Measure(tag string) func(...any) {
	startTime := time.Now()
	return func(args ...any) {
		args = append(args, []any{"timeTakenMs", time.Since(startTime).Milliseconds()}...)
		slog.Debug(tag, args...)
	}
}

func GetEditor() string {
	if editor := os.Getenv("VISUAL"); editor != "" {
		return editor
	}
	if editor := os.Getenv("EDITOR"); editor != "" {
		return editor
	}

	commonEditors := []string{"vim", "nvim", "zed", "code", "cursor", "vi", "nano"}
	if runtime.GOOS == "windows" {
		commonEditors = []string{"vim", "nvim", "zed", "code.cmd", "cursor.cmd", "notepad.exe", "vi", "nano"}
	}

	for _, editor := range commonEditors {
		if _, err := exec.LookPath(editor); err == nil {
			return editor
		}
	}

	return ""
}
