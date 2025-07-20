package textarea

import (
	"fmt"
	"strings"
	"testing"
)

// generateContent creates test content with the specified number of lines
func generateContent(lines int) string {
	var sb strings.Builder
	for i := 0; i < lines; i++ {
		fmt.Fprintf(&sb, "Line %d: The quick brown fox jumps over the lazy dog. Lorem ipsum dolor sit amet.\n", i)
	}
	return sb.String()
}

func BenchmarkTextAreaSetValue(b *testing.B) {
	sizes := []int{10, 100, 1000, 10000}
	
	for _, size := range sizes {
		content := generateContent(size)
		
		b.Run(fmt.Sprintf("Lines_%d", size), func(b *testing.B) {
			b.SetBytes(int64(len(content)))
			for i := 0; i < b.N; i++ {
				m := New()
				m.SetValue(content)
			}
		})
	}
}

func BenchmarkTextAreaInsertRune(b *testing.B) {
	sizes := []int{10, 100, 1000}
	positions := []string{"start", "middle", "end"}
	
	for _, size := range sizes {
		content := generateContent(size)
		
		for _, pos := range positions {
			b.Run(fmt.Sprintf("Lines_%d_%s", size, pos), func(b *testing.B) {
				// Setup
				base := New()
				base.SetValue(content)
				
				// Position cursor
				switch pos {
				case "start":
					base.row = 0
					base.col = 0
				case "middle":
					base.row = size / 2
					base.col = 10
				case "end":
					base.row = size - 1
					base.col = len(base.value[base.row])
				}
				
				b.ResetTimer()
				for i := 0; i < b.N; i++ {
					// Create a copy for each iteration
					m := base
					m.value = make([][]any, len(base.value))
					for j := range base.value {
						m.value[j] = make([]any, len(base.value[j]))
						copy(m.value[j], base.value[j])
					}
					
					// Insert a character
					m.InsertRunesFromUserInput([]rune{'X'})
				}
			})
		}
	}
}

func BenchmarkTextAreaDeleteChar(b *testing.B) {
	sizes := []int{10, 100, 1000}
	
	for _, size := range sizes {
		content := generateContent(size)
		
		b.Run(fmt.Sprintf("Lines_%d", size), func(b *testing.B) {
			// Setup
			base := New()
			base.SetValue(content)
			base.row = size / 2
			base.col = 20
			
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				// Create a copy for each iteration
				m := base
				m.value = make([][]any, len(base.value))
				for j := range base.value {
					m.value[j] = make([]any, len(base.value[j]))
					copy(m.value[j], base.value[j])
				}
				
				// Delete a character (backspace)
				m.col = 20 // Reset position
				m.deleteBeforeCursor()
			}
		})
	}
}

func BenchmarkTextAreaLineOperations(b *testing.B) {
	sizes := []int{10, 100, 1000}
	
	for _, size := range sizes {
		content := generateContent(size)
		
		b.Run(fmt.Sprintf("InsertLine_%d", size), func(b *testing.B) {
			base := New()
			base.SetValue(content)
			base.row = size / 2
			
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				// Create a copy
				m := base
				m.value = make([][]any, len(base.value))
				for j := range base.value {
					m.value[j] = make([]any, len(base.value[j]))
					copy(m.value[j], base.value[j])
				}
				
				// Insert a new line
				m.splitLine(m.row, 10)
			}
		})
		
		b.Run(fmt.Sprintf("JoinLine_%d", size), func(b *testing.B) {
			base := New()
			base.SetValue(content)
			base.row = size / 2
			
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				// Create a copy
				m := base
				m.value = make([][]any, len(base.value)+1)
				for j := range base.value {
					m.value[j] = make([]any, len(base.value[j]))
					copy(m.value[j], base.value[j])
				}
				m.value[len(base.value)] = []any{}
				
				// Join lines
				if m.row < len(m.value)-1 {
					m.mergeLineBelow(m.row)
				}
			}
		})
	}
}

func BenchmarkTextAreaNavigation(b *testing.B) {
	content := generateContent(1000)
	
	b.Run("CursorMovement", func(b *testing.B) {
		m := New()
		m.SetValue(content)
		
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			// Simulate cursor movement
			m.CursorDown()
			m.wordRight()
			m.CursorUp()
			m.wordLeft()
		}
	})
	
	b.Run("WordNavigation", func(b *testing.B) {
		m := New()
		m.SetValue(content)
		m.row = 500
		m.col = 20
		
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			m.wordRight()
			m.wordLeft()
		}
	})
}

func BenchmarkTextAreaRendering(b *testing.B) {
	sizes := []int{10, 100, 1000}
	
	for _, size := range sizes {
		content := generateContent(size)
		
		b.Run(fmt.Sprintf("View_%d_lines", size), func(b *testing.B) {
			m := New()
			m.SetValue(content)
			m.SetWidth(80)
			m.SetHeight(24)
			
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				_ = m.View()
			}
		})
		
		b.Run(fmt.Sprintf("ViewportOnly_%d_lines", size), func(b *testing.B) {
			m := New()
			m.SetValue(content)
			m.SetWidth(80)
			m.SetHeight(24)
			
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				// Just render without full view
				// This tests the string building part
				lines := m.value
				for _, line := range lines {
					_ = string(interfacesToRunes(line))
				}
			}
		})
	}
}

func BenchmarkTextAreaMemoryAllocation(b *testing.B) {
	sizes := []int{100, 1000, 10000}
	
	for _, size := range sizes {
		content := generateContent(size)
		
		b.Run(fmt.Sprintf("SetValue_%d", size), func(b *testing.B) {
			b.ReportAllocs()
			for i := 0; i < b.N; i++ {
				m := New()
				m.SetValue(content)
			}
		})
		
		b.Run(fmt.Sprintf("InsertChar_%d", size), func(b *testing.B) {
			m := New()
			m.SetValue(content)
			m.row = size / 2
			m.col = 10
			
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				// Make a copy of value slice
				oldValue := m.value
				m.value = make([][]any, len(oldValue))
				for j := range oldValue {
					m.value[j] = make([]any, len(oldValue[j]))
					copy(m.value[j], oldValue[j])
				}
				
				m.InsertRunesFromUserInput([]rune{'X'})
			}
		})
	}
}

// Benchmark specific operations that would benefit from rope
func BenchmarkTextAreaLargeFileOperations(b *testing.B) {
	// Simulate a large file (10k lines for now)
	largeContent := generateContent(10000)
	
	b.Run("LoadLargeFile", func(b *testing.B) {
		b.SetBytes(int64(len(largeContent)))
		for i := 0; i < b.N; i++ {
			m := New()
			m.SetValue(largeContent)
		}
	})
	
	b.Run("InsertMiddleLargeFile", func(b *testing.B) {
		b.StopTimer()
		m := New()
		m.SetValue(largeContent)
		m.row = 5000  // Middle of 10k lines
		m.col = 10
		b.StartTimer()
		
		for i := 0; i < b.N; i++ {
			// Simulate the copy that happens in real usage
			newValue := make([][]any, len(m.value))
			for j := range m.value {
				newValue[j] = make([]any, len(m.value[j]))
				copy(newValue[j], m.value[j])
			}
			
			// Now do the actual insertion
			if m.row < len(newValue) {
				row := newValue[m.row]
				newRow := make([]any, len(row)+1)
				if m.col <= len(row) {
					copy(newRow[:m.col], row[:m.col])
					newRow[m.col] = 'X'
					copy(newRow[m.col+1:], row[m.col:])
					newValue[m.row] = newRow
				}
			}
		}
	})
}