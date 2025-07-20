package rope

import (
	"strings"
	"testing"
)

func TestTextBufferBasicOperations(t *testing.T) {
	// Test creation
	tb := NewTextBuffer("Hello, World!")
	
	if tb.String() != "Hello, World!" {
		t.Errorf("Initial content mismatch: got %q", tb.String())
	}
	
	if tb.Len() != 13 {
		t.Errorf("Initial length mismatch: got %d, want 13", tb.Len())
	}
	
	// Test insert
	tb.Insert(7, "Beautiful ")
	if tb.String() != "Hello, Beautiful World!" {
		t.Errorf("After insert: got %q", tb.String())
	}
	
	// Test delete
	tb.Delete(7, 17)
	if tb.String() != "Hello, World!" {
		t.Errorf("After delete: got %q", tb.String())
	}
	
	// Test substring
	sub := tb.Substring(0, 5)
	if sub != "Hello" {
		t.Errorf("Substring: got %q, want %q", sub, "Hello")
	}
}

func TestTextBufferLines(t *testing.T) {
	content := "Line 1\nLine 2\nLine 3"
	tb := NewTextBuffer(content)
	
	// Test line count
	if tb.LineCount() != 3 {
		t.Errorf("LineCount: got %d, want 3", tb.LineCount())
	}
	
	// Test individual lines
	tests := []struct {
		lineNum int
		want    string
	}{
		{0, "Line 1"},
		{1, "Line 2"},
		{2, "Line 3"},
		{3, ""}, // Out of bounds
		{-1, ""}, // Negative
	}
	
	for _, tt := range tests {
		got := tb.Line(tt.lineNum)
		if got != tt.want {
			t.Errorf("Line(%d): got %q, want %q", tt.lineNum, got, tt.want)
		}
	}
	
	// Test line operations after insert
	tb.Insert(6, "\nNew Line")
	if tb.LineCount() != 4 {
		t.Errorf("After insert, LineCount: got %d, want 4", tb.LineCount())
	}
	
	if tb.Line(1) != "New Line" {
		t.Errorf("After insert, Line(1): got %q, want %q", tb.Line(1), "New Line")
	}
}

func TestTextBufferHighlights(t *testing.T) {
	tb := NewTextBuffer("func main() { println(\"hi\") }")
	
	// Add highlights
	tb.SetHighlight(0, 4, "keyword")   // "func"
	tb.SetHighlight(5, 9, "function")  // "main"
	tb.SetHighlight(22, 26, "string")  // "\"hi\""
	
	// Get overlapping highlights
	highlights := tb.GetHighlights(3, 10)
	if len(highlights) != 2 {
		t.Errorf("GetHighlights: got %d highlights, want 2", len(highlights))
	}
	
	// Test shift on insert
	tb.Insert(4, " test")
	highlights = tb.GetHighlights(0, 5)
	if len(highlights) != 1 {
		t.Errorf("After insert: got %d highlights, want 1", len(highlights))
	}
	
	// The "function" highlight should have shifted
	highlights = tb.GetHighlights(10, 14)
	if len(highlights) != 1 || highlights[0].Value != "function" {
		t.Errorf("Function highlight didn't shift correctly")
	}
}

func TestTextBufferAnnotations(t *testing.T) {
	tb := NewTextBuffer("// TODO: implement this\nfunc todo() {}")
	
	// Add annotations
	tb.SetAnnotation(3, 7, "todo-keyword")
	tb.SetAnnotation(0, 23, "comment")
	
	// Get annotations
	annotations := tb.GetAnnotations(5, 10)
	if len(annotations) != 2 {
		t.Errorf("GetAnnotations: got %d annotations, want 2", len(annotations))
	}
	
	// Test delete shifts
	tb.Delete(0, 24) // Remove entire first line
	annotations = tb.GetAnnotations(0, 20)
	if len(annotations) != 0 {
		t.Errorf("After delete: annotations should be empty, got %d", len(annotations))
	}
}

func TestTextBufferEdgeCases(t *testing.T) {
	tb := NewTextBuffer("")
	
	// Empty buffer operations
	if tb.Len() != 0 {
		t.Errorf("Empty buffer length: got %d, want 0", tb.Len())
	}
	
	if tb.LineCount() != 1 {
		t.Errorf("Empty buffer should have 1 line, got %d", tb.LineCount())
	}
	
	// Insert at various positions
	tb.Insert(-10, "Start")
	if tb.String() != "Start" {
		t.Errorf("Insert at negative pos: got %q", tb.String())
	}
	
	tb.Insert(100, "End")
	if tb.String() != "StartEnd" {
		t.Errorf("Insert past end: got %q", tb.String())
	}
	
	// Delete edge cases
	tb.Delete(100, 200) // Past end
	if tb.String() != "StartEnd" {
		t.Errorf("Delete past end should not change content: got %q", tb.String())
	}
	
	tb.Delete(5, 3) // Inverted range
	if tb.String() != "StartEnd" {
		t.Errorf("Delete inverted range should not change content: got %q", tb.String())
	}
}

func TestTextBufferLargeDocument(t *testing.T) {
	// Create a large document
	var lines []string
	for i := 0; i < 10000; i++ {
		lines = append(lines, strings.Repeat("x", 80))
	}
	content := strings.Join(lines, "\n")
	
	tb := NewTextBuffer(content)
	
	// Test line count
	if tb.LineCount() != 10000 {
		t.Errorf("Large doc line count: got %d, want 10000", tb.LineCount())
	}
	
	// Test middle line access
	line := tb.Line(5000)
	if line != strings.Repeat("x", 80) {
		t.Errorf("Middle line incorrect: got %q", line)
	}
	
	// Test insert in middle
	tb.Insert(400000, "INSERTED")
	if !strings.Contains(tb.String(), "INSERTED") {
		t.Error("Insert in large doc failed")
	}
}

func BenchmarkTextBufferInsert(b *testing.B) {
	content := strings.Repeat("Hello World\n", 1000)
	
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		tb := NewTextBuffer(content)
		tb.Insert(500, "inserted text")
	}
}

func BenchmarkTextBufferLineAccess(b *testing.B) {
	content := strings.Repeat("Hello World\n", 10000)
	tb := NewTextBuffer(content)
	
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = tb.Line(i % 10000)
	}
}

func BenchmarkTextBufferHighlights(b *testing.B) {
	tb := NewTextBuffer(strings.Repeat("func main() { println(\"hi\") }\n", 100))
	
	// Add many highlights
	for i := 0; i < 100; i++ {
		offset := i * 30
		tb.SetHighlight(offset, offset+4, "keyword")
		tb.SetHighlight(offset+5, offset+9, "function")
		tb.SetHighlight(offset+22, offset+26, "string")
	}
	
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = tb.GetHighlights(100, 200)
	}
}