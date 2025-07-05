package app

import (
	"context"
	"fmt"
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
type SessionLoadedMsg struct{}
type ModelSelectedMsg struct {
	Provider opencode.Provider
	Model    opencode.Model
}
type SessionClearedMsg struct{}
type CompactSessionMsg struct{}
type SendMsg struct {
	Text        string
	Attachments []opencode.FilePartParam
}
type OptimisticMessageAddedMsg struct {
	Message opencode.Message
}
type FileRenderedMsg struct {
	FilePath string
}

func New(
	ctx context.Context,
	version string,
	appInfo opencode.App,
	httpClient *opencode.Client,
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

	optimisticParts := []opencode.MessagePart{{
		Type: opencode.MessagePartTypeText,
		Text: text,
	}}
	if len(attachments) > 0 {
		for _, attachment := range attachments {
			optimisticParts = append(optimisticParts, opencode.MessagePart{
				Type:      opencode.MessagePartTypeFile,
				Filename:  attachment.Filename.Value,
				MediaType: attachment.MediaType.Value,
				URL:       attachment.URL.Value,
			})
		}
	}

	optimisticMessage := opencode.Message{
		ID:    fmt.Sprintf("optimistic-%d", time.Now().UnixNano()),
		Role:  opencode.MessageRoleUser,
		Parts: optimisticParts,
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
		parts := []opencode.MessagePartUnionParam{
			opencode.TextPartParam{
				Type: opencode.F(opencode.TextPartTypeText),
				Text: opencode.F(text),
			},
		}
		if len(attachments) > 0 {
			for _, attachment := range attachments {
				parts = append(parts, opencode.FilePartParam{
					MediaType: attachment.MediaType,
					Type:      attachment.Type,
					URL:       attachment.URL,
					Filename:  attachment.Filename,
				})
			}
		}

		_, err := a.Client.Session.Chat(ctx, a.Session.ID, opencode.SessionChatParams{
			Parts:      opencode.F(parts),
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
	return a, tea.Batch(cmds...)
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
