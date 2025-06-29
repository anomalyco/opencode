package dialog

import (
	"context"
	"fmt"
	"maps"
	"slices"
	"strings"

	"github.com/charmbracelet/bubbles/v2/key"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/components/list"
	"github.com/sst/opencode/internal/components/modal"
	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
)

const (
	numVisibleModels = 6
	maxDialogWidth   = 40
)

// ModelDialog interface for the model selection dialog
type ModelDialog interface {
	layout.Modal
}

type modelDialog struct {
	app                *app.App
	availableProviders []opencode.Provider
	provider           opencode.Provider
	width              int
	height             int
	hScrollOffset      int
	hScrollPossible    bool
	modal              *modal.Modal
	modelList          list.List[list.StringItem]
}

type modelKeyMap struct {
	Left   key.Binding
	Right  key.Binding
	Enter  key.Binding
	Escape key.Binding
}

var modelKeys = modelKeyMap{
	Left: key.NewBinding(
		key.WithKeys("left", "h"),
		key.WithHelp("←", "scroll left"),
	),
	Right: key.NewBinding(
		key.WithKeys("right", "l"),
		key.WithHelp("→", "scroll right"),
	),
	Enter: key.NewBinding(
		key.WithKeys("enter"),
		key.WithHelp("enter", "select model"),
	),
	Escape: key.NewBinding(
		key.WithKeys("esc"),
		key.WithHelp("esc", "close"),
	),
}

func (m *modelDialog) Init() tea.Cmd {
	m.setupModelsForProvider(m.provider.ID)
	return nil
}

func (m *modelDialog) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch {
		case key.Matches(msg, modelKeys.Left):
			if m.hScrollPossible {
				m.switchProvider(-1)
			}
			return m, nil
		case key.Matches(msg, modelKeys.Right):
			if m.hScrollPossible {
				m.switchProvider(1)
			}
			return m, nil
		case key.Matches(msg, modelKeys.Enter):
			selectedItem, _ := m.modelList.GetSelectedItem()
			models := m.models()
			var selectedModel opencode.Model
			for _, model := range models {
				if model.Name == string(selectedItem) {
					selectedModel = model
					break
				}
			}

			providerToUse := m.provider
			modelToSend := selectedModel

			if m.provider.ID == "favorites" {
				parts := strings.SplitN(selectedModel.ID, "/", 2)
				providerID := parts[0]
				modelID := parts[1]

				for _, p := range m.availableProviders {
					if p.ID == providerID {
						providerToUse = p
						break
					}
				}
				modelToSend = providerToUse.Models[modelID]
			}

			return m, tea.Sequence(
				util.CmdHandler(modal.CloseModalMsg{}),
				util.CmdHandler(
					app.ModelSelectedMsg{
						Provider: providerToUse,
						Model:    modelToSend,
					}),
			)
		case key.Matches(msg, modelKeys.Escape):
			return m, util.CmdHandler(modal.CloseModalMsg{})
		}
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
	}

	// Update the list component
	updatedList, cmd := m.modelList.Update(msg)
	m.modelList = updatedList.(list.List[list.StringItem])
	return m, cmd
}

func (m *modelDialog) models() []opencode.Model {
	models := slices.SortedFunc(maps.Values(m.provider.Models), func(a, b opencode.Model) int {
		return strings.Compare(a.Name, b.Name)
	})
	return models
}

func (m *modelDialog) switchProvider(offset int) {
	newOffset := m.hScrollOffset + offset
	if newOffset < 0 {
		newOffset = len(m.availableProviders) - 1
	}
	if newOffset >= len(m.availableProviders) {
		newOffset = 0
	}

	m.hScrollOffset = newOffset
	m.provider = m.availableProviders[m.hScrollOffset]
	m.modal.SetTitle(fmt.Sprintf("Select %s Model", m.provider.Name))
	m.setupModelsForProvider(m.provider.ID)
}

func (m *modelDialog) View() string {
	listView := m.modelList.View()
	scrollIndicator := m.getScrollIndicators(maxDialogWidth)
	return strings.Join([]string{listView, scrollIndicator}, "\n")
}

func (m *modelDialog) getScrollIndicators(maxWidth int) string {
	var indicator string
	if m.hScrollPossible {
		indicator = "← → (switch provider) "
	}
	if indicator == "" {
		return ""
	}

	t := theme.CurrentTheme()
	return styles.NewStyle().
		Foreground(t.TextMuted()).
		Width(maxWidth).
		Align(lipgloss.Right).
		Render(indicator)
}

func (m *modelDialog) setupModelsForProvider(providerId string) {
	m.hScrollPossible = len(m.availableProviders) > 1
	models := m.models()
	modelNames := make([]string, len(models))
	for i, model := range models {
		modelNames[i] = model.Name
	}

	m.modelList = list.NewStringList(modelNames, numVisibleModels, "No models available", true)
	m.modelList.SetMaxWidth(maxDialogWidth)

	if m.app.Provider != nil && m.app.Model != nil && m.app.Provider.ID == providerId {
		for i, model := range models {
			if model.ID == m.app.Model.ID {
				m.modelList.SetSelectedIndex(i)
				break
			}
		}
	}
}

func (m *modelDialog) Render(background string) string {
	return m.modal.Render(m.View(), background)
}

func (s *modelDialog) Close() tea.Cmd {
	return nil
}

func NewModelDialog(app *app.App) ModelDialog {
	// MOCK: Using a hardcoded list of favorite models for testing
	mockFavoriteModels := []string{"openai/o3", "google/gemini-2.5-pro"} // e.g. "openai/gpt-4-turbo"
	allProviders, _ := app.ListProviders(context.Background())

	var providers []opencode.Provider
	if len(mockFavoriteModels) > 0 {
		var favoriteModels []opencode.Model
		for _, p := range allProviders {
			for _, m := range p.Models {
				for _, fav := range mockFavoriteModels {
					if fav == fmt.Sprintf("%s/%s", p.ID, m.ID) {
						newModel := m
						newModel.ID = fmt.Sprintf("%s/%s", p.ID, m.ID)
						newModel.Name = fmt.Sprintf("%s (%s)", m.Name, p.Name)
						favoriteModels = append(favoriteModels, newModel)
					}
				}
			}
		}

		if len(favoriteModels) > 0 {
			favoritesProvider := opencode.Provider{
				ID:     "favorites",
				Name:   "Favorites",
				Models: make(map[string]opencode.Model),
			}
			for _, m := range favoriteModels {
				favoritesProvider.Models[m.ID] = m
			}
			providers = append(providers, favoritesProvider)
		}
	}
	providers = append(providers, allProviders...)

	currentProvider := providers[0]
	hScrollOffset := 0
	if app.Provider != nil {
		for i, provider := range providers {
			if provider.ID == app.Provider.ID {
				currentProvider = provider
				hScrollOffset = i
				break
			}
		}
	}

	if len(providers) > 0 && providers[0].ID == "favorites" {
		currentProvider = providers[0]
		hScrollOffset = 0
	}

	dialog := &modelDialog{
		app:                app,
		availableProviders: providers,
		hScrollOffset:      hScrollOffset,
		hScrollPossible:    len(providers) > 1,
		provider:           currentProvider,
	}
	dialog.modal = modal.New(
		modal.WithTitle(fmt.Sprintf("Select %s Model", currentProvider.Name)),
		modal.WithMaxWidth(maxDialogWidth+4),
	)

	dialog.setupModelsForProvider(currentProvider.ID)
	return dialog
}
