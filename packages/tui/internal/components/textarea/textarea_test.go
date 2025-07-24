package textarea

import (
	"testing"

	"github.com/sst/opencode/internal/attachment"
)

func TestReplaceRangeAbsolute(t *testing.T) {
	tests := []struct {
		name        string
		initial     string
		startPos    int
		endPos      int
		replacement string
		expected    string
		expectedRow int
		expectedCol int
	}{
		{
			name:        "replace spanning multiple lines",
			initial:     "First\nSecond\nThird",
			startPos:    3, // "st" in "First"
			endPos:      9, // exclusive - up to but not including 'o'
			replacement: "NEW",
			expected:    "FirNEWond\nThird",
			expectedRow: 0,
			expectedCol: 6,
		},
		{
			name:        "replace across newlines",
			initial:     "Line 1\nLine 2\nLine 3",
			startPos:    7,  // Start of "Line 2"
			endPos:      13, // End of "Line 2"
			replacement: "Middle",
			expected:    "Line 1\nMiddle\nLine 3",
			expectedRow: 1,
			expectedCol: 6,
		},
		{
			name:        "replace spanning multiple lines",
			initial:     "First\nSecond\nThird",
			startPos:    3, // "st" in "First"
			endPos:      8, // exclusive - up to but not including 'c'
			replacement: "NEW",
			expected:    "FirNEWcond\nThird",
			expectedRow: 0,
			expectedCol: 6,
		},
		{
			name:        "replace at start",
			initial:     "Hello\nworld",
			startPos:    0,
			endPos:      5,
			replacement: "Hi",
			expected:    "Hi\nworld",
			expectedRow: 0,
			expectedCol: 2,
		},
		{
			name:        "replace at end",
			initial:     "Hello\nworld",
			startPos:    6,
			endPos:      11,
			replacement: "universe",
			expected:    "Hello\nuniverse",
			expectedRow: 1,
			expectedCol: 8,
		},
		{
			name:        "empty replacement",
			initial:     "Hello\nworld",
			startPos:    5,
			endPos:      6,
			replacement: "",
			expected:    "Helloworld",
			expectedRow: 0,
			expectedCol: 5,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := New()
			m.SetValue(tt.initial)

			// Perform the replacement
			m.ReplaceRangeAbsolute(tt.startPos, tt.endPos, tt.replacement)

			// Check the result
			result := m.Value()
			if result != tt.expected {
				t.Errorf("Expected %q, got %q", tt.expected, result)
			}

			// Check cursor position
			if m.row != tt.expectedRow {
				t.Errorf("Expected cursor row %d, got %d", tt.expectedRow, m.row)
			}
			if m.col != tt.expectedCol {
				t.Errorf("Expected cursor col %d, got %d", tt.expectedCol, m.col)
			}
		})
	}
}

func TestReplaceRangeAbsoluteWithAttachments(t *testing.T) {
	m := New()
	m.SetValue("text ")

	// Insert an attachment
	att := &attachment.Attachment{
		ID:      "test-attachment",
		Type:    "file",
		Display: "@file.txt",
	}
	m.InsertAttachment(att)
	m.InsertString("ter")

	// The text now looks like: "text @file.txtter"
	// Position mapping: "text " (0-4) + "@file.txt" (5-13) + "ter" (14-16)
	// Let's replace from position 10 (middle of attachment) to 15 (middle of "ter")
	m.ReplaceRangeAbsolute(10, 15, "NEW")

	result := m.Value()
	// When replacing across attachment boundaries, the entire attachment gets replaced
	// This is the expected behavior for attachment restoration
	expected := "text NEWer"
	if result != expected {
		t.Errorf("Expected %q, got %q", expected, result)
	}
}
func TestAbsolutePosToRowCol(t *testing.T) {
	tests := []struct {
		name        string
		text        string
		absolutePos int
		expectedRow int
		expectedCol int
	}{
		{
			name:        "single line start",
			text:        "Hello world",
			absolutePos: 0,
			expectedRow: 0,
			expectedCol: 0,
		},
		{
			name:        "single line middle",
			text:        "Hello world",
			absolutePos: 6,
			expectedRow: 0,
			expectedCol: 6,
		},
		{
			name:        "single line end",
			text:        "Hello world",
			absolutePos: 11,
			expectedRow: 0,
			expectedCol: 11,
		},
		{
			name:        "multi-line first line",
			text:        "Line 1\nLine 2\nLine 3",
			absolutePos: 3,
			expectedRow: 0,
			expectedCol: 3,
		},
		{
			name:        "multi-line second line start",
			text:        "Line 1\nLine 2\nLine 3",
			absolutePos: 7, // After newline
			expectedRow: 1,
			expectedCol: 0,
		},
		{
			name:        "multi-line second line middle",
			text:        "Line 1\nLine 2\nLine 3",
			absolutePos: 10,
			expectedRow: 1,
			expectedCol: 3,
		},
		{
			name:        "multi-line third line",
			text:        "Line 1\nLine 2\nLine 3",
			absolutePos: 14, // Start of Line 3
			expectedRow: 2,
			expectedCol: 0,
		},
		{
			name:        "beyond end",
			text:        "Short",
			absolutePos: 100,
			expectedRow: 0,
			expectedCol: 5,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := New()
			m.SetValue(tt.text)

			row, col := m.absolutePosToRowCol(tt.absolutePos)

			if row != tt.expectedRow {
				t.Errorf("Expected row %d, got %d", tt.expectedRow, row)
			}
			if col != tt.expectedCol {
				t.Errorf("Expected col %d, got %d", tt.expectedCol, col)
			}
		})
	}
}

func TestReplaceRangeAbsoluteEdgeCases(t *testing.T) {
	t.Run("invalid positions", func(t *testing.T) {
		m := New()
		m.SetValue("Hello world")

		// Test with invalid start position
		m.ReplaceRangeAbsolute(-1, 5, "test")
		if m.Value() != "Hello world" {
			t.Error("Should not modify text with negative start position")
		}

		// Test with end position before start position
		m.ReplaceRangeAbsolute(5, 3, "test")
		if m.Value() != "Hello world" {
			t.Error("Should not modify text when end < start")
		}
	})

	t.Run("empty text", func(t *testing.T) {
		m := New()
		m.ReplaceRangeAbsolute(0, 0, "hello")
		if m.Value() != "hello" {
			t.Errorf("Expected 'hello', got %q", m.Value())
		}
	})

	t.Run("zero-length replacement", func(t *testing.T) {
		m := New()
		m.SetValue("Hello world")
		m.ReplaceRangeAbsolute(5, 5, "NEW")
		expected := "HelloNEW world"
		if m.Value() != expected {
			t.Errorf("Expected %q, got %q", expected, m.Value())
		}
	})
}
