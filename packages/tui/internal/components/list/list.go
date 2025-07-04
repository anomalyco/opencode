package list

import (
	"strings"

	"github.com/charmbracelet/bubbles/v2/key"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/muesli/reflow/truncate"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
)

type ListItem interface {
	Render(selected bool, width int) string
}

type List[T ListItem] interface {
	tea.Model
	tea.ViewModel
	SetMaxWidth(maxWidth int)
	GetSelectedItem() (item T, idx int)
	SetItems(items []T)
	GetItems() []T
	SetSelectedIndex(idx int)
	SetEmptyMessage(msg string)
	IsEmpty() bool
}

type listComponent[T ListItem] struct {
	fallbackMsg         string
	items               []T
	selectedIdx         int
	maxWidth            int
	maxVisibleItems     int
	useAlphaNumericKeys bool
	width               int
	height              int
}

type listKeyMap struct {
	Up        key.Binding
	Down      key.Binding
	UpAlpha   key.Binding
	DownAlpha key.Binding
}

var simpleListKeys = listKeyMap{
	Up: key.NewBinding(
		key.WithKeys("up"),
		key.WithHelp("↑", "previous list item"),
	),
	Down: key.NewBinding(
		key.WithKeys("down"),
		key.WithHelp("↓", "next list item"),
	),
	UpAlpha: key.NewBinding(
		key.WithKeys("k"),
		key.WithHelp("k", "previous list item"),
	),
	DownAlpha: key.NewBinding(
		key.WithKeys("j"),
		key.WithHelp("j", "next list item"),
	),
}

func (c *listComponent[T]) Init() tea.Cmd {
	return nil
}

func (c *listComponent[T]) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch {
		case key.Matches(msg, simpleListKeys.Up) || (c.useAlphaNumericKeys && key.Matches(msg, simpleListKeys.UpAlpha)):
			if c.selectedIdx > 0 {
				c.selectedIdx--
			}
			return c, nil
		case key.Matches(msg, simpleListKeys.Down) || (c.useAlphaNumericKeys && key.Matches(msg, simpleListKeys.DownAlpha)):
			if c.selectedIdx < len(c.items)-1 {
				c.selectedIdx++
			}
			return c, nil
		}
	}

	return c, nil
}

func (c *listComponent[T]) GetSelectedItem() (T, int) {
	if len(c.items) > 0 {
		return c.items[c.selectedIdx], c.selectedIdx
	}

	var zero T
	return zero, -1
}

func (c *listComponent[T]) SetItems(items []T) {
	c.selectedIdx = 0
	c.items = items
}

func (c *listComponent[T]) GetItems() []T {
	return c.items
}

func (c *listComponent[T]) SetEmptyMessage(msg string) {
	c.fallbackMsg = msg
}

func (c *listComponent[T]) IsEmpty() bool {
	return len(c.items) == 0
}

func (c *listComponent[T]) SetMaxWidth(width int) {
	c.maxWidth = width
}

func (c *listComponent[T]) SetSelectedIndex(idx int) {
	if idx >= 0 && idx < len(c.items) {
		c.selectedIdx = idx
	}
}

func (c *listComponent[T]) View() string {
	items := c.items
	maxWidth := c.maxWidth
	if maxWidth == 0 {
		maxWidth = 80 // Default width if not set
	}
	maxVisibleItems := min(c.maxVisibleItems, len(items))
	startIdx := 0

	if len(items) <= 0 {
		return c.fallbackMsg
	}

	if len(items) > maxVisibleItems {
		halfVisible := maxVisibleItems / 2
		if c.selectedIdx >= halfVisible && c.selectedIdx < len(items)-halfVisible {
			startIdx = c.selectedIdx - halfVisible
		} else if c.selectedIdx >= len(items)-halfVisible {
			startIdx = len(items) - maxVisibleItems
		}
	}

	endIdx := min(startIdx+maxVisibleItems, len(items))

	listItems := make([]string, 0, maxVisibleItems)

	for i := startIdx; i < endIdx; i++ {
		item := items[i]
		title := item.Render(i == c.selectedIdx, maxWidth)
		listItems = append(listItems, title)
	}

	return strings.Join(listItems, "\n")
}

func NewListComponent[T ListItem](
	items []T,
	maxVisibleItems int,
	fallbackMsg string,
	useAlphaNumericKeys bool,
) List[T] {
	return &listComponent[T]{
		fallbackMsg:         fallbackMsg,
		items:               items,
		maxVisibleItems:     maxVisibleItems,
		useAlphaNumericKeys: useAlphaNumericKeys,
		selectedIdx:         0,
	}
}

// StringItem is a simple implementation of ListItem for string values
type StringItem string

func (s StringItem) Render(selected bool, width int) string {
	t := theme.CurrentTheme()
	baseStyle := styles.NewStyle()

	truncatedStr := truncate.StringWithTail(string(s), uint(width-1), "...")

	var itemStyle styles.Style
	if selected {
		itemStyle = baseStyle.
			Background(t.Primary()).
			Foreground(t.BackgroundElement()).
			Width(width).
			PaddingLeft(1)
	} else {
		itemStyle = baseStyle.
			Foreground(t.TextMuted()).
			PaddingLeft(1)
	}

	return itemStyle.Render(truncatedStr)
}

// NewStringList creates a new list component with string items
func NewStringList(
	items []string,
	maxVisibleItems int,
	fallbackMsg string,
	useAlphaNumericKeys bool,
) List[StringItem] {
	stringItems := make([]StringItem, len(items))
	for i, item := range items {
		stringItems[i] = StringItem(item)
	}
	return NewListComponent(stringItems, maxVisibleItems, fallbackMsg, useAlphaNumericKeys)
}
