package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode-sdk-go/option"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/tui"
)

var Version = "dev"

func main() {
	version := Version
	if version != "dev" && !strings.HasPrefix(Version, "v") {
		version = "v" + Version
	}

	url := os.Getenv("OPENCODE_SERVER")

	appInfoStr := os.Getenv("OPENCODE_APP_INFO")
	var appInfo opencode.App
	err := json.Unmarshal([]byte(appInfoStr), &appInfo)
	if err != nil {
		slog.Error("Failed to unmarshal app info", "error", err)
		os.Exit(1)
	}

	logfile := filepath.Join(appInfo.Path.Data, "log", "tui.log")
	if _, err := os.Stat(filepath.Dir(logfile)); os.IsNotExist(err) {
		err := os.MkdirAll(filepath.Dir(logfile), 0755)
		if err != nil {
			slog.Error("Failed to create log directory", "error", err)
			os.Exit(1)
		}
	}
	file, err := os.Create(logfile)
	if err != nil {
		slog.Error("Failed to create log file", "error", err)
		os.Exit(1)
	}
	defer file.Close()
	logger := slog.New(slog.NewTextHandler(file, &slog.HandlerOptions{Level: slog.LevelDebug}))
	slog.SetDefault(logger)

	slog.Debug("TUI launched", "app", appInfo)

	httpClient := opencode.NewClient(
		option.WithBaseURL(url),
	)

	if err != nil {
		slog.Error("Failed to create client", "error", err)
		os.Exit(1)
	}

	// Create main context for the application
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	app_, err := app.New(ctx, version, appInfo, httpClient)
	if err != nil {
		panic(err)
	}

	program := tea.NewProgram(
		tui.NewModel(app_),
		tea.WithAltScreen(),
		tea.WithKeyboardEnhancements(),
		tea.WithMouseCellMotion(),
	)

	go func() {
		stream := httpClient.Event.ListStreaming(ctx)
		for stream.Next() {
			evt := stream.Current().AsUnion()
			program.Send(evt)
		}
		if err := stream.Err(); err != nil {
			slog.Error("Error streaming events", "error", err)
			program.Send(err)
		}
	}()

	// Run the TUI
	result, err := program.Run()
	if err != nil {
		slog.Error("TUI error", "error", err)
	}

	slog.Info("TUI exited", "result", result)
}
