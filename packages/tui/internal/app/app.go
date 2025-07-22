package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"log/slog"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/internal/clipboard"
	"github.com/sst/opencode/internal/commands"
	"github.com/sst/opencode/internal/components/toast"
	"github.com/sst/opencode/internal/id"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
)

type Message struct {
	Info  opencode.MessageUnion
	Parts []opencode.PartUnion
}

type App struct {
	Info             opencode.App
	Modes            []opencode.Mode
	Providers        []opencode.Provider
	Version          string
	StatePath        string
	Config           *opencode.Config
	Client           *opencode.Client
	State            *State
	ModeIndex        int
	Mode             *opencode.Mode
	Provider         *opencode.Provider
	Model            *opencode.Model
	Session          *opencode.Session
	Messages         []Message
	Commands         commands.CommandRegistry
	InitialModel     *string
	InitialPrompt    *string
	IntitialMode     *string
	compactCancel    context.CancelFunc
	IsLeaderSequence bool
}

type SessionCreatedMsg = struct {
	Session *opencode.Session
}
type SessionSelectedMsg = *opencode.Session
type SessionLoadedMsg struct{}
type ModelSelectedMsg struct {
	Provider opencode.Provider
	Model    opencode.Model
}
type SessionClearedMsg struct{}
type CompactSessionMsg struct{}
type SendPrompt = Prompt
type SetEditorContentMsg struct {
	Text string
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
	appState, err := LoadState(appStatePath)
	if err != nil {
		appState = NewState()
		SaveState(appStatePath, appState)
	}

	if appState.ModeModel == nil {
		appState.ModeModel = make(map[string]ModeModel)
	}

	if configInfo.Theme != "" {
		appState.Theme = configInfo.Theme
	}

	themeEnv := os.Getenv("OPENCODE_THEME")
	if themeEnv != "" {
		appState.Theme = themeEnv
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
		appState.ModeModel[mode.Name] = ModeModel{
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

	app := &App{
		Info:          appInfo,
		Modes:         modes,
		Version:       version,
		StatePath:     appStatePath,
		Config:        configInfo,
		State:         appState,
		Client:        httpClient,
		ModeIndex:     modeIndex,
		Mode:          mode,
		Session:       &opencode.Session{},
		Messages:      []Message{},
		Commands:      commands.LoadFromConfig(configInfo),
		InitialModel:  initialModel,
		InitialPrompt: initialPrompt,
		IntitialMode:  initialMode,
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

func SetClipboard(text string) tea.Cmd {
	var cmds []tea.Cmd
	cmds = append(cmds, func() tea.Msg {
		clipboard.Write(clipboard.FmtText, []byte(text))
		return nil
	})
	// try to set the clipboard using OSC52 for terminals that support it
	cmds = append(cmds, tea.SetClipboard(text))
	return tea.Sequence(cmds...)
}

func (a *App) cycleMode(forward bool) (*App, tea.Cmd) {
	if forward {
		a.ModeIndex++
		if a.ModeIndex >= len(a.Modes) {
			a.ModeIndex = 0
		}
	} else {
		a.ModeIndex--
		if a.ModeIndex < 0 {
			a.ModeIndex = len(a.Modes) - 1
		}
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
	return a, a.SaveState()
}

func (a *App) SwitchMode() (*App, tea.Cmd) {
	return a.cycleMode(true)
}

func (a *App) SwitchModeReverse() (*App, tea.Cmd) {
	return a.cycleMode(false)
}

func (a *App) InitializeProvider() tea.Cmd {
	providersResponse, err := a.Client.App.Providers(context.Background())
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
		cmds = append(cmds, util.CmdHandler(SendPrompt{Text: *a.InitialPrompt}))
	}
	return tea.Sequence(cmds...)
}

func getDefaultModel(
	response *opencode.AppProvidersResponse,
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
	if casted, ok := lastMessage.Info.(opencode.AssistantMessage); ok {
		return casted.Time.Completed == 0
	}
	return true
}

func (a *App) SaveState() tea.Cmd {
	return func() tea.Msg {
		err := SaveState(a.StatePath, a.State)
		if err != nil {
			slog.Error("Failed to save state", "error", err)
		}
		return nil
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
	cmds = append(cmds, util.CmdHandler(SessionCreatedMsg{Session: session}))

	go func() {
		_, err := a.Client.Session.Init(ctx, a.Session.ID, opencode.SessionInitParams{
			MessageID:  opencode.F(id.Ascending(id.Message)),
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

func (a *App) SendPrompt(ctx context.Context, prompt Prompt) (*App, tea.Cmd) {
	var cmds []tea.Cmd
	if a.Session.ID == "" {
		session, err := a.CreateSession(ctx)
		if err != nil {
			return a, toast.NewErrorToast(err.Error())
		}
		a.Session = session
		cmds = append(cmds, util.CmdHandler(SessionCreatedMsg{Session: session}))
	}

	messageID := id.Ascending(id.Message)
	message := prompt.ToMessage(messageID, a.Session.ID)

	a.Messages = append(a.Messages, message)

	cmds = append(cmds, func() tea.Msg {
		_, err := a.Client.Session.Chat(ctx, a.Session.ID, opencode.SessionChatParams{
			ProviderID: opencode.F(a.Provider.ID),
			ModelID:    opencode.F(a.Model.ID),
			Mode:       opencode.F(a.Mode.Name),
			MessageID:  opencode.F(messageID),
			Parts:      opencode.F(message.ToSessionChatParams()),
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

func (a *App) ListMessages(ctx context.Context, sessionId string) ([]Message, error) {
	response, err := a.Client.Session.Messages(ctx, sessionId)
	if err != nil {
		return nil, err
	}
	if response == nil {
		return []Message{}, nil
	}
	messages := []Message{}
	for _, message := range *response {
		msg := Message{
			Info:  message.Info.AsUnion(),
			Parts: []opencode.PartUnion{},
		}
		for _, part := range message.Parts {
			msg.Parts = append(msg.Parts, part.AsUnion())
		}
		messages = append(messages, msg)
	}
	return messages, nil
}

func (a *App) ListProviders(ctx context.Context) ([]opencode.Provider, error) {
	response, err := a.Client.App.Providers(ctx)
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
