package vim

import (
	"testing"
)

// This file contains regression tests for specific motion behaviors
// that were identified during development.

// TestBackwardWordMotion validates the backward word motion behavior,
// particularly the edge case where the cursor is in the middle of a word.
func TestBackwardWordMotion(t *testing.T) {
	tests := []struct {
		name      string
		buffer    string
		startCol  int
		wantCol   int
	}{
		{
			name:     "from middle of second word",
			buffer:   "hello world",
			startCol: 7, // 'o' in "world"
			wantCol:  0, // 'h' in "hello"
		},
		{
			name:     "from start of second word",
			buffer:   "hello world",
			startCol: 6, // 'w' in "world"
			wantCol:  0, // 'h' in "hello"
		},
		{
			name:     "from end of first word",
			buffer:   "hello world",
			startCol: 4, // 'o' in "hello"
			wantCol:  0, // 'h' in "hello"
		},
		{
			name:     "from whitespace",
			buffer:   "hello world",
			startCol: 5, // space
			wantCol:  0, // 'h' in "hello"
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Convert string to buffer format
			buffer := [][]any{make([]any, len(tt.buffer))}
			for i, r := range tt.buffer {
				buffer[0][i] = r
			}
			
			engine := NewMotionEngine()
			motion := Motion{Type: MotionBackWord, Count: 1}
			startPos := Position{Row: 0, Col: tt.startCol}
			
			result := engine.Execute(buffer, startPos, motion)
			
			if result.Col != tt.wantCol {
				t.Errorf("backward word from col %d: got col %d, want col %d",
					tt.startCol, result.Col, tt.wantCol)
			}
		})
	}
}

// TestFileEndMotion validates that G motion goes to column 0 of the last line,
// not the end of the last line (vim standard behavior).
func TestFileEndMotion(t *testing.T) {
	buffer := [][]any{
		{'l', 'i', 'n', 'e', '1'},
		{'l', 'i', 'n', 'e', '2'},
		{'l', 'i', 'n', 'e', '3'},
	}
	
	engine := NewMotionEngine()
	motion := Motion{Type: MotionFileEnd, Count: 1}
	startPos := Position{Row: 0, Col: 2}
	
	result := engine.Execute(buffer, startPos, motion)
	
	if result.Row != 2 || result.Col != 0 {
		t.Errorf("G motion: got (%d,%d), want (2,0)", result.Row, result.Col)
	}
}