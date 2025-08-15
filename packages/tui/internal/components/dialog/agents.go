package dialog

import (
	"sort"
	"strings"

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
	numVisibleAgents     = 10
	minAgentDialogWidth  = 40
	maxAgentDialogWidth  = 60
	maxDescriptionLength = 60
	maxRecentAgents      = 5
)

// AgentDialog interface for the agent selection dialog
type AgentDialog interface {
	layout.Modal
}

type agentDialog struct {
	app          *app.App
	allAgents    []agentSelectItem
	width        int
	height       int
	modal        *modal.Modal
	searchDialog *SearchDialog
	dialogWidth  int
}

// agentSelectItem combines the visual improvements with code patterns
type agentSelectItem struct {
	name        string
	displayName string
	description string
	mode        string // "primary", "subagent", "all"
	isCurrent   bool
	agentIndex  int
	agent       opencode.Agent // Keep original agent for compatibility
}

func (a agentSelectItem) Render(
	selected bool,
	width int,
	baseStyle styles.Style,
) string {
	t := theme.CurrentTheme()
	itemStyle := baseStyle.
		Background(t.BackgroundPanel()).
		Foreground(t.Text())

	if selected {
		// Use agent color for highlighting when selected (visual improvement)
		agentColor := util.GetAgentColor(a.agentIndex)
		itemStyle = itemStyle.Foreground(agentColor)
	}

	descStyle := baseStyle.
		Foreground(t.TextMuted()).
		Background(t.BackgroundPanel())

	// Calculate available width (accounting for padding and margins)
	availableWidth := width - 2 // Account for left padding

	agentName := a.displayName

	// Determine if agent is built-in or custom using the agent's builtIn field
	var displayText string
	if a.agent.BuiltIn {
		displayText = "(built-in)"
	} else {
		if a.description != "" {
			displayText = a.description
		} else {
			displayText = "(user)"
		}
	}

	separator := " - "

	// Calculate how much space we have for the description (visual improvement)
	nameAndSeparatorLength := len(agentName) + len(separator)
	descriptionMaxLength := availableWidth - nameAndSeparatorLength

	// Cap description length to the maximum allowed
	if descriptionMaxLength > maxDescriptionLength {
		descriptionMaxLength = maxDescriptionLength
	}

	// Truncate description if it's too long (visual improvement)
	if len(displayText) > descriptionMaxLength && descriptionMaxLength > 3 {
		displayText = displayText[:descriptionMaxLength-3] + "..."
	}

	namePart := itemStyle.Render(agentName)
	descPart := descStyle.Render(separator + displayText)
	combinedText := namePart + descPart

	return baseStyle.
		Background(t.BackgroundPanel()).
		PaddingLeft(1).
		Width(width).
		Render(combinedText)
}

func (a agentSelectItem) Selectable() bool {
	return true
}

type agentKeyMap struct {
	Enter  key.Binding
	Escape key.Binding
}

var agentKeys = agentKeyMap{
	Enter: key.NewBinding(
		key.WithKeys("enter"),
		key.WithHelp("enter", "select agent"),
	),
	Escape: key.NewBinding(
		key.WithKeys("esc"),
		key.WithHelp("esc", "close"),
	),
}

func (a *agentDialog) Init() tea.Cmd {
	a.setupAllAgents()
	return a.searchDialog.Init()
}

func (a *agentDialog) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		a.width = msg.Width
		a.height = msg.Height
		a.searchDialog.SetWidth(a.dialogWidth)
		a.searchDialog.SetHeight(msg.Height)

	case SearchSelectionMsg:
		// Handle selection from search dialog
		if item, ok := msg.Item.(agentSelectItem); ok {
			if !item.isCurrent {
				// Switch to selected agent (using their better pattern)
				return a, tea.Sequence(
					util.CmdHandler(modal.CloseModalMsg{}),
					util.CmdHandler(app.AgentSelectedMsg{AgentName: item.name}),
				)
			}
		}
		return a, util.CmdHandler(modal.CloseModalMsg{})
	case SearchCancelledMsg:
		return a, util.CmdHandler(modal.CloseModalMsg{})

	case SearchRemoveItemMsg:
		if item, ok := msg.Item.(agentSelectItem); ok {
			if a.isAgentInRecentSection(item, msg.Index) {
				a.app.State.RemoveAgentFromRecentlyUsed(item.name)
				items := a.buildDisplayList(a.searchDialog.GetQuery())
				a.searchDialog.SetItems(items)
				return a, a.app.SaveState()
			}
		}
		return a, nil

	case SearchQueryChangedMsg:
		// Update the list based on search query
		items := a.buildDisplayList(msg.Query)
		a.searchDialog.SetItems(items)
		return a, nil
	}

	updatedDialog, cmd := a.searchDialog.Update(msg)
	a.searchDialog = updatedDialog.(*SearchDialog)
	return a, cmd
}

func (a *agentDialog) SetSize(width, height int) {
	a.width = width
	a.height = height
}

func (a *agentDialog) View() string {
	return a.searchDialog.View()
}

func (a *agentDialog) calculateOptimalWidth(agents []agentSelectItem) int {
	maxWidth := minAgentDialogWidth

	for _, agent := range agents {
		// Calculate the width needed for this item: "AgentName - Description" (visual improvement)
		itemWidth := len(agent.displayName)

		if agent.agent.BuiltIn {
			itemWidth += len("(built-in)") + 3 // " - "
		} else {
			if agent.description != "" {
				descLength := len(agent.description)
				if descLength > maxDescriptionLength {
					descLength = maxDescriptionLength
				}
				itemWidth += descLength + 3 // " - "
			} else {
				itemWidth += len("(user)") + 3 // " - "
			}
		}

		if itemWidth > maxWidth {
			maxWidth = itemWidth
		}
	}

	maxWidth = min(maxWidth, maxAgentDialogWidth)
	return maxWidth
}

func (a *agentDialog) setupAllAgents() {
	currentAgentName := a.app.Agent().Name

	// Build agent items from app.Agents (no API call needed) - their pattern
	a.allAgents = make([]agentSelectItem, 0, len(a.app.Agents))
	for i, agent := range a.app.Agents {
		if agent.Mode == "subagent" {
			continue // Skip subagents entirely
		}
		isCurrent := agent.Name == currentAgentName

		// Create display name (capitalize first letter)
		displayName := strings.Title(agent.Name)

		a.allAgents = append(a.allAgents, agentSelectItem{
			name:        agent.Name,
			displayName: displayName,
			description: agent.Description, // Keep for search but don't use in display
			mode:        string(agent.Mode),
			isCurrent:   isCurrent,
			agentIndex:  i,
			agent:       agent, // Keep original for compatibility
		})
	}

	a.sortAgents()

	// Calculate optimal width based on all agents (visual improvement)
	a.dialogWidth = a.calculateOptimalWidth(a.allAgents)

	// Ensure minimum width to prevent textinput issues
	a.dialogWidth = max(a.dialogWidth, minAgentDialogWidth)

	a.searchDialog = NewSearchDialog("Search agents...", numVisibleAgents)
	a.searchDialog.SetWidth(a.dialogWidth)

	// Build initial display list (empty query shows grouped view)
	items := a.buildDisplayList("")
	a.searchDialog.SetItems(items)
}

func (a *agentDialog) sortAgents() {
	sort.Slice(a.allAgents, func(i, j int) bool {
		agentA := a.allAgents[i]
		agentB := a.allAgents[j]

		// Current agent goes first (your preference)
		if agentA.name == a.app.Agent().Name {
			return true
		}
		if agentB.name == a.app.Agent().Name {
			return false
		}

		// Alphabetical order for all other agents
		return agentA.name < agentB.name
	})
}

// buildDisplayList creates the list items based on search query
func (a *agentDialog) buildDisplayList(query string) []list.Item {
	if query != "" {
		// Search mode: use fuzzy matching
		return a.buildSearchResults(query)
	} else {
		// Grouped mode: show Recent agents section and alphabetical list (their pattern)
		return a.buildGroupedResults()
	}
}

// buildSearchResults creates a flat list of search results using fuzzy matching
func (a *agentDialog) buildSearchResults(query string) []list.Item {
	agentNames := []string{}
	agentMap := make(map[string]agentSelectItem)

	for _, agent := range a.allAgents {
		// Only include non-subagents in search
		if agent.mode == "subagent" {
			continue
		}
		searchStr := agent.name
		agentNames = append(agentNames, searchStr)
		agentMap[searchStr] = agent
	}

	matches := fuzzy.RankFindFold(query, agentNames)
	sort.Sort(matches)

	items := []list.Item{}
	seenAgents := make(map[string]bool)

	for _, match := range matches {
		agent := agentMap[match.Target]
		// Create a unique key to avoid duplicates
		key := agent.name
		if seenAgents[key] {
			continue
		}
		seenAgents[key] = true
		items = append(items, agent)
	}

	return items
}

// buildGroupedResults creates a grouped list with Recent agents section and categorized agents
func (a *agentDialog) buildGroupedResults() []list.Item {
	var items []list.Item

	// Add Recent section (their pattern)
	recentAgents := a.getRecentAgents(maxRecentAgents)
	if len(recentAgents) > 0 {
		items = append(items, list.HeaderItem("Recent"))
		for _, agent := range recentAgents {
			items = append(items, agent)
		}
	}

	// Create map of recent agent names for filtering
	recentAgentNames := make(map[string]bool)
	for _, recent := range recentAgents {
		recentAgentNames[recent.name] = true
	}

	// Only show non-subagents (primary/user) in the main section
	mainAgents := make([]agentSelectItem, 0)
	for _, agent := range a.allAgents {
		if !recentAgentNames[agent.name] {
			mainAgents = append(mainAgents, agent)
		}
	}

	// Sort main agents alphabetically
	sort.Slice(mainAgents, func(i, j int) bool {
		return mainAgents[i].name < mainAgents[j].name
	})

	// Add main agents section
	if len(mainAgents) > 0 {
		items = append(items, list.HeaderItem("Agents"))
		for _, agent := range mainAgents {
			items = append(items, agent)
		}
	}

	return items
}

func (a *agentDialog) Render(background string) string {
	return a.modal.Render(a.View(), background)
}

func (a *agentDialog) Close() tea.Cmd {
	return nil
}

// getRecentAgents returns the most recently used agents (their pattern)
func (a *agentDialog) getRecentAgents(limit int) []agentSelectItem {
	var recentAgents []agentSelectItem

	// Get recent agents from app state
	for _, usage := range a.app.State.RecentlyUsedAgents {
		if len(recentAgents) >= limit {
			break
		}

		// Find the corresponding agent
		for _, agent := range a.allAgents {
			if agent.name == usage.AgentName {
				recentAgents = append(recentAgents, agent)
				break
			}
		}
	}

	// If no recent agents, use the current agent
	if len(recentAgents) == 0 {
		currentAgentName := a.app.Agent().Name
		for _, agent := range a.allAgents {
			if agent.name == currentAgentName {
				recentAgents = append(recentAgents, agent)
				break
			}
		}
	}

	return recentAgents
}

func (a *agentDialog) isAgentInRecentSection(agent agentSelectItem, index int) bool {
	// Only check if we're in grouped mode (no search query)
	if a.searchDialog.GetQuery() != "" {
		return false
	}

	recentAgents := a.getRecentAgents(maxRecentAgents)
	if len(recentAgents) == 0 {
		return false
	}

	// Index 0 is the "Recent" header, so recent agents are at indices 1 to len(recentAgents)
	if index >= 1 && index <= len(recentAgents) {
		if index-1 < len(recentAgents) {
			recentAgent := recentAgents[index-1]
			return recentAgent.name == agent.name
		}
	}

	return false
}

func NewAgentDialog(app *app.App) AgentDialog {
	dialog := &agentDialog{
		app: app,
	}

	dialog.setupAllAgents()

	dialog.modal = modal.New(
		modal.WithTitle("Select Agent"),
		modal.WithMaxWidth(dialog.dialogWidth+4),
	)

	return dialog
}
