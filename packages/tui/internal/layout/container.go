package layout

import (
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
)

type Container interface {
	tea.Model
	tea.ViewModel
	Sizeable
	Focusable
	Alignable
}

type container struct {
	width  int
	height int
	x      int
	y      int

	content tea.ViewModel

	paddingTop    int
	paddingRight  int
	paddingBottom int
	paddingLeft   int

	borderTop    bool
	borderRight  bool
	borderBottom bool
	borderLeft   bool
	borderStyle  lipgloss.Border

	maxWidth int
	align    lipgloss.Position

	focused bool
}

func (c *container) Init() tea.Cmd {
	if model, ok := c.content.(tea.Model); ok {
		return model.Init()
	}
	return nil
}

func (c *container) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	if model, ok := c.content.(tea.Model); ok {
		u, cmd := model.Update(msg)
		c.content = u.(tea.ViewModel)
		return c, cmd
	}
	return c, nil
}

func (c *container) View() string {
	t := theme.CurrentTheme()
	style := styles.NewStyle().Background(t.Background())
	width := c.width
	height := c.height

	// Apply max width constraint if set
	if c.maxWidth > 0 && width > c.maxWidth {
		width = c.maxWidth
	}

	// Apply border if any side is enabled
	if c.borderTop || c.borderRight || c.borderBottom || c.borderLeft {
		// Adjust width and height for borders
		if c.borderTop {
			height--
		}
		if c.borderBottom {
			height--
		}
		if c.borderLeft {
			width--
		}
		if c.borderRight {
			width--
		}
		style = style.Border(c.borderStyle, c.borderTop, c.borderRight, c.borderBottom, c.borderLeft)

		// Use primary color for border if focused
		if c.focused {
			style = style.BorderBackground(t.Background()).BorderForeground(t.Primary())
		} else {
			style = style.BorderBackground(t.Background()).BorderForeground(t.Border())
		}
	}
	style = style.
		Width(width).
		Height(height).
		PaddingTop(c.paddingTop).
		PaddingRight(c.paddingRight).
		PaddingBottom(c.paddingBottom).
		PaddingLeft(c.paddingLeft)

	return style.Render(c.content.View())
}

func (c *container) SetSize(width, height int) tea.Cmd {
	c.width = width
	c.height = height

	// Apply max width constraint if set
	effectiveWidth := width
	if c.maxWidth > 0 && width > c.maxWidth {
		effectiveWidth = c.maxWidth
	}

	// If the content implements Sizeable, adjust its size to account for padding and borders
	if sizeable, ok := c.content.(Sizeable); ok {
		// Calculate horizontal space taken by padding and borders
		horizontalSpace := c.paddingLeft + c.paddingRight
		if c.borderLeft {
			horizontalSpace++
		}
		if c.borderRight {
			horizontalSpace++
		}

		// Calculate vertical space taken by padding and borders
		verticalSpace := c.paddingTop + c.paddingBottom
		if c.borderTop {
			verticalSpace++
		}
		if c.borderBottom {
			verticalSpace++
		}

		// Set content size with adjusted dimensions
		contentWidth := max(0, effectiveWidth-horizontalSpace)
		contentHeight := max(0, height-verticalSpace)
		return sizeable.SetSize(contentWidth, contentHeight)
	}
	return nil
}

func (c *container) GetSize() (int, int) {
	return min(c.width, c.maxWidth), c.height
}

func (c *container) MaxWidth() int {
	return c.maxWidth
}

func (c *container) Alignment() lipgloss.Position {
	return c.align
}

// Focus sets the container as focused
func (c *container) Focus() tea.Cmd {
	c.focused = true
	if focusable, ok := c.content.(Focusable); ok {
		return focusable.Focus()
	}
	return nil
}

// Blur removes focus from the container
func (c *container) Blur() tea.Cmd {
	c.focused = false
	if blurable, ok := c.content.(Focusable); ok {
		return blurable.Blur()
	}
	return nil
}

func (c *container) IsFocused() bool {
	if blurable, ok := c.content.(Focusable); ok {
		return blurable.IsFocused()
	}
	return c.focused
}

// GetPosition returns the x, y coordinates of the container
func (c *container) GetPosition() (x, y int) {
	return c.x, c.y
}

func (c *container) SetPosition(x, y int) {
	c.x = x
	c.y = y
}

type ContainerOption func(*container)

func NewContainer(content tea.ViewModel, options ...ContainerOption) Container {
	c := &container{
		content:     content,
		borderStyle: lipgloss.NormalBorder(),
	}
	for _, option := range options {
		option(c)
	}
	return c
}

// Padding options
func WithPadding(top, right, bottom, left int) ContainerOption {
	return func(c *container) {
		c.paddingTop = top
		c.paddingRight = right
		c.paddingBottom = bottom
		c.paddingLeft = left
	}
}

func WithPaddingAll(padding int) ContainerOption {
	return WithPadding(padding, padding, padding, padding)
}

func WithPaddingHorizontal(padding int) ContainerOption {
	return func(c *container) {
		c.paddingLeft = padding
		c.paddingRight = padding
	}
}

func WithPaddingVertical(padding int) ContainerOption {
	return func(c *container) {
		c.paddingTop = padding
		c.paddingBottom = padding
	}
}

func WithBorder(top, right, bottom, left bool) ContainerOption {
	return func(c *container) {
		c.borderTop = top
		c.borderRight = right
		c.borderBottom = bottom
		c.borderLeft = left
	}
}

func WithBorderAll() ContainerOption {
	return WithBorder(true, true, true, true)
}

func WithBorderHorizontal() ContainerOption {
	return WithBorder(true, false, true, false)
}

func WithBorderVertical() ContainerOption {
	return WithBorder(false, true, false, true)
}

func WithBorderStyle(style lipgloss.Border) ContainerOption {
	return func(c *container) {
		c.borderStyle = style
	}
}

func WithRoundedBorder() ContainerOption {
	return WithBorderStyle(lipgloss.RoundedBorder())
}

func WithThickBorder() ContainerOption {
	return WithBorderStyle(lipgloss.ThickBorder())
}

func WithDoubleBorder() ContainerOption {
	return WithBorderStyle(lipgloss.DoubleBorder())
}

func WithMaxWidth(maxWidth int) ContainerOption {
	return func(c *container) {
		c.maxWidth = maxWidth
	}
}

func WithAlign(align lipgloss.Position) ContainerOption {
	return func(c *container) {
		c.align = align
	}
}

func WithAlignLeft() ContainerOption {
	return WithAlign(lipgloss.Left)
}

func WithAlignCenter() ContainerOption {
	return WithAlign(lipgloss.Center)
}

func WithAlignRight() ContainerOption {
	return WithAlign(lipgloss.Right)
}
