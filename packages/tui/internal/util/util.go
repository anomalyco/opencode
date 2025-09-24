package util

import (
	"log/slog"
	"os"
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

func CleanTitle(title string) string {
	title = strings.TrimSpace(title)
	if !strings.HasPrefix(title, "```") || !strings.HasSuffix(title, "```") {
		title = strings.ReplaceAll(title, "\n", " ")
		return strings.TrimSpace(title)
	}
	if len(title) < 6 {
		return ""
	}
	content := title[3 : len(title)-3]
	if content == "" {
		return ""
	}
	lines := strings.Split(content, "\n")
	if len(lines) > 0 {
		first := strings.TrimSpace(lines[0])
		if first != "" && !strings.Contains(first, " ") && len(first) < 20 {
			lines = lines[1:]
		}
	}
	title = strings.Join(lines, "\n")
	title = strings.ReplaceAll(title, "\n", " ")
	return strings.TrimSpace(title)
}

func Measure(tag string) func(...any) {
	startTime := time.Now()
	return func(args ...any) {
		args = append(args, []any{"timeTakenMs", time.Since(startTime).Milliseconds()}...)
		slog.Debug(tag, args...)
	}
}
