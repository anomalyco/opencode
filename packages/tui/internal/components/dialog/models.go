package dialog

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/charmbracelet/bubbles/v2/key"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/lithammer/fuzzysearch/fuzzy"
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
	maxRecentModels  = 5
)

// ModelDialog interface for the model selection dialog
type ModelDialog interface {
	layout.Modal
}

type modelDialog struct {
	app          *app.App
	allModels    []ModelWithProvider
	width        int
	height       int
	modal        *modal.Modal
	searchDialog *SearchDialog
	dialogWidth  int
}

type ModelWithProvider struct {
	Model    opencode.Model
	Provider opencode.Provider
}

// modelItem is a custom list item for model selections
type modelItem struct {
	model ModelWithProvider
}

func (m modelItem) Render(
	selected bool,
	width int,
	baseStyle styles.Style,
) string {
	t := theme.CurrentTheme()

	itemStyle := baseStyle.
		Background(t.BackgroundPanel()).
		Foreground(t.Text())

	if selected {
		itemStyle = itemStyle.Foreground(t.Primary())
	}

	providerStyle := baseStyle.
		Foreground(t.TextMuted()).
		Background(t.BackgroundPanel())

	modelPart := itemStyle.Render(m.model.Model.Name)
	providerPart := providerStyle.Render(fmt.Sprintf(" %s", m.model.Provider.Name))

	combinedText := modelPart + providerPart
	return baseStyle.
		Background(t.BackgroundPanel()).
		PaddingLeft(1).
		Render(combinedText)
}

func (m modelItem) Selectable() bool {
	return true
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
	return m.searchDialog.Init()
}

func (m *modelDialog) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case SearchSelectionMsg:
		// Handle selection from search dialog
		if item, ok := msg.Item.(modelItem); ok {
			return m, tea.Sequence(
				util.CmdHandler(modal.CloseModalMsg{}),
				util.CmdHandler(
					app.ModelSelectedMsg{
						Provider: item.model.Provider,
						Model:    item.model.Model,
					}),
			)
		}
		return m, util.CmdHandler(modal.CloseModalMsg{})
	case SearchCancelledMsg:
		return m, util.CmdHandler(modal.CloseModalMsg{})

	case SearchRemoveItemMsg:
		if item, ok := msg.Item.(modelItem); ok {
			if m.isModelInRecentSection(item.model, msg.Index) {
				m.app.State.RemoveModelFromRecentlyUsed(item.model.Provider.ID, item.model.Model.ID)
				items := m.buildDisplayList(m.searchDialog.GetQuery())
				m.searchDialog.SetItems(items)
				return m, m.app.SaveState()
			}
		}
		return m, nil

	case SearchQueryChangedMsg:
		// Update the list based on search query
		items := m.buildDisplayList(msg.Query)
		m.searchDialog.SetItems(items)
		return m, nil

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.searchDialog.SetWidth(m.dialogWidth)
		m.searchDialog.SetHeight(msg.Height)
	}

	updatedDialog, cmd := m.searchDialog.Update(msg)
	m.searchDialog = updatedDialog.(*SearchDialog)
	return m, cmd
}

func (m *modelDialog) View() string {
	return m.searchDialog.View()
}

func (m *modelDialog) calculateOptimalWidth(models []ModelWithProvider) int {
	maxWidth := minDialogWidth

	for _, model := range models {
		// Calculate the width needed for this item: "ModelName (ProviderName)"
		// Add 4 for the parentheses, space, and some padding
		itemWidth := len(model.Model.Name) + len(model.Provider.Name) + 4
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

	// Calculate optimal width based on all models
	m.dialogWidth = m.calculateOptimalWidth(m.allModels)

	// Initialize search dialog
	m.searchDialog = NewSearchDialog("Search models...", numVisibleModels)
	m.searchDialog.SetWidth(m.dialogWidth)

	// Build initial display list (empty query shows grouped view)
	items := m.buildDisplayList("")
	m.searchDialog.SetItems(items)
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

// buildDisplayList creates the list items based on search query
func (m *modelDialog) buildDisplayList(query string) []list.Item {
	if query != "" {
		// Search mode: use fuzzy matching
		return m.buildSearchResults(query)
	} else {
		// Grouped mode: show Recent section and provider groups
		return m.buildGroupedResults()
	}
}

// buildSearchResults creates a flat list of search results using fuzzy matching
func (m *modelDialog) buildSearchResults(query string) []list.Item {
	type modelMatch struct {
		model ModelWithProvider
		score int
	}

	modelNames := []string{}
	modelMap := make(map[string]ModelWithProvider)

	// Create search strings and perform fuzzy matching
	for _, model := range m.allModels {
		searchStr := fmt.Sprintf("%s %s", model.Model.Name, model.Provider.Name)
		modelNames = append(modelNames, searchStr)
		modelMap[searchStr] = model

		searchStr = fmt.Sprintf("%s %s", model.Provider.Name, model.Model.Name)
		modelNames = append(modelNames, searchStr)
		modelMap[searchStr] = model
	}

	matches := fuzzy.RankFindFold(query, modelNames)
	sort.Sort(matches)

	items := []list.Item{}
	seenModels := make(map[string]bool)

	for _, match := range matches {
		model := modelMap[match.Target]
		// Create a unique key to avoid duplicates
		// Include name to handle custom models with same ID but different names
		key := fmt.Sprintf("%s:%s:%s", model.Provider.ID, model.Model.ID, model.Model.Name)
		if seenModels[key] {
			continue
		}
		seenModels[key] = true
		items = append(items, modelItem{model: model})
	}

	return items
}

// buildGroupedResults creates a grouped list with Recent section and provider groups
func (m *modelDialog) buildGroupedResults() []list.Item {
	var items []list.Item

	// Add Recent section
	recentModels := m.getRecentModels(maxRecentModels)
	if len(recentModels) > 0 {
		items = append(items, list.HeaderItem("Recent"))
		for _, model := range recentModels {
			items = append(items, modelItem{model: model})
		}
	}

	// Group models by provider
	providerGroups := make(map[string][]ModelWithProvider)
	for _, model := range m.allModels {
		providerName := model.Provider.Name
		providerGroups[providerName] = append(providerGroups[providerName], model)
	}

	// Get sorted provider names for consistent order
	var providerNames []string
	for name := range providerGroups {
		providerNames = append(providerNames, name)
	}
	sort.Strings(providerNames)

	// Add provider groups
	for _, providerName := range providerNames {
		models := providerGroups[providerName]

		// Sort models within provider group
		sort.Slice(models, func(i, j int) bool {
			modelA := models[i]
			modelB := models[j]

			usageA := m.getModelUsageTime(modelA.Provider.ID, modelA.Model.ID)
			usageB := m.getModelUsageTime(modelB.Provider.ID, modelB.Model.ID)

			// Sort by usage time first, then by release date, then alphabetically
			if !usageA.IsZero() && !usageB.IsZero() {
				return usageA.After(usageB)
			}
			if !usageA.IsZero() && usageB.IsZero() {
				return true
			}
			if usageA.IsZero() && !usageB.IsZero() {
				return false
			}

			// Sort by release date if available
			if modelA.Model.ReleaseDate != "" && modelB.Model.ReleaseDate != "" {
				dateA := m.parseReleaseDate(modelA.Model.ReleaseDate)
				dateB := m.parseReleaseDate(modelB.Model.ReleaseDate)
				if !dateA.IsZero() && !dateB.IsZero() {
					return dateA.After(dateB)
				}
			}

			return modelA.Model.Name < modelB.Model.Name
		})

		// Add provider header
		items = append(items, list.HeaderItem(providerName))

		// Add models in this provider group
		for _, model := range models {
			items = append(items, modelItem{model: model})
		}
	}

	return items
}

// getRecentModels returns the most recently used models
func (m *modelDialog) getRecentModels(limit int) []ModelWithProvider {
	var recentModels []ModelWithProvider

	// Get recent models from app state
	for _, usage := range m.app.State.RecentlyUsedModels {
		if len(recentModels) >= limit {
			break
		}

		// Find the corresponding model
		for _, model := range m.allModels {
			if model.Provider.ID == usage.ProviderID && model.Model.ID == usage.ModelID {
				recentModels = append(recentModels, model)
				break
			}
		}
	}

	return recentModels
}

func (m *modelDialog) isModelInRecentSection(model ModelWithProvider, index int) bool {
	// Only check if we're in grouped mode (no search query)
	if m.searchDialog.GetQuery() != "" {
		return false
	}

	recentModels := m.getRecentModels(maxRecentModels)
	if len(recentModels) == 0 {
		return false
	}

	// Index 0 is the "Recent" header, so recent models are at indices 1 to len(recentModels)
	if index >= 1 && index <= len(recentModels) {
		if index-1 < len(recentModels) {
			recentModel := recentModels[index-1]
			return recentModel.Provider.ID == model.Provider.ID &&
				recentModel.Model.ID == model.Model.ID
		}
	}

	return false
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
