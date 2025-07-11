package app

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/internal/clipboard"
	"github.com/sst/opencode/internal/commands"
	"github.com/sst/opencode/internal/components/toast"
	"github.com/sst/opencode/internal/config"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
)

type App struct {
	Info             opencode.App
	Modes            []opencode.Mode
	Providers        []opencode.Provider
	Version          string
	StatePath        string
	Config           *opencode.Config
	Client           *opencode.Client
	CommandsClient   *commands.CommandsClient
	State            *config.State
	ModeIndex        int
	Mode             *opencode.Mode
	Provider         *opencode.Provider
	Model            *opencode.Model
	Session          *opencode.Session
	Messages         []opencode.MessageUnion
	Commands         commands.CommandRegistry
	InitialModel     *string
	InitialPrompt    *string
	IntitialMode     *string
	compactCancel    context.CancelFunc
	IsLeaderSequence bool
}

type (
	SessionSelectedMsg = *opencode.Session
	SessionLoadedMsg   struct{}
	ModelSelectedMsg   struct {
		Provider opencode.Provider
		Model    opencode.Model
	}
)
type (
	SessionClearedMsg struct{}
	CompactSessionMsg struct{}
	SendMsg           struct {
		Text        string
		Attachments []opencode.FilePartParam
	}
)
type SetEditorContentMsg struct {
	Text string
}
type OptimisticMessageAddedMsg struct {
	Message opencode.MessageUnion
}
type FileRenderedMsg struct {
	FilePath string
}

func New(
	ctx context.Context,
	version string,
	appInfo opencode.App,
	modes []opencode.Mode,
	httpClient *opencode.Client,
	initialModel *string,
	initialPrompt *string,
	initialMode *string,
) (*App, error) {
	util.RootPath = appInfo.Path.Root
	util.CwdPath = appInfo.Path.Cwd

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

	if appState.ModeModel == nil {
		appState.ModeModel = make(map[string]config.ModeModel)
	}

	if configInfo.Theme != "" {
		appState.Theme = configInfo.Theme
	}

	var modeIndex int
	var mode *opencode.Mode
	modeName := "build"
	if appState.Mode != "" {
		modeName = appState.Mode
	}
	if initialMode != nil && *initialMode != "" {
		modeName = *initialMode
	}
	for i, m := range modes {
		if m.Name == modeName {
			modeIndex = i
			break
		}
	}
	mode = &modes[modeIndex]

	if mode.Model.ModelID != "" {
		appState.ModeModel[mode.Name] = config.ModeModel{
			ProviderID: mode.Model.ProviderID,
			ModelID:    mode.Model.ModelID,
		}
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

	// Create commands client using the same base URL as the HTTP client
	baseURL := os.Getenv("OPENCODE_SERVER")
	if baseURL == "" {
		baseURL = "http://localhost:4096" // Default fallback
	}

	commandsClient := commands.NewCommandsClient(baseURL)

	app := &App{
		Info:           appInfo,
		Modes:          modes,
		Version:        version,
		StatePath:      appStatePath,
		Config:         configInfo,
		State:          appState,
		Client:         httpClient,
		CommandsClient: commandsClient,
		ModeIndex:      modeIndex,
		Mode:           mode,
		Session:        &opencode.Session{},
		Messages:       []opencode.MessageUnion{},
		Commands:       commands.LoadFromConfig(configInfo),
		InitialModel:   initialModel,
		InitialPrompt:  initialPrompt,
		IntitialMode:   initialMode,
	}

	// Create example command file if commands directory doesn't exist
	app.ensureCommandsDirectory()

	return app, nil
}

func (a *App) Key(commandName commands.CommandName) string {
	t := theme.CurrentTheme()
	base := styles.NewStyle().Background(t.Background()).Foreground(t.Text()).Bold(true).Render
	muted := styles.NewStyle().
		Background(t.Background()).
		Foreground(t.TextMuted()).
		Faint(true).
		Render
	command := a.Commands[commandName]
	kb := command.Keybindings[0]
	key := kb.Key
	if kb.RequiresLeader {
		key = a.Config.Keybinds.Leader + " " + kb.Key
	}
	return base(key) + muted(" "+command.Description)
}

func (a *App) SetClipboard(text string) tea.Cmd {
	var cmds []tea.Cmd
	cmds = append(cmds, func() tea.Msg {
		clipboard.Write(clipboard.FmtText, []byte(text))
		return nil
	})
	// try to set the clipboard using OSC52 for terminals that support it
	cmds = append(cmds, tea.SetClipboard(text))
	return tea.Sequence(cmds...)
}

func (a *App) SwitchMode() (*App, tea.Cmd) {
	a.ModeIndex++
	if a.ModeIndex >= len(a.Modes) {
		a.ModeIndex = 0
	}
	a.Mode = &a.Modes[a.ModeIndex]

	modelID := a.Mode.Model.ModelID
	providerID := a.Mode.Model.ProviderID
	if modelID == "" {
		if model, ok := a.State.ModeModel[a.Mode.Name]; ok {
			modelID = model.ModelID
			providerID = model.ProviderID
		}
	}

	if modelID != "" {
		for _, provider := range a.Providers {
			if provider.ID == providerID {
				a.Provider = &provider
				for _, model := range provider.Models {
					if model.ID == modelID {
						a.Model = &model
						break
					}
				}
				break
			}
		}
	}

	a.State.Mode = a.Mode.Name

	return a, func() tea.Msg {
		a.SaveState()
		return nil
	}
}

func (a *App) InitializeProvider() tea.Cmd {
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

	a.Providers = providers

	// retains backwards compatibility with old state format
	if model, ok := a.State.ModeModel[a.State.Mode]; ok {
		a.State.Provider = model.ProviderID
		a.State.Model = model.ModelID
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

	var initialProvider *opencode.Provider
	var initialModel *opencode.Model
	if a.InitialModel != nil && *a.InitialModel != "" {
		splits := strings.Split(*a.InitialModel, "/")
		for _, provider := range providers {
			if provider.ID == splits[0] {
				initialProvider = &provider
				for _, model := range provider.Models {
					modelID := strings.Join(splits[1:], "/")
					if model.ID == modelID {
						initialModel = &model
					}
				}
			}
		}
	}

	if initialProvider != nil && initialModel != nil {
		currentProvider = initialProvider
		currentModel = initialModel
	}

	var cmds []tea.Cmd
	cmds = append(cmds, util.CmdHandler(ModelSelectedMsg{
		Provider: *currentProvider,
		Model:    *currentModel,
	}))
	if a.InitialPrompt != nil && *a.InitialPrompt != "" {
		cmds = append(cmds, util.CmdHandler(SendMsg{Text: *a.InitialPrompt}))
	}
	return tea.Sequence(cmds...)
}

func getDefaultModel(
	response *opencode.ConfigProvidersResponse,
	provider opencode.Provider,
) *opencode.Model {
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

func (a *App) IsBusy() bool {
	if len(a.Messages) == 0 {
		return false
	}

	lastMessage := a.Messages[len(a.Messages)-1]
	if casted, ok := lastMessage.(opencode.AssistantMessage); ok {
		return casted.Time.Completed == 0
	}
	return false
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
	if a.compactCancel != nil {
		a.compactCancel()
	}

	compactCtx, cancel := context.WithCancel(ctx)
	a.compactCancel = cancel

	go func() {
		defer func() {
			a.compactCancel = nil
		}()

		_, err := a.Client.Session.Summarize(
			compactCtx,
			a.Session.ID,
			opencode.SessionSummarizeParams{
				ProviderID: opencode.F(a.Provider.ID),
				ModelID:    opencode.F(a.Model.ID),
			},
		)
		if err != nil {
			if compactCtx.Err() != context.Canceled {
				slog.Error("Failed to compact session", "error", err)
			}
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

func (a *App) SendChatMessage(
	ctx context.Context,
	text string,
	attachments []opencode.FilePartParam,
) (*App, tea.Cmd) {
	var cmds []tea.Cmd
	if a.Session.ID == "" {
		session, err := a.CreateSession(ctx)
		if err != nil {
			return a, toast.NewErrorToast(err.Error())
		}
		a.Session = session
		cmds = append(cmds, util.CmdHandler(SessionSelectedMsg(session)))
	}

	optimisticParts := []opencode.UserMessagePart{{
		Type: opencode.UserMessagePartTypeText,
		Text: text,
	}}
	if len(attachments) > 0 {
		for _, attachment := range attachments {
			optimisticParts = append(optimisticParts, opencode.UserMessagePart{
				Type:     opencode.UserMessagePartTypeFile,
				Filename: attachment.Filename.Value,
				Mime:     attachment.Mime.Value,
				URL:      attachment.URL.Value,
			})
		}
	}

	optimisticMessage := opencode.UserMessage{
		ID:        fmt.Sprintf("optimistic-%d", time.Now().UnixNano()),
		Role:      opencode.UserMessageRoleUser,
		Parts:     optimisticParts,
		SessionID: a.Session.ID,
		Time: opencode.UserMessageTime{
			Created: float64(time.Now().Unix()),
		},
	}

	a.Messages = append(a.Messages, optimisticMessage)
	cmds = append(cmds, util.CmdHandler(OptimisticMessageAddedMsg{Message: optimisticMessage}))

	cmds = append(cmds, func() tea.Msg {
		parts := []opencode.UserMessagePartUnionParam{
			opencode.TextPartParam{
				Type: opencode.F(opencode.TextPartTypeText),
				Text: opencode.F(text),
			},
		}
		if len(attachments) > 0 {
			for _, attachment := range attachments {
				parts = append(parts, opencode.FilePartParam{
					Mime:     attachment.Mime,
					Type:     attachment.Type,
					URL:      attachment.URL,
					Filename: attachment.Filename,
				})
			}
		}

		_, err := a.Client.Session.Chat(ctx, a.Session.ID, opencode.SessionChatParams{
			Parts:      opencode.F(parts),
			ProviderID: opencode.F(a.Provider.ID),
			ModelID:    opencode.F(a.Model.ID),
			Mode:       opencode.F(a.Mode.Name),
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
	return a, tea.Batch(cmds...)
}

func (a *App) Cancel(ctx context.Context, sessionID string) error {
	// Cancel any running compact operation
	if a.compactCancel != nil {
		a.compactCancel()
		a.compactCancel = nil
	}

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

User request: $ARGUMENTS

Please help the user with their request above. If no specific request was provided, give general guidance about this example command.

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

## Arguments

You can pass arguments to commands using the $ARGUMENTS placeholder:

Example usage:
- /example hello world
- /example "some text with spaces"

The $ARGUMENTS placeholder will be replaced with everything after the command name.

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
