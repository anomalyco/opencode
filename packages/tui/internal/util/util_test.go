package util

import "testing"

func TestCleanTitle(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "normal title",
			input:    "Hello World",
			expected: "Hello World",
		},
		{
			name:     "multiline title",
			input:    "Hello\nWorld",
			expected: "Hello World",
		},
		{
			name:     "code fence json",
			input:    "```json\n{\"title\": \"Test\"}\n```",
			expected: "{\"title\": \"Test\"}",
		},
		{
			name:     "code fence with language",
			input:    "```python\nprint('hello')\n```",
			expected: "print('hello')",
		},
		{
			name:     "leading and trailing spaces",
			input:    "  Hello World  ",
			expected: "Hello World",
		},
		{
			name:     "multiline with spaces",
			input:    "Hello\n  World\n  Test",
			expected: "Hello   World   Test",
		},
		{
			name:     "empty string",
			input:    "",
			expected: "",
		},
		{
			name:     "only code fence",
			input:    "```",
			expected: "",
		},
		{
			name:     "code fence without content",
			input:    "``````",
			expected: "",
		},
		{
			name:     "code fence with newline",
			input:    "```\n```",
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := CleanTitle(tt.input)
			if result != tt.expected {
				t.Errorf("CleanTitle(%q) = %q; want %q", tt.input, result, tt.expected)
			}
		})
	}
}
