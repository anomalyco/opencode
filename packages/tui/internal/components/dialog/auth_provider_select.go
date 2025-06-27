package dialog

import (
	"context"

	"github.com/charmbracelet/bubbles/v2/key"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/components/list"
	"github.com/sst/opencode/internal/components/modal"
	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/util"
	"github.com/sst/opencode/pkg/client"
)

// AuthProviderSelectDialog shows unauthenticated providers for selection
type AuthProviderSelectDialog interface {
	layout.Modal
}

type authProviderSelectDialog struct {
	app               *app.App
	authProviders     []AuthProviderInfo
	modal             *modal.Modal
	providerList      list.List[list.StringItem]
}

// AuthProviderInfo holds provider information for authentication
type AuthProviderInfo struct {
	Id       string
	Name     string
	AuthType client.PostAuthProviders200AuthType
}

// StartAuthFlowMsg is sent when a provider is selected for authentication
type StartAuthFlowMsg struct {
	Provider AuthProviderInfo
}

type authProviderSelectKeyMap struct {
	Enter  key.Binding
	Escape key.Binding
}

var authProviderSelectKeys = authProviderSelectKeyMap{
	Enter: key.NewBinding(
		key.WithKeys("enter"),
		key.WithHelp("enter", "select provider"),
	),
	Escape: key.NewBinding(
		key.WithKeys("esc"),
		key.WithHelp("esc", "cancel"),
	),
}

func (d *authProviderSelectDialog) Init() tea.Cmd {
	return nil
}

func (d *authProviderSelectDialog) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch {
		case key.Matches(msg, authProviderSelectKeys.Enter):
			_, idx := d.providerList.GetSelectedItem()
			if idx == -1 || idx >= len(d.authProviders) {
				return d, nil
			}
			
			selectedProvider := d.authProviders[idx]
			return d, tea.Sequence(
				util.CmdHandler(modal.CloseModalMsg{}),
				util.CmdHandler(StartAuthFlowMsg{Provider: selectedProvider}),
			)
			
		case key.Matches(msg, authProviderSelectKeys.Escape):
			return d, util.CmdHandler(modal.CloseModalMsg{})
		}
	}

	// Update the list component
	updatedList, cmd := d.providerList.Update(msg)
	d.providerList = updatedList.(list.List[list.StringItem])
	return d, cmd
}

func (d *authProviderSelectDialog) View() string {
	return d.providerList.View()
}

func (d *authProviderSelectDialog) Render(background string) string {
	return d.modal.Render(d.View(), background)
}

func (d *authProviderSelectDialog) Close() tea.Cmd {
	return nil
}

func NewAuthProviderSelectDialog(app *app.App) AuthProviderSelectDialog {
	// Fetch auth providers and filter unauthenticated ones
	authProviderList, _ := app.ListAuthProviders(context.Background())
	
	var unauthProviders []AuthProviderInfo
	var providerNames []string
	
	for _, provider := range authProviderList {
		if !provider.Authenticated {
			unauthProviders = append(unauthProviders, AuthProviderInfo{
				Id:       provider.Id,
				Name:     provider.Name,
				AuthType: provider.AuthType,
			})
			providerNames = append(providerNames, provider.Name)
		}
	}
	
	if len(providerNames) == 0 {
		providerNames = append(providerNames, "All providers are authenticated")
	}
	
	providerList := list.NewStringList(providerNames, 8, "No providers to add", true)
	providerList.SetMaxWidth(40)
	
	return &authProviderSelectDialog{
		app:           app,
		authProviders: unauthProviders,
		providerList:  providerList,
		modal: modal.New(
			modal.WithTitle("Add Provider"),
			modal.WithMaxWidth(44),
		),
	}
}