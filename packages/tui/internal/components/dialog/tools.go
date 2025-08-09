package dialog

import (
	"context"
	"fmt"
	"log/slog"
	"sort"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/lithammer/fuzzysearch/fuzzy"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/components/list"
	"github.com/sst/opencode/internal/components/modal"
	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
)

const (
	numVisibleTools    = 10
	minToolDialogWidth = 40
	maxToolDialogWidth = 80
)

// ToolsDialog interface (parity with other dialogs)
type ToolsDialog interface{ layout.Modal }

type toolsDialog struct {
	app          *app.App
	allTools     []toolItem
	modal        *modal.Modal
	searchDialog *SearchDialog
	dialogWidth  int
	width        int
	height       int
}

type toolItem struct {
	name           string
	displayName    string
	enabled        bool
	source         string // "builtin" or "mcp"
	overridden     bool   // differs from default (agent default + global default)
	defaultEnabled bool   // cached default enabled value from API
}

func (t toolItem) Render(selected bool, width int, baseStyle styles.Style) string {
	theme := theme.CurrentTheme()

	itemStyle := baseStyle.
		Background(theme.BackgroundPanel()).
		Foreground(theme.Text())

	if selected {
		itemStyle = itemStyle.Foreground(theme.Primary())
	} else if t.overridden { // non-selected overridden items get warning color
		itemStyle = itemStyle.Foreground(theme.Warning())
	}

	// Show toggle state
	toggleIndicator := "[ ]"
	if t.enabled {
		toggleIndicator = "[✓]"
	}

	text := fmt.Sprintf("%s %s", toggleIndicator, t.displayName)
	return itemStyle.
		PaddingLeft(1).
		Render(text)
}

func (t toolItem) Selectable() bool {
	return true
}

type cancelToolsMsg struct{}

func (d *toolsDialog) Init() tea.Cmd {
	d.setupAllTools()
	return d.searchDialog.Init()
}

func (d *toolsDialog) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case SearchSelectionMsg:
		// Toggle selection without closing modal (single pass recompute)
		if t, ok := msg.Item.(toolItem); ok {
			agent := d.app.Agent()
			overrides := make(map[string]bool)
			selectedName := t.name
			for i := range d.allTools {
				if d.allTools[i].name == selectedName {
					d.allTools[i].enabled = !d.allTools[i].enabled
				}
				base := d.allTools[i].defaultEnabled
				if agentSetting, ok := agent.Tools[d.allTools[i].name]; ok {
					base = agentSetting
				}
				d.allTools[i].overridden = d.allTools[i].enabled != base
				if d.allTools[i].overridden {
					overrides[d.allTools[i].name] = d.allTools[i].enabled
				}
			}
			// rebuild visual list preserving selection by name
			curQuery := d.searchDialog.GetQuery()
			items := d.buildItems(curQuery)
			d.searchDialog.SetItems(items)
			for i, it := range d.searchDialog.list.GetItems() {
				if ti, ok := it.(toolItem); ok && ti.name == selectedName {
					d.searchDialog.list.SetSelectedIndex(i)
					break
				}
			}
			return d, util.CmdHandler(app.ToolsUpdatedMsg{Agent: agent.Name, Overrides: overrides})
		}
		return d, nil
	case SearchCancelledMsg:
		return d, util.CmdHandler(modal.CloseModalMsg{})

	case SearchQueryChangedMsg:
		// Update the list based on search query
		items := d.buildItems(msg.Query)
		d.searchDialog.SetItems(items)
		return d, nil

	case tea.WindowSizeMsg:
		d.width = msg.Width
		d.height = msg.Height
		d.searchDialog.SetWidth(d.dialogWidth)
		d.searchDialog.SetHeight(msg.Height)

	case tea.KeyPressMsg:
		switch msg.String() {
		case "esc":
			return d, func() tea.Msg { return cancelToolsMsg{} }
		case "tab":
			// Cycle to next agent (forward)
			updated, _ := d.app.SwitchAgent()
			d.app = updated
			// capture currently selected tool name to attempt preservation across agents if exists in new list
			var selName string
			if si, idx := d.searchDialog.list.GetSelectedItem(); idx >= 0 {
				if ti, ok := si.(toolItem); ok {
					selName = ti.name
				}
			}
			d.setupAllTools()
			// try to reselect by name
			if selName != "" {
				items := d.searchDialog.list.GetItems()
				for i, it := range items {
					if ti, ok := it.(toolItem); ok && ti.name == selName {
						d.searchDialog.list.SetSelectedIndex(i)
						break
					}
				}
			}
			return d, nil
		}
	case cancelToolsMsg:
		return d, util.CmdHandler(modal.CloseModalMsg{})
	}

	// For non-key messages, pass to search dialog

	updatedDialog, cmd := d.searchDialog.Update(msg)
	d.searchDialog = updatedDialog.(*SearchDialog)
	return d, cmd
}

func (d *toolsDialog) View() string {
	return d.searchDialog.View()
}

func (d *toolsDialog) Render(background string) string {
	return d.modal.Render(d.View(), background)
}

func (d *toolsDialog) Close() tea.Cmd {
	return nil
}

func (d *toolsDialog) setupAllTools() {
	agent := d.app.Agent()
	slog.Debug("Setting up tools dialog", "agent", agent.Name, "tools", agent.Tools)

	// Get all available tools from the API
	ctx := context.Background()
	availableTools, err := d.app.ListTools(ctx)
	if err != nil {
		slog.Error("Failed to fetch tools from API", "error", err)
		// If we can't get tools, we can't show the dialog
		// This should be rare since the server should be running
		availableTools = make(map[string]app.ToolInfo)
	}

	if agent.Tools == nil {
		slog.Warn("Agent has no tools", "agent", agent.Name)
		agent.Tools = make(map[string]bool)
	}

	// Use session-scoped overrides (not persisted)
	overrides := d.app.SessionToolOverrides[agent.Name]
	if overrides == nil {
		overrides = make(map[string]bool)
	}

	// Build deterministic ordered list: collect names, sort by source then name
	// Only show tools that are meant to be user-manageable (defaultEnabled indicates this)
	keys := make([]string, 0, len(availableTools))
	for k, toolInfo := range availableTools {
		// Only include tools that have a default enabled state
		// Tools without defaultEnabled (nil) or explicitly disabled are not user-manageable
		if toolInfo.DefaultEnabled != nil && !*toolInfo.DefaultEnabled {
			continue
		}
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		aInfo := availableTools[keys[i]]
		bInfo := availableTools[keys[j]]
		if aInfo.Source == bInfo.Source {
			return keys[i] < keys[j]
		}
		if aInfo.Source == "builtin" && bInfo.Source == "mcp" {
			return true
		}
		if aInfo.Source == "mcp" && bInfo.Source == "builtin" {
			return false
		}
		return aInfo.Source < bInfo.Source
	})

	// Build tool items with current state (defaults + agent settings + overrides)
	d.allTools = make([]toolItem, 0, len(keys))
	for _, toolName := range keys {
		toolInfo := availableTools[toolName]
		defaultEnabled := app.IsToolDefaultEnabledFromToolInfo(toolInfo)
		if agentSetting, exists := agent.Tools[toolName]; exists {
			defaultEnabled = agentSetting
		}
		enabled := defaultEnabled
		if override, exists := overrides[toolName]; exists {
			enabled = override
		}
		overridden := enabled != defaultEnabled
		displayName := toolName
		d.allTools = append(d.allTools, toolItem{
			name:           toolName,
			displayName:    displayName,
			enabled:        enabled,
			source:         toolInfo.Source,
			overridden:     overridden,
			defaultEnabled: app.IsToolDefaultEnabledFromToolInfo(toolInfo),
		})
	}

	ordered := make([]string, 0, len(d.allTools))
	for _, t := range d.allTools {
		ordered = append(ordered, fmt.Sprintf("%s(%s)=%v", t.name, t.source, t.enabled))
	}
	slog.Debug("Built tool items", "count", len(d.allTools), "order", ordered)

	// Calculate optimal width
	d.dialogWidth = d.calculateOptimalWidth()

	// Initialize or update search dialog
	if d.searchDialog == nil {
		d.searchDialog = NewSearchDialog("Search tool...", numVisibleTools)
	} else {
		// Reset query when switching agents for clarity
		d.searchDialog.SetQuery("")
	}
	d.searchDialog.SetWidth(d.dialogWidth)

	// Build initial display list
	items := d.buildItems("")
	d.searchDialog.SetItems(items)
}
func (d *toolsDialog) calculateOptimalWidth() int {
	maxWidth := minToolDialogWidth
	for _, tool := range d.allTools {
		// Account for toggle indicator "[✓] " (4 chars) plus display name
		itemWidth := len(tool.displayName) + 4 + 2 // +2 for padding
		if itemWidth > maxWidth {
			maxWidth = itemWidth
		}
	}
	if maxWidth > maxToolDialogWidth {
		maxWidth = maxToolDialogWidth
	}
	return maxWidth
}

func (d *toolsDialog) buildItems(query string) []list.Item {
	if query == "" {
		var items []list.Item
		currentHeader := ""
		for _, tool := range d.allTools { // already sorted builtin first
			if tool.source == "builtin" {
				if currentHeader != "builtin" {
					items = append(items, list.HeaderItem("Builtin Tools"))
					currentHeader = "builtin"
				}
			} else if tool.source == "mcp" {
				if currentHeader != "mcp" {
					items = append(items, list.HeaderItem("MCP Tools"))
					currentHeader = "mcp"
				}
			}
			items = append(items, tool)
		}
		return items
	}
	matches := make([]toolItem, 0, len(d.allTools))
	for _, tool := range d.allTools {
		if fuzzy.MatchFold(query, tool.name) || fuzzy.MatchFold(query, tool.displayName) {
			matches = append(matches, tool)
		}
	}
	if len(matches) == 0 {
		return []list.Item{}
	}
	names := make([]string, len(matches))
	for i, m := range matches {
		names[i] = m.displayName
	}
	ranked := fuzzy.RankFindFold(query, names)
	sort.Sort(ranked)
	items := make([]list.Item, 0, len(ranked))
	for _, r := range ranked {
		items = append(items, matches[r.OriginalIndex])
	}
	return items
}

// NewToolsDialog builds the dialog using agent defaults + persisted overrides.
func NewToolsDialog(app *app.App) ToolsDialog {
	dialog := &toolsDialog{
		app: app,
	}

	dialog.setupAllTools()

	dialog.modal = modal.New(
		modal.WithTitle("Toggle Tools"),
		modal.WithMaxWidth(dialog.dialogWidth+4),
	)
	return dialog
}
