package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

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
	Project           opencode.Project
	Agents            []opencode.Agent
	Providers         []opencode.Provider
	Version           string
	StatePath         string
	Config            *opencode.Config
	Client            *opencode.Client
	State             *State
	AgentIndex        int
	Provider          *opencode.Provider
	Model             *opencode.Model
	Session           *opencode.Session
	Messages          []Message
	Permissions       []opencode.Permission
	CurrentPermission opencode.Permission
	Commands          commands.CommandRegistry
	InitialModel      *string
	InitialPrompt     *string
	InitialAgent      *string
	InitialSession    *string
	compactCancel     context.CancelFunc
	IsLeaderSequence  bool
	IsBashMode        bool
	ScrollSpeed       int
}

func (a *App) Agent() *opencode.Agent {
	return &a.Agents[a.AgentIndex]
}

type SessionCreatedMsg = struct {
	Session *opencode.Session
}
type SessionSelectedMsg = *opencode.Session
type MessageRevertedMsg struct {
	Session opencode.Session
	Message Message
}
type SessionUnrevertedMsg struct {
	Session opencode.Session
}
type SessionLoadedMsg struct{}
type ModelSelectedMsg struct {
	Provider opencode.Provider
	Model    opencode.Model
}

type AgentSelectedMsg struct {
	AgentName string
}

type SessionClearedMsg struct{}
type CompactSessionMsg struct{}
type SendPrompt = Prompt
type SendShell = struct {
	Command string
}
type SendCommand = struct {
	Command string
	Args    string
}
type SetEditorContentMsg struct {
	Text string
}
type FileRenderedMsg struct {
	FilePath string
}
type PermissionRespondedToMsg struct {
	Response opencode.SessionPermissionRespondParamsResponse
}

func New(
	ctx context.Context,
	version string,
	project *opencode.Project,
	path *opencode.Path,
	agents []opencode.Agent,
	httpClient *opencode.Client,
	initialModel *string,
	initialPrompt *string,
	initialAgent *string,
	initialSession *string,
) (*App, error) {
	util.RootPath = project.Worktree
	util.CwdPath, _ = os.Getwd()

	configInfo, err := httpClient.Config.Get(ctx, opencode.ConfigGetParams{})
	if err != nil {
		return nil, err
	}

	if configInfo.Keybinds.Leader == "" {
		configInfo.Keybinds.Leader = "ctrl+x"
	}

	appStatePath := filepath.Join(path.State, "tui")
	appState, err := LoadState(appStatePath)
	if err != nil {
		appState = NewState()
		SaveState(appStatePath, appState)
	}

	if appState.AgentModel == nil {
		appState.AgentModel = make(map[string]AgentModel)
	}

	if configInfo.Theme != "" {
		appState.Theme = configInfo.Theme
	}

	themeEnv := os.Getenv("OPENCODE_THEME")
	if themeEnv != "" {
		appState.Theme = themeEnv
	}

	agentIndex := slices.IndexFunc(agents, func(a opencode.Agent) bool {
		return a.Mode != "subagent"
	})
	var agent *opencode.Agent
	modeName := "build"
	if appState.Agent != "" {
		modeName = appState.Agent
	}
	if initialAgent != nil && *initialAgent != "" {
		modeName = *initialAgent
	}
	for i, m := range agents {
		if m.Name == modeName {
			agentIndex = i
			break
		}
	}
	agent = &agents[agentIndex]

	if agent.Model.ModelID != "" {
		appState.AgentModel[agent.Name] = AgentModel{
			ProviderID: agent.Model.ProviderID,
			ModelID:    agent.Model.ModelID,
		}
	}

	if err := theme.LoadThemesFromDirectories(
		path.Config,
		util.RootPath,
		util.CwdPath,
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

	customCommands, err := httpClient.Command.List(ctx, opencode.CommandListParams{})
	if err != nil {
		return nil, err
	}

	app := &App{
		Project:        *project,
		Agents:         agents,
		Version:        version,
		StatePath:      appStatePath,
		Config:         configInfo,
		State:          appState,
		Client:         httpClient,
		AgentIndex:     agentIndex,
		Session:        &opencode.Session{},
		Messages:       []Message{},
		Commands:       commands.LoadFromConfig(configInfo, *customCommands),
		InitialModel:   initialModel,
		InitialPrompt:  initialPrompt,
		InitialAgent:   initialAgent,
		InitialSession: initialSession,
		ScrollSpeed:    int(configInfo.Tui.ScrollSpeed),
	}

	return app, nil
}

func (a *App) Keybind(commandName commands.CommandName) string {
	command := a.Commands[commandName]
	if len(command.Keybindings) == 0 {
		return ""
	}
	kb := command.Keybindings[0]
	key := kb.Key
	if kb.RequiresLeader {
		key = a.Config.Keybinds.Leader + " " + kb.Key
	}
	return key
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
	key := a.Keybind(commandName)
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

func (a *App) updateModelForNewAgent() {
	singleModelEnv := os.Getenv("OPENCODE_AGENTS_SWITCH_SINGLE_MODEL")
	isSingleModel := singleModelEnv == "1" || singleModelEnv == "true"

	if isSingleModel {
		return
	}
	// Set up model for the new agent
	modelID := a.Agent().Model.ModelID
	providerID := a.Agent().Model.ProviderID
	if modelID == "" {
		if model, ok := a.State.AgentModel[a.Agent().Name]; ok {
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
}

func (a *App) cycleMode(forward bool) (*App, tea.Cmd) {
	if forward {
		a.AgentIndex++
		if a.AgentIndex >= len(a.Agents) {
			a.AgentIndex = 0
		}
	} else {
		a.AgentIndex--
		if a.AgentIndex < 0 {
			a.AgentIndex = len(a.Agents) - 1
		}
	}
	if a.Agent().Mode == "subagent" {
		return a.cycleMode(forward)
	}

	a.updateModelForNewAgent()

	a.State.Agent = a.Agent().Name
	a.State.UpdateAgentUsage(a.Agent().Name)
	return a, a.SaveState()
}

func (a *App) SwitchAgent() (*App, tea.Cmd) {
	return a.cycleMode(true)
}

func (a *App) SwitchAgentReverse() (*App, tea.Cmd) {
	return a.cycleMode(false)
}

func (a *App) cycleRecentModel(forward bool) (*App, tea.Cmd) {
	recentModels := a.State.RecentlyUsedModels
	if len(recentModels) > 5 {
		recentModels = recentModels[:5]
	}
	if len(recentModels) < 2 {
		return a, toast.NewInfoToast("Need at least 2 recent models to cycle")
	}
	nextIndex := 0
	prevIndex := 0
	for i, recentModel := range recentModels {
		if a.Provider != nil && a.Model != nil && recentModel.ProviderID == a.Provider.ID &&
			recentModel.ModelID == a.Model.ID {
			nextIndex = (i + 1) % len(recentModels)
			prevIndex = (i - 1 + len(recentModels)) % len(recentModels)
			break
		}
	}
	targetIndex := nextIndex
	if !forward {
		targetIndex = prevIndex
	}
	for range recentModels {
		currentRecentModel := recentModels[targetIndex%len(recentModels)]
		provider, model := findModelByProviderAndModelID(
			a.Providers,
			currentRecentModel.ProviderID,
			currentRecentModel.ModelID,
		)
		if provider != nil && model != nil {
			a.Provider, a.Model = provider, model
			a.State.AgentModel[a.Agent().Name] = AgentModel{
				ProviderID: provider.ID,
				ModelID:    model.ID,
			}
			return a, tea.Sequence(
				a.SaveState(),
				toast.NewSuccessToast(
					fmt.Sprintf("Switched to %s (%s)", model.Name, provider.Name),
				),
			)
		}
		recentModels = append(
			recentModels[:targetIndex%len(recentModels)],
			recentModels[targetIndex%len(recentModels)+1:]...)
		if len(recentModels) < 2 {
			a.State.RecentlyUsedModels = recentModels
			return a, tea.Sequence(
				a.SaveState(),
				toast.NewInfoToast("Not enough valid recent models to cycle"),
			)
		}
	}
	a.State.RecentlyUsedModels = recentModels
	return a, toast.NewErrorToast("Recent model not found")
}

func (a *App) CycleRecentModel() (*App, tea.Cmd) {
	return a.cycleRecentModel(true)
}

func (a *App) CycleRecentModelReverse() (*App, tea.Cmd) {
	return a.cycleRecentModel(false)
}

func (a *App) SwitchToAgent(agentName string) (*App, tea.Cmd) {
	// Find the agent index by name
	for i, agent := range a.Agents {
		if agent.Name == agentName {
			a.AgentIndex = i
			break
		}
	}

	a.updateModelForNewAgent()

	a.State.Agent = a.Agent().Name
	a.State.UpdateAgentUsage(agentName)
	return a, a.SaveState()
}

// findModelByFullID finds a model by its full ID in the format "provider/model"
func findModelByFullID(
	providers []opencode.Provider,
	fullModelID string,
) (*opencode.Provider, *opencode.Model) {
	modelParts := strings.SplitN(fullModelID, "/", 2)
	if len(modelParts) < 2 {
		return nil, nil
	}

	providerID := modelParts[0]
	modelID := modelParts[1]

	return findModelByProviderAndModelID(providers, providerID, modelID)
}

// findModelByProviderAndModelID finds a model by provider ID and model ID
func findModelByProviderAndModelID(
	providers []opencode.Provider,
	providerID, modelID string,
) (*opencode.Provider, *opencode.Model) {
	for _, provider := range providers {
		if provider.ID != providerID {
			continue
		}

		for _, model := range provider.Models {
			if model.ID == modelID {
				return &provider, &model
			}
		}

		// Provider found but model not found
		return nil, nil
	}

	// Provider not found
	return nil, nil
}

// findProviderByID finds a provider by its ID
func findProviderByID(providers []opencode.Provider, providerID string) *opencode.Provider {
	for _, provider := range providers {
		if provider.ID == providerID {
			return &provider
		}
	}
	return nil
}

func (a *App) InitializeProvider() tea.Cmd {
	providersResponse, err := a.Client.App.Providers(context.Background(), opencode.AppProvidersParams{})
	if err != nil {
		slog.Error("Failed to list providers", "error", err)
		// TODO: notify user
		return nil
	}
	providers := providersResponse.Providers
	if len(providers) == 0 {
		slog.Error("No providers configured")
		return nil
	}

	a.Providers = providers

	// retains backwards compatibility with old state format
	if model, ok := a.State.AgentModel[a.State.Agent]; ok {
		a.State.Provider = model.ProviderID
		a.State.Model = model.ModelID
	}

	var selectedProvider *opencode.Provider
	var selectedModel *opencode.Model

	// Priority 1: Command line --model flag (InitialModel)
	if a.InitialModel != nil && *a.InitialModel != "" {
		if provider, model := findModelByFullID(providers, *a.InitialModel); provider != nil &&
			model != nil {
			selectedProvider = provider
			selectedModel = model
			slog.Debug(
				"Selected model from command line",
				"provider",
				provider.ID,
				"model",
				model.ID,
			)
		} else {
			slog.Debug("Command line model not found", "model", *a.InitialModel)
		}
	}

	// Priority 2: Config file model setting
	if selectedProvider == nil && a.Config.Model != "" {
		if provider, model := findModelByFullID(providers, a.Config.Model); provider != nil &&
			model != nil {
			selectedProvider = provider
			selectedModel = model
			slog.Debug("Selected model from config", "provider", provider.ID, "model", model.ID)
		} else {
			slog.Debug("Config model not found", "model", a.Config.Model)
		}
	}

	// Priority 3: Current agent's preferred model
	if selectedProvider == nil && a.Agent().Model.ModelID != "" {
		if provider, model := findModelByProviderAndModelID(providers, a.Agent().Model.ProviderID, a.Agent().Model.ModelID); provider != nil &&
			model != nil {
			selectedProvider = provider
			selectedModel = model
			slog.Debug(
				"Selected model from current agent",
				"provider",
				provider.ID,
				"model",
				model.ID,
				"agent",
				a.Agent().Name,
			)
		} else {
			slog.Debug("Agent model not found", "provider", a.Agent().Model.ProviderID, "model", a.Agent().Model.ModelID, "agent", a.Agent().Name)
		}
	}

	// Priority 4: Recent model usage (most recently used model)
	if selectedProvider == nil && len(a.State.RecentlyUsedModels) > 0 {
		recentUsage := a.State.RecentlyUsedModels[0] // Most recent is first
		if provider, model := findModelByProviderAndModelID(providers, recentUsage.ProviderID, recentUsage.ModelID); provider != nil &&
			model != nil {
			selectedProvider = provider
			selectedModel = model
			slog.Debug(
				"Selected model from recent usage",
				"provider",
				provider.ID,
				"model",
				model.ID,
			)
		} else {
			slog.Debug("Recent model not found", "provider", recentUsage.ProviderID, "model", recentUsage.ModelID)
		}
	}

	// Priority 5: State-based model (backwards compatibility)
	if selectedProvider == nil && a.State.Provider != "" && a.State.Model != "" {
		if provider, model := findModelByProviderAndModelID(providers, a.State.Provider, a.State.Model); provider != nil &&
			model != nil {
			selectedProvider = provider
			selectedModel = model
			slog.Debug("Selected model from state", "provider", provider.ID, "model", model.ID)
		} else {
			slog.Debug("State model not found", "provider", a.State.Provider, "model", a.State.Model)
		}
	}

	// Priority 6: Internal priority fallback (Anthropic preferred, then first available)
	if selectedProvider == nil {
		// Try Anthropic first as internal priority
		if provider := findProviderByID(providers, "anthropic"); provider != nil {
			if model := getDefaultModel(providersResponse, *provider); model != nil {
				selectedProvider = provider
				selectedModel = model
				slog.Debug(
					"Selected model from internal priority (Anthropic)",
					"provider",
					provider.ID,
					"model",
					model.ID,
				)
			}
		}

		// If Anthropic not available, use first available provider
		if selectedProvider == nil && len(providers) > 0 {
			provider := &providers[0]
			if model := getDefaultModel(providersResponse, *provider); model != nil {
				selectedProvider = provider
				selectedModel = model
				slog.Debug(
					"Selected model from fallback (first available)",
					"provider",
					provider.ID,
					"model",
					model.ID,
				)
			}
		}
	}

	// Final safety check
	if selectedProvider == nil || selectedModel == nil {
		slog.Error("Failed to select any model")
		return nil
	}

	var cmds []tea.Cmd
	cmds = append(cmds, util.CmdHandler(ModelSelectedMsg{
		Provider: *selectedProvider,
		Model:    *selectedModel,
	}))

	// Load initial session if provided
	if a.InitialSession != nil && *a.InitialSession != "" {
		cmds = append(cmds, func() tea.Msg {
			// Find the session by ID
			sessions, err := a.ListSessions(context.Background())
			if err != nil {
				slog.Error("Failed to list sessions for initial session", "error", err)
				return toast.NewErrorToast("Failed to load initial session")()
			}

			for _, session := range sessions {
				if session.ID == *a.InitialSession {
					return SessionSelectedMsg(&session)
				}
			}

			slog.Warn("Initial session not found", "sessionID", *a.InitialSession)
			return toast.NewErrorToast("Session not found: " + *a.InitialSession)()
		})
	}

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
	if a.IsCompacting() {
		return true
	}
	lastMessage := a.Messages[len(a.Messages)-1]
	if casted, ok := lastMessage.Info.(opencode.AssistantMessage); ok {
		return casted.Time.Completed == 0
	}
	return false
}

func (a *App) IsCompacting() bool {
	if time.Since(time.UnixMilli(int64(a.Session.Time.Compacting))) < time.Second*30 {
		return true
	}
	return false
}

func (a *App) HasAnimatingWork() bool {
	for _, msg := range a.Messages {
		switch casted := msg.Info.(type) {
		case opencode.AssistantMessage:
			if casted.Time.Completed == 0 {
				return true
			}
		}
		for _, p := range msg.Parts {
			if tp, ok := p.(opencode.ToolPart); ok {
				if tp.State.Status == opencode.ToolPartStateStatusPending {
					return true
				}
			}
		}
	}
	return false
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
	return nil
	/*
		_, err := a.Client.App.Init(ctx)
		if err != nil {
			slog.Error("Failed to mark project as initialized", "error", err)
			return err
		}
		return nil
	*/
}

func (a *App) CreateSession(ctx context.Context) (*opencode.Session, error) {
	session, err := a.Client.Session.New(ctx, opencode.SessionNewParams{})
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
		_, err := a.Client.Session.Prompt(ctx, a.Session.ID, opencode.SessionPromptParams{
			Model: opencode.F(opencode.SessionPromptParamsModel{
				ProviderID: opencode.F(a.Provider.ID),
				ModelID:    opencode.F(a.Model.ID),
			}),
			Agent:     opencode.F(a.Agent().Name),
			MessageID: opencode.F(messageID),
			Parts:     opencode.F(message.ToSessionChatParams()),
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

func (a *App) SendCommand(ctx context.Context, command string, args string) (*App, tea.Cmd) {
	var cmds []tea.Cmd
	if a.Session.ID == "" {
		session, err := a.CreateSession(ctx)
		if err != nil {
			return a, toast.NewErrorToast(err.Error())
		}
		a.Session = session
		cmds = append(cmds, util.CmdHandler(SessionCreatedMsg{Session: session}))
	}

	cmds = append(cmds, func() tea.Msg {
		params := opencode.SessionCommandParams{
			Command:   opencode.F(command),
			Arguments: opencode.F(args),
			Agent:     opencode.F(a.Agents[a.AgentIndex].Name),
		}
		if a.Provider != nil && a.Model != nil {
			params.Model = opencode.F(a.Provider.ID + "/" + a.Model.ID)
		}
		_, err := a.Client.Session.Command(
			context.Background(),
			a.Session.ID,
			params,
		)
		if err != nil {
			slog.Error("Failed to execute command", "error", err)
			return toast.NewErrorToast(fmt.Sprintf("Failed to execute command: %v", err))()
		}
		return nil
	})

	// The actual response will come through SSE
	// For now, just return success
	return a, tea.Batch(cmds...)
}

func (a *App) SendShell(ctx context.Context, command string) (*App, tea.Cmd) {
	var cmds []tea.Cmd
	if a.Session.ID == "" {
		session, err := a.CreateSession(ctx)
		if err != nil {
			return a, toast.NewErrorToast(err.Error())
		}
		a.Session = session
		cmds = append(cmds, util.CmdHandler(SessionCreatedMsg{Session: session}))
	}

	cmds = append(cmds, func() tea.Msg {
		_, err := a.Client.Session.Shell(
			context.Background(),
			a.Session.ID,
			opencode.SessionShellParams{
				Agent:   opencode.F(a.Agent().Name),
				Command: opencode.F(command),
			},
		)
		if err != nil {
			slog.Error("Failed to submit shell command", "error", err)
			return toast.NewErrorToast(fmt.Sprintf("Failed to submit shell command: %v", err))()
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

	_, err := a.Client.Session.Abort(ctx, sessionID, opencode.SessionAbortParams{})
	if err != nil {
		slog.Error("Failed to cancel session", "error", err)
		return err
	}
	return nil
}

func (a *App) ListSessions(ctx context.Context) ([]opencode.Session, error) {
	response, err := a.Client.Session.List(ctx, opencode.SessionListParams{})
	if err != nil {
		return nil, err
	}
	if response == nil {
		return []opencode.Session{}, nil
	}
	sessions := *response
	return sessions, nil
}

func (a *App) DeleteSession(ctx context.Context, sessionID string) error {
	_, err := a.Client.Session.Delete(ctx, sessionID, opencode.SessionDeleteParams{})
	if err != nil {
		slog.Error("Failed to delete session", "error", err)
		return err
	}
	return nil
}

func (a *App) UpdateSession(ctx context.Context, sessionID string, title string) error {
	_, err := a.Client.Session.Update(ctx, sessionID, opencode.SessionUpdateParams{
		Title: opencode.F(title),
	})
	if err != nil {
		slog.Error("Failed to update session", "error", err)
		return err
	}
	return nil
}

func (a *App) ListMessages(ctx context.Context, sessionId string) ([]Message, error) {
	response, err := a.Client.Session.Messages(ctx, sessionId, opencode.SessionMessagesParams{})
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
	response, err := a.Client.App.Providers(ctx, opencode.AppProvidersParams{})
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
