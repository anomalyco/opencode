// Package rope provides a rope data structure adapter for TUI components.
// This adapter integrates the rope implementation with TUI-specific features
// like syntax highlighting, annotations, and efficient rendering.
package rope

import (
	"github.com/sst/opencode/internal/rangemap"
)

// TextBuffer wraps a rope with additional metadata for TUI components.
type TextBuffer struct {
	rope        *Rope
	lineCache   []int // Cache of line start positions
	highlights  *rangemap.RangeMap[string] // Syntax highlighting ranges
	annotations *rangemap.RangeMap[string] // User annotations (comments, etc.)
}

// NewTextBuffer creates a new text buffer with the given initial content.
func NewTextBuffer(content string) *TextBuffer {
	return &TextBuffer{
		rope:        New(content),
		highlights:  rangemap.New[string](),
		annotations: rangemap.New[string](),
	}
}

// String returns the entire buffer content as a string.
func (tb *TextBuffer) String() string {
	return tb.rope.String()
}

// Len returns the length of the buffer in bytes.
func (tb *TextBuffer) Len() int {
	return tb.rope.Len()
}

// Insert inserts text at the given position.
func (tb *TextBuffer) Insert(pos int, text string) {
	if pos < 0 {
		pos = 0
	}
	if pos > tb.rope.Len() {
		pos = tb.rope.Len()
	}
	
	// Update rope
	tb.rope = tb.rope.Insert(pos, text)
	
	// Shift metadata ranges
	insertLen := len(text)
	tb.highlights.Shift(insertLen, pos)
	tb.annotations.Shift(insertLen, pos)
	
	// Invalidate line cache
	tb.lineCache = nil
}

// Delete removes text between start and end positions.
func (tb *TextBuffer) Delete(start, end int) {
	if start < 0 {
		start = 0
	}
	if end > tb.rope.Len() {
		end = tb.rope.Len()
	}
	if start >= end {
		return
	}
	
	// Update rope
	tb.rope = tb.rope.Delete(start, end)
	
	// Shift metadata ranges
	deleteLen := end - start
	tb.highlights.Shift(-deleteLen, start)
	tb.annotations.Shift(-deleteLen, start)
	
	// Invalidate line cache
	tb.lineCache = nil
}

// Substring returns a substring between start and end positions.
func (tb *TextBuffer) Substring(start, end int) string {
	if start < 0 {
		start = 0
	}
	if end > tb.rope.Len() {
		end = tb.rope.Len()
	}
	if start >= end {
		return ""
	}
	
	return tb.rope.Substring(start, end)
}

// Line returns the content of the specified line (0-indexed).
func (tb *TextBuffer) Line(lineNum int) string {
	tb.ensureLineCache()
	
	if lineNum < 0 || lineNum >= len(tb.lineCache) {
		return ""
	}
	
	start := tb.lineCache[lineNum]
	end := tb.rope.Len()
	if lineNum+1 < len(tb.lineCache) {
		end = tb.lineCache[lineNum+1] - 1 // Exclude newline
	}
	
	return tb.Substring(start, end)
}

// LineCount returns the number of lines in the buffer.
func (tb *TextBuffer) LineCount() int {
	tb.ensureLineCache()
	return len(tb.lineCache)
}

// ensureLineCache builds the line cache if needed.
func (tb *TextBuffer) ensureLineCache() {
	if tb.lineCache != nil {
		return
	}
	
	tb.lineCache = []int{0}
	content := tb.rope.String()
	
	for i, ch := range content {
		if ch == '\n' {
			tb.lineCache = append(tb.lineCache, i+1)
		}
	}
}

// SetHighlight sets a syntax highlighting range.
func (tb *TextBuffer) SetHighlight(start, end int, style string) error {
	return tb.highlights.Insert(rangemap.Range{Start: start, End: end}, style)
}

// GetHighlights returns all highlighting ranges that overlap with the query range.
func (tb *TextBuffer) GetHighlights(start, end int) []rangemap.Entry[string] {
	return tb.highlights.GetOverlapping(rangemap.Range{Start: start, End: end})
}

// SetAnnotation sets an annotation range.
func (tb *TextBuffer) SetAnnotation(start, end int, annotation string) error {
	return tb.annotations.Insert(rangemap.Range{Start: start, End: end}, annotation)
}

// GetAnnotations returns all annotation ranges that overlap with the query range.
func (tb *TextBuffer) GetAnnotations(start, end int) []rangemap.Entry[string] {
	return tb.annotations.GetOverlapping(rangemap.Range{Start: start, End: end})
}

// Clear removes all content and metadata.
func (tb *TextBuffer) Clear() {
	tb.rope = NewEmpty()
	tb.lineCache = nil
	tb.highlights.Clear()
	tb.annotations.Clear()
}