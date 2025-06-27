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
	"github.com/sst/opencode/internal/components/toast"
	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
	"github.com/sst/opencode/pkg/client"
)

// HotkeysDialog interface for the hotkeys configuration dialog
type HotkeysDialog interface {
	layout.Modal
}

type hotkeysDialog struct {
	app          *app.App
	providers    []client.ProviderInfo
	providerList list.List[list.StringItem]
	modal        *modal.Modal
	width        int
	height       int
}

type hotkeysKeyMap struct {
	Number key.Binding
	Clear  key.Binding
	Escape key.Binding
}

var hotkeysKeys = hotkeysKeyMap{
	Number: key.NewBinding(
		key.WithKeys("0", "1", "2", "3", "4", "5", "6", "7", "8", "9"),
		key.WithHelp("0-9", "assign hotkey"),
	),
	Clear: key.NewBinding(
		key.WithKeys("delete", "backspace"),
		key.WithHelp("del", "clear hotkey"),
	),
	Escape: key.NewBinding(
		key.WithKeys("esc"),
		key.WithHelp("esc", "close"),
	),
}

func (h *hotkeysDialog) Init() tea.Cmd {
	return nil
}

func (h *hotkeysDialog) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		keyStr := msg.String()
		
		// Check for number keys
		if len(keyStr) == 1 && keyStr[0] >= '0' && keyStr[0] <= '9' {
			_, idx := h.providerList.GetSelectedItem()
			if idx == -1 || idx >= len(h.providers) {
				return h, nil
			}
			
			selectedProvider := h.providers[idx]
			hotkeyNum := int(keyStr[0] - '0')
			
			// Assign the hotkey number directly
			return h, h.setProviderHotkey(selectedProvider.Id, hotkeyNum)
		}
		
		switch {
		case key.Matches(msg, hotkeysKeys.Clear):
			// Clear hotkey for selected provider
			_, idx := h.providerList.GetSelectedItem()
			if idx == -1 || idx >= len(h.providers) {
				return h, nil
			}
			
			selectedProvider := h.providers[idx]
			return h, h.clearProviderHotkey(selectedProvider.Id)
			
		case key.Matches(msg, hotkeysKeys.Escape):
			return h, util.CmdHandler(modal.CloseModalMsg{})
		}
		
	case tea.WindowSizeMsg:
		h.width = msg.Width
		h.height = msg.Height
	}

	// Update the list component
	updatedList, cmd := h.providerList.Update(msg)
	h.providerList = updatedList.(list.List[list.StringItem])
	return h, cmd
}

func (h *hotkeysDialog) setProviderHotkey(providerID string, hotkeyNum int) tea.Cmd {
	// Initialize hotkeys map if nil
	if h.app.State.ProviderHotkeys == nil {
		h.app.State.ProviderHotkeys = make(map[string]int)
	}
	
	// Clear any existing assignment for this hotkey number
	for id, num := range h.app.State.ProviderHotkeys {
		if num == hotkeyNum {
			delete(h.app.State.ProviderHotkeys, id)
			break
		}
	}
	
	// Assign the new hotkey
	h.app.State.ProviderHotkeys[providerID] = hotkeyNum
	h.app.SaveState()
	
	return tea.Sequence(
		func() tea.Msg {
			return ShowHotkeysDialogMsg{} // Refresh the dialog
		},
		toast.NewSuccessToast(fmt.Sprintf("Set %s to hotkey /%d", providerID, hotkeyNum)),
	)
}

func (h *hotkeysDialog) clearProviderHotkey(providerID string) tea.Cmd {
	if h.app.State.ProviderHotkeys == nil {
		return nil
	}
	
	// Remove the hotkey assignment
	if _, exists := h.app.State.ProviderHotkeys[providerID]; exists {
		delete(h.app.State.ProviderHotkeys, providerID)
		h.app.SaveState()
		
		return tea.Sequence(
			func() tea.Msg {
				return ShowHotkeysDialogMsg{} // Refresh the dialog
			},
			toast.NewInfoToast(fmt.Sprintf("Cleared hotkey for %s", providerID)),
		)
	}
	
	return nil
}

func (h *hotkeysDialog) View() string {
	t := theme.CurrentTheme()
	
	header := lipgloss.JoinVertical(
		lipgloss.Left,
		styles.NewStyle().
			Foreground(t.TextMuted()).
			MarginBottom(1).
			Render("Assign number keys for quick provider switching"),
		styles.NewStyle().
			Foreground(t.TextMuted()).
			Italic(true).
			Render("Select a provider and press 0-9 to assign, Delete to clear"),
		styles.NewStyle().
			Foreground(t.TextMuted()).
			Italic(true).
			Render("Use /1, /2, etc. to quickly switch providers"),
		"",
	)
	
	return lipgloss.JoinVertical(
		lipgloss.Left,
		header,
		h.providerList.View(),
	)
}

func (h *hotkeysDialog) Render(background string) string {
	return h.modal.Render(h.View(), background)
}

func (h *hotkeysDialog) Close() tea.Cmd {
	return nil
}

// ShowHotkeysDialogMsg is sent to show the hotkeys dialog
type ShowHotkeysDialogMsg struct{}

func NewHotkeysDialog(app *app.App) HotkeysDialog {
	// Get authenticated providers
	providers, err := app.ListProviders(context.Background())
	if err != nil {
		slog.Error("Failed to list providers", "error", err)
	}
	
	// Get auth status to filter only authenticated providers
	authProviders := make(map[string]bool)
	authProviderList, _ := app.ListAuthProviders(context.Background())
	for _, authProvider := range authProviderList {
		authProviders[authProvider.Id] = authProvider.Authenticated
	}
	
	// Filter authenticated providers
	var authenticatedProviders []client.ProviderInfo
	for _, provider := range providers {
		if authenticated, exists := authProviders[provider.Id]; exists && authenticated {
			authenticatedProviders = append(authenticatedProviders, provider)
		}
	}
	
	// Apply custom order if exists
	if app.State.ProviderOrder != nil && len(app.State.ProviderOrder) > 0 {
		// Create a map for quick lookup of order positions
		orderMap := make(map[string]int)
		for i, id := range app.State.ProviderOrder {
			orderMap[id] = i
		}
		
		// Sort by custom order
		slices.SortFunc(authenticatedProviders, func(a, b client.ProviderInfo) int {
			aPos, aExists := orderMap[a.Id]
			bPos, bExists := orderMap[b.Id]
			
			if aExists && bExists {
				return aPos - bPos
			} else if aExists {
				return -1
			} else if bExists {
				return 1
			}
			return strings.Compare(a.Name, b.Name)
		})
	} else {
		// Sort by name
		slices.SortFunc(authenticatedProviders, func(a, b client.ProviderInfo) int {
			return strings.Compare(a.Name, b.Name)
		})
	}
	
	// Create provider list with hotkey indicators
	providerNames := make([]string, len(authenticatedProviders))
	t := theme.CurrentTheme()
	
	for i, provider := range authenticatedProviders {
		hotkeyIndicator := "    " // Empty space for alignment (4 chars to accommodate [XX])
		
		// Check if this provider has a hotkey assigned
		if app.State.ProviderHotkeys != nil {
			if hotkeyNum, exists := app.State.ProviderHotkeys[provider.Id]; exists {
				hotkeyIndicator = lipgloss.NewStyle().
					Foreground(t.Primary()).
					Bold(true).
					Render(fmt.Sprintf("[%d]", hotkeyNum))
			}
		}
		
		providerNames[i] = fmt.Sprintf("%s %s", hotkeyIndicator, provider.Name)
	}
	
	providerList := list.NewStringList(providerNames, 10, "No providers available", true)
	providerList.SetMaxWidth(50)
	
	return &hotkeysDialog{
		app:          app,
		providers:    authenticatedProviders,
		providerList: providerList,
		modal: modal.New(
			modal.WithTitle("Provider Hotkeys"),
			modal.WithMaxWidth(54),
		),
	}
}