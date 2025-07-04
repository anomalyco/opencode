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
	numVisibleModels = 10
	minDialogWidth   = 40
	maxDialogWidth   = 80
)

// ModelDialog interface for the model selection dialog
type ModelDialog interface {
	layout.Modal
}

type modelDialog struct {
	app         *app.App
	allModels   []ModelWithProvider
	width       int
	height      int
	modal       *modal.Modal
	modelList   list.List[ModelItem]
	dialogWidth int
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

	if selected {
		displayText := fmt.Sprintf("%s (%s)", m.ModelName, m.ProviderName)
		return styles.NewStyle().
			Background(t.Primary()).
			Foreground(t.BackgroundPanel()).
			Width(width).
			PaddingLeft(1).
			Render(displayText)
	} else {
		modelStyle := styles.NewStyle().
			Foreground(t.Text()).
			Background(t.BackgroundPanel())
		providerStyle := styles.NewStyle().
			Foreground(t.TextMuted()).
			Background(t.BackgroundPanel())

		modelPart := modelStyle.Render(m.ModelName)
		providerPart := providerStyle.Render(fmt.Sprintf(" (%s)", m.ProviderName))

		combinedText := modelPart + providerPart
		return styles.NewStyle().
			Background(t.BackgroundPanel()).
			PaddingLeft(1).
			Render(combinedText)
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

func (m *modelDialog) calculateOptimalWidth(modelItems []ModelItem) int {
	maxWidth := minDialogWidth

	for _, item := range modelItems {
		// Calculate the width needed for this item: "ModelName (ProviderName)"
		// Add 4 for the parentheses, space, and some padding
		itemWidth := len(item.ModelName) + len(item.ProviderName) + 4
		if itemWidth > maxWidth {
			maxWidth = itemWidth
		}
	}

	if maxWidth > maxDialogWidth {
		maxWidth = maxDialogWidth
	}

	return maxWidth
}

func (m *modelDialog) setupAllModels() {
	providers, _ := m.app.ListProviders(context.Background())

	m.allModels = make([]ModelWithProvider, 0)
	for _, provider := range providers {
		for _, model := range provider.Models {
			m.allModels = append(m.allModels, ModelWithProvider{
				Model:    model,
				Provider: provider,
			})
		}
	}

	m.sortModels()

	modelItems := make([]ModelItem, len(m.allModels))
	for i, modelWithProvider := range m.allModels {
		modelItems[i] = ModelItem{
			ModelName:    modelWithProvider.Model.Name,
			ProviderName: modelWithProvider.Provider.Name,
		}
	}

	m.dialogWidth = m.calculateOptimalWidth(modelItems)

	m.modelList = list.NewListComponent(modelItems, numVisibleModels, "No models available", true)
	m.modelList.SetMaxWidth(m.dialogWidth)

	if len(m.allModels) > 0 {
		m.modelList.SetSelectedIndex(0)
	}
}

func (m *modelDialog) sortModels() {
	sort.Slice(m.allModels, func(i, j int) bool {
		modelA := m.allModels[i]
		modelB := m.allModels[j]

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
		if modelA.Model.ReleaseDate != "" && modelB.Model.ReleaseDate != "" {
			dateA := m.parseReleaseDate(modelA.Model.ReleaseDate)
			dateB := m.parseReleaseDate(modelB.Model.ReleaseDate)
			if !dateA.IsZero() && !dateB.IsZero() {
				return dateA.After(dateB)
			}
		}

		// If only one has release date, it goes first
		if modelA.Model.ReleaseDate != "" && modelB.Model.ReleaseDate == "" {
			return true
		}
		if modelA.Model.ReleaseDate == "" && modelB.Model.ReleaseDate != "" {
			return false
		}

		// If neither has usage time nor release date, fall back to alphabetical sorting
		return modelA.Model.Name < modelB.Model.Name
	})
}

func (m *modelDialog) parseReleaseDate(dateStr string) time.Time {
	if parsed, err := time.Parse("2006-01-02", dateStr); err == nil {
		return parsed
	}

	return time.Time{}
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
	}

	dialog.setupAllModels()

	dialog.modal = modal.New(
		modal.WithTitle("Select Model"),
		modal.WithMaxWidth(dialog.dialogWidth+4),
	)

	return dialog
}
