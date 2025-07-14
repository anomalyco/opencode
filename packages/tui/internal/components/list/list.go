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
	Render(selected bool, width int, isFirstInViewport bool) string
	Selectable() bool
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
	GetMaxVisibleItems() int
	GetActualHeight() int
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
		key.WithKeys("up", "ctrl+p"),
		key.WithHelp("↑", "previous list item"),
	),
	Down: key.NewBinding(
		key.WithKeys("down", "ctrl+n"),
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
			c.moveUp()
			return c, nil
		case key.Matches(msg, simpleListKeys.Down) || (c.useAlphaNumericKeys && key.Matches(msg, simpleListKeys.DownAlpha)):
			c.moveDown()
			return c, nil
		}
	}

	return c, nil
}

// moveUp moves the selection up, skipping non-selectable items
func (c *listComponent[T]) moveUp() {
	if len(c.items) == 0 {
		return
	}

	// Find the previous selectable item
	for i := c.selectedIdx - 1; i >= 0; i-- {
		if c.items[i].Selectable() {
			c.selectedIdx = i
			return
		}
	}

	// If no selectable item found above, stay at current position
}

// moveDown moves the selection down, skipping non-selectable items
func (c *listComponent[T]) moveDown() {
	if len(c.items) == 0 {
		return
	}

	originalIdx := c.selectedIdx
	for {
		if c.selectedIdx < len(c.items)-1 {
			c.selectedIdx++
		} else {
			break
		}

		if c.items[c.selectedIdx].Selectable() {
			return
		}

		// Prevent infinite loop
		if c.selectedIdx == originalIdx {
			break
		}
	}
}

func (c *listComponent[T]) GetSelectedItem() (T, int) {
	if len(c.items) > 0 && c.items[c.selectedIdx].Selectable() {
		return c.items[c.selectedIdx], c.selectedIdx
	}

	var zero T
	return zero, -1
}

func (c *listComponent[T]) SetItems(items []T) {
	c.items = items
	c.selectedIdx = 0

	// Ensure initial selection is on a selectable item
	if len(items) > 0 && !items[0].Selectable() {
		c.moveDown()
	}
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

func (c *listComponent[T]) GetMaxVisibleItems() int {
	return c.maxVisibleItems
}

func (c *listComponent[T]) GetActualHeight() int {
	items := c.items
	if len(items) == 0 {
		return 1 // For empty message
	}

	maxVisibleItems := min(c.maxVisibleItems, len(items))
	startIdx := 0

	if len(items) > maxVisibleItems {
		halfVisible := maxVisibleItems / 2
		if c.selectedIdx >= halfVisible && c.selectedIdx < len(items)-halfVisible {
			startIdx = c.selectedIdx - halfVisible
		} else if c.selectedIdx >= len(items)-halfVisible {
			startIdx = len(items) - maxVisibleItems
		}
	}

	endIdx := min(startIdx+maxVisibleItems, len(items))

	height := 0
	for i := startIdx; i < endIdx; i++ {
		item := items[i]
		isFirstInViewport := (i == startIdx)

		// Check if this is a HeaderItem and calculate its height
		if _, ok := any(item).(HeaderItem); ok {
			if isFirstInViewport {
				height += 1 // No top margin
			} else {
				height += 2 // With top margin
			}
		} else {
			height += 1 // Regular items take 1 line
		}
	}

	return height
}

func (c *listComponent[T]) View() string {
	items := c.items
	maxWidth := c.maxWidth
	if maxWidth == 0 {
		maxWidth = 80 // Default width if not set
	}

	if len(items) <= 0 {
		return c.fallbackMsg
	}

	// Calculate viewport based on actual heights, not item counts
	startIdx, endIdx := c.calculateViewport()

	listItems := make([]string, 0, endIdx-startIdx)

	for i := startIdx; i < endIdx; i++ {
		item := items[i]
		isFirstInViewport := (i == startIdx)
		title := item.Render(i == c.selectedIdx, maxWidth, isFirstInViewport)
		listItems = append(listItems, title)
	}

	return strings.Join(listItems, "\n")
}

// calculateViewport determines which items to show based on available height
func (c *listComponent[T]) calculateViewport() (startIdx, endIdx int) {
	items := c.items
	if len(items) == 0 {
		return 0, 0
	}

	// Helper function to calculate height of an item at given position
	getItemHeight := func(idx int, isFirst bool) int {
		if _, ok := any(items[idx]).(HeaderItem); ok {
			if isFirst {
				return 1 // No top margin
			} else {
				return 2 // With top margin
			}
		}
		return 1 // Regular items
	}

	// If we have fewer items than max, show all
	if len(items) <= c.maxVisibleItems {
		return 0, len(items)
	}

	// Try to center the selected item in the viewport
	// Start by trying to put selected item in the middle
	targetStart := c.selectedIdx - c.maxVisibleItems/2
	if targetStart < 0 {
		targetStart = 0
	}

	// Find the actual start and end indices that fit within our height budget
	bestStart := 0
	bestEnd := 0
	bestHeight := 0

	// Try different starting positions around our target
	for start := max(0, targetStart-2); start <= min(len(items)-1, targetStart+2); start++ {
		currentHeight := 0
		end := start

		for end < len(items) && currentHeight < c.maxVisibleItems {
			itemHeight := getItemHeight(end, end == start)
			if currentHeight+itemHeight > c.maxVisibleItems {
				break
			}
			currentHeight += itemHeight
			end++
		}

		// Check if this viewport contains the selected item and is better than current best
		if start <= c.selectedIdx && c.selectedIdx < end {
			if currentHeight > bestHeight || (currentHeight == bestHeight && abs(start+end-2*c.selectedIdx) < abs(bestStart+bestEnd-2*c.selectedIdx)) {
				bestStart = start
				bestEnd = end
				bestHeight = currentHeight
			}
		}
	}

	// If no good viewport found that contains selected item, just show from selected item
	if bestEnd == 0 {
		bestStart = c.selectedIdx
		currentHeight := 0
		for bestEnd = bestStart; bestEnd < len(items) && currentHeight < c.maxVisibleItems; bestEnd++ {
			itemHeight := getItemHeight(bestEnd, bestEnd == bestStart)
			if currentHeight+itemHeight > c.maxVisibleItems {
				break
			}
			currentHeight += itemHeight
		}
	}

	return bestStart, bestEnd
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
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

func (s StringItem) Render(selected bool, width int, isFirstInViewport bool) string {
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

func (s StringItem) Selectable() bool {
	return true
}

// HeaderItem is a non-selectable header item for grouping
type HeaderItem string

func (h HeaderItem) Render(selected bool, width int, isFirstInViewport bool) string {
	t := theme.CurrentTheme()
	baseStyle := styles.NewStyle()

	truncatedStr := truncate.StringWithTail(string(h), uint(width-1), "...")

	headerStyle := baseStyle.
		Foreground(t.Accent()).
		Bold(true).
		MarginBottom(0).
		PaddingLeft(1)

	// Only add top margin if this is not the first item in the viewport
	if !isFirstInViewport {
		headerStyle = headerStyle.MarginTop(1)
	}

	return headerStyle.Render(truncatedStr)
}

func (h HeaderItem) Selectable() bool {
	return false
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
