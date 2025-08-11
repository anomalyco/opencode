package dialog

import (
	"fmt"
	"sort"

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
	minAgentDialogWidth  = 54
	maxAgentDialogWidth  = 108
	maxDescriptionLength = 80
)

// AgentDialog interface for the agent selection dialog
type AgentDialog interface {
	layout.Modal
}

type agentDialog struct {
	app          *app.App
	allAgents    []opencode.Agent
	width        int
	height       int
	modal        *modal.Modal
	searchDialog *SearchDialog
	dialogWidth  int
}

// agentItem is a custom list item for agent selections
type agentItem struct {
	agent opencode.Agent
}

func (a agentItem) Render(
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

	descStyle := baseStyle.
		Foreground(t.TextMuted()).
		Background(t.BackgroundPanel())

	// Calculate available width (accounting for padding and margins)
	availableWidth := width - 2 // Account for left padding

	agentName := a.agent.Name
	description := a.agent.Description
	if description == "" {
		description = fmt.Sprintf("(%s)", a.agent.Mode)
	}

	separator := " - "

	// Calculate how much space we have for the description
	nameAndSeparatorLength := len(agentName) + len(separator)
	descriptionMaxLength := availableWidth - nameAndSeparatorLength

	// Truncate description if it's too long
	if len(description) > descriptionMaxLength && descriptionMaxLength > 3 {
		description = description[:descriptionMaxLength-3] + "..."
	}

	namePart := itemStyle.Render(agentName)
	descPart := descStyle.Render(separator + description)
	combinedText := namePart + descPart

	return baseStyle.
		Background(t.BackgroundPanel()).
		PaddingLeft(1).
		Width(width).
		Render(combinedText)
}

func (a agentItem) Selectable() bool {
	// All agents in the dialog are selectable (subagents are filtered out)
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
	case SearchSelectionMsg:
		// Handle selection from search dialog
		if item, ok := msg.Item.(agentItem); ok {
			return a, tea.Sequence(
				util.CmdHandler(modal.CloseModalMsg{}),
				util.CmdHandler(
					app.AgentSelectedMsg{
						Agent: item.agent,
					}),
			)
		}
		return a, util.CmdHandler(modal.CloseModalMsg{})
	case SearchCancelledMsg:
		return a, util.CmdHandler(modal.CloseModalMsg{})

	case SearchQueryChangedMsg:
		// Update the list based on search query
		items := a.buildDisplayList(msg.Query)
		a.searchDialog.SetItems(items)
		return a, nil

	case tea.WindowSizeMsg:
		a.width = msg.Width
		a.height = msg.Height
		a.searchDialog.SetWidth(a.dialogWidth)
		a.searchDialog.SetHeight(msg.Height)
	}

	updatedDialog, cmd := a.searchDialog.Update(msg)
	a.searchDialog = updatedDialog.(*SearchDialog)
	return a, cmd
}

func (a *agentDialog) View() string {
	return a.searchDialog.View()
}

func (a *agentDialog) calculateOptimalWidth(agents []opencode.Agent) int {
	maxWidth := minAgentDialogWidth

	for _, agent := range agents {
		// Calculate the width needed for this item: "AgentName - Description"
		itemWidth := len(agent.Name)
		if agent.Description != "" {
			itemWidth += len(agent.Description) + 3 // " - "
		} else {
			itemWidth += len(string(agent.Mode)) + 3 // " (mode)"
		}

		if itemWidth > maxWidth {
			maxWidth = itemWidth
		}
	}

	maxWidth = min(maxWidth, maxAgentDialogWidth)

	return maxWidth
}

func (a *agentDialog) setupAllAgents() {
	// Get agents from the app, filtering out subagents
	a.allAgents = []opencode.Agent{}
	for _, agent := range a.app.Agents {
		if agent.Mode != "subagent" {
			a.allAgents = append(a.allAgents, agent)
		}
	}

	a.sortAgents()

	// Calculate optimal width based on all agents
	a.dialogWidth = a.calculateOptimalWidth(a.allAgents)

	// Ensure minimum width to prevent textinput issues
	a.dialogWidth = max(a.dialogWidth, minAgentDialogWidth)

	a.searchDialog = NewSearchDialog("Search agents...", numVisibleAgents)
	a.searchDialog.SetWidth(a.dialogWidth)

	items := a.buildDisplayList("")
	a.searchDialog.SetItems(items)
}

func (a *agentDialog) sortAgents() {
	sort.Slice(a.allAgents, func(i, j int) bool {
		agentA := a.allAgents[i]
		agentB := a.allAgents[j]

		// Current agent goes first
		if agentA.Name == a.app.Agent().Name {
			return true
		}
		if agentB.Name == a.app.Agent().Name {
			return false
		}

		// Alphabetical order for all other agents
		return agentA.Name < agentB.Name
	})
}

func (a *agentDialog) buildDisplayList(query string) []list.Item {
	if query != "" {
		return a.buildSearchResults(query)
	}
	return a.buildGroupedResults()
}

func (a *agentDialog) buildSearchResults(query string) []list.Item {
	agentNames := []string{}
	agentMap := make(map[string]opencode.Agent)

	for _, agent := range a.allAgents {
		// Search by name
		searchStr := agent.Name
		agentNames = append(agentNames, searchStr)
		agentMap[searchStr] = agent

		// Search by description if available
		if agent.Description != "" {
			searchStr = fmt.Sprintf("%s %s", agent.Name, agent.Description)
			agentNames = append(agentNames, searchStr)
			agentMap[searchStr] = agent
		}
	}

	matches := fuzzy.RankFindFold(query, agentNames)
	sort.Sort(matches)

	items := []list.Item{}
	seenAgents := make(map[string]bool)

	for _, match := range matches {
		agent := agentMap[match.Target]
		// Create a unique key to avoid duplicates
		key := agent.Name
		if seenAgents[key] {
			continue
		}
		seenAgents[key] = true
		items = append(items, agentItem{agent: agent})
	}

	return items
}

func (a *agentDialog) buildGroupedResults() []list.Item {
	var items []list.Item

	items = append(items, list.HeaderItem("Agents"))

	// Add all agents (subagents are already filtered out)
	for _, agent := range a.allAgents {
		items = append(items, agentItem{agent: agent})
	}

	return items
}

func (a *agentDialog) Render(background string) string {
	return a.modal.Render(a.View(), background)
}

func (s *agentDialog) Close() tea.Cmd {
	return nil
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
