package vim

import (
	"strings"
)

// VisualIndicator creates a visual selection indicator overlay
type VisualIndicator struct {
	startRow, startCol int
	endRow, endCol     int
	mode               VimMode
}

// NewVisualIndicator creates a new visual indicator
func NewVisualIndicator(start, end Position, mode VimMode) *VisualIndicator {
	return &VisualIndicator{
		startRow: start.Row,
		startCol: start.Col,
		endRow:   end.Row,
		endCol:   end.Col,
		mode:     mode,
	}
}

// RenderOverlay creates an overlay string that shows the selection
func (vi *VisualIndicator) RenderOverlay(width, height int) string {
	if vi.mode != ModeVisual && vi.mode != ModeVisualLine {
		return ""
	}

	var lines []string

	for row := 0; row < height; row++ {
		line := strings.Repeat(" ", width)

		if vi.mode == ModeVisualLine {
			// Line mode - show indicator for entire lines
			if row >= vi.startRow && row <= vi.endRow {
				line = "▌" + strings.Repeat("─", width-2) + "▐"
			}
		} else {
			// Character mode - show indicators for specific positions
			if row == vi.startRow && row == vi.endRow {
				// Single line selection
				if vi.startCol < width && vi.endCol < width {
					runes := []rune(line)
					for col := vi.startCol; col <= vi.endCol && col < len(runes); col++ {
						runes[col] = '█'
					}
					line = string(runes)
				}
			} else if row == vi.startRow {
				// Start of multi-line selection
				runes := []rune(line)
				for col := vi.startCol; col < len(runes); col++ {
					runes[col] = '█'
				}
				line = string(runes)
			} else if row == vi.endRow {
				// End of multi-line selection
				runes := []rune(line)
				for col := 0; col <= vi.endCol && col < len(runes); col++ {
					runes[col] = '█'
				}
				line = string(runes)
			} else if row > vi.startRow && row < vi.endRow {
				// Middle of multi-line selection
				line = strings.Repeat("█", width)
			}
		}

		lines = append(lines, line)
	}

	return strings.Join(lines, "\n")
}
