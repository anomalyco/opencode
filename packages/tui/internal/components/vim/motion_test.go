package vim

import (
	"testing"
)

func TestMotionEngine_BasicMotions(t *testing.T) {
	tests := []struct {
		name     string
		buffer   [][]rune
		startPos Position
		motion   Motion
		wantPos  Position
	}{
		// Character motions
		{
			name:     "h moves left",
			buffer:   [][]rune{{'h', 'e', 'l', 'l', 'o'}},
			startPos: Position{Row: 0, Col: 2},
			motion:   Motion{Type: MotionLeft, Count: 1},
			wantPos:  Position{Row: 0, Col: 1},
		},
		{
			name:     "h at start of line stays",
			buffer:   [][]rune{{'h', 'e', 'l', 'l', 'o'}},
			startPos: Position{Row: 0, Col: 0},
			motion:   Motion{Type: MotionLeft, Count: 1},
			wantPos:  Position{Row: 0, Col: 0},
		},
		{
			name:     "l moves right",
			buffer:   [][]rune{{'h', 'e', 'l', 'l', 'o'}},
			startPos: Position{Row: 0, Col: 2},
			motion:   Motion{Type: MotionRight, Count: 1},
			wantPos:  Position{Row: 0, Col: 3},
		},
		{
			name:     "l at end of line stays",
			buffer:   [][]rune{{'h', 'e', 'l', 'l', 'o'}},
			startPos: Position{Row: 0, Col: 4},
			motion:   Motion{Type: MotionRight, Count: 1},
			wantPos:  Position{Row: 0, Col: 4},
		},
		{
			name:     "j moves down",
			buffer:   [][]rune{{'l', 'i', 'n', 'e', '1'}, {'l', 'i', 'n', 'e', '2'}},
			startPos: Position{Row: 0, Col: 2},
			motion:   Motion{Type: MotionDown, Count: 1},
			wantPos:  Position{Row: 1, Col: 2},
		},
		{
			name:     "k moves up",
			buffer:   [][]rune{{'l', 'i', 'n', 'e', '1'}, {'l', 'i', 'n', 'e', '2'}},
			startPos: Position{Row: 1, Col: 2},
			motion:   Motion{Type: MotionUp, Count: 1},
			wantPos:  Position{Row: 0, Col: 2},
		},
		// Word motions
		{
			name:     "w moves to next word",
			buffer:   [][]rune{{'h', 'e', 'l', 'l', 'o', ' ', 'w', 'o', 'r', 'l', 'd'}},
			startPos: Position{Row: 0, Col: 0},
			motion:   Motion{Type: MotionWord, Count: 1},
			wantPos:  Position{Row: 0, Col: 6},
		},
		{
			name:     "b moves to previous word",
			buffer:   [][]rune{{'h', 'e', 'l', 'l', 'o', ' ', 'w', 'o', 'r', 'l', 'd'}},
			startPos: Position{Row: 0, Col: 7},
			motion:   Motion{Type: MotionBackWord, Count: 1},
			wantPos:  Position{Row: 0, Col: 0},
		},
		{
			name:     "e moves to end of word",
			buffer:   [][]rune{{'h', 'e', 'l', 'l', 'o', ' ', 'w', 'o', 'r', 'l', 'd'}},
			startPos: Position{Row: 0, Col: 0},
			motion:   Motion{Type: MotionEndWord, Count: 1},
			wantPos:  Position{Row: 0, Col: 4},
		},
		// Line motions
		{
			name:     "0 moves to start of line",
			buffer:   [][]rune{{'h', 'e', 'l', 'l', 'o'}},
			startPos: Position{Row: 0, Col: 3},
			motion:   Motion{Type: MotionLineStart, Count: 1},
			wantPos:  Position{Row: 0, Col: 0},
		},
		{
			name:     "$ moves to end of line",
			buffer:   [][]rune{{'h', 'e', 'l', 'l', 'o'}},
			startPos: Position{Row: 0, Col: 0},
			motion:   Motion{Type: MotionLineEnd, Count: 1, Inclusive: true},
			wantPos:  Position{Row: 0, Col: 4},
		},
		// File motions
		{
			name:     "gg moves to first line",
			buffer:   [][]rune{{'l', 'i', 'n', 'e', '1'}, {'l', 'i', 'n', 'e', '2'}, {'l', 'i', 'n', 'e', '3'}},
			startPos: Position{Row: 2, Col: 2},
			motion:   Motion{Type: MotionFileStart, Count: 1},
			wantPos:  Position{Row: 0, Col: 0},
		},
		{
			name:     "G moves to last line",
			buffer:   [][]rune{{'l', 'i', 'n', 'e', '1'}, {'l', 'i', 'n', 'e', '2'}, {'l', 'i', 'n', 'e', '3'}},
			startPos: Position{Row: 0, Col: 2},
			motion:   Motion{Type: MotionFileEnd, Count: 1},
			wantPos:  Position{Row: 2, Col: 0},
		},
		// Count support
		{
			name:     "3h moves left 3 times",
			buffer:   [][]rune{{'h', 'e', 'l', 'l', 'o'}},
			startPos: Position{Row: 0, Col: 4},
			motion:   Motion{Type: MotionLeft, Count: 3},
			wantPos:  Position{Row: 0, Col: 1},
		},
		{
			name:     "2w moves forward 2 words",
			buffer:   [][]rune{{'o', 'n', 'e', ' ', 't', 'w', 'o', ' ', 't', 'h', 'r', 'e', 'e'}},
			startPos: Position{Row: 0, Col: 0},
			motion:   Motion{Type: MotionWord, Count: 2},
			wantPos:  Position{Row: 0, Col: 8},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Convert [][]rune to [][]any for compatibility
			buffer := make([][]any, len(tt.buffer))
			for i, row := range tt.buffer {
				buffer[i] = make([]any, len(row))
				for j, r := range row {
					buffer[i][j] = r
				}
			}

			engine := NewMotionEngine()
			gotPos := engine.Execute(buffer, tt.startPos, tt.motion)
			if gotPos != tt.wantPos {
				t.Errorf("Execute() = %v, want %v", gotPos, tt.wantPos)
			}
		})
	}
}

func TestMotionEngine_CharacterSearch(t *testing.T) {
	tests := []struct {
		name     string
		buffer   [][]rune
		startPos Position
		motion   Motion
		wantPos  Position
	}{
		{
			name:     "f finds character forward",
			buffer:   [][]rune{{'h', 'e', 'l', 'l', 'o', ' ', 'w', 'o', 'r', 'l', 'd'}},
			startPos: Position{Row: 0, Col: 0},
			motion:   Motion{Type: MotionFindChar, Count: 1, Char: 'o', Inclusive: true},
			wantPos:  Position{Row: 0, Col: 4},
		},
		{
			name:     "F finds character backward",
			buffer:   [][]rune{{'h', 'e', 'l', 'l', 'o', ' ', 'w', 'o', 'r', 'l', 'd'}},
			startPos: Position{Row: 0, Col: 8},
			motion:   Motion{Type: MotionFindCharBack, Count: 1, Char: 'l', Inclusive: true},
			wantPos:  Position{Row: 0, Col: 3},
		},
		{
			name:     "t moves till character (before)",
			buffer:   [][]rune{{'h', 'e', 'l', 'l', 'o', ' ', 'w', 'o', 'r', 'l', 'd'}},
			startPos: Position{Row: 0, Col: 0},
			motion:   Motion{Type: MotionTillChar, Count: 1, Char: 'o', Inclusive: false},
			wantPos:  Position{Row: 0, Col: 3},
		},
		{
			name:     "T moves till character backward (after)",
			buffer:   [][]rune{{'h', 'e', 'l', 'l', 'o', ' ', 'w', 'o', 'r', 'l', 'd'}},
			startPos: Position{Row: 0, Col: 8},
			motion:   Motion{Type: MotionTillCharBack, Count: 1, Char: 'l', Inclusive: false},
			wantPos:  Position{Row: 0, Col: 4},
		},
		{
			name:     "2fo finds second 'o'",
			buffer:   [][]rune{{'h', 'e', 'l', 'l', 'o', ' ', 'w', 'o', 'r', 'l', 'd'}},
			startPos: Position{Row: 0, Col: 0},
			motion:   Motion{Type: MotionFindChar, Count: 2, Char: 'o', Inclusive: true},
			wantPos:  Position{Row: 0, Col: 7},
		},
		{
			name:     "fx for non-existent character stays in place",
			buffer:   [][]rune{{'h', 'e', 'l', 'l', 'o'}},
			startPos: Position{Row: 0, Col: 0},
			motion:   Motion{Type: MotionFindChar, Count: 1, Char: 'x', Inclusive: true},
			wantPos:  Position{Row: 0, Col: 0},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Convert [][]rune to [][]any for compatibility
			buffer := make([][]any, len(tt.buffer))
			for i, row := range tt.buffer {
				buffer[i] = make([]any, len(row))
				for j, r := range row {
					buffer[i][j] = r
				}
			}

			engine := NewMotionEngine()
			gotPos := engine.Execute(buffer, tt.startPos, tt.motion)
			if gotPos != tt.wantPos {
				t.Errorf("Execute() = %v, want %v", gotPos, tt.wantPos)
			}
		})
	}
}

func TestMotionEngine_TextObjects(t *testing.T) {
	tests := []struct {
		name      string
		buffer    [][]rune
		startPos  Position
		motion    Motion
		wantStart Position
		wantEnd   Position
	}{
		{
			name:      "iw selects inner word",
			buffer:    [][]rune{{'h', 'e', 'l', 'l', 'o', ' ', 'w', 'o', 'r', 'l', 'd'}},
			startPos:  Position{Row: 0, Col: 2},
			motion:    Motion{Type: MotionInnerWord, Count: 1},
			wantStart: Position{Row: 0, Col: 0},
			wantEnd:   Position{Row: 0, Col: 4},
		},
		{
			name:      "aw selects around word (includes trailing space)",
			buffer:    [][]rune{{'h', 'e', 'l', 'l', 'o', ' ', 'w', 'o', 'r', 'l', 'd'}},
			startPos:  Position{Row: 0, Col: 2},
			motion:    Motion{Type: MotionAroundWord, Count: 1},
			wantStart: Position{Row: 0, Col: 0},
			wantEnd:   Position{Row: 0, Col: 5},
		},
		{
			name:      "i\" selects inner quotes",
			buffer:    [][]rune{{'"', 'h', 'e', 'l', 'l', 'o', '"', ' ', 'w', 'o', 'r', 'l', 'd'}},
			startPos:  Position{Row: 0, Col: 3},
			motion:    Motion{Type: MotionInnerQuotes, Count: 1},
			wantStart: Position{Row: 0, Col: 1},
			wantEnd:   Position{Row: 0, Col: 5},
		},
		{
			name:      "a\" selects around quotes (includes quotes)",
			buffer:    [][]rune{{'"', 'h', 'e', 'l', 'l', 'o', '"', ' ', 'w', 'o', 'r', 'l', 'd'}},
			startPos:  Position{Row: 0, Col: 3},
			motion:    Motion{Type: MotionAroundQuotes, Count: 1},
			wantStart: Position{Row: 0, Col: 0},
			wantEnd:   Position{Row: 0, Col: 6},
		},
		{
			name:      "i{ selects inner braces",
			buffer:    [][]rune{{'{', 'c', 'o', 'd', 'e', '}'}},
			startPos:  Position{Row: 0, Col: 2},
			motion:    Motion{Type: MotionInnerBraces, Count: 1},
			wantStart: Position{Row: 0, Col: 1},
			wantEnd:   Position{Row: 0, Col: 4},
		},
		{
			name:      "a{ selects around braces",
			buffer:    [][]rune{{'{', 'c', 'o', 'd', 'e', '}'}},
			startPos:  Position{Row: 0, Col: 2},
			motion:    Motion{Type: MotionAroundBraces, Count: 1},
			wantStart: Position{Row: 0, Col: 0},
			wantEnd:   Position{Row: 0, Col: 5},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Convert [][]rune to [][]any for compatibility
			buffer := make([][]any, len(tt.buffer))
			for i, row := range tt.buffer {
				buffer[i] = make([]any, len(row))
				for j, r := range row {
					buffer[i][j] = r
				}
			}

			engine := NewMotionEngine()
			gotStart, gotEnd := engine.GetTextObjectRange(buffer, tt.startPos, tt.motion.Type)
			if gotStart != tt.wantStart || gotEnd != tt.wantEnd {
				t.Errorf("GetTextObjectRange() = (%v, %v), want (%v, %v)", 
					gotStart, gotEnd, tt.wantStart, tt.wantEnd)
			}
		})
	}
}

func TestMotionEngine_EdgeCases(t *testing.T) {
	tests := []struct {
		name     string
		buffer   [][]rune
		startPos Position
		motion   Motion
		wantPos  Position
	}{
		{
			name:     "empty buffer returns origin",
			buffer:   [][]rune{},
			startPos: Position{Row: 0, Col: 0},
			motion:   Motion{Type: MotionRight, Count: 1},
			wantPos:  Position{Row: 0, Col: 0},
		},
		{
			name:     "motion beyond buffer bounds clamps",
			buffer:   [][]rune{{'h', 'i'}},
			startPos: Position{Row: 0, Col: 0},
			motion:   Motion{Type: MotionRight, Count: 10},
			wantPos:  Position{Row: 0, Col: 1},
		},
		{
			name:     "gg on empty line works",
			buffer:   [][]rune{{}, {'t', 'e', 's', 't'}},
			startPos: Position{Row: 1, Col: 0},
			motion:   Motion{Type: MotionFileStart, Count: 1},
			wantPos:  Position{Row: 0, Col: 0},
		},
		{
			name:     "$ on empty line stays at 0",
			buffer:   [][]rune{{}},
			startPos: Position{Row: 0, Col: 0},
			motion:   Motion{Type: MotionLineEnd, Count: 1},
			wantPos:  Position{Row: 0, Col: 0},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Convert [][]rune to [][]any for compatibility
			buffer := make([][]any, len(tt.buffer))
			for i, row := range tt.buffer {
				buffer[i] = make([]any, len(row))
				for j, r := range row {
					buffer[i][j] = r
				}
			}

			engine := NewMotionEngine()
			gotPos := engine.Execute(buffer, tt.startPos, tt.motion)
			if gotPos != tt.wantPos {
				t.Errorf("Execute() = %v, want %v", gotPos, tt.wantPos)
			}
		})
	}
}