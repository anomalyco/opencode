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
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/components/list"
	"github.com/sst/opencode/internal/components/modal"
	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
	"github.com/sst/opencode/pkg/client"
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
	availableProviders []client.ProviderInfo
	provider           client.ProviderInfo
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
	m.setupModelsForProvider(m.provider.Id)
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
			var selectedModel client.ModelInfo
			for _, model := range models {
				if model.Name == string(selectedItem) {
					selectedModel = model
					break
				}
			}
			return m, tea.Sequence(
				util.CmdHandler(modal.CloseModalMsg{}),
				util.CmdHandler(
					app.ModelSelectedMsg{
						Provider: m.provider,
						Model:    selectedModel,
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

func (m *modelDialog) models() []client.ModelInfo {
	models := slices.SortedFunc(maps.Values(m.provider.Models), func(a, b client.ModelInfo) int {
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
	m.setupModelsForProvider(m.provider.Id)
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
	models := m.models()
	modelNames := make([]string, len(models))
	for i, model := range models {
		modelNames[i] = model.Name
	}

	m.modelList = list.NewStringList(modelNames, numVisibleModels, "No models available", true)
	m.modelList.SetMaxWidth(maxDialogWidth)

	if m.app.Provider != nil && m.app.Model != nil && m.app.Provider.Id == providerId {
		for i, model := range models {
			if model.Id == m.app.Model.Id {
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
	availableProviders, _ := app.ListProviders(context.Background())

	currentProvider := availableProviders[0]
	hScrollOffset := 0
	if app.Provider != nil {
		for i, provider := range availableProviders {
			if provider.Id == app.Provider.Id {
				currentProvider = provider
				hScrollOffset = i
				break
			}
		}
	}

	dialog := &modelDialog{
		app:                app,
		availableProviders: availableProviders,
		hScrollOffset:      hScrollOffset,
		hScrollPossible:    len(availableProviders) > 1,
		provider:           currentProvider,
		modal: modal.New(
			modal.WithTitle(fmt.Sprintf("Select %s Model", currentProvider.Name)),
			modal.WithMaxWidth(maxDialogWidth+4),
		),
	}

	dialog.setupModelsForProvider(currentProvider.Id)
	return dialog
}
