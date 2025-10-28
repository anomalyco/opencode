package main

import (
	"context"
	"io"
	"log/slog"
	"math"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	tea "github.com/charmbracelet/bubbletea/v2"
	flag "github.com/spf13/pflag"
	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode-sdk-go/option"
	"github.com/sst/opencode/internal/api"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/clipboard"
	"github.com/sst/opencode/internal/tui"
	"github.com/sst/opencode/internal/util"
	"golang.org/x/sync/errgroup"
)

var Version = "dev"

// startEventStream starts the event streaming loop with reconnection logic
func startEventStream(ctx context.Context, client *opencode.Client, program *tea.Program) {
	const (
		minBackoff = 1 * time.Second
		maxBackoff = 30 * time.Second
	)

	attempt := 0
	reconnected := false
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		stream := client.Event.ListStreaming(ctx, opencode.EventListParams{})
		streamActive := false

		for stream.Next() {
			if !streamActive {
				streamActive = true
				// Notify UI that connection was restored after reconnection attempts
				if reconnected {
					program.Send(tui.ConnectionReconnectedMsg{Attempt: attempt})
					reconnected = false
				}
				attempt = 0 // Reset attempt counter on successful stream
			}
			evt := stream.Current().AsUnion()
			program.Send(evt)
		}

		if err := stream.Err(); err != nil {
			slog.Error("Event stream error", "error", err, "attempt", attempt+1)
		}

		// If context is cancelled, exit
		if ctx.Err() != nil {
			return
		}

		// Calculate backoff with exponential increase
		backoff := minBackoff
		if streamActive {
			// If stream was active and then dropped, use minimal backoff
			backoff = minBackoff
		} else {
			// Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s, 30s, ...
			backoff = time.Duration(math.Min(float64(minBackoff)*math.Pow(2, float64(attempt)), float64(maxBackoff)))
		}

		attempt++
		reconnected = true

		slog.Info("Reconnecting to event stream", "backoff_seconds", backoff.Seconds(), "attempt", attempt)

		// Notify UI that we're trying to reconnect
		program.Send(tui.ConnectionReconnectingMsg{
			Attempt: attempt,
			Backoff: backoff,
		})

		select {
		case <-time.After(backoff):
			// Continue to next iteration to reconnect
		case <-ctx.Done():
			return
		}
	}
}

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

	go startEventStream(ctx, httpClient, program)

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
