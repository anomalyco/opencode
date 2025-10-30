package main

import (
	"context"
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
	"github.com/sst/opencode-sdk-go/packages/ssestream"
	"github.com/sst/opencode/internal/api"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/clipboard"
	"github.com/sst/opencode/internal/decoders"
	"github.com/sst/opencode/internal/tui"
	"github.com/sst/opencode/internal/util"
	"golang.org/x/sync/errgroup"
)

var Version = "dev"

func main() {
	version := Version
	if version != "dev" && !strings.HasPrefix(Version, "v") {
		version = "v" + Version
	}

	var model *string = flag.String("model", "", "model to begin with")
	var prompt *string = flag.String("prompt", "", "prompt to begin with")
	var agent *string = flag.String("agent", "", "agent to begin with")
	var sessionID *string = flag.String("session", "", "session ID")
	flag.Parse()

	url := os.Getenv("OPENCODE_SERVER")

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

	// Register custom SSE decoder to handle large events (>32MB)
	// This is a workaround for the bufio.Scanner token size limit in the auto-generated SDK
	// See: packages/tui/internal/decoders/decoder.go
	ssestream.RegisterDecoder("text/event-stream", decoders.NewUnboundedDecoder)

	httpClient := opencode.NewClient(
		option.WithBaseURL(url),
	)

	var agents []opencode.Agent
	var path *opencode.Path
	var project *opencode.Project

	batch := errgroup.Group{}

	batch.Go(func() error {
		result, err := httpClient.Project.Current(context.Background(), opencode.ProjectCurrentParams{})
		if err != nil {
			return err
		}
		project = result
		return nil
	})

	batch.Go(func() error {
		result, err := httpClient.Agent.List(context.Background(), opencode.AgentListParams{})
		if err != nil {
			return err
		}
		agents = *result
		return nil
	})

	batch.Go(func() error {
		result, err := httpClient.Path.Get(context.Background(), opencode.PathGetParams{})
		if err != nil {
			return err
		}
		path = result
		return nil
	})

	err = batch.Wait()
	if err != nil {
		panic(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	apiHandler := util.NewAPILogHandler(ctx, httpClient, "tui", slog.LevelDebug)
	logger := slog.New(apiHandler)
	slog.SetDefault(logger)

	slog.Debug("TUI launched")

	go func() {
		err = clipboard.Init()
		if err != nil {
			slog.Error("Failed to initialize clipboard", "error", err)
		}
	}()

	// Create main context for the application
	app_, err := app.New(ctx, version, project, path, agents, httpClient, model, prompt, agent, sessionID)
	if err != nil {
		panic(err)
	}

	tuiModel := tui.NewModel(app_).(*tui.Model)
	program := tea.NewProgram(
		tuiModel,
		tea.WithAltScreen(),
		tea.WithMouseCellMotion(),
	)

	// Set up signal handling for graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGTERM, syscall.SIGINT)

	go func() {
		stream := httpClient.Event.ListStreaming(ctx, opencode.EventListParams{})
		for stream.Next() {
			evt := stream.Current().AsUnion()
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
		tuiModel.Cleanup()
		program.Quit()
	}()

	// Run the TUI
	result, err := program.Run()
	if err != nil {
		slog.Error("TUI error", "error", err)
	}

	tuiModel.Cleanup()
	slog.Info("TUI exited", "result", result)
}
