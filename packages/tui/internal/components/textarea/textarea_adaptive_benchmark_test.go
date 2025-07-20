package textarea

import (
	"fmt"
	"strings"
	"testing"
)

func BenchmarkAdaptiveTextarea(b *testing.B) {
	// Test small content (should use original)
	b.Run("SmallContent_100_lines", func(b *testing.B) {
		content := createRopeTestContent(100)
		
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			m := NewAdaptive()
			m.SetValue(content)
			
			// Verify it's using original implementation
			impl, _ := m.GetCurrentImplementation()
			if impl != "original" {
				b.Errorf("Expected original implementation for small content, got %s", impl)
			}
			
			// Perform some operations
			m.Focus()
			m.InsertString("NEW TEXT")
			_ = m.View()
		}
	})
	
	// Test medium content (right at threshold)
	b.Run("MediumContent_500_lines", func(b *testing.B) {
		content := createRopeTestContent(500)
		
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			m := NewAdaptive()
			m.SetValue(content)
			
			// Perform some operations
			m.Focus()
			m.InsertString("NEW TEXT")
			_ = m.View()
		}
	})
	
	// Test large content (should use rope)
	b.Run("LargeContent_2000_lines", func(b *testing.B) {
		content := createRopeTestContent(2000)
		
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			m := NewAdaptive()
			m.SetValue(content)
			
			// Verify it's using rope implementation
			impl, _ := m.GetCurrentImplementation()
			if impl != "rope" {
				b.Errorf("Expected rope implementation for large content, got %s", impl)
			}
			
			// Perform some operations
			m.Focus()
			m.InsertString("NEW TEXT")
			_ = m.View()
		}
	})
	
	// Test transition from small to large
	b.Run("Transition_Small_to_Large", func(b *testing.B) {
		smallContent := createRopeTestContent(100)
		additionalContent := createRopeTestContent(1000)
		
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			m := NewAdaptive()
			m.SetValue(smallContent)
			
			// Should start with original
			impl, _ := m.GetCurrentImplementation()
			if impl != "original" {
				b.Errorf("Expected original implementation initially, got %s", impl)
			}
			
			// Add more content to trigger switch
			m.InsertString(additionalContent)
			
			// Should now be using rope
			impl, _ = m.GetCurrentImplementation()
			if impl != "rope" {
				b.Errorf("Expected rope implementation after growth, got %s", impl)
			}
		}
	})
}

func BenchmarkAdaptiveVsStatic(b *testing.B) {
	sizes := []int{100, 500, 1000, 2000}
	
	for _, size := range sizes {
		content := createRopeTestContent(size)
		
		b.Run(fmt.Sprintf("Adaptive_%d_lines", size), func(b *testing.B) {
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				m := NewAdaptive()
				m.SetValue(content)
				m.Focus()
				m.SetWidth(120)
				m.SetHeight(50)
				
				// Perform mixed operations
				m.InsertString("INSERT_TEXT")
				for j := 0; j < 10; j++ {
					m.InsertRune('x')
				}
				_ = m.View()
			}
		})
		
		b.Run(fmt.Sprintf("Original_%d_lines", size), func(b *testing.B) {
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				m := New()
				m.SetValue(content)
				m.Focus()
				m.SetWidth(120)
				m.SetHeight(50)
				
				// Perform mixed operations
				m.InsertString("INSERT_TEXT")
				for j := 0; j < 10; j++ {
					m.InsertRune('x')
				}
				_ = m.View()
			}
		})
		
		b.Run(fmt.Sprintf("Rope_%d_lines", size), func(b *testing.B) {
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				m := NewRope()
				m.SetValue(content)
				m.Focus()
				m.SetWidth(120)
				m.SetHeight(50)
				
				// Perform mixed operations
				m.InsertString("INSERT_TEXT")
				for j := 0; j < 10; j++ {
					m.InsertRune('x')
				}
				_ = m.View()
			}
		})
	}
}

func BenchmarkAdaptiveRendering(b *testing.B) {
	sizes := []int{100, 500, 1000, 2000, 5000}
	
	for _, size := range sizes {
		content := createRopeTestContent(size)
		
		b.Run(fmt.Sprintf("AdaptiveRendering_%d_lines", size), func(b *testing.B) {
			m := NewAdaptive()
			m.SetValue(content)
			m.Focus()
			m.SetWidth(120)
			m.SetHeight(50)
			
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				_ = m.View()
			}
		})
	}
}

func BenchmarkAdaptiveInsertOperations(b *testing.B) {
	sizes := []int{100, 500, 1000, 2000}
	
	for _, size := range sizes {
		content := createRopeTestContent(size)
		
		b.Run(fmt.Sprintf("AdaptiveInsert_%d_lines", size), func(b *testing.B) {
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				m := NewAdaptive()
				m.SetValue(content)
				m.Focus()
				
				// Insert at various positions
				m.InsertString("BEGINNING")
				
				// Move to middle and insert
				totalChars := len(content)
				for pos := 0; pos < totalChars/2 && pos < 1000; pos++ {
					if content[pos] == '\n' {
						break
					}
				}
				m.InsertString("MIDDLE")
				
				// Insert at end
				m.InsertString("END")
			}
		})
	}
}

func BenchmarkAdaptiveSwitchingOverhead(b *testing.B) {
	b.Run("FrequentSwitching", func(b *testing.B) {
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			m := NewAdaptive()
			
			// Start small
			smallContent := createRopeTestContent(100)
			m.SetValue(smallContent)
			
			// Grow to trigger switch to rope
			largeContent := createRopeTestContent(1000)
			m.InsertString(largeContent)
			
			// Shrink back down (would need Reset + SetValue to trigger switch back)
			m.Reset()
			m.SetValue(smallContent)
		}
	})
	
	b.Run("NoSwitching_SmallContent", func(b *testing.B) {
		content := createRopeTestContent(100)
		
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			m := NewAdaptive()
			m.SetValue(content)
			m.InsertString("ADDITIONAL TEXT")
		}
	})
	
	b.Run("NoSwitching_LargeContent", func(b *testing.B) {
		content := createRopeTestContent(2000)
		
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			m := NewAdaptive()
			m.SetValue(content)
			m.InsertString("ADDITIONAL TEXT")
		}
	})
}

func BenchmarkAdaptiveMemoryUsage(b *testing.B) {
	sizes := []int{100, 500, 1000, 2000}
	
	for _, size := range sizes {
		content := createRopeTestContent(size)
		
		b.Run(fmt.Sprintf("AdaptiveMemory_%d_lines", size), func(b *testing.B) {
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				m := NewAdaptive()
				m.SetValue(content)
				m.Focus()
				m.InsertString("TEST")
				_ = m.View()
			}
		})
	}
}

func TestAdaptiveImplementationSwitching(t *testing.T) {
	m := NewAdaptive()
	
	// Start with small content - should use original
	smallContent := createRopeTestContent(100)
	m.SetValue(smallContent)
	
	impl, reason := m.GetCurrentImplementation()
	if impl != "original" {
		t.Errorf("Expected original implementation for small content, got %s: %s", impl, reason)
	}
	
	// Add large amount of content - should switch to rope
	largeContent := createRopeTestContent(1000)
	m.InsertString(largeContent)
	
	impl, reason = m.GetCurrentImplementation()
	if impl != "rope" {
		t.Errorf("Expected rope implementation for large content, got %s: %s", impl, reason)
	}
	
	// Verify content is preserved during switch
	finalContent := m.Value()
	expectedContent := smallContent + largeContent
	if finalContent != expectedContent {
		t.Error("Content was not preserved during implementation switch")
	}
	
	// Reset and verify it goes back to original
	m.Reset()
	impl, reason = m.GetCurrentImplementation()
	if impl != "original" {
		t.Errorf("Expected original implementation after reset, got %s: %s", impl, reason)
	}
}

func TestAdaptiveCharacterThreshold(t *testing.T) {
	m := NewAdaptive()
	
	// Test right at character threshold
	content := strings.Repeat("a", ropeThresholdChars-10)
	m.SetValue(content)
	
	impl, _ := m.GetCurrentImplementation()
	if impl != "original" {
		t.Errorf("Expected original implementation below character threshold, got %s", impl)
	}
	
	// Add enough characters to cross threshold
	m.InsertString(strings.Repeat("b", 20))
	
	impl, _ = m.GetCurrentImplementation()
	if impl != "rope" {
		t.Errorf("Expected rope implementation above character threshold, got %s", impl)
	}
}

func TestAdaptiveLineThreshold(t *testing.T) {
	m := NewAdaptive()
	
	// Test right at line threshold
	lines := make([]string, ropeThresholdLines-10)
	for i := range lines {
		lines[i] = "test line"
	}
	content := strings.Join(lines, "\n")
	m.SetValue(content)
	
	impl, _ := m.GetCurrentImplementation()
	if impl != "original" {
		t.Errorf("Expected original implementation below line threshold, got %s", impl)
	}
	
	// Add enough lines to cross threshold
	additionalLines := strings.Repeat("\nanother line", 20)
	m.InsertString(additionalLines)
	
	impl, _ = m.GetCurrentImplementation()
	if impl != "rope" {
		t.Errorf("Expected rope implementation above line threshold, got %s", impl)
	}
}