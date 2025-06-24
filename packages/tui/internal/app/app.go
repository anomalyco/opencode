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
	"github.com/sst/opencode/internal/commands"
	"github.com/sst/opencode/internal/components/toast"
	"github.com/sst/opencode/internal/config"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
	"github.com/sst/opencode/pkg/client"
)

var RootPath string

type App struct {
	Info      client.AppInfo
	Version   string
	StatePath string
	Config    *client.ConfigInfo
	Client    *client.ClientWithResponses
	State     *config.State
	Provider  *client.ProviderInfo
	Model     *client.ModelInfo
	Session   *client.SessionInfo
	Messages  []client.MessageInfo
	Commands  commands.CommandRegistry
}

type SessionSelectedMsg = *client.SessionInfo
type ModelSelectedMsg struct {
	Provider client.ProviderInfo
	Model    client.ModelInfo
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
	Message client.MessageInfo
}

func New(
	ctx context.Context,
	version string,
	appInfo client.AppInfo,
	httpClient *client.ClientWithResponses,
) (*App, error) {
	RootPath = appInfo.Path.Root

	configResponse, err := httpClient.PostConfigGetWithResponse(ctx)
	if err != nil {
		return nil, err
	}
	if configResponse.StatusCode() != 200 || configResponse.JSON200 == nil {
		return nil, fmt.Errorf("failed to get config: %d", configResponse.StatusCode())
	}
	configInfo := configResponse.JSON200
	if configInfo.Keybinds == nil {
		leader := "ctrl+x"
		keybinds := client.ConfigKeybinds{
			Leader: &leader,
		}
		configInfo.Keybinds = &keybinds
	}

	appStatePath := filepath.Join(appInfo.Path.State, "tui")
	appState, err := config.LoadState(appStatePath)
	if err != nil {
		appState = config.NewState()
		config.SaveState(appStatePath, appState)
	}

	if configInfo.Theme != nil {
		appState.Theme = *configInfo.Theme
	}
	if configInfo.Model != nil {
		splits := strings.Split(*configInfo.Model, "/")
		appState.Provider = splits[0]
		appState.Model = strings.Join(splits[1:], "/")
	}

	// Load themes from all directories
	if err := theme.LoadThemesFromDirectories(
		appInfo.Path.Config,
		appInfo.Path.Root,
		appInfo.Path.Cwd,
	); err != nil {
		slog.Warn("Failed to load themes from directories", "error", err)
	}

	if appState.Theme != "" {
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
		Session:   &client.SessionInfo{},
		Messages:  []client.MessageInfo{},
		Commands:  commands.LoadFromConfig(configInfo),
	}

	return app, nil
}

func (a *App) InitializeProvider() tea.Cmd {
	return func() tea.Msg {
		providersResponse, err := a.Client.PostProviderListWithResponse(context.Background())
		if err != nil {
			slog.Error("Failed to list providers", "error", err)
			// TODO: notify user
			return nil
		}
		if providersResponse != nil && providersResponse.StatusCode() != 200 {
			slog.Error("failed to retrieve providers", "status", providersResponse.StatusCode(), "message", string(providersResponse.Body))
			return nil
		}
		providers := []client.ProviderInfo{}
		var defaultProvider *client.ProviderInfo
		var defaultModel *client.ModelInfo

		var anthropic *client.ProviderInfo
		for _, provider := range providersResponse.JSON200.Providers {
			if provider.Id == "anthropic" {
				anthropic = &provider
			}
		}

		// default to anthropic if available
		if anthropic != nil {
			defaultProvider = anthropic
			defaultModel = getDefaultModel(providersResponse, *anthropic)
		}

		for _, provider := range providersResponse.JSON200.Providers {
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

		var currentProvider *client.ProviderInfo
		var currentModel *client.ModelInfo
		for _, provider := range providers {
			if provider.Id == a.State.Provider {
				currentProvider = &provider

				for _, model := range provider.Models {
					if model.Id == a.State.Model {
						currentModel = &model
					}
				}
			}
		}
		if currentProvider == nil || currentModel == nil {
			currentProvider = defaultProvider
			currentModel = defaultModel
		}

		// TODO: handle no provider or model setup, yet
		return ModelSelectedMsg{
			Provider: *currentProvider,
			Model:    *currentModel,
		}
	}
}

func getDefaultModel(response *client.PostProviderListResponse, provider client.ProviderInfo) *client.ModelInfo {
	if match, ok := response.JSON200.Default[provider.Id]; ok {
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
	return lastMessage.Metadata.Time.Completed == nil
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
		response, err := a.Client.PostSessionInitialize(ctx, client.PostSessionInitializeJSONRequestBody{
			SessionID:  a.Session.Id,
			ProviderID: a.Provider.Id,
			ModelID:    a.Model.Id,
		})
		if err != nil {
			slog.Error("Failed to initialize project", "error", err)
			// status.Error(err.Error())
		}
		if response != nil && response.StatusCode != 200 {
			slog.Error("Failed to initialize project", "error", response.StatusCode)
			// status.Error(fmt.Sprintf("failed to initialize project: %d", response.StatusCode))
		}
	}()

	return tea.Batch(cmds...)
}

func (a *App) CompactSession(ctx context.Context) tea.Cmd {
	go func() {
		response, err := a.Client.PostSessionSummarizeWithResponse(ctx, client.PostSessionSummarizeJSONRequestBody{
			SessionID:  a.Session.Id,
			ProviderID: a.Provider.Id,
			ModelID:    a.Model.Id,
		})
		if err != nil {
			slog.Error("Failed to compact session", "error", err)
		}
		if response != nil && response.StatusCode() != 200 {
			slog.Error("Failed to compact session", "error", response.StatusCode)
		}
	}()
	return nil
}

func (a *App) MarkProjectInitialized(ctx context.Context) error {
	response, err := a.Client.PostAppInitialize(ctx)
	if err != nil {
		slog.Error("Failed to mark project as initialized", "error", err)
		return err
	}
	if response != nil && response.StatusCode != 200 {
		return fmt.Errorf("failed to initialize project: %d", response.StatusCode)
	}
	return nil
}

func (a *App) CreateSession(ctx context.Context) (*client.SessionInfo, error) {
	resp, err := a.Client.PostSessionCreateWithResponse(ctx)
	if err != nil {
		return nil, err
	}
	if resp != nil && resp.StatusCode() != 200 {
		return nil, fmt.Errorf("failed to create session: %d", resp.StatusCode())
	}
	session := resp.JSON200
	return session, nil
}

func (a *App) SendChatMessage(ctx context.Context, text string, attachments []Attachment) tea.Cmd {
	var cmds []tea.Cmd
	if a.Session.Id == "" {
		session, err := a.CreateSession(ctx)
		if err != nil {
			return toast.NewErrorToast(err.Error())
		}
		a.Session = session
		cmds = append(cmds, util.CmdHandler(SessionSelectedMsg(session)))
	}

	part := client.MessagePart{}
	part.FromMessagePartText(client.MessagePartText{
		Type: "text",
		Text: text,
	})
	parts := []client.MessagePart{part}

	optimisticMessage := client.MessageInfo{
		Id:    fmt.Sprintf("optimistic-%d", time.Now().UnixNano()),
		Role:  client.User,
		Parts: parts,
		Metadata: client.MessageMetadata{
			SessionID: a.Session.Id,
			Time: struct {
				Completed *float32 `json:"completed,omitempty"`
				Created   float32  `json:"created"`
			}{
				Created: float32(time.Now().Unix()),
			},
			Tool: make(map[string]client.MessageMetadata_Tool_AdditionalProperties),
		},
	}

	a.Messages = append(a.Messages, optimisticMessage)
	cmds = append(cmds, util.CmdHandler(OptimisticMessageAddedMsg{Message: optimisticMessage}))

	cmds = append(cmds, func() tea.Msg {
		response, err := a.Client.PostSessionChat(ctx, client.PostSessionChatJSONRequestBody{
			SessionID:  a.Session.Id,
			Parts:      parts,
			ProviderID: a.Provider.Id,
			ModelID:    a.Model.Id,
		})
		if err != nil {
			errormsg := fmt.Sprintf("failed to send message: %v", err)
			slog.Error(errormsg)
			return toast.NewErrorToast(errormsg)()
		}
		if response != nil && response.StatusCode != 200 {
			errormsg := fmt.Sprintf("failed to send message: %d", response.StatusCode)
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
	response, err := a.Client.PostSessionAbort(ctx, client.PostSessionAbortJSONRequestBody{
		SessionID: sessionID,
	})
	if err != nil {
		slog.Error("Failed to cancel session", "error", err)
		// status.Error(err.Error())
		return err
	}
	if response != nil && response.StatusCode != 200 {
		slog.Error("Failed to cancel session", "error", fmt.Sprintf("failed to cancel session: %d", response.StatusCode))
		// status.Error(fmt.Sprintf("failed to cancel session: %d", response.StatusCode))
		return fmt.Errorf("failed to cancel session: %d", response.StatusCode)
	}
	return nil
}

func (a *App) ListSessions(ctx context.Context) ([]client.SessionInfo, error) {
	resp, err := a.Client.PostSessionListWithResponse(ctx)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode() != 200 {
		return nil, fmt.Errorf("failed to list sessions: %d", resp.StatusCode())
	}
	if resp.JSON200 == nil {
		return []client.SessionInfo{}, nil
	}
	sessions := *resp.JSON200

	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].Time.Created-sessions[j].Time.Created > 0
	})

	return sessions, nil
}

func (a *App) DeleteSession(ctx context.Context, sessionID string) error {
	resp, err := a.Client.PostSessionDeleteWithResponse(ctx, client.PostSessionDeleteJSONRequestBody{
		SessionID: sessionID,
	})
	if err != nil {
		return err
	}
	if resp.StatusCode() != 200 {
		return fmt.Errorf("failed to delete session: %d", resp.StatusCode())
	}
	return nil
}

func (a *App) ListMessages(ctx context.Context, sessionId string) ([]client.MessageInfo, error) {
	resp, err := a.Client.PostSessionMessagesWithResponse(ctx, client.PostSessionMessagesJSONRequestBody{SessionID: sessionId})
	if err != nil {
		return nil, err
	}
	if resp.StatusCode() != 200 {
		return nil, fmt.Errorf("failed to list messages: %d", resp.StatusCode())
	}
	if resp.JSON200 == nil {
		return []client.MessageInfo{}, nil
	}
	messages := *resp.JSON200
	return messages, nil
}

func (a *App) ListProviders(ctx context.Context) ([]client.ProviderInfo, error) {
	resp, err := a.Client.PostProviderListWithResponse(ctx)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode() != 200 {
		return nil, fmt.Errorf("failed to list sessions: %d", resp.StatusCode())
	}
	if resp.JSON200 == nil {
		return []client.ProviderInfo{}, nil
	}

	providers := *resp.JSON200
	return providers.Providers, nil
}

// func (a *App) loadCustomKeybinds() {
//
// }
