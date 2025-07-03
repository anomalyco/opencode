package layout

import (
	"strings"

	"github.com/charmbracelet/lipgloss/v2"
	"github.com/charmbracelet/lipgloss/v2/compat"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
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
	Background *compat.AdaptiveColor
	Direction  Direction
	Justify    Justify
	Align      Align
	Width      int
	Height     int
	Gap        int
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

	t := theme.CurrentTheme()
	if opts.Background == nil {
		background := t.Background()
		opts.Background = &background
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

	// Account for gaps between items
	totalGapSize := 0
	if len(items) > 1 && opts.Gap > 0 {
		totalGapSize = opts.Gap * (len(items) - 1)
	}

	// Calculate available space for grow items
	availableSpace := max(mainAxisSize-totalFixedSize-totalGapSize, 0)

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
					Background(*opts.Background).
					Width(itemSize).
					Height(crossAxisSize).
					Render(view)
			}

			// Apply cross-axis alignment
			switch opts.Align {
			case AlignCenter:
				view = lipgloss.PlaceVertical(
					crossAxisSize,
					lipgloss.Center,
					view,
					styles.WhitespaceStyle(*opts.Background),
				)
			case AlignEnd:
				view = lipgloss.PlaceVertical(
					crossAxisSize,
					lipgloss.Bottom,
					view,
					styles.WhitespaceStyle(*opts.Background),
				)
			case AlignStart:
				view = lipgloss.PlaceVertical(
					crossAxisSize,
					lipgloss.Top,
					view,
					styles.WhitespaceStyle(*opts.Background),
				)
			case AlignStretch:
				// Already stretched by Height setting above
			}
		} else {
			// For column direction, constrain height and handle width alignment
			if itemSize > 0 {
				style := styles.NewStyle().
					Background(*opts.Background).
					Height(itemSize)
				// Only set width for stretch alignment
				if opts.Align == AlignStretch {
					style = style.Width(crossAxisSize)
				}
				view = style.Render(view)
			}

			// Apply cross-axis alignment
			switch opts.Align {
			case AlignCenter:
				view = lipgloss.PlaceHorizontal(
					crossAxisSize,
					lipgloss.Center,
					view,
					styles.WhitespaceStyle(*opts.Background),
				)
			case AlignEnd:
				view = lipgloss.PlaceHorizontal(
					crossAxisSize,
					lipgloss.Right,
					view,
					styles.WhitespaceStyle(*opts.Background),
				)
			case AlignStart:
				view = lipgloss.PlaceHorizontal(
					crossAxisSize,
					lipgloss.Left,
					view,
					styles.WhitespaceStyle(*opts.Background),
				)
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

	// Calculate total actual size including gaps
	totalActualSize := 0
	for _, size := range actualSizes {
		totalActualSize += size
	}
	if len(items) > 1 && opts.Gap > 0 {
		totalActualSize += opts.Gap * (len(items) - 1)
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

	spaceStyle := styles.NewStyle().Background(*opts.Background)
	// Add space before if needed
	if spaceBefore > 0 {
		if opts.Direction == Row {
			space := strings.Repeat(" ", spaceBefore)
			parts = append(parts, spaceStyle.Render(space))
		} else {
			// For vertical layout, add empty lines as separate parts
			for range spaceBefore {
				parts = append(parts, "")
			}
		}
	}

	// Add items with spacing
	for i, view := range sizedViews {
		parts = append(parts, view)

		// Add space between items (not after the last one)
		if i < len(sizedViews)-1 {
			// Add gap first, then any additional spacing from justification
			totalSpacing := opts.Gap + spaceBetween
			if totalSpacing > 0 {
				if opts.Direction == Row {
					space := strings.Repeat(" ", totalSpacing)
					parts = append(parts, spaceStyle.Render(space))
				} else {
					// For vertical layout, add empty lines as separate parts
					for range totalSpacing {
						parts = append(parts, "")
					}
				}
			}
		}
	}

	// Add space after if needed
	if spaceAfter > 0 {
		if opts.Direction == Row {
			space := strings.Repeat(" ", spaceAfter)
			parts = append(parts, spaceStyle.Render(space))
		} else {
			// For vertical layout, add empty lines as separate parts
			for range spaceAfter {
				parts = append(parts, "")
			}
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
