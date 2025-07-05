package dialog

import (
	"log/slog"

	"github.com/charmbracelet/bubbles/v2/key"
	"github.com/charmbracelet/bubbles/v2/textarea"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/sst/opencode/internal/components/list"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
)

type CompletionItem struct {
	Title string
	Value string
}

type CompletionItemI interface {
	list.ListItem
	GetValue() string
	DisplayValue() string
}

func (ci *CompletionItem) Render(selected bool, width int) string {
	t := theme.CurrentTheme()
	baseStyle := styles.NewStyle().Foreground(t.Text())

	itemStyle := baseStyle.
		Background(t.BackgroundElement()).
		Width(width).
		Padding(0, 1)

	if selected {
		itemStyle = itemStyle.Foreground(t.Primary())
	}

	title := itemStyle.Render(
		ci.DisplayValue(),
	)
	return title
}

func (ci *CompletionItem) DisplayValue() string {
	return ci.Title
}

func (ci *CompletionItem) GetValue() string {
	return ci.Value
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
	SearchString    string
	CompletionValue string
	ProviderID      string
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
	completionProvider   CompletionProvider
	width                int
	height               int
	pseudoSearchTextArea textarea.Model
	list                 list.List[CompletionItemI]
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

				var query string
				query = c.pseudoSearchTextArea.Value()

				if query != c.query {
					c.query = query
					cmd = func() tea.Msg {
						items, err := c.completionProvider.GetChildEntries(query)
						if err != nil {
							slog.Error("Failed to get completion items", "error", err)
						}
						return items
					}
					cmds = append(cmds, cmd)
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
				// Only close on backspace when there are no characters left
				if msg.String() != "backspace" || len(c.pseudoSearchTextArea.Value()) <= 0 {
					return c, c.close()
				}
			}

			return c, tea.Batch(cmds...)
		} else {
			cmd := func() tea.Msg {
				items, err := c.completionProvider.GetChildEntries("")
				if err != nil {
					slog.Error("Failed to get completion items", "error", err)
				}
				return items
			}
			cmds = append(cmds, cmd)
			cmds = append(cmds, c.pseudoSearchTextArea.Focus())
			return c, tea.Batch(cmds...)
		}
	}

	return c, tea.Batch(cmds...)
}

func (c *completionDialogComponent) View() string {
	t := theme.CurrentTheme()
	baseStyle := styles.NewStyle().Foreground(t.Text())

	maxWidth := 40
	completions := c.list.GetItems()

	for _, cmd := range completions {
		title := cmd.DisplayValue()
		width := lipgloss.Width(title)
		if width > maxWidth-4 {
			maxWidth = width + 4
		}
	}

	c.list.SetMaxWidth(maxWidth)

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
			SearchString:    value,
			CompletionValue: item.GetValue(),
			ProviderID:      c.completionProvider.GetId(),
		}),
		c.close(),
	)
}

func (c *completionDialogComponent) close() tea.Cmd {
	c.pseudoSearchTextArea.Reset()
	c.pseudoSearchTextArea.Blur()
	return util.CmdHandler(CompletionDialogCloseMsg{})
}

func NewCompletionDialogComponent(completionProvider CompletionProvider) CompletionDialog {
	ti := textarea.New()

	li := list.NewListComponent(
		[]CompletionItemI{},
		7,
		completionProvider.GetEmptyMessage(),
		false,
	)

	go func() {
		items, err := completionProvider.GetChildEntries("")
		if err != nil {
			slog.Error("Failed to get completion items", "error", err)
		}
		li.SetItems(items)
	}()

	return &completionDialogComponent{
		query:                "",
		completionProvider:   completionProvider,
		pseudoSearchTextArea: ti,
		list:                 li,
	}
}
