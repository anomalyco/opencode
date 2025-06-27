package dialog

import (
	"context"
	"fmt"

	"github.com/charmbracelet/bubbles/v2/key"
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

// ConfirmRemoveProviderDialog interface for the confirmation dialog
type ConfirmRemoveProviderDialog interface {
	layout.Modal
}

type confirmRemoveProviderDialog struct {
	app      *app.App
	provider AuthProviderInfo
	modal    *modal.Modal
}

type confirmRemoveKeyMap struct {
	Yes    key.Binding
	No     key.Binding
	Escape key.Binding
}

var confirmRemoveKeys = confirmRemoveKeyMap{
	Yes: key.NewBinding(
		key.WithKeys("y"),
		key.WithHelp("y", "confirm"),
	),
	No: key.NewBinding(
		key.WithKeys("n"),
		key.WithHelp("n", "cancel"),
	),
	Escape: key.NewBinding(
		key.WithKeys("esc"),
		key.WithHelp("esc", "cancel"),
	),
}

func (d *confirmRemoveProviderDialog) Init() tea.Cmd {
	return nil
}

func (d *confirmRemoveProviderDialog) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch {
		case key.Matches(msg, confirmRemoveKeys.Yes):
			// Remove the provider
			return d, d.removeProvider()
			
		case key.Matches(msg, confirmRemoveKeys.No), key.Matches(msg, confirmRemoveKeys.Escape):
			return d, util.CmdHandler(modal.CloseModalMsg{})
		}
	}
	return d, nil
}

func (d *confirmRemoveProviderDialog) removeProvider() tea.Cmd {
	return func() tea.Msg {
		// Call the auth remove endpoint
		resp, err := d.app.Client.PostAuthRemoveWithResponse(
			context.Background(),
			client.PostAuthRemoveJSONRequestBody{
				ProviderId: d.provider.Id,
			},
		)
		
		if err != nil {
			return toast.NewErrorToast(fmt.Sprintf("Failed to remove provider: %s", err.Error()))
		}
		
		if resp.StatusCode() != 200 {
			return toast.NewErrorToast(fmt.Sprintf("Failed to remove provider: status %d", resp.StatusCode()))
		}
		
		return ProviderRemovedMsg{ProviderID: d.provider.Id}
	}
}

func (d *confirmRemoveProviderDialog) View() string {
	t := theme.CurrentTheme()
	
	content := []string{
		styles.NewStyle().
			Foreground(t.Warning()).
			Bold(true).
			Render("⚠ Warning"),
		"",
		fmt.Sprintf("Are you sure you want to remove %s?", d.provider.Name),
		"",
		styles.NewStyle().
			Foreground(t.TextMuted()).
			Render("This will delete your authentication credentials."),
		styles.NewStyle().
			Foreground(t.TextMuted()).
			Render("You'll need to re-authenticate to use this provider again."),
		"",
		"",
		lipgloss.JoinHorizontal(
			lipgloss.Left,
			styles.NewStyle().
				Foreground(t.Success()).
				Bold(true).
				Render("[y] Yes"),
			"    ",
			styles.NewStyle().
				Foreground(t.Error()).
				Bold(true).
				Render("[n] No"),
		),
	}
	
	return lipgloss.JoinVertical(lipgloss.Left, content...)
}

func (d *confirmRemoveProviderDialog) Render(background string) string {
	return d.modal.Render(d.View(), background)
}

func (d *confirmRemoveProviderDialog) Close() tea.Cmd {
	return nil
}

func NewConfirmRemoveProviderDialog(app *app.App, provider AuthProviderInfo) ConfirmRemoveProviderDialog {
	return &confirmRemoveProviderDialog{
		app:      app,
		provider: provider,
		modal: modal.New(
			modal.WithTitle("Confirm Remove Provider"),
			modal.WithMaxWidth(50),
		),
	}
}