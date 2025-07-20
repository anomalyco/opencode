package rope

import (
	"fmt"
	"math/rand"
	"strings"
	"testing"
)

// Benchmark comparison between rope and string operations

func generateText(lines int) string {
	var sb strings.Builder
	for i := 0; i < lines; i++ {
		fmt.Fprintf(&sb, "Line %d: The quick brown fox jumps over the lazy dog. Lorem ipsum dolor sit amet.\n", i)
	}
	return sb.String()
}

func BenchmarkInsertComparison(b *testing.B) {
	sizes := []int{100, 1000, 10000}
	positions := []string{"start", "middle", "end"}
	
	for _, size := range sizes {
		content := generateText(size)
		insertText := "INSERTED TEXT HERE"
		
		for _, pos := range positions {
			var insertPos int
			switch pos {
			case "start":
				insertPos = 0
			case "middle":
				insertPos = len(content) / 2
			case "end":
				insertPos = len(content)
			}
			
			b.Run(fmt.Sprintf("String_%d_%s", size, pos), func(b *testing.B) {
				b.SetBytes(int64(len(content)))
				for i := 0; i < b.N; i++ {
					result := content[:insertPos] + insertText + content[insertPos:]
					_ = result
				}
			})
			
			b.Run(fmt.Sprintf("Rope_%d_%s", size, pos), func(b *testing.B) {
				r := New(content)
				b.ResetTimer()
				b.SetBytes(int64(len(content)))
				for i := 0; i < b.N; i++ {
					result := r.Insert(insertPos, insertText)
					_ = result
				}
			})
			
			b.Run(fmt.Sprintf("TextBuffer_%d_%s", size, pos), func(b *testing.B) {
				tb := NewTextBuffer(content)
				b.ResetTimer()
				b.SetBytes(int64(len(content)))
				for i := 0; i < b.N; i++ {
					// TextBuffer is mutable, so we need to delete after insert
					tb.Insert(insertPos, insertText)
					tb.Delete(insertPos, insertPos+len(insertText))
				}
			})
		}
	}
}

func BenchmarkDeleteComparison(b *testing.B) {
	sizes := []int{100, 1000, 10000}
	
	for _, size := range sizes {
		content := generateText(size)
		deleteLen := 50
		
		b.Run(fmt.Sprintf("String_%d", size), func(b *testing.B) {
			b.SetBytes(int64(len(content)))
			for i := 0; i < b.N; i++ {
				pos := rand.Intn(len(content) - deleteLen)
				result := content[:pos] + content[pos+deleteLen:]
				_ = result
			}
		})
		
		b.Run(fmt.Sprintf("Rope_%d", size), func(b *testing.B) {
			r := New(content)
			b.ResetTimer()
			b.SetBytes(int64(len(content)))
			for i := 0; i < b.N; i++ {
				pos := rand.Intn(len(content) - deleteLen)
				result := r.Delete(pos, pos+deleteLen)
				_ = result
			}
		})
		
		b.Run(fmt.Sprintf("TextBuffer_%d", size), func(b *testing.B) {
			b.SetBytes(int64(len(content)))
			for i := 0; i < b.N; i++ {
				tb := NewTextBuffer(content)
				pos := rand.Intn(len(content) - deleteLen)
				tb.Delete(pos, pos+deleteLen)
			}
		})
	}
}

func BenchmarkRandomAccessComparison(b *testing.B) {
	sizes := []int{1000, 10000, 100000}
	
	for _, size := range sizes {
		content := generateText(size)
		
		b.Run(fmt.Sprintf("String_%d", size), func(b *testing.B) {
			runes := []rune(content)
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				pos := rand.Intn(len(runes))
				_ = runes[pos]
			}
		})
		
		b.Run(fmt.Sprintf("Rope_%d", size), func(b *testing.B) {
			r := New(content)
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				pos := rand.Intn(r.Len())
				_, _ = r.CharAt(pos)
			}
		})
	}
}

func BenchmarkLineAccessComparison(b *testing.B) {
	sizes := []int{100, 1000, 10000}
	
	for _, size := range sizes {
		content := generateText(size)
		
		b.Run(fmt.Sprintf("StringSplit_%d", size), func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				lines := strings.Split(content, "\n")
				lineNum := rand.Intn(len(lines))
				_ = lines[lineNum]
			}
		})
		
		b.Run(fmt.Sprintf("TextBuffer_%d", size), func(b *testing.B) {
			tb := NewTextBuffer(content)
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				lineNum := rand.Intn(tb.LineCount())
				_ = tb.Line(lineNum)
			}
		})
	}
}

func BenchmarkHighlightingComparison(b *testing.B) {
	sizes := []int{100, 1000, 10000}
	highlightCount := 100
	
	for _, size := range sizes {
		content := generateText(size)
		
		b.Run(fmt.Sprintf("TextBuffer_%d", size), func(b *testing.B) {
			tb := NewTextBuffer(content)
			
			// Add highlights
			for i := 0; i < highlightCount; i++ {
				start := rand.Intn(len(content) - 10)
				tb.SetHighlight(start, start+10, "keyword")
			}
			
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				start := rand.Intn(len(content) - 100)
				_ = tb.GetHighlights(start, start+100)
			}
		})
	}
}

func BenchmarkIncrementalEditing(b *testing.B) {
	// Simulate typical editing patterns
	content := generateText(1000)
	
	b.Run("String", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			text := content
			// Simulate typing
			for j := 0; j < 10; j++ {
				pos := len(text) / 2
				text = text[:pos] + "x" + text[pos:]
			}
			// Simulate backspace
			for j := 0; j < 5; j++ {
				pos := len(text) / 2
				text = text[:pos-1] + text[pos:]
			}
		}
	})
	
	b.Run("Rope", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			r := New(content)
			// Simulate typing
			for j := 0; j < 10; j++ {
				pos := r.Len() / 2
				r = r.Insert(pos, "x")
			}
			// Simulate backspace
			for j := 0; j < 5; j++ {
				pos := r.Len() / 2
				r = r.Delete(pos-1, pos)
			}
		}
	})
	
	b.Run("TextBuffer", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			tb := NewTextBuffer(content)
			// Simulate typing
			for j := 0; j < 10; j++ {
				pos := tb.Len() / 2
				tb.Insert(pos, "x")
			}
			// Simulate backspace
			for j := 0; j < 5; j++ {
				pos := tb.Len() / 2
				tb.Delete(pos-1, pos)
			}
		}
	})
}

func BenchmarkMemoryUsage(b *testing.B) {
	// This benchmark helps understand memory allocation patterns
	sizes := []int{1000, 10000, 100000}
	
	for _, size := range sizes {
		content := generateText(size)
		
		b.Run(fmt.Sprintf("Rope_%d", size), func(b *testing.B) {
			b.ReportAllocs()
			for i := 0; i < b.N; i++ {
				r := New(content)
				// Perform some operations
				r = r.Insert(size/2, "test")
				r = r.Delete(size/2, size/2+4)
				_ = r.Substring(0, 100)
			}
		})
		
		b.Run(fmt.Sprintf("TextBuffer_%d", size), func(b *testing.B) {
			b.ReportAllocs()
			for i := 0; i < b.N; i++ {
				tb := NewTextBuffer(content)
				// Perform some operations
				tb.Insert(size/2, "test")
				tb.Delete(size/2, size/2+4)
				_ = tb.Substring(0, 100)
			}
		})
	}
}