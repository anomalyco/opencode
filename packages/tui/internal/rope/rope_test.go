package rope

import (
	"strings"
	"testing"
)

func TestRopeBasicOperations(t *testing.T) {
	// Test creation
	r := New("Hello, World!")
	
	if r.String() != "Hello, World!" {
		t.Errorf("String() = %q, want %q", r.String(), "Hello, World!")
	}
	
	if r.Len() != 13 {
		t.Errorf("Len() = %d, want 13", r.Len())
	}
	
	if r.Lines() != 1 {
		t.Errorf("Lines() = %d, want 1", r.Lines())
	}
	
	// Test CharAt
	ch, err := r.CharAt(7)
	if err != nil || ch != 'W' {
		t.Errorf("CharAt(7) = %c, %v, want 'W', nil", ch, err)
	}
	
	// Test out of bounds
	_, err = r.CharAt(100)
	if err == nil {
		t.Error("CharAt(100) should return error")
	}
}

func TestRopeInsert(t *testing.T) {
	r := New("Hello World")
	
	// Insert in middle
	r2 := r.Insert(5, ", Beautiful")
	if r2.String() != "Hello, Beautiful World" {
		t.Errorf("After insert: %q", r2.String())
	}
	
	// Original unchanged
	if r.String() != "Hello World" {
		t.Errorf("Original changed: %q", r.String())
	}
	
	// Insert at beginning
	r3 := r.Insert(0, "Well, ")
	if r3.String() != "Well, Hello World" {
		t.Errorf("Insert at start: %q", r3.String())
	}
	
	// Insert at end
	r4 := r.Insert(r.Len(), "!")
	if r4.String() != "Hello World!" {
		t.Errorf("Insert at end: %q", r4.String())
	}
	
	// Insert past end
	r5 := r.Insert(100, "!")
	if r5.String() != "Hello World!" {
		t.Errorf("Insert past end: %q", r5.String())
	}
}

func TestRopeDelete(t *testing.T) {
	r := New("Hello, Beautiful World!")
	
	// Delete from middle
	r2 := r.Delete(5, 16)
	if r2.String() != "Hello World!" {
		t.Errorf("After delete: %q", r2.String())
	}
	
	// Delete from start
	r3 := r.Delete(0, 7)
	if r3.String() != "Beautiful World!" {
		t.Errorf("Delete from start: %q", r3.String())
	}
	
	// Delete from end
	r4 := r.Delete(17, 23)
	if r4.String() != "Hello, Beautiful " {
		t.Errorf("Delete from end: %q", r4.String())
	}
	
	// Delete entire string
	r5 := r.Delete(0, r.Len())
	if r5.String() != "" {
		t.Errorf("Delete all: %q", r5.String())
	}
}

func TestRopeSubstring(t *testing.T) {
	r := New("Hello, World!")
	
	tests := []struct {
		start, end int
		want       string
	}{
		{0, 5, "Hello"},
		{7, 12, "World"},
		{0, 13, "Hello, World!"},
		{5, 5, ""},
		{-5, 5, "Hello"},
		{7, 100, "World!"},
		{100, 200, ""},
	}
	
	for _, tt := range tests {
		got := r.Substring(tt.start, tt.end)
		if got != tt.want {
			t.Errorf("Substring(%d, %d) = %q, want %q", tt.start, tt.end, got, tt.want)
		}
	}
}

func TestRopeSplit(t *testing.T) {
	r := New("Hello, World!")
	
	// Split in middle
	left, right := r.Split(7)
	if left.String() != "Hello, " {
		t.Errorf("Split left: %q", left.String())
	}
	if right.String() != "World!" {
		t.Errorf("Split right: %q", right.String())
	}
	
	// Split at start
	left, right = r.Split(0)
	if left.String() != "" {
		t.Errorf("Split at 0 left: %q", left.String())
	}
	if right.String() != "Hello, World!" {
		t.Errorf("Split at 0 right: %q", right.String())
	}
	
	// Split at end
	left, right = r.Split(r.Len())
	if left.String() != "Hello, World!" {
		t.Errorf("Split at end left: %q", left.String())
	}
	if right.String() != "" {
		t.Errorf("Split at end right: %q", right.String())
	}
}

func TestRopeConcat(t *testing.T) {
	r1 := New("Hello, ")
	r2 := New("World!")
	
	r3 := r1.Concat(r2)
	if r3.String() != "Hello, World!" {
		t.Errorf("Concat: %q", r3.String())
	}
	
	// Concat with empty
	r4 := r1.Concat(NewEmpty())
	if r4.String() != "Hello, " {
		t.Errorf("Concat with empty: %q", r4.String())
	}
	
	r5 := NewEmpty().Concat(r1)
	if r5.String() != "Hello, " {
		t.Errorf("Empty concat with: %q", r5.String())
	}
}

func TestRopeLines(t *testing.T) {
	r := New("Line 1\nLine 2\nLine 3")
	
	if r.Lines() != 3 {
		t.Errorf("Lines() = %d, want 3", r.Lines())
	}
	
	// Insert newline
	r2 := r.Insert(6, "\nLine 1.5")
	if r2.Lines() != 4 {
		t.Errorf("After insert newline: Lines() = %d, want 4", r2.Lines())
	}
	
	// Delete newline
	r3 := r.Delete(6, 7)
	expected := "Line 1Line 2\nLine 3"
	if r3.String() != expected {
		t.Errorf("After delete newline: %q", r3.String())
	}
	if r3.Lines() != 2 {
		t.Errorf("After delete newline: Lines() = %d, want 2", r3.Lines())
	}
}

func TestRopeLargeOperations(t *testing.T) {
	// Create large rope
	var sb strings.Builder
	for i := 0; i < 100; i++ {
		sb.WriteString(strings.Repeat("x", 100))
		sb.WriteString("\n")
	}
	content := sb.String()
	
	r := New(content)
	
	// Test structure is balanced
	if r.String() != content {
		t.Error("Large rope content mismatch")
	}
	
	// Insert in middle of large rope
	r2 := r.Insert(5000, "INSERTED")
	if !strings.Contains(r2.String(), "INSERTED") {
		t.Error("Insert in large rope failed")
	}
	
	// Delete from large rope
	r3 := r2.Delete(5000, 5008)
	if r3.String() != content {
		t.Error("Delete from large rope failed")
	}
}

func TestRopeBalance(t *testing.T) {
	// Build rope incrementally to test balancing
	r := NewEmpty()
	
	// Add many small pieces
	for i := 0; i < 1000; i++ {
		r = r.Insert(r.Len(), "x")
	}
	
	if r.Len() != 1000 {
		t.Errorf("Incremental build: Len() = %d, want 1000", r.Len())
	}
	
	// The rope should still be efficient
	ch, err := r.CharAt(500)
	if err != nil || ch != 'x' {
		t.Errorf("CharAt after incremental build: %c, %v", ch, err)
	}
}

func BenchmarkRopeInsert(b *testing.B) {
	content := strings.Repeat("Hello World\n", 1000)
	r := New(content)
	
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = r.Insert(5000, "inserted")
	}
}

func BenchmarkRopeDelete(b *testing.B) {
	content := strings.Repeat("Hello World\n", 1000)
	r := New(content)
	
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = r.Delete(5000, 5010)
	}
}

func BenchmarkRopeSubstring(b *testing.B) {
	content := strings.Repeat("Hello World\n", 1000)
	r := New(content)
	
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = r.Substring(5000, 5100)
	}
}

func BenchmarkRopeCharAt(b *testing.B) {
	content := strings.Repeat("Hello World\n", 10000)
	r := New(content)
	
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = r.CharAt(i % r.Len())
	}
}

func BenchmarkStringBuilderComparison(b *testing.B) {
	content := strings.Repeat("Hello World\n", 1000)
	
	b.Run("StringBuilder", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			sb := strings.Builder{}
			sb.WriteString(content[:5000])
			sb.WriteString("inserted")
			sb.WriteString(content[5000:])
			_ = sb.String()
		}
	})
	
	b.Run("Rope", func(b *testing.B) {
		r := New(content)
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			r2 := r.Insert(5000, "inserted")
			_ = r2.String()
		}
	})
}