package dialog

import (
	"context"
	"fmt"
	"log/slog"
	"slices"
	"strings"

	"github.com/charmbracelet/bubbles/v2/key"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/components/list"
	"github.com/sst/opencode/internal/components/modal"
	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
)

// RemoveProviderDialog interface for the remove provider dialog
type RemoveProviderDialog interface {
	layout.Modal
}

type removeProviderDialog struct {
	app                  *app.App
	authenticatedProviders []AuthProviderInfo
	providerList         list.List[list.StringItem]
	modal                *modal.Modal
}

type removeProviderKeyMap struct {
	Enter  key.Binding
	Escape key.Binding
}

var removeProviderKeys = removeProviderKeyMap{
	Enter: key.NewBinding(
		key.WithKeys("enter"),
		key.WithHelp("enter", "remove provider"),
	),
	Escape: key.NewBinding(
		key.WithKeys("esc"),
		key.WithHelp("esc", "cancel"),
	),
}

// ProviderRemovedMsg is sent when a provider is successfully removed
type ProviderRemovedMsg struct {
	ProviderID string
}

func (d *removeProviderDialog) Init() tea.Cmd {
	return nil
}

func (d *removeProviderDialog) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch {
		case key.Matches(msg, removeProviderKeys.Enter):
			_, idx := d.providerList.GetSelectedItem()
			if idx == -1 || idx >= len(d.authenticatedProviders) {
				return d, nil
			}
			
			// Get the selected provider
			selectedProvider := d.authenticatedProviders[idx]
			
			// Show confirmation dialog
			return d, tea.Sequence(
				util.CmdHandler(modal.CloseModalMsg{}),
				util.CmdHandler(ShowConfirmRemoveMsg{
					Provider: selectedProvider,
				}),
			)
			
		case key.Matches(msg, removeProviderKeys.Escape):
			return d, util.CmdHandler(modal.CloseModalMsg{})
		}
	}

	// Update the list component
	updatedList, cmd := d.providerList.Update(msg)
	d.providerList = updatedList.(list.List[list.StringItem])
	return d, cmd
}

func (d *removeProviderDialog) View() string {
	if len(d.authenticatedProviders) == 0 {
		t := theme.CurrentTheme()
		return lipgloss.NewStyle().
			Foreground(t.TextMuted()).
			Italic(true).
			Render("No authenticated providers to remove")
	}
	return d.providerList.View()
}

func (d *removeProviderDialog) Render(background string) string {
	return d.modal.Render(d.View(), background)
}

func (d *removeProviderDialog) Close() tea.Cmd {
	return nil
}

func NewRemoveProviderDialog(app *app.App) RemoveProviderDialog {
	// Get authenticated providers
	authProviderList, err := app.ListAuthProviders(context.Background())
	if err != nil {
		slog.Error("Failed to list auth providers", "error", err)
	}
	
	// Filter only authenticated providers
	var authenticatedProviders []AuthProviderInfo
	for _, provider := range authProviderList {
		if provider.Authenticated {
			authenticatedProviders = append(authenticatedProviders, AuthProviderInfo{
				Id:       provider.Id,
				Name:     provider.Name,
				AuthType: provider.AuthType,
			})
		}
	}
	
	// Sort by name
	slices.SortFunc(authenticatedProviders, func(a, b AuthProviderInfo) int {
		return strings.Compare(a.Name, b.Name)
	})
	
	// Create provider names list
	providerNames := make([]string, len(authenticatedProviders))
	t := theme.CurrentTheme()
	for i, provider := range authenticatedProviders {
		// Show with a red X icon to indicate removal
		providerNames[i] = fmt.Sprintf("%s %s", 
			lipgloss.NewStyle().Foreground(t.Error()).Render("✕"),
			provider.Name,
		)
	}
	
	providerList := list.NewStringList(providerNames, 8, "No providers to remove", true)
	providerList.SetMaxWidth(40)
	
	return &removeProviderDialog{
		app:                    app,
		authenticatedProviders: authenticatedProviders,
		providerList:          providerList,
		modal: modal.New(
			modal.WithTitle("Remove Provider"),
			modal.WithMaxWidth(44),
		),
	}
}

// ShowConfirmRemoveMsg shows confirmation dialog for removing provider
type ShowConfirmRemoveMsg struct {
	Provider AuthProviderInfo
}