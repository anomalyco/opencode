package chat

import (
	"testing"
)

func TestExtractPathFromURL(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "simple file URL",
			input:    "file:///tmp/test.txt",
			expected: "/tmp/test.txt",
		},
		{
			name:     "file URL with spaces (URL encoded)",
			input:    "file:///tmp/test%20file.txt",
			expected: "/tmp/test file.txt",
		},
		{
			name:     "file URL with special characters",
			input:    "file:///tmp/test%2Bfile%26more.txt",
			expected: "/tmp/test+file&more.txt",
		},
		{
			name:     "file URL with relative path",
			input:    "file://./test.txt",
			expected: "./test.txt",
		},
		{
			name:     "non-file URL (data URL)",
			input:    "data:text/plain;base64,SGVsbG8gV29ybGQ=",
			expected: "data:text/plain;base64,SGVsbG8gV29ybGQ=",
		},
		{
			name:     "non-file URL (http)",
			input:    "https://example.com/file.txt",
			expected: "https://example.com/file.txt",
		},
		{
			name:     "file URL with complex encoding",
			input:    "file:///Users/user/My%20Documents/file%20%28copy%29.txt",
			expected: "/Users/user/My Documents/file (copy).txt",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := extractPathFromURL(tt.input)
			if result != tt.expected {
				t.Errorf("extractPathFromURL(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}
