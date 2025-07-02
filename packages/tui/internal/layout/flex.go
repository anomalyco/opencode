package layout

import (
	"strings"

	"github.com/charmbracelet/lipgloss/v2"
	"github.com/sst/opencode/internal/styles"
)

type Direction int

const (
	Row Direction = iota
	Column
)

type Justify int

const (
	JustifyStart Justify = iota
	JustifyEnd
	JustifyCenter
	JustifySpaceBetween
	JustifySpaceAround
)

type Align int

const (
	AlignStart Align = iota
	AlignEnd
	AlignCenter
	AlignStretch // Only applicable in the cross-axis
)

type FlexOptions struct {
	Direction Direction
	Justify   Justify
	Align     Align
	Width     int
	Height    int
}

type FlexItem struct {
	View      string
	FixedSize int  // Fixed size in the main axis (width for Row, height for Column)
	Grow      bool // If true, the item will grow to fill available space
}

// Render lays out a series of view strings based on flexbox-like rules.
func Render(opts FlexOptions, items ...FlexItem) string {
	if len(items) == 0 {
		return ""
	}

	// Calculate dimensions for each item
	mainAxisSize := opts.Width
	crossAxisSize := opts.Height
	if opts.Direction == Column {
		mainAxisSize = opts.Height
		crossAxisSize = opts.Width
	}

	// Calculate total fixed size and count grow items
	totalFixedSize := 0
	growCount := 0
	for _, item := range items {
		if item.FixedSize > 0 {
			totalFixedSize += item.FixedSize
		} else if item.Grow {
			growCount++
		}
	}

	// Calculate available space for grow items
	availableSpace := max(mainAxisSize-totalFixedSize, 0)

	// Calculate size for each grow item
	growItemSize := 0
	if growCount > 0 && availableSpace > 0 {
		growItemSize = availableSpace / growCount
	}

	// Prepare sized views
	sizedViews := make([]string, len(items))
	actualSizes := make([]int, len(items))

	for i, item := range items {
		view := item.View

		// Determine the size for this item
		itemSize := 0
		if item.FixedSize > 0 {
			itemSize = item.FixedSize
		} else if item.Grow && growItemSize > 0 {
			itemSize = growItemSize
		} else {
			// No fixed size and not growing - use natural size
			if opts.Direction == Row {
				itemSize = lipgloss.Width(view)
			} else {
				itemSize = lipgloss.Height(view)
			}
		}

		// Apply size constraints
		if opts.Direction == Row {
			// For row direction, constrain width and handle height alignment
			if itemSize > 0 {
				view = styles.NewStyle().
					Width(itemSize).
					Height(crossAxisSize).
					Render(view)
			}

			// Apply cross-axis alignment
			switch opts.Align {
			case AlignCenter:
				view = lipgloss.PlaceVertical(crossAxisSize, lipgloss.Center, view)
			case AlignEnd:
				view = lipgloss.PlaceVertical(crossAxisSize, lipgloss.Bottom, view)
			case AlignStart:
				view = lipgloss.PlaceVertical(crossAxisSize, lipgloss.Top, view)
			case AlignStretch:
				// Already stretched by Height setting above
			}
		} else {
			// For column direction, constrain height and handle width alignment
			if itemSize > 0 {
				view = styles.NewStyle().
					Height(itemSize).
					Width(crossAxisSize).
					Render(view)
			}

			// Apply cross-axis alignment
			switch opts.Align {
			case AlignCenter:
				view = lipgloss.PlaceHorizontal(crossAxisSize, lipgloss.Center, view)
			case AlignEnd:
				view = lipgloss.PlaceHorizontal(crossAxisSize, lipgloss.Right, view)
			case AlignStart:
				view = lipgloss.PlaceHorizontal(crossAxisSize, lipgloss.Left, view)
			case AlignStretch:
				// Already stretched by Width setting above
			}
		}

		sizedViews[i] = view
		if opts.Direction == Row {
			actualSizes[i] = lipgloss.Width(view)
		} else {
			actualSizes[i] = lipgloss.Height(view)
		}
	}

	// Calculate total actual size
	totalActualSize := 0
	for _, size := range actualSizes {
		totalActualSize += size
	}

	// Apply justification
	remainingSpace := max(mainAxisSize-totalActualSize, 0)

	// Calculate spacing based on justification
	var spaceBefore, spaceBetween, spaceAfter int
	switch opts.Justify {
	case JustifyStart:
		spaceAfter = remainingSpace
	case JustifyEnd:
		spaceBefore = remainingSpace
	case JustifyCenter:
		spaceBefore = remainingSpace / 2
		spaceAfter = remainingSpace - spaceBefore
	case JustifySpaceBetween:
		if len(items) > 1 {
			spaceBetween = remainingSpace / (len(items) - 1)
		} else {
			spaceAfter = remainingSpace
		}
	case JustifySpaceAround:
		if len(items) > 0 {
			spaceAround := remainingSpace / (len(items) * 2)
			spaceBefore = spaceAround
			spaceAfter = spaceAround
			spaceBetween = spaceAround * 2
		}
	}

	// Build the final layout
	var parts []string

	// Add space before if needed
	if spaceBefore > 0 {
		if opts.Direction == Row {
			parts = append(parts, strings.Repeat(" ", spaceBefore))
		} else {
			parts = append(parts, strings.Repeat("\n", spaceBefore))
		}
	}

	// Add items with spacing
	for i, view := range sizedViews {
		parts = append(parts, view)

		// Add space between items (not after the last one)
		if i < len(sizedViews)-1 && spaceBetween > 0 {
			if opts.Direction == Row {
				parts = append(parts, strings.Repeat(" ", spaceBetween))
			} else {
				parts = append(parts, strings.Repeat("\n", spaceBetween))
			}
		}
	}

	// Add space after if needed
	if spaceAfter > 0 {
		if opts.Direction == Row {
			parts = append(parts, strings.Repeat(" ", spaceAfter))
		} else {
			parts = append(parts, strings.Repeat("\n", spaceAfter))
		}
	}

	// Join the parts
	if opts.Direction == Row {
		return lipgloss.JoinHorizontal(lipgloss.Top, parts...)
	} else {
		return lipgloss.JoinVertical(lipgloss.Left, parts...)
	}
}

// Helper function to create a simple vertical layout
func Vertical(width, height int, items ...FlexItem) string {
	return Render(FlexOptions{
		Direction: Column,
		Width:     width,
		Height:    height,
		Justify:   JustifyStart,
		Align:     AlignStretch,
	}, items...)
}

// Helper function to create a simple horizontal layout
func Horizontal(width, height int, items ...FlexItem) string {
	return Render(FlexOptions{
		Direction: Row,
		Width:     width,
		Height:    height,
		Justify:   JustifyStart,
		Align:     AlignStretch,
	}, items...)
}
