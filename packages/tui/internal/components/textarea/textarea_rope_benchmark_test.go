package textarea

import (
	"fmt"
	"strings"
	"testing"
)

// Helper to create test content for rope-based textarea
func createRopeTestContent(lines int) string {
	var sb strings.Builder
	for i := 0; i < lines; i++ {
		fmt.Fprintf(&sb, "Line %d: This is a test line with some content that simulates real text editing. ", i)
		if i%5 == 0 {
			sb.WriteString("Here's some **markdown** content with `code` and [links](http://example.com). ")
		}
		if i < lines-1 {
			sb.WriteString("\n")
		}
	}
	return sb.String()
}

func BenchmarkRopeTextareaInsert(b *testing.B) {
	sizes := []int{100, 1000, 10000}
	
	for _, size := range sizes {
		b.Run(fmt.Sprintf("InsertAtBeginning_%d_lines", size), func(b *testing.B) {
			content := createRopeTestContent(size)
			m := NewRope()
			m.SetValue(content)
			
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				// Insert at beginning - this should be O(log n) with rope
				m.cursorPos = 0
				m.updateRowCol()
				m.InsertString("NEW TEXT ")
				
				// Reset for next iteration
				m.SetValue(content)
			}
		})
		
		b.Run(fmt.Sprintf("InsertAtMiddle_%d_lines", size), func(b *testing.B) {
			content := createRopeTestContent(size)
			m := NewRope()
			m.SetValue(content)
			
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				// Insert at middle - this should be O(log n) with rope
				m.cursorPos = len(content) / 2
				m.updateRowCol()
				m.InsertString("NEW TEXT ")
				
				// Reset for next iteration
				m.SetValue(content)
			}
		})
		
		b.Run(fmt.Sprintf("InsertAtEnd_%d_lines", size), func(b *testing.B) {
			content := createRopeTestContent(size)
			m := NewRope()
			m.SetValue(content)
			
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				// Insert at end - this should be O(log n) with rope
				m.cursorPos = len(content)
				m.updateRowCol()
				m.InsertString("NEW TEXT ")
				
				// Reset for next iteration
				m.SetValue(content)
			}
		})
	}
}

func BenchmarkRopeTextareaDelete(b *testing.B) {
	sizes := []int{100, 1000, 10000}
	
	for _, size := range sizes {
		b.Run(fmt.Sprintf("DeleteAtBeginning_%d_lines", size), func(b *testing.B) {
			content := createRopeTestContent(size)
			
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				m := NewRope()
				m.SetValue(content)
				
				// Delete from beginning - this should be O(log n) with rope
				m.cursorPos = 0
				m.updateRowCol()
				if len(content) > 10 {
					m.buffer.Delete(0, 10)
				}
			}
		})
		
		b.Run(fmt.Sprintf("DeleteAtMiddle_%d_lines", size), func(b *testing.B) {
			content := createRopeTestContent(size)
			
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				m := NewRope()
				m.SetValue(content)
				
				// Delete from middle - this should be O(log n) with rope
				middle := len(content) / 2
				m.cursorPos = middle
				m.updateRowCol()
				if len(content) > middle+10 {
					m.buffer.Delete(middle, middle+10)
				}
			}
		})
	}
}

func BenchmarkRopeTextareaNavigation(b *testing.B) {
	sizes := []int{100, 1000, 10000}
	
	for _, size := range sizes {
		b.Run(fmt.Sprintf("CursorMovement_%d_lines", size), func(b *testing.B) {
			content := createRopeTestContent(size)
			m := NewRope()
			m.SetValue(content)
			m.Focus()
			
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				// Simulate cursor movements
				for j := 0; j < 100; j++ {
					m.characterRight()
				}
				for j := 0; j < 50; j++ {
					m.characterLeft()
				}
				for j := 0; j < 10; j++ {
					m.CursorDown()
				}
				for j := 0; j < 10; j++ {
					m.CursorUp()
				}
				
				// Reset cursor position
				m.cursorPos = 0
				m.updateRowCol()
			}
		})
	}
}

func BenchmarkRopeTextareaRendering(b *testing.B) {
	sizes := []int{100, 1000, 10000}
	
	for _, size := range sizes {
		b.Run(fmt.Sprintf("ViewRendering_%d_lines", size), func(b *testing.B) {
			content := createRopeTestContent(size)
			m := NewRope()
			m.SetValue(content)
			m.SetWidth(120)
			m.SetHeight(50)
			m.Focus()
			
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				_ = m.View()
			}
		})
	}
}

func BenchmarkRopeTextareaLargeOperations(b *testing.B) {
	b.Run("VeryLargeFile_50k_lines", func(b *testing.B) {
		content := createRopeTestContent(50000)
		
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			m := NewRope()
			m.SetValue(content)
			
			// Perform various operations on large content
			m.cursorPos = len(content) / 2
			m.updateRowCol()
			m.InsertString("INSERTED TEXT")
			
			// Navigate to different positions
			m.CursorStart()
			m.CursorEnd()
			
			// Render a portion
			m.SetWidth(120)
			m.SetHeight(50)
			_ = m.View()
		}
	})
}

func BenchmarkRopeTextareaMemoryAllocation(b *testing.B) {
	sizes := []int{100, 1000, 10000}
	
	for _, size := range sizes {
		b.Run(fmt.Sprintf("CreateAndDestroy_%d_lines", size), func(b *testing.B) {
			content := createRopeTestContent(size)
			
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				m := NewRope()
				m.SetValue(content)
				_ = m.Value()
			}
		})
		
		b.Run(fmt.Sprintf("MultipleInserts_%d_lines", size), func(b *testing.B) {
			content := createRopeTestContent(size)
			
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				m := NewRope()
				m.SetValue(content)
				
				// Perform multiple insertions
				for j := 0; j < 10; j++ {
					m.cursorPos = j * 100
					if m.cursorPos > len(content) {
						m.cursorPos = len(content)
					}
					m.updateRowCol()
					m.InsertString(fmt.Sprintf("Insert %d ", j))
				}
			}
		})
	}
}

// Comparison benchmark between original and rope implementations
func BenchmarkTextareaComparison(b *testing.B) {
	content := createRopeTestContent(1000)
	
	b.Run("Original_Insert_Middle", func(b *testing.B) {
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			m := New()
			m.SetValue(content)
			
			// Position cursor at middle
			lines := strings.Split(content, "\n")
			m.row = len(lines) / 2
			m.col = 0
			
			m.InsertString("NEW TEXT ")
		}
	})
	
	b.Run("Rope_Insert_Middle", func(b *testing.B) {
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			m := NewRope()
			m.SetValue(content)
			
			// Position cursor at middle
			m.cursorPos = len(content) / 2
			m.updateRowCol()
			
			m.InsertString("NEW TEXT ")
		}
	})
	
	b.Run("Original_Rendering", func(b *testing.B) {
		m := New()
		m.SetValue(content)
		m.SetWidth(120)
		m.SetHeight(50)
		m.Focus()
		
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_ = m.View()
		}
	})
	
	b.Run("Rope_Rendering", func(b *testing.B) {
		m := NewRope()
		m.SetValue(content)
		m.SetWidth(120)
		m.SetHeight(50)
		m.Focus()
		
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_ = m.View()
		}
	})
}