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
	"github.com/sst/opencode/internal/components/modal"
	"github.com/sst/opencode/internal/layout"

	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
	"github.com/sst/opencode/pkg/client"
)

const (
	numVisibleModels = 10
	paneWidth        = 40
	totalDialogWidth = paneWidth*2 + 3 // 2 panes + divider
)

type ActivePane int

const (
	MainModelPane ActivePane = iota
	LightweightModelPane
)

type SortMode int

const (
	SortByName SortMode = iota
	SortByLastUpdated
	SortByReleaseDate
)

// ModelDialog interface for the model selection dialog
type ModelDialog interface {
	layout.Modal
}

type modelDialog struct {
	app                *app.App
	availableProviders []client.ProviderInfo

	// Main model selection
	mainProvider     client.ProviderInfo
	mainSelectedIdx  int
	mainScrollOffset int

	// Lightweight model selection
	lightProvider     client.ProviderInfo
	lightSelectedIdx  int
	lightScrollOffset int

	// UI state
	activePane      ActivePane
	sortMode        SortMode
	width           int
	height          int
	hScrollOffset   int
	hScrollPossible bool

	modal *modal.Modal
}

type modelKeyMap struct {
	Up     key.Binding
	Down   key.Binding
	Left   key.Binding
	Right  key.Binding
	Tab    key.Binding
	Sort   key.Binding
	Enter  key.Binding
	Escape key.Binding
}

var modelKeys = modelKeyMap{
	Up: key.NewBinding(
		key.WithKeys("up", "k"),
		key.WithHelp("↑", "previous model"),
	),
	Down: key.NewBinding(
		key.WithKeys("down", "j"),
		key.WithHelp("↓", "next model"),
	),
	Left: key.NewBinding(
		key.WithKeys("left", "h"),
		key.WithHelp("←", "previous provider"),
	),
	Right: key.NewBinding(
		key.WithKeys("right", "l"),
		key.WithHelp("→", "next provider"),
	),
	Tab: key.NewBinding(
		key.WithKeys("tab"),
		key.WithHelp("tab", "switch pane"),
	),
	Sort: key.NewBinding(
		key.WithKeys("s"),
		key.WithHelp("s", "change sort mode"),
	),
	Enter: key.NewBinding(
		key.WithKeys("enter"),
		key.WithHelp("enter", "save selection"),
	),
	Escape: key.NewBinding(
		key.WithKeys("esc"),
		key.WithHelp("esc", "close"),
	),
}

func (m *modelDialog) Init() tea.Cmd {
	if len(m.availableProviders) == 0 {
		return nil
	}

	if m.app.MainProvider != nil {
		m.mainProvider = *m.app.MainProvider
		models := m.getModelsForProvider(m.mainProvider)
		for i, model := range models {
			if m.app.MainModel != nil && model.Id == m.app.MainModel.Id {
				m.mainSelectedIdx = i
				break
			}
		}
	} else {
		m.mainProvider = m.availableProviders[0]
	}

	m.lightProvider = m.mainProvider

	if m.app.LightProvider != nil && m.app.LightModel != nil {
		m.lightProvider = *m.app.LightProvider

		models := m.getModelsForProvider(m.lightProvider)
		for i, model := range models {
			if model.Id == m.app.LightModel.Id {
				m.lightSelectedIdx = i
				break
			}
		}
	} else {
		models := m.getModelsForProvider(m.lightProvider)
		for i, model := range models {
			if isLightweightModel(model) {
				m.lightSelectedIdx = i
				break
			}
		}
	}

	return nil
}

func (m *modelDialog) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch {
		case key.Matches(msg, modelKeys.Up):
			m.moveSelectionUp()
		case key.Matches(msg, modelKeys.Down):
			m.moveSelectionDown()
		case key.Matches(msg, modelKeys.Left):
			if m.hScrollPossible {
				m.switchProvider(-1)
			}
		case key.Matches(msg, modelKeys.Right):
			if m.hScrollPossible {
				m.switchProvider(1)
			}
		case key.Matches(msg, modelKeys.Tab):
			m.switchPane()
		case key.Matches(msg, modelKeys.Sort):
			m.cycleSortMode()
		case key.Matches(msg, modelKeys.Enter):
			mainModels := m.getModelsForProvider(m.mainProvider)
			lightModels := m.getModelsForProvider(m.lightProvider)

			return m, tea.Sequence(
				util.CmdHandler(modal.CloseModalMsg{}),
				util.CmdHandler(
					app.ModelSelectedMsg{
						MainProvider:        m.mainProvider,
						MainModel:           mainModels[m.mainSelectedIdx],
						LightweightProvider: m.lightProvider,
						LightweightModel:    lightModels[m.lightSelectedIdx],
					}),
			)
		case key.Matches(msg, modelKeys.Escape):
			return m, util.CmdHandler(modal.CloseModalMsg{})
		}
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
	}

	return m, nil
}

func (m *modelDialog) getModelsForProvider(provider client.ProviderInfo) []client.ModelInfo {
	models := slices.Collect(maps.Values(provider.Models))
	
	switch m.sortMode {
	case SortByLastUpdated:
		slices.SortFunc(models, func(a, b client.ModelInfo) int {
			// Sort by last_updated date (newest first)
			aDate := m.getModelDate(a, true)
			bDate := m.getModelDate(b, true)
			
			// Models without dates go to the end
			if aDate == "" && bDate == "" {
				if cmp := strings.Compare(a.Name, b.Name); cmp != 0 {
					return cmp
				}
				return strings.Compare(a.Id, b.Id)
			}
			if aDate == "" {
				return 1
			}
			if bDate == "" {
				return -1
			}
			
			// Compare dates (reverse for newest first)
			if cmp := strings.Compare(bDate, aDate); cmp != 0 {
				return cmp
			}
			
			// If dates are equal, use name as stable tiebreaker
			if cmp := strings.Compare(a.Name, b.Name); cmp != 0 {
				return cmp
			}
			// Final tiebreaker: use ID for absolute stability
			return strings.Compare(a.Id, b.Id)
		})
	case SortByReleaseDate:
		slices.SortFunc(models, func(a, b client.ModelInfo) int {
			// Sort by release_date (newest first)
			aDate := m.getModelDate(a, false)
			bDate := m.getModelDate(b, false)
			
			// Models without dates go to the end
			if aDate == "" && bDate == "" {
				if cmp := strings.Compare(a.Name, b.Name); cmp != 0 {
					return cmp
				}
				return strings.Compare(a.Id, b.Id)
			}
			if aDate == "" {
				return 1
			}
			if bDate == "" {
				return -1
			}
			
			// Compare dates (reverse for newest first)
			if cmp := strings.Compare(bDate, aDate); cmp != 0 {
				return cmp
			}
			
			// If dates are equal, use name as stable tiebreaker
			if cmp := strings.Compare(a.Name, b.Name); cmp != 0 {
				return cmp
			}
			// Final tiebreaker: use ID for absolute stability
			return strings.Compare(a.Id, b.Id)
		})
	default: // SortByName
		slices.SortFunc(models, func(a, b client.ModelInfo) int {
			return strings.Compare(a.Name, b.Name)
		})
	}
	
	return models
}

func (m *modelDialog) moveSelectionUp() {
	if m.activePane == MainModelPane {
		if m.mainSelectedIdx > 0 {
			m.mainSelectedIdx--
		} else {
			m.mainSelectedIdx = len(m.mainProvider.Models) - 1
			m.mainScrollOffset = max(0, len(m.mainProvider.Models)-numVisibleModels)
		}

		if m.mainSelectedIdx < m.mainScrollOffset {
			m.mainScrollOffset = m.mainSelectedIdx
		}
	} else {
		if m.lightSelectedIdx > 0 {
			m.lightSelectedIdx--
		} else {
			m.lightSelectedIdx = len(m.lightProvider.Models) - 1
			m.lightScrollOffset = max(0, len(m.lightProvider.Models)-numVisibleModels)
		}

		if m.lightSelectedIdx < m.lightScrollOffset {
			m.lightScrollOffset = m.lightSelectedIdx
		}
	}
}

func (m *modelDialog) moveSelectionDown() {
	if m.activePane == MainModelPane {
		if m.mainSelectedIdx < len(m.mainProvider.Models)-1 {
			m.mainSelectedIdx++
		} else {
			m.mainSelectedIdx = 0
			m.mainScrollOffset = 0
		}

		if m.mainSelectedIdx >= m.mainScrollOffset+numVisibleModels {
			m.mainScrollOffset = m.mainSelectedIdx - (numVisibleModels - 1)
		}
	} else {
		if m.lightSelectedIdx < len(m.lightProvider.Models)-1 {
			m.lightSelectedIdx++
		} else {
			m.lightSelectedIdx = 0
			m.lightScrollOffset = 0
		}

		if m.lightSelectedIdx >= m.lightScrollOffset+numVisibleModels {
			m.lightScrollOffset = m.lightSelectedIdx - (numVisibleModels - 1)
		}
	}
}

func (m *modelDialog) switchProvider(offset int) {
	providerIdx := 0
	for i, p := range m.availableProviders {
		if m.activePane == MainModelPane && p.Id == m.mainProvider.Id {
			providerIdx = i
			break
		} else if m.activePane == LightweightModelPane && p.Id == m.lightProvider.Id {
			providerIdx = i
			break
		}
	}

	newIdx := providerIdx + offset
	if newIdx < 0 {
		newIdx = len(m.availableProviders) - 1
	}
	if newIdx >= len(m.availableProviders) {
		newIdx = 0
	}

	if m.activePane == MainModelPane {
		m.mainProvider = m.availableProviders[newIdx]
		m.mainSelectedIdx = 0
		m.mainScrollOffset = 0
		// Update modal title like the original when switching main provider
		m.updateModalTitle()
	} else {
		m.lightProvider = m.availableProviders[newIdx]
		m.lightSelectedIdx = 0
		m.lightScrollOffset = 0
	}
}

func (m *modelDialog) switchPane() {
	if m.activePane == MainModelPane {
		m.activePane = LightweightModelPane
	} else {
		m.activePane = MainModelPane
	}
}

func (m *modelDialog) cycleSortMode() {
	m.sortMode = (m.sortMode + 1) % 3
	// Reset scroll positions when changing sort mode
	m.mainSelectedIdx = 0
	m.mainScrollOffset = 0
	m.lightSelectedIdx = 0
	m.lightScrollOffset = 0
	// Update title to show new sort mode
	m.updateModalTitle()
}

func (m *modelDialog) getModelDate(model client.ModelInfo, useLastUpdated bool) string {
	if useLastUpdated && model.LastUpdated != nil {
		return *model.LastUpdated
	}
	if model.ReleaseDate != nil {
		return *model.ReleaseDate
	}
	return ""
}

func (m *modelDialog) getSortModeString() string {
	switch m.sortMode {
	case SortByLastUpdated:
		return "Last Updated"
	case SortByReleaseDate:
		return "Release Date"
	default:
		return "Name"
	}
}

func (m *modelDialog) updateModalTitle() {
	title := fmt.Sprintf("Select Models - %s (Sort: %s)", m.mainProvider.Name, m.getSortModeString())
	m.modal.SetTitle(title)
}

func (m *modelDialog) View() string {
	t := theme.CurrentTheme()

	if len(m.availableProviders) == 0 {
		emptyStyle := lipgloss.NewStyle().
			Background(t.BackgroundElement()).
			Foreground(t.TextMuted()).
			Padding(2, 4).
			Align(lipgloss.Center)
		return emptyStyle.Render("No providers configured. Please configure at least one provider.")
	}

	baseStyle := lipgloss.NewStyle().
		Background(t.BackgroundElement()).
		Foreground(t.Text())

	mainPane := m.renderPane(
		"Main Model",
		m.mainProvider,
		m.mainSelectedIdx,
		m.mainScrollOffset,
		m.activePane == MainModelPane,
		baseStyle,
	)

	lightPane := m.renderPane(
		"Lightweight Model",
		m.lightProvider,
		m.lightSelectedIdx,
		m.lightScrollOffset,
		m.activePane == LightweightModelPane,
		baseStyle,
	)

	dividerHeight := 1 + numVisibleModels + 1 // 1 header + models + 1 scroll line
	dividerLines := make([]string, dividerHeight)
	for i := range dividerLines {
		dividerLines[i] = "│"
	}
	divider := lipgloss.NewStyle().
		Background(t.BackgroundElement()).
		Foreground(t.TextMuted()).
		Render(strings.Join(dividerLines, "\n"))

	content := lipgloss.JoinHorizontal(
		lipgloss.Top,
		mainPane,
		divider,
		lightPane,
	)

	content = baseStyle.
		Width(totalDialogWidth).
		Height(dividerHeight).
		Render(content)

	scrollIndicator := m.getScrollIndicators(totalDialogWidth)

	if scrollIndicator != "" {
		return baseStyle.
			Width(totalDialogWidth).
			Render(lipgloss.JoinVertical(
				lipgloss.Left,
				content,
				scrollIndicator,
			))
	}

	return content
}

func (m *modelDialog) renderPane(title string, provider client.ProviderInfo, selectedIdx, scrollOffset int, isActive bool, baseStyle lipgloss.Style) string {
	t := theme.CurrentTheme()

	headerText := fmt.Sprintf("%s (%s)", title, provider.Name)
	headerStyle := lipgloss.NewStyle().
		Width(paneWidth).
		Align(lipgloss.Center).
		Bold(true).
		Background(t.BackgroundElement())

	if isActive {
		headerStyle = headerStyle.Foreground(t.Primary())
	} else {
		headerStyle = headerStyle.Foreground(t.TextMuted())
	}

	headerRendered := headerStyle.Render(headerText)

	models := m.getModelsForProvider(provider)
	endIdx := min(scrollOffset+numVisibleModels, len(models))
	modelItems := make([]string, 0, endIdx-scrollOffset)

	for i := scrollOffset; i < endIdx; i++ {
		model := models[i]
		isLightweight := isLightweightModel(model)

		modelName := model.Name
		if isLightweight {
			modelName = fmt.Sprintf("⚡ %s", modelName)
		}

		itemStyle := baseStyle.Width(paneWidth)
		if i == selectedIdx {
			if isActive {
				itemStyle = itemStyle.
					Background(t.Primary()).
					Foreground(t.BackgroundElement()).
					Bold(true)
			} else {
				itemStyle = itemStyle.
					Background(t.BackgroundElement()).
					Foreground(t.Accent()).
					Bold(true)
			}
		}

		modelItems = append(modelItems, itemStyle.Render(modelName))
	}

	for len(modelItems) < numVisibleModels {
		modelItems = append(modelItems, baseStyle.Width(paneWidth).Render(" "))
	}

	modelList := lipgloss.JoinVertical(lipgloss.Left, modelItems...)

	scrollIndicatorContent := ""
	if len(models) > numVisibleModels {
		if scrollOffset > 0 {
			scrollIndicatorContent = "↑"
		}
		if scrollOffset+numVisibleModels < len(models) {
			if scrollIndicatorContent != "" {
				scrollIndicatorContent += " "
			}
			scrollIndicatorContent += "↓"
		}
	}

	var scrollIndicator string
	if scrollIndicatorContent != "" {
		scrollIndicator = lipgloss.NewStyle().
			Background(t.BackgroundElement()).
			Foreground(t.Primary()).
			Width(paneWidth).
			Align(lipgloss.Right).
			Bold(true).
			Render(scrollIndicatorContent)
	} else {
		scrollIndicator = baseStyle.Width(paneWidth).Render(" ")
	}

	return lipgloss.JoinVertical(
		lipgloss.Left,
		headerRendered,
		modelList,
		scrollIndicator,
	)
}

func (m *modelDialog) getScrollIndicators(maxWidth int) string {
	var indicator string

	mainModels := len(m.mainProvider.Models)
	if mainModels > numVisibleModels {
		if m.mainScrollOffset > 0 {
			indicator += "↑ "
		}
		if m.mainScrollOffset+numVisibleModels < mainModels {
			indicator += "↓ "
		}
	}

	if m.hScrollPossible {
		indicator = "← " + indicator + "→"
	}

	if indicator != "" {
		indicator += " • [Tab] Switch pane • [S] Sort"
	} else {
		indicator = "[S] Sort"
	}

	if indicator == "" {
		t := theme.CurrentTheme()
		return lipgloss.NewStyle().
			Background(t.BackgroundElement()).
			Width(maxWidth).
			Render(" ")
	}

	t := theme.CurrentTheme()
	return lipgloss.NewStyle().
		Background(t.BackgroundElement()).
		Foreground(t.Primary()).
		Width(maxWidth).
		Align(lipgloss.Right).
		Bold(true).
		Render(indicator)
}

func isLightweightModel(model client.ModelInfo) bool {
	return model.Cost.Output <= 4 && model.Cost.Output != 0
}

func (m *modelDialog) Render(background string) string {
	return m.modal.Render(m.View(), background)
}

func (m *modelDialog) Close() tea.Cmd {
	return nil
}

func NewModelDialog(app *app.App) ModelDialog {
	availableProviders, _ := app.ListProviders(context.Background())

	if len(availableProviders) == 0 {
		return &modelDialog{
			app:                app,
			availableProviders: availableProviders,
			hScrollOffset:      0,
			hScrollPossible:    false,
			modal:              modal.New(modal.WithTitle("Select Models - No Providers Available")),
		}
	}

	dialog := &modelDialog{
		app:                app,
		availableProviders: availableProviders,
		hScrollOffset:      0,
		hScrollPossible:    len(availableProviders) > 1,
		mainProvider:       availableProviders[0],
		lightProvider:      availableProviders[0],
		sortMode:           SortByName,
		modal:              modal.New(modal.WithTitle("Select Models")),
	}

	dialog.Init()
	dialog.updateModalTitle()

	return dialog
}
