package dialog

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/v2/key"
	"github.com/charmbracelet/bubbles/v2/textinput"
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
	app            *app.App
	allModels      []ModelWithProvider
	filteredModels []ModelWithProvider
	width          int
	height         int
	modal          *modal.Modal
	modelList      list.List[ModelItem]
	dialogWidth    int
	filterInput    textinput.Model
	filterActive   bool
	filterQuery    string
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
	Filter key.Binding
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
	Filter: key.NewBinding(
		key.WithKeys("/"),
		key.WithHelp("/", "filter models"),
	),
}

func (m *modelDialog) Init() tea.Cmd {
	m.setupAllModels()
	m.filterInput = m.createTextInput()
	return nil
}

func (m *modelDialog) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.KeyMsg:
		// Handle filter input when active
		if m.filterActive {
			switch {
			case key.Matches(msg, modelKeys.Enter):
				// Select model when filter is active
				_, selectedIndex := m.modelList.GetSelectedItem()
				if selectedIndex >= 0 && selectedIndex < len(m.filteredModels) {
					selectedModel := m.filteredModels[selectedIndex]
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
				// Exit filter mode
				m.filterActive = false
				m.filterInput.Blur()
				m.filterInput.SetValue("")
				m.filterQuery = ""
				m.filterModels("")
				return m, nil
			default:
				// Update filter input
				m.filterInput, cmd = m.filterInput.Update(msg)
				cmds = append(cmds, cmd)

				// Update filter if query changed
				newQuery := m.filterInput.Value()
				if newQuery != m.filterQuery {
					m.filterQuery = newQuery
					m.filterModels(newQuery)
				}
			}
		} else {
			// Handle normal navigation when filter is not active
			switch {
			case key.Matches(msg, modelKeys.Enter):
				_, selectedIndex := m.modelList.GetSelectedItem()
				if selectedIndex >= 0 && selectedIndex < len(m.filteredModels) {
					selectedModel := m.filteredModels[selectedIndex]
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
			case key.Matches(msg, modelKeys.Filter):
				// Activate filter mode
				m.filterActive = true
				m.filterInput.Focus()
				return m, textinput.Blink
			default:
				// Update the list component for navigation
				updatedList, cmd := m.modelList.Update(msg)
				m.modelList = updatedList.(list.List[ModelItem])
				cmds = append(cmds, cmd)
			}
		}
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
	}

	return m, tea.Batch(cmds...)
}

func (m *modelDialog) View() string {
	if m.filterActive {
		t := theme.CurrentTheme()
		m.filterInput.SetWidth(m.dialogWidth - 4)
		inputView := m.filterInput.View()
		inputView = styles.NewStyle().
			Background(t.BackgroundElement()).
			Height(1).
			Width(m.dialogWidth-2).
			Padding(0, 0).
			Render(inputView)

		listView := m.modelList.View()
		return inputView + "\n" + listView
	}
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

	// Initialize filtered models to show all models initially
	m.filteredModels = m.allModels

	modelItems := make([]ModelItem, len(m.filteredModels))
	for i, modelWithProvider := range m.filteredModels {
		modelItems[i] = ModelItem{
			ModelName:    modelWithProvider.Model.Name,
			ProviderName: modelWithProvider.Provider.Name,
		}
	}

	m.dialogWidth = m.calculateOptimalWidth(modelItems)

	m.modelList = list.NewListComponent(modelItems, numVisibleModels, "No models available", true)
	m.modelList.SetMaxWidth(m.dialogWidth)

	if len(m.filteredModels) > 0 {
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

func (m *modelDialog) createTextInput() textinput.Model {
	t := theme.CurrentTheme()
	bgColor := t.BackgroundElement()
	textColor := t.Text()
	textMutedColor := t.TextMuted()

	ti := textinput.New()

	ti.Styles.Blurred.Placeholder = styles.NewStyle().
		Foreground(textMutedColor).
		Background(bgColor).
		Lipgloss()
	ti.Styles.Blurred.Text = styles.NewStyle().Foreground(textColor).Background(bgColor).Lipgloss()
	ti.Styles.Focused.Placeholder = styles.NewStyle().
		Foreground(textMutedColor).
		Background(bgColor).
		Lipgloss()
	ti.Styles.Focused.Text = styles.NewStyle().Foreground(textColor).Background(bgColor).Lipgloss()
	ti.Styles.Cursor.Color = t.Primary()
	ti.VirtualCursor = true

	ti.Prompt = " "
	ti.CharLimit = -1
	ti.Placeholder = "Filter models..."

	return ti
}

func (m *modelDialog) filterModels(query string) {
	if query == "" {
		m.filteredModels = m.allModels
	} else {
		m.filteredModels = make([]ModelWithProvider, 0)
		lowerQuery := strings.ToLower(query)

		for _, model := range m.allModels {
			modelName := strings.ToLower(model.Model.Name)
			providerName := strings.ToLower(model.Provider.Name)

			if strings.Contains(modelName, lowerQuery) || strings.Contains(providerName, lowerQuery) {
				m.filteredModels = append(m.filteredModels, model)
			}
		}
	}

	// Update the list with filtered models
	modelItems := make([]ModelItem, len(m.filteredModels))
	for i, modelWithProvider := range m.filteredModels {
		modelItems[i] = ModelItem{
			ModelName:    modelWithProvider.Model.Name,
			ProviderName: modelWithProvider.Provider.Name,
		}
	}

	m.modelList.SetItems(modelItems)
	if len(m.filteredModels) > 0 {
		m.modelList.SetSelectedIndex(0)
	}
}

func NewModelDialog(app *app.App) ModelDialog {
	dialog := &modelDialog{
		app: app,
	}

	dialog.setupAllModels()
	dialog.filterInput = dialog.createTextInput()

	dialog.modal = modal.New(
		modal.WithTitle("Select Model"),
		modal.WithMaxWidth(dialog.dialogWidth+4),
	)

	return dialog
}
