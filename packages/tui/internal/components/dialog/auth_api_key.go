package dialog

import (
	"context"
	"fmt"

	"github.com/charmbracelet/bubbles/v2/key"
	"github.com/charmbracelet/bubbles/v2/textinput"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/components/modal"
	"github.com/sst/opencode/internal/components/toast"
	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
	"github.com/sst/opencode/pkg/client"
)

// AuthAPIKeyDialog shows API key input for a provider
type AuthAPIKeyDialog interface {
	layout.Modal
}

type authAPIKeyDialog struct {
	app        *app.App
	provider   AuthProviderInfo
	modal      *modal.Modal
	textInput  textinput.Model
	submitting bool
}

type authAPIKeyKeyMap struct {
	Enter  key.Binding
	Escape key.Binding
}

var authAPIKeyKeys = authAPIKeyKeyMap{
	Enter: key.NewBinding(
		key.WithKeys("enter"),
		key.WithHelp("enter", "submit"),
	),
	Escape: key.NewBinding(
		key.WithKeys("esc"),
		key.WithHelp("esc", "cancel"),
	),
}

// AuthSuccessMsg is sent when authentication succeeds
type AuthSuccessMsg struct {
	ProviderID string
}

func (d *authAPIKeyDialog) Init() tea.Cmd {
	return textinput.Blink
}

func (d *authAPIKeyDialog) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.KeyMsg:
		if d.submitting {
			return d, nil // Ignore input while submitting
		}
		
		switch {
		case key.Matches(msg, authAPIKeyKeys.Enter):
			apiKey := d.textInput.Value()
			if apiKey == "" {
				return d, toast.NewErrorToast("API key cannot be empty")
			}
			
			d.submitting = true
			return d, d.submitAPIKey(apiKey)
			
		case key.Matches(msg, authAPIKeyKeys.Escape):
			return d, util.CmdHandler(modal.CloseModalMsg{})
		}
		
	case AuthSuccessMsg:
		// Close modal and forward the success message to the main handler
		return d, tea.Sequence(
			util.CmdHandler(modal.CloseModalMsg{}),
			util.CmdHandler(msg), // Forward the AuthSuccessMsg
		)
		
	case error:
		d.submitting = false
		return d, toast.NewErrorToast(fmt.Sprintf("Authentication failed: %s", msg.Error()))
	}

	// Only update text input if not submitting
	if !d.submitting {
		d.textInput, cmd = d.textInput.Update(msg)
		cmds = append(cmds, cmd)
	}

	return d, tea.Batch(cmds...)
}

func (d *authAPIKeyDialog) submitAPIKey(apiKey string) tea.Cmd {
	return func() tea.Msg {
		resp, err := d.app.Client.PostAuthApikeyWithResponse(
			context.Background(),
			client.PostAuthApikeyJSONRequestBody{
				ProviderId: d.provider.Id,
				ApiKey:     apiKey,
			},
		)
		
		if err != nil {
			return err
		}
		
		if resp.StatusCode() != 200 {
			return fmt.Errorf("failed with status %d", resp.StatusCode())
		}
		
		return AuthSuccessMsg{ProviderID: d.provider.Id}
	}
}

func (d *authAPIKeyDialog) View() string {
	t := theme.CurrentTheme()
	
	content := []string{
		styles.NewStyle().
			Foreground(t.TextMuted()).
			MarginBottom(1).
			Render(fmt.Sprintf("Enter API key for %s", d.provider.Name)),
		"",
		d.textInput.View(),
	}
	
	if d.submitting {
		content = append(content, "", styles.NewStyle().
			Foreground(t.TextMuted()).
			Italic(true).
			Render("Authenticating..."))
	}
	
	return lipgloss.JoinVertical(lipgloss.Left, content...)
}

func (d *authAPIKeyDialog) Render(background string) string {
	return d.modal.Render(d.View(), background)
}

func (d *authAPIKeyDialog) Close() tea.Cmd {
	return nil
}

func NewAuthAPIKeyDialog(app *app.App, provider AuthProviderInfo) AuthAPIKeyDialog {
	ti := textinput.New()
	ti.Placeholder = "sk-..."
	ti.Focus()
	ti.CharLimit = 200
	ti.SetWidth(40)
	ti.Prompt = ""
	ti.EchoMode = textinput.EchoPassword
	
	return &authAPIKeyDialog{
		app:       app,
		provider:  provider,
		textInput: ti,
		modal: modal.New(
			modal.WithTitle("Enter API Key"),
			modal.WithMaxWidth(44),
		),
	}
}