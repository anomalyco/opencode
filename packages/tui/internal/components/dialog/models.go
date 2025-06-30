package dialog

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/charmbracelet/bubbles/v2/key"
	tea "github.com/charmbracelet/bubbletea/v2"
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
	app       *app.App
	allModels []ModelWithProvider
	width     int
	height    int
	modal     *modal.Modal
	modelList list.List[ModelItem]
}

type ModelWithProvider struct {
	Model    opencode.Model
	Provider opencode.Provider
}

type ModelItem struct {
	ModelName    string
	ProviderName string
}

func (m ModelItem) Render(selected bool, width int) string {
	t := theme.CurrentTheme()

	// Create the display text
	displayText := fmt.Sprintf("%s (%s)", m.ModelName, m.ProviderName)

	if selected {
		// When selected, use the standard selection styling
		return styles.NewStyle().
			Background(t.Primary()).
			Foreground(t.BackgroundElement()).
			Width(width).
			PaddingLeft(1).
			Render(displayText)
	} else {
		// When not selected, use normal text styling (same as StringItem)
		return styles.NewStyle().
			Foreground(t.Text()).
			PaddingLeft(1).
			Render(displayText)
	}
}

type modelKeyMap struct {
	Enter  key.Binding
	Escape key.Binding
}

var modelKeys = modelKeyMap{
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
	m.setupAllModels()
	return nil
}

func (m *modelDialog) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch {
		case key.Matches(msg, modelKeys.Enter):
			_, selectedIndex := m.modelList.GetSelectedItem()
			if selectedIndex >= 0 && selectedIndex < len(m.allModels) {
				selectedModel := m.allModels[selectedIndex]
				return m, tea.Sequence(
					util.CmdHandler(modal.CloseModalMsg{}),
					util.CmdHandler(
						app.ModelSelectedMsg{
							Provider: selectedModel.Provider,
							Model:    selectedModel.Model,
						}),
				)
			}
			return m, util.CmdHandler(modal.CloseModalMsg{})
		case key.Matches(msg, modelKeys.Escape):
			return m, util.CmdHandler(modal.CloseModalMsg{})
		}
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
	}

	// Update the list component
	updatedList, cmd := m.modelList.Update(msg)
	m.modelList = updatedList.(list.List[ModelItem])
	return m, cmd
}

func (m *modelDialog) View() string {
	return m.modelList.View()
}

func (m *modelDialog) setupAllModels() {
	// Get all available providers
	providers, _ := m.app.ListProviders(context.Background())

	// Collect all models from all providers
	m.allModels = make([]ModelWithProvider, 0)
	for _, provider := range providers {
		for _, model := range provider.Models {
			m.allModels = append(m.allModels, ModelWithProvider{
				Model:    model,
				Provider: provider,
			})
		}
	}

	// Sort models by recently used first, then by release date desc (if available)
	m.sortModels()

	// Create ModelItem objects for the list
	modelItems := make([]ModelItem, len(m.allModels))
	for i, modelWithProvider := range m.allModels {
		modelItems[i] = ModelItem{
			ModelName:    modelWithProvider.Model.Name,
			ProviderName: modelWithProvider.Provider.Name,
		}
	}

	m.modelList = list.NewListComponent(modelItems, numVisibleModels, "No models available", true)
	m.modelList.SetMaxWidth(maxDialogWidth)

	// Set the selected index to current model if it exists
	if m.app.Provider != nil && m.app.Model != nil {
		for i, modelWithProvider := range m.allModels {
			if modelWithProvider.Provider.ID == m.app.Provider.ID && modelWithProvider.Model.ID == m.app.Model.ID {
				m.modelList.SetSelectedIndex(i)
				break
			}
		}
	}
}

func (m *modelDialog) sortModels() {
	sort.Slice(m.allModels, func(i, j int) bool {
		modelA := m.allModels[i]
		modelB := m.allModels[j]

		// Get usage timestamps for both models
		usageA := m.getModelUsageTime(modelA.Provider.ID, modelA.Model.ID)
		usageB := m.getModelUsageTime(modelB.Provider.ID, modelB.Model.ID)

		// If both have usage times, sort by most recent first
		if !usageA.IsZero() && !usageB.IsZero() {
			return usageA.After(usageB)
		}

		// If only one has usage time, it goes first
		if !usageA.IsZero() && usageB.IsZero() {
			return true
		}
		if usageA.IsZero() && !usageB.IsZero() {
			return false
		}

		// If neither has usage time, sort by release date desc if available
		// For now, we'll fall back to alphabetical sorting by name
		// TODO: Add release date sorting when the field becomes available in the SDK
		return modelA.Model.Name < modelB.Model.Name
	})
}

func (m *modelDialog) getModelUsageTime(providerID, modelID string) time.Time {
	for _, usage := range m.app.State.RecentlyUsedModels {
		if usage.ProviderID == providerID && usage.ModelID == modelID {
			return usage.LastUsed
		}
	}
	return time.Time{}
}

func (m *modelDialog) Render(background string) string {
	return m.modal.Render(m.View(), background)
}

func (s *modelDialog) Close() tea.Cmd {
	return nil
}

func NewModelDialog(app *app.App) ModelDialog {
	dialog := &modelDialog{
		app: app,
		modal: modal.New(
			modal.WithTitle("Select Model"),
			modal.WithMaxWidth(maxDialogWidth+4),
		),
	}

	dialog.setupAllModels()
	return dialog
}
