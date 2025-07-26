package main

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"

	tea "github.com/charmbracelet/bubbletea/v2"
	flag "github.com/spf13/pflag"
	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode-sdk-go/option"
	"github.com/sst/opencode/internal/api"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/clipboard"
	"github.com/sst/opencode/internal/tui"
	"github.com/sst/opencode/internal/util"
)

var Version = "dev"

func main() {
	version := Version
	if version != "dev" && !strings.HasPrefix(Version, "v") {
		version = "v" + Version
	}

	var model *string = flag.String("model", "", "model to begin with")
	var prompt *string = flag.String("prompt", "", "prompt to begin with")
	var mode *string = flag.String("mode", "", "mode to begin with")
	flag.Parse()

	url := os.Getenv("OPENCODE_SERVER")

	appInfoStr := os.Getenv("OPENCODE_APP_INFO")
	var appInfo opencode.App
	err := json.Unmarshal([]byte(appInfoStr), &appInfo)
	if err != nil {
		slog.Error("Failed to unmarshal app info", "error", err)
		os.Exit(1)
	}

	modesStr := os.Getenv("OPENCODE_MODES")
	var modes []opencode.Mode
	err = json.Unmarshal([]byte(modesStr), &modes)
	if err != nil {
		slog.Error("Failed to unmarshal modes", "error", err)
		os.Exit(1)
	}

	stat, err := os.Stdin.Stat()
	if err != nil {
		slog.Error("Failed to stat stdin", "error", err)
		os.Exit(1)
	}

	// Check if there's data piped to stdin
	if (stat.Mode() & os.ModeCharDevice) == 0 {
		stdin, err := io.ReadAll(os.Stdin)
		if err != nil {
			slog.Error("Failed to read stdin", "error", err)
			os.Exit(1)
		}
		stdinContent := strings.TrimSpace(string(stdin))
		if stdinContent != "" {
			if prompt == nil || *prompt == "" {
				prompt = &stdinContent
			} else {
				combined := *prompt + "\n" + stdinContent
				prompt = &combined
			}
		}
	}

	httpClient := opencode.NewClient(
		option.WithBaseURL(url),
	)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	apiHandler := util.NewAPILogHandler(ctx, httpClient, "tui", slog.LevelDebug)
	logger := slog.New(apiHandler)
	slog.SetDefault(logger)

	slog.Debug("TUI launched", "app", appInfoStr, "modes", modesStr)

	go func() {
		err = clipboard.Init()
		if err != nil {
			slog.Error("Failed to initialize clipboard", "error", err)
		}
	}()

	// Create main context for the application
	app_, err := app.New(ctx, version, appInfo, modes, httpClient, model, prompt, mode)
	if err != nil {
		panic(err)
	}

	program := tea.NewProgram(
		tui.NewModel(app_),
		tea.WithAltScreen(),
		tea.WithMouseCellMotion(),
	)

	// Set up signal handling for graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGTERM, syscall.SIGINT)

	go func() {
		stream := httpClient.Event.ListStreaming(ctx)
		for stream.Next() {
			evt := stream.Current().AsUnion()
			if _, ok := evt.(opencode.EventListResponseEventStorageWrite); ok {
				continue
			}
			program.Send(evt)
		}
		if err := stream.Err(); err != nil {
			slog.Error("Error streaming events", "error", err)
			program.Send(err)
		}
	}()

	go api.Start(ctx, program, httpClient)

	// Handle signals in a separate goroutine
	go func() {
		sig := <-sigChan
		slog.Info("Received signal, shutting down gracefully", "signal", sig)
		program.Quit()
	}()

	// Run the TUI
	result, err := program.Run()
	if err != nil {
		slog.Error("TUI error", "error", err)
	}

	slog.Info("TUI exited", "result", result)
}
