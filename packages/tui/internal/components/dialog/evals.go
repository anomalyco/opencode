package dialog

import (
	"fmt"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/components/list"
	"github.com/sst/opencode/internal/components/modal"
	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
)

const (
	numVisibleEvals = 10
	minEvalsWidth   = 40
	maxEvalsWidth   = 80
)

// EvalsDialog interface for the evaluation dashboard
type EvalsDialog interface {
	layout.Modal
}

type evalsDialog struct {
	app          *app.App
	width        int
	height       int
	modal        *modal.Modal
	searchDialog *SearchDialog
	dialogWidth  int
}

// evalItem is a custom list item for evaluation suites
type evalItem struct {
	Name        string
	Status      string // "idle", "running", "passed", "failed"
	LastRun     time.Time
	LastScore   float64
	Tests       int
	Passed      int
	Failed      int
	Duration    time.Duration
}

func (e evalItem) Render(selected bool, width int, baseStyle styles.Style) string {
	if selected {
		baseStyle = baseStyle.Background(theme.CurrentTheme().BackgroundElement()).
			Foreground(theme.CurrentTheme().Primary())
	}
	
	// Status indicator (clean, minimal)
	var prefix string
	switch e.Status {
	case "running":
		prefix = "● "
	case "passed":
		prefix = "✓ "
	case "failed":
		prefix = "✗ "
	default:
		prefix = "  "
	}
	
	// Suite name with truncation
	name := e.Name
	maxNameLength := width - 20
	if maxNameLength > 3 && len(name) > maxNameLength {
		name = name[:maxNameLength-3] + "..."
	}
	
	// Score (if available)
	scoreText := ""
	if e.LastScore > 0 {
		scoreText = fmt.Sprintf(" %.0f%%", e.LastScore)
	}
	
	content := prefix + name + scoreText
	return baseStyle.Render(content)
}

func (e evalItem) Selectable() bool {
	return true
}

func (e evalItem) FilterValue() string {
	return e.Name
}

func (e *evalsDialog) Init() tea.Cmd {
	e.setupEvalsList()
	return e.searchDialog.Init()
}

func (e *evalsDialog) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case SearchSelectionMsg:
		// Handle selection from search dialog
		if item, ok := msg.Item.(evalItem); ok {
			return e, tea.Sequence(
				util.CmdHandler(modal.CloseModalMsg{}),
				e.runEvaluation(item.Name),
			)
		}
		return e, util.CmdHandler(modal.CloseModalMsg{})
		
	case SearchCancelledMsg:
		return e, util.CmdHandler(modal.CloseModalMsg{})

	case SearchQueryChangedMsg:
		// Update the list based on search query
		items := e.buildDisplayList(msg.Query)
		e.searchDialog.SetItems(items)
		return e, nil

	case tea.WindowSizeMsg:
		e.width = msg.Width
		e.height = msg.Height
		e.dialogWidth = min(maxEvalsWidth, max(minEvalsWidth, msg.Width-8))
		e.searchDialog.SetWidth(e.dialogWidth)
		e.searchDialog.SetHeight(msg.Height)
	}

	updatedDialog, cmd := e.searchDialog.Update(msg)
	if searchDialog, ok := updatedDialog.(*SearchDialog); ok {
		e.searchDialog = searchDialog
	}

	return e, cmd
}

func (e *evalsDialog) View() string {
	return e.searchDialog.View()
}

func (e *evalsDialog) Render(background string) string {
	return e.modal.Render(e.View(), background)
}

func (e *evalsDialog) Close() tea.Cmd {
	return nil
}

func (e *evalsDialog) runEvaluation(suiteName string) tea.Cmd {
	// TODO: Integrate with actual EvalOps tool execution
	return nil
}

func (e *evalsDialog) setupEvalsList() {
	items := e.buildDisplayList("")
	e.searchDialog.SetItems(items)
}

func (e *evalsDialog) buildDisplayList(query string) []list.Item {
	allEvals := []evalItem{
		{
			Name: "code-quality.js", Status: "passed",
			LastRun: time.Now().Add(-10 * time.Minute), LastScore: 94.5,
			Tests: 15, Passed: 14, Failed: 1, Duration: 2300 * time.Millisecond,
		},
		{
			Name: "security-scan.js", Status: "failed",
			LastRun: time.Now().Add(-25 * time.Minute), LastScore: 67.8,
			Tests: 8, Passed: 5, Failed: 3, Duration: 1800 * time.Millisecond,
		},
		{
			Name: "performance-test.js", Status: "passed",
			LastRun: time.Now().Add(-1 * time.Hour), LastScore: 89.2,
			Tests: 12, Passed: 11, Failed: 1, Duration: 3100 * time.Millisecond,
		},
		{
			Name: "integration-test.js", Status: "idle",
			LastRun: time.Now().Add(-3 * time.Hour), LastScore: 0,
			Tests: 0, Passed: 0, Failed: 0, Duration: 0,
		},
	}

	// Filter based on query if provided
	var filtered []evalItem
	if query == "" {
		filtered = allEvals
	} else {
		for _, eval := range allEvals {
			if matchesQuery(eval.Name, query) {
				filtered = append(filtered, eval)
			}
		}
	}

	// Convert to list.Items
	items := make([]list.Item, len(filtered))
	for i, eval := range filtered {
		items[i] = eval
	}

	return items
}

func matchesQuery(name, query string) bool {
	// Simple substring matching
	return query == "" || strings.Contains(strings.ToLower(name), strings.ToLower(query))
}

// Helper functions
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func NewEvalsDialog(app *app.App) EvalsDialog {
	dialog := &evalsDialog{
		app:         app,
		modal:       modal.New(modal.WithTitle("EvalOps"), modal.WithMaxWidth(80)),
		dialogWidth: maxEvalsWidth,
	}
	
	// Initialize search dialog with proper parameters
	dialog.searchDialog = NewSearchDialog("Search evaluation suites...", numVisibleEvals)
	
	// Set initial width and height
	dialog.searchDialog.SetWidth(dialog.dialogWidth)
	dialog.searchDialog.SetHeight(numVisibleEvals + 4)
	
	// Set up initial items
	dialog.setupEvalsList()
	
	return dialog
}
