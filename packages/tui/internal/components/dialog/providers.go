package dialog

import (
	"context"
	"fmt"
	"log/slog"
	"maps"
	"slices"
	"strings"

	"github.com/charmbracelet/bubbles/v2/key"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/components/list"
	"github.com/sst/opencode/internal/components/modal"
	"github.com/sst/opencode/internal/components/toast"
	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
	"github.com/sst/opencode/pkg/client"
)

const (
	numVisibleProviders = 8
	maxProviderDialogWidth = 50
)

// AddProviderRequestMsg is sent when user wants to add a new provider
type AddProviderRequestMsg struct{}

// RemoveProviderRequestMsg is sent when user wants to remove a provider
type RemoveProviderRequestMsg struct{}

// ShowProviderDialogMsg is sent to show the provider dialog
type ShowProviderDialogMsg struct{}

// MoveProviderMsg is sent to reorder providers
type MoveProviderMsg struct {
	ProviderID string
	Direction  int // -1 for up, 1 for down
}

// ProviderDialog interface for the provider selection dialog
type ProviderDialog interface {
	layout.Modal
}

type providerDialog struct {
	app               *app.App
	availableProviders []client.ProviderInfo
	authProviders     map[string]bool // provider ID -> authenticated status
	width             int
	height            int
	modal             *modal.Modal
	providerList      list.List[list.StringItem]
}

type providerKeyMap struct {
	Enter    key.Binding
	Escape   key.Binding
	MoveUp   key.Binding
	MoveDown key.Binding
}

var providerKeys = providerKeyMap{
	Enter: key.NewBinding(
		key.WithKeys("enter"),
		key.WithHelp("enter", "select provider"),
	),
	Escape: key.NewBinding(
		key.WithKeys("esc"),
		key.WithHelp("esc", "close"),
	),
	MoveUp: key.NewBinding(
		key.WithKeys("shift+up", "K"),
		key.WithHelp("shift+↑/K", "move up"),
	),
	MoveDown: key.NewBinding(
		key.WithKeys("shift+down", "J"),
		key.WithHelp("shift+↓/J", "move down"),
	),
}

func (p *providerDialog) Init() tea.Cmd {
	return nil
}

func (p *providerDialog) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch {
		case key.Matches(msg, providerKeys.MoveUp):
			_, idx := p.providerList.GetSelectedItem()
			if idx <= 0 || idx >= len(p.availableProviders) {
				return p, nil
			}
			
			// Move provider up in the order
			selectedProvider := p.availableProviders[idx]
			return p, util.CmdHandler(MoveProviderMsg{
				ProviderID: selectedProvider.Id,
				Direction:  -1,
			})
			
		case key.Matches(msg, providerKeys.MoveDown):
			_, idx := p.providerList.GetSelectedItem()
			if idx == -1 || idx >= len(p.availableProviders)-1 {
				return p, nil
			}
			
			// Move provider down in the order
			selectedProvider := p.availableProviders[idx]
			return p, util.CmdHandler(MoveProviderMsg{
				ProviderID: selectedProvider.Id,
				Direction:  1,
			})
			
		case key.Matches(msg, providerKeys.Enter):
			_, idx := p.providerList.GetSelectedItem()
			if idx == -1 {
				return p, nil
			}
			
			// Check if "Add new provider" was selected
			if idx == len(p.availableProviders) {
				return p, tea.Sequence(
					util.CmdHandler(modal.CloseModalMsg{}),
					util.CmdHandler(AddProviderRequestMsg{}),
				)
			}
			
			// Check if "Remove provider" was selected
			if idx == len(p.availableProviders)+1 {
				return p, tea.Sequence(
					util.CmdHandler(modal.CloseModalMsg{}),
					util.CmdHandler(RemoveProviderRequestMsg{}),
				)
			}
			
			// Find the selected provider (index-based since we have formatted strings)
			selectedProvider := p.availableProviders[idx]
			
			// Check if the provider is authenticated
			isAuthenticated, exists := p.authProviders[selectedProvider.Id]
			if !exists || !isAuthenticated {
				// Provider not authenticated, show option to add auth
				return p, tea.Sequence(
					util.CmdHandler(modal.CloseModalMsg{}),
					util.CmdHandler(AddProviderRequestMsg{}),
					toast.NewWarningToast(fmt.Sprintf("%s requires authentication", selectedProvider.Name)),
				)
			}
			
			// Get the default model for this provider
			models := slices.SortedFunc(maps.Values(selectedProvider.Models), func(a, b client.ModelInfo) int {
				return strings.Compare(a.Name, b.Name)
			})
			
			if len(models) == 0 {
				return p, util.CmdHandler(modal.CloseModalMsg{})
			}
			
			// Check if we have a saved model for this provider
			var selectedModel client.ModelInfo
			if savedModelId, exists := p.app.State.ProviderModels[selectedProvider.Id]; exists {
				// Look for the saved model
				for _, model := range models {
					if model.Id == savedModelId {
						selectedModel = model
						break
					}
				}
			}
			
			// If no saved model found, use the first model as default
			if selectedModel.Id == "" {
				selectedModel = models[0]
			}
			
			return p, tea.Sequence(
				util.CmdHandler(modal.CloseModalMsg{}),
				util.CmdHandler(
					app.ModelSelectedMsg{
						Provider: selectedProvider,
						Model:    selectedModel,
					}),
			)
		case key.Matches(msg, providerKeys.Escape):
			return p, util.CmdHandler(modal.CloseModalMsg{})
		}
	case tea.WindowSizeMsg:
		p.width = msg.Width
		p.height = msg.Height
	}

	// Update the list component
	updatedList, cmd := p.providerList.Update(msg)
	p.providerList = updatedList.(list.List[list.StringItem])
	return p, cmd
}

func (p *providerDialog) View() string {
	return p.providerList.View()
}

func (p *providerDialog) Render(background string) string {
	return p.modal.Render(p.View(), background)
}

func (p *providerDialog) Close() tea.Cmd {
	return nil
}

func NewProviderDialog(app *app.App) ProviderDialog {
	availableProviders, err := app.ListProviders(context.Background())
	if err != nil {
		slog.Error("Failed to list providers", "error", err)
	}
	slog.Debug("Provider dialog: fetched providers", "count", len(availableProviders))
	
	// Fetch auth provider data to get authentication status
	authProviders := make(map[string]bool)
	authProviderList, err := app.ListAuthProviders(context.Background())
	if err != nil {
		slog.Error("Failed to list auth providers", "error", err)
	}
	for _, authProvider := range authProviderList {
		authProviders[authProvider.Id] = authProvider.Authenticated
	}
	
	// Sort providers by custom order or by name
	if app.State.ProviderOrder != nil && len(app.State.ProviderOrder) > 0 {
		// Create a map for quick lookup of order positions
		orderMap := make(map[string]int)
		for i, id := range app.State.ProviderOrder {
			orderMap[id] = i
		}
		
		// Sort by custom order, putting unknown providers at the end
		slices.SortFunc(availableProviders, func(a, b client.ProviderInfo) int {
			aPos, aExists := orderMap[a.Id]
			bPos, bExists := orderMap[b.Id]
			
			if aExists && bExists {
				return aPos - bPos
			} else if aExists {
				return -1 // a comes before b
			} else if bExists {
				return 1 // b comes before a
			}
			// Neither exists in order, sort by name
			return strings.Compare(a.Name, b.Name)
		})
	} else {
		// No custom order, sort by name
		slices.SortFunc(availableProviders, func(a, b client.ProviderInfo) int {
			return strings.Compare(a.Name, b.Name)
		})
	}
	
	// Create provider names list with model count and auth status
	providerNames := make([]string, len(availableProviders)+2)  // +2 for "Add new provider" and "Remove provider"
	t := theme.CurrentTheme()
	for i, provider := range availableProviders {
		modelCount := len(provider.Models)
		authStatus := " "
		if authenticated, exists := authProviders[provider.Id]; exists && authenticated {
			// Green dot for authenticated providers
			authStatus = lipgloss.NewStyle().Foreground(t.Success()).Render("● ") 
		} else {
			// Hollow dot for unauthenticated providers
			authStatus = lipgloss.NewStyle().Foreground(t.TextMuted()).Render("○ ")
		}
		// Add position number for quick reference
		position := lipgloss.NewStyle().
			Foreground(t.TextMuted()).
			Render(fmt.Sprintf("%d. ", i+1))
		providerNames[i] = fmt.Sprintf("%s%s%s (%d models)", position, authStatus, provider.Name, modelCount)
	}
	// Add the "Add new provider" option at the end
	providerNames[len(availableProviders)] = "→ Add new provider..."
	// Add the "Remove provider" option after that
	providerNames[len(availableProviders)+1] = "→ Remove provider..."
	
	providerList := list.NewStringList(providerNames, numVisibleProviders, "No providers available", true)
	providerList.SetMaxWidth(maxProviderDialogWidth)
	
	// Set the current provider as selected
	if app.Provider != nil {
		for i, provider := range availableProviders {
			if provider.Id == app.Provider.Id {
				providerList.SetSelectedIndex(i)
				break
			}
		}
	}
	
	dialog := &providerDialog{
		app:                app,
		availableProviders: availableProviders,
		authProviders:      authProviders,
		providerList:      providerList,
		modal: modal.New(
			modal.WithTitle("Select Provider"),
			modal.WithMaxWidth(maxProviderDialogWidth+4),
		),
	}
	
	return dialog
}