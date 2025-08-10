package vim

import (
	"strings"
	"testing"
)

func TestVisualIndicator_Creation(t *testing.T) {
	start := Position{Row: 1, Col: 2}
	end := Position{Row: 3, Col: 4}
	
	vi := NewVisualIndicator(start, end, ModeVisual)
	
	if vi.startRow != 1 || vi.startCol != 2 {
		t.Errorf("Start position incorrect: got (%d,%d), want (1,2)", vi.startRow, vi.startCol)
	}
	if vi.endRow != 3 || vi.endCol != 4 {
		t.Errorf("End position incorrect: got (%d,%d), want (3,4)", vi.endRow, vi.endCol)
	}
	if vi.mode != ModeVisual {
		t.Errorf("Mode incorrect: got %v, want ModeVisual", vi.mode)
	}
}

func TestVisualIndicator_RenderOverlay_NoVisualMode(t *testing.T) {
	// Test with non-visual modes
	modes := []VimMode{ModeNormal, ModeInsert, ModeReplace}
	
	for _, mode := range modes {
		vi := NewVisualIndicator(Position{0, 0}, Position{2, 2}, mode)
		overlay := vi.RenderOverlay(10, 5)
		
		if overlay != "" {
			t.Errorf("RenderOverlay should return empty for mode %v, got: %s", mode, overlay)
		}
	}
}

func TestVisualIndicator_RenderOverlay_CharacterMode(t *testing.T) {
	tests := []struct {
		name      string
		start     Position
		end       Position
		width     int
		height    int
		wantChars map[Position]rune // positions that should have selection character
	}{
		{
			name:   "single line selection",
			start:  Position{Row: 1, Col: 2},
			end:    Position{Row: 1, Col: 4},
			width:  10,
			height: 3,
			wantChars: map[Position]rune{
				{1, 2}: '█',
				{1, 3}: '█',
				{1, 4}: '█',
			},
		},
		{
			name:   "multi-line selection",
			start:  Position{Row: 1, Col: 3},
			end:    Position{Row: 3, Col: 2},
			width:  10,
			height: 5,
			wantChars: map[Position]rune{
				// First line: from col 3 to end
				{1, 3}: '█',
				{1, 4}: '█',
				{1, 5}: '█',
				{1, 6}: '█',
				{1, 7}: '█',
				{1, 8}: '█',
				{1, 9}: '█',
				// Middle line: entire line
				{2, 0}: '█',
				{2, 1}: '█',
				{2, 2}: '█',
				{2, 3}: '█',
				{2, 4}: '█',
				{2, 5}: '█',
				{2, 6}: '█',
				{2, 7}: '█',
				{2, 8}: '█',
				{2, 9}: '█',
				// Last line: from start to col 2
				{3, 0}: '█',
				{3, 1}: '█',
				{3, 2}: '█',
			},
		},
		{
			name:   "single character selection",
			start:  Position{Row: 0, Col: 0},
			end:    Position{Row: 0, Col: 0},
			width:  5,
			height: 1,
			wantChars: map[Position]rune{
				{0, 0}: '█',
			},
		},
	}
	
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			vi := NewVisualIndicator(tt.start, tt.end, ModeVisual)
			overlay := vi.RenderOverlay(tt.width, tt.height)
			
			lines := strings.Split(overlay, "\n")
			if len(lines) != tt.height {
				t.Errorf("Expected %d lines, got %d", tt.height, len(lines))
				return
			}
			
			// Check each position
			for row := 0; row < tt.height; row++ {
				runes := []rune(lines[row])
				if len(runes) != tt.width {
					t.Errorf("Line %d: expected width %d, got %d", row, tt.width, len(runes))
					continue
				}
				
				for col := 0; col < tt.width; col++ {
					pos := Position{row, col}
					wantChar, shouldHaveSelection := tt.wantChars[pos]
					gotChar := runes[col]
					
					if shouldHaveSelection {
						if gotChar != wantChar {
							t.Errorf("Position (%d,%d): expected '%c', got '%c'", 
								row, col, wantChar, gotChar)
						}
					} else {
						if gotChar != ' ' {
							t.Errorf("Position (%d,%d): expected space, got '%c'", 
								row, col, gotChar)
						}
					}
				}
			}
		})
	}
}

func TestVisualIndicator_RenderOverlay_LineMode(t *testing.T) {
	tests := []struct {
		name       string
		start      Position
		end        Position
		width      int
		height     int
		wantLines  []bool // which lines should have selection indicators
	}{
		{
			name:      "single line selection",
			start:     Position{Row: 1, Col: 0},
			end:       Position{Row: 1, Col: 5},
			width:     10,
			height:    3,
			wantLines: []bool{false, true, false},
		},
		{
			name:      "multi-line selection",
			start:     Position{Row: 1, Col: 0},
			end:       Position{Row: 3, Col: 0},
			width:     10,
			height:    5,
			wantLines: []bool{false, true, true, true, false},
		},
		{
			name:      "all lines selection",
			start:     Position{Row: 0, Col: 0},
			end:       Position{Row: 2, Col: 0},
			width:     8,
			height:    3,
			wantLines: []bool{true, true, true},
		},
	}
	
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			vi := NewVisualIndicator(tt.start, tt.end, ModeVisualLine)
			overlay := vi.RenderOverlay(tt.width, tt.height)
			
			lines := strings.Split(overlay, "\n")
			if len(lines) != tt.height {
				t.Errorf("Expected %d lines, got %d", tt.height, len(lines))
				return
			}
			
			for i, line := range lines {
				hasIndicator := strings.HasPrefix(line, "▌") && strings.HasSuffix(line, "▐")
				
				if tt.wantLines[i] {
					if !hasIndicator {
						t.Errorf("Line %d: expected line selection indicator, got: %s", i, line)
					}
					// Check middle is filled with dashes
					if len(line) > 2 {
						middle := line[len("▌") : len(line)-len("▐")]
						expectedMiddle := strings.Repeat("─", tt.width-2)
						if middle != expectedMiddle {
							t.Errorf("Line %d: middle should be dashes, got: %s", i, middle)
						}
					}
				} else {
					if hasIndicator {
						t.Errorf("Line %d: should not have selection indicator, got: %s", i, line)
					}
					// Should be all spaces
					expectedSpaces := strings.Repeat(" ", tt.width)
					if line != expectedSpaces {
						t.Errorf("Line %d: expected all spaces, got: %s", i, line)
					}
				}
			}
		})
	}
}

func TestVisualIndicator_RenderOverlay_BoundaryCases(t *testing.T) {
	tests := []struct {
		name   string
		start  Position
		end    Position
		width  int
		height int
	}{
		{
			name:   "zero width",
			start:  Position{Row: 0, Col: 0},
			end:    Position{Row: 0, Col: 0},
			width:  0,
			height: 1,
		},
		{
			name:   "zero height",
			start:  Position{Row: 0, Col: 0},
			end:    Position{Row: 0, Col: 0},
			width:  10,
			height: 0,
		},
		{
			name:   "selection beyond width",
			start:  Position{Row: 0, Col: 5},
			end:    Position{Row: 0, Col: 15},
			width:  10,
			height: 1,
		},
		{
			name:   "selection beyond height",
			start:  Position{Row: 5, Col: 0},
			end:    Position{Row: 10, Col: 0},
			width:  10,
			height: 3,
		},
	}
	
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			vi := NewVisualIndicator(tt.start, tt.end, ModeVisual)
			overlay := vi.RenderOverlay(tt.width, tt.height)
			
			if tt.height == 0 {
				if overlay != "" {
					t.Error("Expected empty overlay for zero height")
				}
				return
			}
			
			lines := strings.Split(overlay, "\n")
			if len(lines) != tt.height {
				t.Errorf("Expected %d lines, got %d", tt.height, len(lines))
			}
			
			// Verify no panic and reasonable output
			for i, line := range lines {
				runes := []rune(line)
				if len(runes) != tt.width {
					t.Errorf("Line %d: expected width %d, got %d", i, tt.width, len(runes))
				}
			}
		})
	}
}