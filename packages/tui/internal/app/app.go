package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"log/slog"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/internal/commands"
	"github.com/sst/opencode/internal/components/toast"
	"github.com/sst/opencode/internal/config"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
)

var RootPath string
var CwdPath string

type App struct {
	Info      opencode.App
	Version   string
	StatePath string
	Config    *opencode.Config
	Client    *opencode.Client
	State     *config.State
	Provider  *opencode.Provider
	Model     *opencode.Model
	Session   *opencode.Session
	Messages  []opencode.Message
	Commands  commands.CommandRegistry
}

type SessionSelectedMsg = *opencode.Session
type ModelSelectedMsg struct {
	Provider opencode.Provider
	Model    opencode.Model
}
type SessionClearedMsg struct{}
type CompactSessionMsg struct{}
type SendMsg struct {
	Text        string
	Attachments []Attachment
}
type CompletionDialogTriggeredMsg struct {
	InitialValue string
}
type OptimisticMessageAddedMsg struct {
	Message opencode.Message
}

func New(
	ctx context.Context,
	version string,
	appInfo opencode.App,
	httpClient *opencode.Client,
) (*App, error) {
	RootPath = appInfo.Path.Root
	CwdPath = appInfo.Path.Cwd

	configInfo, err := httpClient.Config.Get(ctx)
	if err != nil {
		return nil, err
	}

	if configInfo.Keybinds.Leader == "" {
		configInfo.Keybinds.Leader = "ctrl+x"
	}

	appStatePath := filepath.Join(appInfo.Path.State, "tui")
	appState, err := config.LoadState(appStatePath)
	if err != nil {
		appState = config.NewState()
		config.SaveState(appStatePath, appState)
	}

	if configInfo.Theme != "" {
		appState.Theme = configInfo.Theme
	}

	if configInfo.Model != "" {
		splits := strings.Split(configInfo.Model, "/")
		appState.Provider = splits[0]
		appState.Model = strings.Join(splits[1:], "/")
	}

	if err := theme.LoadThemesFromDirectories(
		appInfo.Path.Config,
		appInfo.Path.Root,
		appInfo.Path.Cwd,
	); err != nil {
		slog.Warn("Failed to load themes from directories", "error", err)
	}

	if appState.Theme != "" {
		if appState.Theme == "system" && styles.Terminal != nil {
			theme.UpdateSystemTheme(
				styles.Terminal.Background,
				styles.Terminal.BackgroundIsDark,
			)
		}
		theme.SetTheme(appState.Theme)
	}

	slog.Debug("Loaded config", "config", configInfo)

	app := &App{
		Info:      appInfo,
		Version:   version,
		StatePath: appStatePath,
		Config:    configInfo,
		State:     appState,
		Client:    httpClient,
		Session:   &opencode.Session{},
		Messages:  []opencode.Message{},
		Commands:  commands.LoadFromConfig(configInfo),
	}

	// Create example command file if commands directory doesn't exist
	app.ensureCommandsDirectory()

	return app, nil
}

func (a *App) InitializeProvider() tea.Cmd {
	return func() tea.Msg {
		providersResponse, err := a.Client.Config.Providers(context.Background())
		if err != nil {
			slog.Error("Failed to list providers", "error", err)
			// TODO: notify user
			return nil
		}
		providers := providersResponse.Providers
		var defaultProvider *opencode.Provider
		var defaultModel *opencode.Model

		var anthropic *opencode.Provider
		for _, provider := range providers {
			if provider.ID == "anthropic" {
				anthropic = &provider
			}
		}

		// default to anthropic if available
		if anthropic != nil {
			defaultProvider = anthropic
			defaultModel = getDefaultModel(providersResponse, *anthropic)
		}

		for _, provider := range providers {
			if defaultProvider == nil || defaultModel == nil {
				defaultProvider = &provider
				defaultModel = getDefaultModel(providersResponse, provider)
			}
			providers = append(providers, provider)
		}
		if len(providers) == 0 {
			slog.Error("No providers configured")
			return nil
		}

		var currentProvider *opencode.Provider
		var currentModel *opencode.Model
		for _, provider := range providers {
			if provider.ID == a.State.Provider {
				currentProvider = &provider

				for _, model := range provider.Models {
					if model.ID == a.State.Model {
						currentModel = &model
					}
				}
			}
		}
		if currentProvider == nil || currentModel == nil {
			currentProvider = defaultProvider
			currentModel = defaultModel
		}

		return ModelSelectedMsg{
			Provider: *currentProvider,
			Model:    *currentModel,
		}
	}
}

func getDefaultModel(response *opencode.ConfigProvidersResponse, provider opencode.Provider) *opencode.Model {
	if match, ok := response.Default[provider.ID]; ok {
		model := provider.Models[match]
		return &model
	} else {
		for _, model := range provider.Models {
			return &model
		}
	}
	return nil
}

type Attachment struct {
	FilePath string
	FileName string
	MimeType string
	Content  []byte
}

func (a *App) IsBusy() bool {
	if len(a.Messages) == 0 {
		return false
	}

	lastMessage := a.Messages[len(a.Messages)-1]
	return lastMessage.Metadata.Time.Completed == 0
}

func (a *App) SaveState() {
	err := config.SaveState(a.StatePath, a.State)
	if err != nil {
		slog.Error("Failed to save state", "error", err)
	}
}

func (a *App) InitializeProject(ctx context.Context) tea.Cmd {
	cmds := []tea.Cmd{}

	session, err := a.CreateSession(ctx)
	if err != nil {
		// status.Error(err.Error())
		return nil
	}

	a.Session = session
	cmds = append(cmds, util.CmdHandler(SessionSelectedMsg(session)))

	go func() {
		_, err := a.Client.Session.Init(ctx, a.Session.ID, opencode.SessionInitParams{
			ProviderID: opencode.F(a.Provider.ID),
			ModelID:    opencode.F(a.Model.ID),
		})
		if err != nil {
			slog.Error("Failed to initialize project", "error", err)
			// status.Error(err.Error())
		}
	}()

	return tea.Batch(cmds...)
}

func (a *App) CompactSession(ctx context.Context) tea.Cmd {
	go func() {
		_, err := a.Client.Session.Summarize(ctx, a.Session.ID, opencode.SessionSummarizeParams{
			ProviderID: opencode.F(a.Provider.ID),
			ModelID:    opencode.F(a.Model.ID),
		})
		if err != nil {
			slog.Error("Failed to compact session", "error", err)
		}
	}()
	return nil
}

func (a *App) MarkProjectInitialized(ctx context.Context) error {
	_, err := a.Client.App.Init(ctx)
	if err != nil {
		slog.Error("Failed to mark project as initialized", "error", err)
		return err
	}
	return nil
}

func (a *App) CreateSession(ctx context.Context) (*opencode.Session, error) {
	session, err := a.Client.Session.New(ctx)
	if err != nil {
		return nil, err
	}
	return session, nil
}

func (a *App) SendChatMessage(ctx context.Context, text string, attachments []Attachment) tea.Cmd {
	var cmds []tea.Cmd
	if a.Session.ID == "" {
		session, err := a.CreateSession(ctx)
		if err != nil {
			return toast.NewErrorToast(err.Error())
		}
		a.Session = session
		cmds = append(cmds, util.CmdHandler(SessionSelectedMsg(session)))
	}

	optimisticMessage := opencode.Message{
		ID:   fmt.Sprintf("optimistic-%d", time.Now().UnixNano()),
		Role: opencode.MessageRoleUser,
		Parts: []opencode.MessagePart{{
			Type: opencode.MessagePartTypeText,
			Text: text,
		}},
		Metadata: opencode.MessageMetadata{
			SessionID: a.Session.ID,
			Time: opencode.MessageMetadataTime{
				Created: float64(time.Now().Unix()),
			},
		},
	}

	a.Messages = append(a.Messages, optimisticMessage)
	cmds = append(cmds, util.CmdHandler(OptimisticMessageAddedMsg{Message: optimisticMessage}))

	cmds = append(cmds, func() tea.Msg {
		_, err := a.Client.Session.Chat(ctx, a.Session.ID, opencode.SessionChatParams{
			Parts: opencode.F([]opencode.MessagePartUnionParam{
				opencode.TextPartParam{
					Type: opencode.F(opencode.TextPartTypeText),
					Text: opencode.F(text),
				},
			}),
			ProviderID: opencode.F(a.Provider.ID),
			ModelID:    opencode.F(a.Model.ID),
		})
		if err != nil {
			errormsg := fmt.Sprintf("failed to send message: %v", err)
			slog.Error(errormsg)
			return toast.NewErrorToast(errormsg)()
		}
		return nil
	})

	// The actual response will come through SSE
	// For now, just return success
	return tea.Batch(cmds...)
}

func (a *App) Cancel(ctx context.Context, sessionID string) error {
	_, err := a.Client.Session.Abort(ctx, sessionID)
	if err != nil {
		slog.Error("Failed to cancel session", "error", err)
		// status.Error(err.Error())
		return err
	}
	return nil
}

func (a *App) ListSessions(ctx context.Context) ([]opencode.Session, error) {
	response, err := a.Client.Session.List(ctx)
	if err != nil {
		return nil, err
	}
	if response == nil {
		return []opencode.Session{}, nil
	}
	sessions := *response
	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].Time.Created-sessions[j].Time.Created > 0
	})
	return sessions, nil
}

func (a *App) DeleteSession(ctx context.Context, sessionID string) error {
	_, err := a.Client.Session.Delete(ctx, sessionID)
	if err != nil {
		slog.Error("Failed to delete session", "error", err)
		return err
	}
	return nil
}

func (a *App) ListMessages(ctx context.Context, sessionId string) ([]opencode.Message, error) {
	response, err := a.Client.Session.Messages(ctx, sessionId)
	if err != nil {
		return nil, err
	}
	if response == nil {
		return []opencode.Message{}, nil
	}
	messages := *response
	return messages, nil
}

func (a *App) ListProviders(ctx context.Context) ([]opencode.Provider, error) {
	response, err := a.Client.Config.Providers(ctx)
	if err != nil {
		return nil, err
	}
	if response == nil {
		return []opencode.Provider{}, nil
	}

	providers := *response
	return providers.Providers, nil
}

// func (a *App) loadCustomKeybinds() {
//
// }

func (a *App) ensureCommandsDirectory() {
	commandsDir := filepath.Join(a.Info.Path.Config, "commands")

	// Check if commands directory exists
	if _, err := os.Stat(commandsDir); os.IsNotExist(err) {
		// Create the commands directory
		if err := os.MkdirAll(commandsDir, 0755); err != nil {
			slog.Error("Failed to create commands directory", "error", err)
			return
		}

		// Create an example command file
		examplePath := filepath.Join(commandsDir, "example.md")
		exampleContent := `---
description: An example custom command for demonstration
---

# Example Command

This is an example command file. You can create markdown files in the commands directory to define custom commands.

## Command Locations

Commands can be stored in two locations:
1. Global: ~/.config/opencode/commands/ (available in all projects)
2. Project: $PWD/.opencode/commands/ (specific to current project)

Project-level commands take precedence over global commands with the same name.

## Nested Commands

You can organize commands in subdirectories. For example:
- commands/git/commit.md becomes /git:commit
- commands/docker/build.md becomes /docker:build

## Metadata

You can add YAML frontmatter at the top of your markdown files to provide metadata:
- description: A brief description that will appear in command autocompletion

Alternatively, if no frontmatter is provided, the first heading will be used as the description.

## Usage

When you type /example in the chat, this content will be sent to the LLM as context.

## Features

- Use markdown formatting
- Include code examples
- Add instructions for the LLM
- Create reusable prompts

## Example Code

` + "```typescript" + `
function example() {
  console.log("This is an example");
}
` + "```" + `

You can customize this file or create new ones with different names.
`

		if err := os.WriteFile(examplePath, []byte(exampleContent), 0644); err != nil {
			slog.Error("Failed to create example command file", "error", err)
		} else {
			slog.Info("Created example command file at", "path", examplePath)
		}
	}
}
