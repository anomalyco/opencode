package layout

import (
	"strings"
	"testing"
)

func TestFlexGap(t *testing.T) {
	tests := []struct {
		name     string
		opts     FlexOptions
		items    []FlexItem
		expected string
	}{
		{
			name: "Row with gap",
			opts: FlexOptions{
				Direction: Row,
				Width:     20,
				Height:    1,
				Gap:       2,
			},
			items: []FlexItem{
				{View: "A"},
				{View: "B"},
				{View: "C"},
			},
			expected: "A  B  C",
		},
		{
			name: "Column with gap",
			opts: FlexOptions{
				Direction: Column,
				Width:     1,
				Height:    5,
				Gap:       1,
				Align:     AlignStart,
			},
			items: []FlexItem{
				{View: "A", FixedSize: 1},
				{View: "B", FixedSize: 1},
				{View: "C", FixedSize: 1},
			},
			expected: "A\n \nB\n \nC",
		},
		{
			name: "Row with gap and justify space between",
			opts: FlexOptions{
				Direction: Row,
				Width:     15,
				Height:    1,
				Gap:       1,
				Justify:   JustifySpaceBetween,
			},
			items: []FlexItem{
				{View: "A"},
				{View: "B"},
				{View: "C"},
			},
			expected: "A      B      C",
		},
		{
			name: "No gap specified",
			opts: FlexOptions{
				Direction: Row,
				Width:     10,
				Height:    1,
			},
			items: []FlexItem{
				{View: "A"},
				{View: "B"},
				{View: "C"},
			},
			expected: "ABC",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := Render(tt.opts, tt.items...)
			// Trim any trailing spaces for comparison
			result = strings.TrimRight(result, " ")
			expected := strings.TrimRight(tt.expected, " ")

			if result != expected {
				t.Errorf("Render() = %q, want %q", result, expected)
			}
		})
	}
}
