package layout

import (
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
)

type FlexDirection int

const (
	FlexDirectionHorizontal FlexDirection = iota
	FlexDirectionVertical
)

type FlexChildSize struct {
	Fixed bool
	Size  int
}

var FlexChildSizeGrow = FlexChildSize{Fixed: false}

func FlexChildSizeFixed(size int) FlexChildSize {
	return FlexChildSize{Fixed: true, Size: size}
}

type FlexLayout interface {
	tea.ViewModel
	Sizeable
	SetChildren(panes []tea.ViewModel) tea.Cmd
	SetSizes(sizes []FlexChildSize) tea.Cmd
	SetDirection(direction FlexDirection) tea.Cmd
}

type flexLayout struct {
	width     int
	height    int
	direction FlexDirection
	children  []tea.ViewModel
	sizes     []FlexChildSize
}

type FlexLayoutOption func(*flexLayout)

func (f *flexLayout) View() string {
	if len(f.children) == 0 {
		return ""
	}

	t := theme.CurrentTheme()
	views := make([]string, 0, len(f.children))
	for i, child := range f.children {
		if child == nil {
			continue
		}

		alignment := lipgloss.Center
		if alignable, ok := child.(Alignable); ok {
			alignment = alignable.Alignment()
		}
		var childWidth, childHeight int
		if f.direction == FlexDirectionHorizontal {
			childWidth, childHeight = f.calculateChildSize(i)
			view := lipgloss.PlaceHorizontal(
				childWidth,
				alignment,
				child.View(),
				// TODO: make configurable WithBackgroundStyle
				lipgloss.WithWhitespaceStyle(styles.NewStyle().Background(t.Background()).Lipgloss()),
			)
			views = append(views, view)
		} else {
			childWidth, childHeight = f.calculateChildSize(i)
			view := lipgloss.Place(
				f.width,
				childHeight,
				lipgloss.Center,
				alignment,
				child.View(),
				// TODO: make configurable WithBackgroundStyle
				lipgloss.WithWhitespaceStyle(styles.NewStyle().Background(t.Background()).Lipgloss()),
			)
			views = append(views, view)
		}
	}
	if f.direction == FlexDirectionHorizontal {
		return lipgloss.JoinHorizontal(lipgloss.Center, views...)
	}
	return lipgloss.JoinVertical(lipgloss.Center, views...)
}

func (f *flexLayout) calculateChildSize(index int) (width, height int) {
	if index >= len(f.children) {
		return 0, 0
	}

	totalFixed := 0
	flexCount := 0

	for i, child := range f.children {
		if child == nil {
			continue
		}
		if i < len(f.sizes) && f.sizes[i].Fixed {
			if f.direction == FlexDirectionHorizontal {
				totalFixed += f.sizes[i].Size
			} else {
				totalFixed += f.sizes[i].Size
			}
		} else {
			flexCount++
		}
	}

	if f.direction == FlexDirectionHorizontal {
		height = f.height
		if index < len(f.sizes) && f.sizes[index].Fixed {
			width = f.sizes[index].Size
		} else if flexCount > 0 {
			remainingSpace := f.width - totalFixed
			width = remainingSpace / flexCount
		}
	} else {
		width = f.width
		if index < len(f.sizes) && f.sizes[index].Fixed {
			height = f.sizes[index].Size
		} else if flexCount > 0 {
			remainingSpace := f.height - totalFixed
			height = remainingSpace / flexCount
		}
	}

	return width, height
}

func (f *flexLayout) SetSize(width, height int) tea.Cmd {
	f.width = width
	f.height = height

	var cmds []tea.Cmd
	currentX, currentY := 0, 0

	for i, child := range f.children {
		if child != nil {
			paneWidth, paneHeight := f.calculateChildSize(i)
			alignment := lipgloss.Center
			if alignable, ok := child.(Alignable); ok {
				alignment = alignable.Alignment()
			}

			// Calculate actual position based on alignment
			actualX, actualY := currentX, currentY

			if f.direction == FlexDirectionHorizontal {
				// In horizontal layout, vertical alignment affects Y position
				// (lipgloss.Center is used for vertical alignment in JoinHorizontal)
				actualY = (f.height - paneHeight) / 2
			} else {
				// In vertical layout, horizontal alignment affects X position
				contentWidth := paneWidth
				if alignable, ok := child.(Alignable); ok {
					if alignable.MaxWidth() > 0 && contentWidth > alignable.MaxWidth() {
						contentWidth = alignable.MaxWidth()
					}
				}

				switch alignment {
				case lipgloss.Center:
					actualX = (f.width - contentWidth) / 2
				case lipgloss.Right:
					actualX = f.width - contentWidth
				case lipgloss.Left:
					actualX = 0
				}
			}

			// Set position if the pane is Alignable
			if c, ok := child.(Alignable); ok {
				c.SetPosition(actualX, actualY)
			}

			if sizeable, ok := child.(Sizeable); ok {
				cmd := sizeable.SetSize(paneWidth, paneHeight)
				cmds = append(cmds, cmd)
			}

			// Update position for next pane
			if f.direction == FlexDirectionHorizontal {
				currentX += paneWidth
			} else {
				currentY += paneHeight
			}
		}
	}
	return tea.Batch(cmds...)
}

func (f *flexLayout) GetSize() (int, int) {
	return f.width, f.height
}

func (f *flexLayout) SetChildren(children []tea.ViewModel) tea.Cmd {
	f.children = children
	if f.width > 0 && f.height > 0 {
		return f.SetSize(f.width, f.height)
	}
	return nil
}

func (f *flexLayout) SetSizes(sizes []FlexChildSize) tea.Cmd {
	f.sizes = sizes
	if f.width > 0 && f.height > 0 {
		return f.SetSize(f.width, f.height)
	}
	return nil
}

func (f *flexLayout) SetDirection(direction FlexDirection) tea.Cmd {
	f.direction = direction
	if f.width > 0 && f.height > 0 {
		return f.SetSize(f.width, f.height)
	}
	return nil
}

func NewFlexLayout(children []tea.ViewModel, options ...FlexLayoutOption) FlexLayout {
	layout := &flexLayout{
		children:  children,
		direction: FlexDirectionHorizontal,
		sizes:     []FlexChildSize{},
	}
	for _, option := range options {
		option(layout)
	}
	return layout
}

func WithDirection(direction FlexDirection) FlexLayoutOption {
	return func(f *flexLayout) {
		f.direction = direction
	}
}

func WithChildren(children ...tea.ViewModel) FlexLayoutOption {
	return func(f *flexLayout) {
		f.children = children
	}
}

func WithSizes(sizes ...FlexChildSize) FlexLayoutOption {
	return func(f *flexLayout) {
		f.sizes = sizes
	}
}
