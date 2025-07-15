package dialog

import (
	"log/slog"
	"sort"
	"strings"

	"github.com/charmbracelet/bubbles/v2/key"
	"github.com/charmbracelet/bubbles/v2/textarea"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/lithammer/fuzzysearch/fuzzy"
	"github.com/muesli/reflow/truncate"
	"github.com/sst/opencode/internal/completions"
	"github.com/sst/opencode/internal/components/list"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
)

type CompletionSelectedMsg struct {
	Item         completions.CompletionSuggestion
	SearchString string
}

type CompletionDialogCompleteItemMsg struct {
	Value string
}

type CompletionDialogCloseMsg struct{}

type CompletionDialog interface {
	tea.Model
	tea.ViewModel
	SetWidth(width int)
	IsEmpty() bool
}

type completionDialogComponent struct {
	query                string
	providers            []completions.CompletionProvider
	width                int
	height               int
	pseudoSearchTextArea textarea.Model
	list                 list.List[completions.CompletionSuggestion]
	trigger              string
}

type completionDialogKeyMap struct {
	Complete key.Binding
	Cancel   key.Binding
}

var completionDialogKeys = completionDialogKeyMap{
	Complete: key.NewBinding(
		key.WithKeys("tab", "enter", "right"),
	),
	Cancel: key.NewBinding(
		key.WithKeys(" ", "esc", "backspace", "ctrl+h", "ctrl+c"),
	),
}

func (c *completionDialogComponent) Init() tea.Cmd {
	return nil
}

func (c *completionDialogComponent) getAllCompletions(query string) tea.Cmd {
	return func() tea.Msg {
		allItems := make([]completions.CompletionSuggestion, 0)

		// Collect results from all providers
		for _, provider := range c.providers {
			items, err := provider.GetChildEntries(query)
			if err != nil {
				slog.Error(
					"Failed to get completion items",
					"provider",
					provider.GetId(),
					"error",
					err,
				)
				continue
			}
			allItems = append(allItems, items...)
		}

		// If there's a query, use fuzzy ranking to sort results
		if query != "" && len(allItems) > 0 {
			t := theme.CurrentTheme()
			baseStyle := styles.NewStyle().Background(t.BackgroundElement())
			// Create a slice of display values for fuzzy matching
			displayValues := make([]string, len(allItems))
			for i, item := range allItems {
				displayValues[i] = item.Display(baseStyle)
			}

			// Get fuzzy matches with ranking
			matches := fuzzy.RankFindFold(query, displayValues)

			// Sort by score (best matches first)
			sort.Sort(matches)

			// Reorder items based on fuzzy ranking
			rankedItems := make([]completions.CompletionSuggestion, 0, len(matches))
			for _, match := range matches {
				rankedItems = append(rankedItems, allItems[match.OriginalIndex])
			}

			return rankedItems
		}

		return allItems
	}
}
func (c *completionDialogComponent) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd
	switch msg := msg.(type) {
	case []completions.CompletionSuggestion:
		c.list.SetItems(msg)
	case tea.KeyMsg:
		if c.pseudoSearchTextArea.Focused() {
			if !key.Matches(msg, completionDialogKeys.Complete) {
				var cmd tea.Cmd
				c.pseudoSearchTextArea, cmd = c.pseudoSearchTextArea.Update(msg)
				cmds = append(cmds, cmd)

				fullValue := c.pseudoSearchTextArea.Value()
				query := strings.TrimPrefix(fullValue, c.trigger)

				if query != c.query {
					c.query = query
					cmds = append(cmds, c.getAllCompletions(query))
				}

				u, cmd := c.list.Update(msg)
				c.list = u.(list.List[completions.CompletionSuggestion])
				cmds = append(cmds, cmd)
			}

			switch {
			case key.Matches(msg, completionDialogKeys.Complete):
				item, i := c.list.GetSelectedItem()
				if i == -1 {
					return c, nil
				}
				return c, c.complete(item)
			case key.Matches(msg, completionDialogKeys.Cancel):
				value := c.pseudoSearchTextArea.Value()
				width := lipgloss.Width(value)
				triggerWidth := lipgloss.Width(c.trigger)
				// Only close on backspace when there are no characters left, unless we're back to just the trigger
				if (msg.String() != "backspace" && msg.String() != "ctrl+h") || (width <= triggerWidth && value != c.trigger) {
					return c, c.close()
				}
			}

			return c, tea.Batch(cmds...)
		} else {
			cmds = append(cmds, c.getAllCompletions(""))
			cmds = append(cmds, c.pseudoSearchTextArea.Focus())
			return c, tea.Batch(cmds...)
		}
	}

	return c, tea.Batch(cmds...)
}

func (c *completionDialogComponent) View() string {
	t := theme.CurrentTheme()
	c.list.SetMaxWidth(c.width)

	return styles.NewStyle().
		Padding(0, 1).
		Foreground(t.Text()).
		Background(t.BackgroundElement()).
		BorderStyle(lipgloss.ThickBorder()).
		BorderLeft(true).
		BorderRight(true).
		BorderForeground(t.Border()).
		BorderBackground(t.Background()).
		Width(c.width).
		Render(c.list.View())
}

func (c *completionDialogComponent) SetWidth(width int) {
	c.width = width
}

func (c *completionDialogComponent) IsEmpty() bool {
	return c.list.IsEmpty()
}

func (c *completionDialogComponent) complete(item completions.CompletionSuggestion) tea.Cmd {
	value := c.pseudoSearchTextArea.Value()
	return tea.Batch(
		util.CmdHandler(CompletionSelectedMsg{
			SearchString: value,
			Item:         item,
		}),
		c.close(),
	)
}

func (c *completionDialogComponent) close() tea.Cmd {
	c.pseudoSearchTextArea.Reset()
	c.pseudoSearchTextArea.Blur()
	return util.CmdHandler(CompletionDialogCloseMsg{})
}

func NewCompletionDialogComponent(
	trigger string,
	providers ...completions.CompletionProvider,
) CompletionDialog {
	ti := textarea.New()
	ti.SetValue(trigger)

	// Use a generic empty message if we have multiple providers
	emptyMessage := "no matching items"
	if len(providers) == 1 {
		emptyMessage = providers[0].GetEmptyMessage()
	}

	// Define render function for completion suggestions
	renderFunc := func(item completions.CompletionSuggestion, selected bool, width int, baseStyle styles.Style) string {
		t := theme.CurrentTheme()
		style := baseStyle

		if selected {
			style = style.Background(t.BackgroundElement()).Foreground(t.Primary())
		} else {
			style = style.Background(t.BackgroundElement()).Foreground(t.Text())
		}

		// The item.Display string already has any inline colors from the provider
		truncatedStr := truncate.String(item.Display(style), uint(width-4))
		return style.Width(width - 4).Render(truncatedStr)
	}

	// Define selectable function - all completion suggestions are selectable
	selectableFunc := func(item completions.CompletionSuggestion) bool {
		return true
	}

	li := list.NewListComponent(
		list.WithItems([]completions.CompletionSuggestion{}),
		list.WithMaxVisibleHeight[completions.CompletionSuggestion](7),
		list.WithFallbackMessage[completions.CompletionSuggestion](emptyMessage),
		list.WithAlphaNumericKeys[completions.CompletionSuggestion](false),
		list.WithRenderFunc(renderFunc),
		list.WithSelectableFunc(selectableFunc),
	)

	c := &completionDialogComponent{
		query:                "",
		providers:            providers,
		pseudoSearchTextArea: ti,
		list:                 li,
		trigger:              trigger,
	}

	// Load initial items from all providers
	go func() {
		allItems := make([]completions.CompletionSuggestion, 0)
		for _, provider := range providers {
			items, err := provider.GetChildEntries("")
			if err != nil {
				slog.Error(
					"Failed to get completion items",
					"provider",
					provider.GetId(),
					"error",
					err,
				)
				continue
			}
			allItems = append(allItems, items...)
		}
		li.SetItems(allItems)
	}()

	return c
}
