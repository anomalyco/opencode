package chat

import (
	"strings"
	"testing"
)

// TestProcessInlineCode verifies that the processInlineCode function correctly
// escapes angle brackets in plain text while preserving them in inline code segments.
func TestProcessInlineCode(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "plain text with angle brackets",
			input:    "This is <some> text with <angle brackets>",
			expected: "This is \\<some\\> text with \\<angle brackets\\>",
		},
		{
			name:     "inline code with angle brackets",
			input:    "This is `<some>` code with angle brackets",
			expected: "This is `<some>` code with angle brackets",
		},
		{
			name:     "multiple inline code segments",
			input:    "Text with `<code>` and more `<brackets>` in different segments",
			expected: "Text with `<code>` and more `<brackets>` in different segments",
		},
		{
			name:     "mixed content",
			input:    "Normal <tag> with `<code>` and then <another> tag",
			expected: "Normal \\<tag\\> with `<code>` and then \\<another\\> tag",
		},
		{
			name:     "angle bracket at end of line",
			input:    "Text ending with <",
			expected: "Text ending with \\<",
		},
		{
			name:     "unclosed inline code",
			input:    "This has unclosed `<code>",
			expected: "This has unclosed `<code>",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := processInlineCode(tt.input)
			if result != tt.expected {
				t.Errorf("processInlineCode() = %q, want %q", result, tt.expected)
			}
		})
	}
}

// TestCodeBlockAngleBrackets tests the code block detection logic to ensure
// that angle brackets are escaped in plain text but preserved in code blocks.
func TestCodeBlockAngleBrackets(t *testing.T) {
	tests := []struct {
		name         string
		input        string
		shouldEscape []bool // For each line, should angle brackets be escaped?
	}{
		{
			name:         "plain text outside code block",
			input:        "This is <some> text",
			shouldEscape: []bool{true},
		},
		{
			name:         "text inside code block",
			input:        "```\n<html>\n</html>\n```",
			shouldEscape: []bool{false, false, false, false},
		},
		{
			name:         "text with inline code",
			input:        "Text with `<code>` segment",
			shouldEscape: []bool{true}, // The line will be processed by processInlineCode which handles inline code
		},
		{
			name:         "mixed content",
			input:        "Text before\n```\n<div>\n  <p>Content</p>\n</div>\n```\nText after",
			shouldEscape: []bool{true, false, false, false, false, false, true},
		},
		{
			name:         "nested angle brackets",
			input:        "Text <outer <inner> outer>\n```\n<outer <inner> outer>\n```",
			shouldEscape: []bool{true, false, false, false},
		},
		{
			name:         "tilde code blocks",
			input:        "Text before\n~~~\n<div>\n  <p>Content</p>\n</div>\n~~~\nText after",
			shouldEscape: []bool{true, false, false, false, false, false, true},
		},
		{
			name:         "code blocks with language specifier",
			input:        "Text before\n```html\n<div>\n  <p>Content</p>\n</div>\n```\nText after",
			shouldEscape: []bool{true, false, false, false, false, false, true},
		},
		{
			name:         "code blocks with complex language specifier",
			input:        "Text before\n```javascript {.line-numbers}\n<div>\n  const element = document.createElement('<p>');\n</div>\n```\nText after",
			shouldEscape: []bool{true, false, false, false, false, false, true},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Simulate the code block detection logic from toMarkdown
			lines := strings.Split(tt.input, "\n")
			inCodeBlock := false
			codeBlockMarker := ""

			for i, line := range lines {
				// Check if we should be escaping this line based on test case
				expectedEscape := tt.shouldEscape[i]

				// Check for code block markers (``` or ~~~)
				if strings.HasPrefix(strings.TrimSpace(line), "```") || strings.HasPrefix(strings.TrimSpace(line), "~~~") {
					marker := line[:3]
					if !inCodeBlock {
						// Start of code block
						inCodeBlock = true
						codeBlockMarker = marker
					} else if strings.HasPrefix(strings.TrimSpace(line), codeBlockMarker) {
						// End of code block
						inCodeBlock = false
					}
				}

				// Verify our code block detection matches expected behavior
				if inCodeBlock || strings.HasPrefix(strings.TrimSpace(line), "```") || strings.HasPrefix(strings.TrimSpace(line), "~~~") {
					// Inside code block or marker line - should not escape
					if expectedEscape {
						t.Errorf("Line %d should not be in a code block, but was detected as such: %q", i, line)
					}
				} else {
					// Outside code block - should escape
					if !expectedEscape {
						t.Errorf("Line %d should be in a code block, but was not detected as such: %q", i, line)
					}

					// If the line contains angle brackets, verify processInlineCode escapes them
					if strings.Contains(line, "<") || strings.Contains(line, ">") {
						processed := processInlineCode(line)
						// Check that angle brackets are escaped, but not those in inline code
						if !strings.Contains(processed, "\\<") && !strings.Contains(processed, "\\>") &&
							(strings.Contains(line, "<") || strings.Contains(line, ">")) &&
							!strings.Contains(line, "`") {
							t.Errorf("Angle brackets should be escaped in line: %q, got: %q", line, processed)
						}
					}
				}
			}
		})
	}
}
