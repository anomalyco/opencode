package dialog

import (
	"github.com/charmbracelet/bubbles/v2/key"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/components/list"
	"github.com/sst/opencode/internal/components/modal"
	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/util"
)

// AuthMethodSelectDialog shows login method selection for Anthropic
type AuthMethodSelectDialog interface {
	layout.Modal
}

type authMethodSelectDialog struct {
	app          *app.App
	provider     AuthProviderInfo
	modal        *modal.Modal
	methodList   list.List[list.StringItem]
}

// StartOAuthFlowMsg is sent when OAuth is selected for Anthropic
type StartOAuthFlowMsg struct {
	Provider AuthProviderInfo
}

// StartAPIKeyFlowMsg is sent when API key is selected for Anthropic
type StartAPIKeyFlowMsg struct {
	Provider AuthProviderInfo
}

type authMethodKeyMap struct {
	Enter  key.Binding
	Escape key.Binding
}

var authMethodKeys = authMethodKeyMap{
	Enter: key.NewBinding(
		key.WithKeys("enter"),
		key.WithHelp("enter", "select method"),
	),
	Escape: key.NewBinding(
		key.WithKeys("esc"),
		key.WithHelp("esc", "cancel"),
	),
}

func (d *authMethodSelectDialog) Init() tea.Cmd {
	return nil
}

func (d *authMethodSelectDialog) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch {
		case key.Matches(msg, authMethodKeys.Enter):
			_, idx := d.methodList.GetSelectedItem()
			if idx == -1 {
				return d, nil
			}
			
			// 0 = Claude Pro/Max (OAuth), 1 = API Key
			if idx == 0 {
				return d, tea.Sequence(
					util.CmdHandler(modal.CloseModalMsg{}),
					util.CmdHandler(StartOAuthFlowMsg{Provider: d.provider}),
				)
			} else {
				return d, tea.Sequence(
					util.CmdHandler(modal.CloseModalMsg{}),
					util.CmdHandler(StartAPIKeyFlowMsg{Provider: d.provider}),
				)
			}
			
		case key.Matches(msg, authMethodKeys.Escape):
			return d, util.CmdHandler(modal.CloseModalMsg{})
		}
	}

	// Update the list component
	updatedList, cmd := d.methodList.Update(msg)
	d.methodList = updatedList.(list.List[list.StringItem])
	return d, cmd
}

func (d *authMethodSelectDialog) View() string {
	return d.methodList.View()
}

func (d *authMethodSelectDialog) Render(background string) string {
	return d.modal.Render(d.View(), background)
}

func (d *authMethodSelectDialog) Close() tea.Cmd {
	return nil
}

func NewAuthMethodSelectDialog(app *app.App, provider AuthProviderInfo) AuthMethodSelectDialog {
	methods := []string{
		"Claude Pro/Max",
		"API Key",
	}
	
	methodList := list.NewStringList(methods, 2, "", true)
	methodList.SetMaxWidth(30)
	
	return &authMethodSelectDialog{
		app:        app,
		provider:   provider,
		methodList: methodList,
		modal: modal.New(
			modal.WithTitle("Login Method"),
			modal.WithMaxWidth(34),
		),
	}
}