package list

import (
	"strings"

	"github.com/charmbracelet/bubbles/v2/key"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/muesli/reflow/truncate"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
)

// Item interface that all list items must implement
type Item interface {
	Render(selected bool, width int, baseStyle styles.Style) string
	Selectable() bool
}

// RenderFunc defines how to render an item in the list
type RenderFunc[T any] func(item T, selected bool, width int, baseStyle styles.Style) string

// SelectableFunc defines whether an item is selectable
type SelectableFunc[T any] func(item T) bool

// Options holds configuration for the list component
type Options[T any] struct {
	items               []T
	maxVisibleHeight    int
	fallbackMsg         string
	useAlphaNumericKeys bool
	renderItem          RenderFunc[T]
	isSelectable        SelectableFunc[T]
	baseStyle           styles.Style
}

// Option is a function that configures the list component
type Option[T any] func(*Options[T])

// WithItems sets the initial items for the list
func WithItems[T any](items []T) Option[T] {
	return func(o *Options[T]) {
		o.items = items
	}
}

// WithMaxVisibleHeight sets the maximum visible height in lines
func WithMaxVisibleHeight[T any](height int) Option[T] {
	return func(o *Options[T]) {
		o.maxVisibleHeight = height
	}
}

// WithFallbackMessage sets the message to show when the list is empty
func WithFallbackMessage[T any](msg string) Option[T] {
	return func(o *Options[T]) {
		o.fallbackMsg = msg
	}
}

// WithAlphaNumericKeys enables j/k navigation keys
func WithAlphaNumericKeys[T any](enabled bool) Option[T] {
	return func(o *Options[T]) {
		o.useAlphaNumericKeys = enabled
	}
}

// WithRenderFunc sets the function to render items
func WithRenderFunc[T any](fn RenderFunc[T]) Option[T] {
	return func(o *Options[T]) {
		o.renderItem = fn
	}
}

// WithSelectableFunc sets the function to determine if items are selectable
func WithSelectableFunc[T any](fn SelectableFunc[T]) Option[T] {
	return func(o *Options[T]) {
		o.isSelectable = fn
	}
}

// WithStyle sets the base style that gets passed to render functions
func WithStyle[T any](style styles.Style) Option[T] {
	return func(o *Options[T]) {
		o.baseStyle = style
	}
}

type List[T any] interface {
	tea.Model
	tea.ViewModel
	SetMaxWidth(maxWidth int)
	GetSelectedItem() (item T, idx int)
	SetItems(items []T)
	GetItems() []T
	SetSelectedIndex(idx int)
	SetEmptyMessage(msg string)
	IsEmpty() bool
	GetMaxVisibleHeight() int
}

type listComponent[T any] struct {
	fallbackMsg         string
	items               []T
	selectedIdx         int
	maxWidth            int
	maxVisibleHeight    int
	useAlphaNumericKeys bool
	width               int
	height              int
	renderItem          RenderFunc[T]
	isSelectable        SelectableFunc[T]
	baseStyle           styles.Style
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
		if c.isSelectable(c.items[i]) {
			c.selectedIdx = i
			return
		}
	}

	// If no selectable item found above, wrap to the bottom
	for i := len(c.items) - 1; i > c.selectedIdx; i-- {
		if c.isSelectable(c.items[i]) {
			c.selectedIdx = i
			return
		}
	}
}

// moveDown moves the selection down, skipping non-selectable items
func (c *listComponent[T]) moveDown() {
	if len(c.items) == 0 {
		return
	}

	originalIdx := c.selectedIdx
	// First try moving down from current position
	for i := c.selectedIdx + 1; i < len(c.items); i++ {
		if c.isSelectable(c.items[i]) {
			c.selectedIdx = i
			return
		}
	}

	// If no selectable item found below, wrap to the top
	for i := 0; i < originalIdx; i++ {
		if c.isSelectable(c.items[i]) {
			c.selectedIdx = i
			return
		}
	}
}

func (c *listComponent[T]) GetSelectedItem() (T, int) {
	if len(c.items) > 0 && c.isSelectable(c.items[c.selectedIdx]) {
		return c.items[c.selectedIdx], c.selectedIdx
	}

	var zero T
	return zero, -1
}

func (c *listComponent[T]) SetItems(items []T) {
	c.items = items
	c.selectedIdx = 0

	// Ensure initial selection is on a selectable item
	if len(items) > 0 && !c.isSelectable(items[0]) {
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

func (c *listComponent[T]) GetMaxVisibleHeight() int {
	return c.maxVisibleHeight
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

	// Calculate viewport based on actual heights
	startIdx, endIdx := c.calculateViewport()

	listItems := make([]string, 0, endIdx-startIdx)

	for i := startIdx; i < endIdx; i++ {
		item := items[i]

		// Special handling for HeaderItem to remove top margin on first item
		if i == startIdx {
			// Check if this is a HeaderItem
			if _, ok := any(item).(Item); ok {
				if headerItem, isHeader := any(item).(HeaderItem); isHeader {
					// Render header without top margin when it's first
					t := theme.CurrentTheme()
					truncatedStr := truncate.StringWithTail(string(headerItem), uint(maxWidth-1), "...")
					headerStyle := c.baseStyle.
						Foreground(t.Accent()).
						Bold(true).
						MarginBottom(0).
						PaddingLeft(1)
					listItems = append(listItems, headerStyle.Render(truncatedStr))
					continue
				}
			}
		}

		title := c.renderItem(item, i == c.selectedIdx, maxWidth, c.baseStyle)
		listItems = append(listItems, title)
	}

	return strings.Join(listItems, "\n")
}

// calculateViewport determines which items to show based on available space
func (c *listComponent[T]) calculateViewport() (startIdx, endIdx int) {
	items := c.items
	if len(items) == 0 {
		return 0, 0
	}

	// Calculate heights of all items
	itemHeights := make([]int, len(items))
	for i, item := range items {
		rendered := c.renderItem(item, false, c.maxWidth, c.baseStyle)
		itemHeights[i] = lipgloss.Height(rendered)
	}

	// Find the range of items that fit within maxVisibleHeight
	// Start by trying to center the selected item
	start := 0
	end := len(items)

	// Calculate height from start to selected
	heightToSelected := 0
	for i := 0; i <= c.selectedIdx && i < len(items); i++ {
		heightToSelected += itemHeights[i]
	}

	// If selected item is beyond visible height, scroll to show it
	if heightToSelected > c.maxVisibleHeight {
		// Start from selected and work backwards to find start
		currentHeight := itemHeights[c.selectedIdx]
		start = c.selectedIdx

		for i := c.selectedIdx - 1; i >= 0 && currentHeight+itemHeights[i] <= c.maxVisibleHeight; i-- {
			currentHeight += itemHeights[i]
			start = i
		}
	}

	// Calculate end based on start
	currentHeight := 0
	for i := start; i < len(items); i++ {
		if currentHeight+itemHeights[i] > c.maxVisibleHeight {
			end = i
			break
		}
		currentHeight += itemHeights[i]
	}

	return start, end
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

func NewListComponent[T any](opts ...Option[T]) List[T] {
	options := &Options[T]{
		baseStyle: styles.NewStyle(), // Default empty style
	}

	for _, opt := range opts {
		opt(options)
	}

	return &listComponent[T]{
		fallbackMsg:         options.fallbackMsg,
		items:               options.items,
		maxVisibleHeight:    options.maxVisibleHeight,
		useAlphaNumericKeys: options.useAlphaNumericKeys,
		selectedIdx:         0,
		renderItem:          options.renderItem,
		isSelectable:        options.isSelectable,
		baseStyle:           options.baseStyle,
	}
}

// StringItem is a simple implementation of Item for string values
type StringItem string

func (s StringItem) Render(selected bool, width int, baseStyle styles.Style) string {
	t := theme.CurrentTheme()

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

func (h HeaderItem) Render(selected bool, width int, baseStyle styles.Style) string {
	t := theme.CurrentTheme()

	truncatedStr := truncate.StringWithTail(string(h), uint(width-1), "...")

	headerStyle := baseStyle.
		Foreground(t.Accent()).
		Bold(true).
		MarginTop(1).
		MarginBottom(0).
		PaddingLeft(1)

	return headerStyle.Render(truncatedStr)
}

func (h HeaderItem) Selectable() bool {
	return false
}

// Ensure StringItem and HeaderItem implement Item
var _ Item = StringItem("")
var _ Item = HeaderItem("")
