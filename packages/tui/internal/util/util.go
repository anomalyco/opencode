package util

import (
	"log/slog"
	"os"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea/v2"
)

// GetTimeFormat returns the appropriate Go time format string based on config
func GetTimeFormat(config string) string {
	switch config {
	case "24h":
		return "2006-01-02 15:04:05"
	case "12h":
		return "2006-01-02 03:04:05 PM"
	default:
		return "2006-01-02 15:04:05" // fallback to 24h
	}
}

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
