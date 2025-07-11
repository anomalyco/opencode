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
	"github.com/sst/opencode/internal/components/list"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
)

type CompletionItem struct {
	Title      string
	Value      string
	ProviderID string
	Raw        any
}

type CompletionItemI interface {
	list.ListItem
	GetValue() string
	DisplayValue() string
	GetProviderID() string
	GetRaw() any
}

func (ci *CompletionItem) Render(selected bool, width int) string {
	t := theme.CurrentTheme()
	baseStyle := styles.NewStyle().Foreground(t.Text())

	truncatedStr := truncate.String(string(ci.DisplayValue()), uint(width-4))

	itemStyle := baseStyle.
		Background(t.BackgroundElement()).
		Padding(0, 1)

	if selected {
		itemStyle = itemStyle.Foreground(t.Primary())
	}

	title := itemStyle.Render(truncatedStr)
	return title
}

func (ci *CompletionItem) DisplayValue() string {
	return ci.Title
}

func (ci *CompletionItem) GetValue() string {
	return ci.Value
}

func (ci *CompletionItem) GetProviderID() string {
	return ci.ProviderID
}

func (ci *CompletionItem) GetRaw() any {
	return ci.Raw
}

func NewCompletionItem(completionItem CompletionItem) CompletionItemI {
	return &completionItem
}

type CompletionProvider interface {
	GetId() string
	GetChildEntries(query string) ([]CompletionItemI, error)
	GetEmptyMessage() string
}

type CompletionSelectedMsg struct {
	Item         CompletionItemI
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
	providers            []CompletionProvider
	width                int
	height               int
	pseudoSearchTextArea textarea.Model
	list                 list.List[CompletionItemI]
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
		key.WithKeys(" ", "esc", "backspace", "ctrl+c"),
	),
}

func (c *completionDialogComponent) Init() tea.Cmd {
	return nil
}

func (c *completionDialogComponent) getAllCompletions(query string) tea.Cmd {
	return func() tea.Msg {
		allItems := make([]CompletionItemI, 0)

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
			// Create a slice of display values for fuzzy matching
			displayValues := make([]string, len(allItems))
			for i, item := range allItems {
				displayValues[i] = item.DisplayValue()
			}

			// Get fuzzy matches with ranking
			matches := fuzzy.RankFindFold(query, displayValues)

			// Sort by score (best matches first)
			sort.Sort(matches)

			// Reorder items based on fuzzy ranking
			rankedItems := make([]CompletionItemI, 0, len(matches))
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
	case []CompletionItemI:
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
				c.list = u.(list.List[CompletionItemI])
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
				if msg.String() != "backspace" || (width <= triggerWidth && value != c.trigger) {
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
	baseStyle := styles.NewStyle().Foreground(t.Text())
	c.list.SetMaxWidth(c.width)

	return baseStyle.
		Padding(0, 0).
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

func (c *completionDialogComponent) complete(item CompletionItemI) tea.Cmd {
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
	providers ...CompletionProvider,
) CompletionDialog {
	ti := textarea.New()
	ti.SetValue(trigger)

	// Use a generic empty message if we have multiple providers
	emptyMessage := "no matching items"
	if len(providers) == 1 {
		emptyMessage = providers[0].GetEmptyMessage()
	}

	li := list.NewListComponent(
		[]CompletionItemI{},
		7,
		emptyMessage,
		false,
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
		allItems := make([]CompletionItemI, 0)
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
