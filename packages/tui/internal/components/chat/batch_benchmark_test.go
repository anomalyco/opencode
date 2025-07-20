package chat

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/charmbracelet/lipgloss/v2"
	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/theme"
)

// Initialize theme for batch testing
func initBatchTestTheme() {
	if err := theme.LoadThemesFromJSON(); err != nil {
		// Fallback to system theme if loading fails
		testTheme := theme.NewSystemTheme(lipgloss.Color("#000000"), true)
		theme.RegisterTheme("test", testTheme)
		theme.SetTheme("test")
		return
	}

	// Use the actual opencode theme for realistic performance measurements
	if err := theme.SetTheme("opencode"); err != nil {
		// Fallback to first available theme if opencode is not found
		availableThemes := theme.AvailableThemes()
		if len(availableThemes) > 0 {
			theme.SetTheme(availableThemes[0])
		}
	}
}

// Helper to create test messages for batch benchmarks
func createBatchTestMessage(role string, content string, index int) app.Message {
	var messageInfo opencode.MessageUnion
	var parts []opencode.PartUnion
	
	// Create a text part
	textPart := opencode.TextPart{
		ID:        fmt.Sprintf("part_%d", index),
		MessageID: fmt.Sprintf("msg_%d", index),
		SessionID: "test-session",
		Text:      content,
		Type:      "text",
		Time: opencode.TextPartTime{
			Start: float64(time.Now().Unix()),
			End:   float64(time.Now().Unix()),
		},
	}
	parts = append(parts, textPart)
	
	if role == "user" {
		messageInfo = opencode.UserMessage{
			ID:        fmt.Sprintf("msg_%d", index),
			Role:      "user",
			SessionID: "test-session",
			Time: opencode.UserMessageTime{
				Created: float64(time.Now().Unix()),
			},
		}
	} else {
		messageInfo = opencode.AssistantMessage{
			ID:         fmt.Sprintf("msg_%d", index),
			ModelID:    "test-model",
			Cost:       0.001,
			Path:       opencode.AssistantMessagePath{},
			ProviderID: "test-provider",
			Role:       "assistant",
			SessionID:  "test-session",
			System:     []string{},
			Time: opencode.AssistantMessageTime{
				Created:   float64(time.Now().Unix()),
				Completed: float64(time.Now().Unix()),
			},
			Tokens: opencode.AssistantMessageTokens{
				Input:  100,
				Output: 50,
				Cache: opencode.AssistantMessageTokensCache{
					Read:  0,
					Write: 0,
				},
				Reasoning: 0,
			},
			Summary: false,
		}
	}
	
	return app.Message{
		Info:  messageInfo,
		Parts: parts,
	}
}

func createBatchLongMessage(lines int) string {
	var sb strings.Builder
	for i := 0; i < lines; i++ {
		fmt.Fprintf(&sb, "Line %d: This is a test message with some content that simulates a real chat message. ", i)
		if i%5 == 0 {
			sb.WriteString("Here's some **markdown** content with `code` and [links](http://example.com). ")
		}
		sb.WriteString("\n")
	}
	return sb.String()
}

func BenchmarkBatchVsSequentialRendering(b *testing.B) {
	messageCounts := []int{50, 100, 200, 500}
	
	for _, count := range messageCounts {
		// Create test messages with varying complexity
		messages := make([]app.Message, 0, count)
		for i := 0; i < count; i++ {
			role := "user"
			if i%2 == 0 {
				role = "assistant"
			}
			
			// Mix of short and long messages
			content := fmt.Sprintf("Message %d: Short content", i)
			if i%10 == 0 {
				content = createBatchLongMessage(15) // 15 line message
			}
			
			messages = append(messages, createBatchTestMessage(role, content, i))
		}
		
		width := 120
		showToolDetails := false
		
		// Benchmark sequential batch processing
		b.Run(fmt.Sprintf("Sequential_%d_messages", count), func(b *testing.B) {
			initBatchTestTheme()
			cache := NewPartCache()
			processor := NewBatchProcessor(cache)
			
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				blocks, _, err := processor.RenderMessagesSequential(messages, width, showToolDetails)
				if err != nil {
					b.Fatalf("Sequential rendering failed: %v", err)
				}
				_ = strings.Join(blocks, "\n\n")
			}
		})
		
		// Benchmark parallel batch processing
		b.Run(fmt.Sprintf("Parallel_%d_messages", count), func(b *testing.B) {
			initBatchTestTheme()
			cache := NewPartCache()
			processor := NewBatchProcessor(cache)
			
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				blocks, _, err := processor.RenderMessagesParallel(messages, width, showToolDetails)
				if err != nil {
					b.Fatalf("Parallel rendering failed: %v", err)
				}
				_ = strings.Join(blocks, "\n\n")
			}
		})
		
		// Benchmark with cache warm-up to test cache hit performance
		b.Run(fmt.Sprintf("Sequential_Warm_Cache_%d_messages", count), func(b *testing.B) {
			initBatchTestTheme()
			cache := NewPartCache()
			processor := NewBatchProcessor(cache)
			
			// Warm up cache with one full render
			_, _, err := processor.RenderMessagesSequential(messages, width, showToolDetails)
			if err != nil {
				b.Fatalf("Cache warm-up failed: %v", err)
			}
			
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				blocks, _, err := processor.RenderMessagesSequential(messages, width, showToolDetails)
				if err != nil {
					b.Fatalf("Sequential rendering failed: %v", err)
				}
				_ = strings.Join(blocks, "\n\n")
			}
		})
		
		b.Run(fmt.Sprintf("Parallel_Warm_Cache_%d_messages", count), func(b *testing.B) {
			initBatchTestTheme()
			cache := NewPartCache()
			processor := NewBatchProcessor(cache)
			
			// Warm up cache
			_, _, err := processor.RenderMessagesParallel(messages, width, showToolDetails)
			if err != nil {
				b.Fatalf("Cache warm-up failed: %v", err)
			}
			
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				blocks, _, err := processor.RenderMessagesParallel(messages, width, showToolDetails)
				if err != nil {
					b.Fatalf("Parallel rendering failed: %v", err)
				}
				_ = strings.Join(blocks, "\n\n")
			}
		})
	}
}

func BenchmarkBatchMemoryUsage(b *testing.B) {
	messageCount := 500
	messages := make([]app.Message, 0, messageCount)
	
	for i := 0; i < messageCount; i++ {
		content := createBatchLongMessage(20) // Larger messages
		messages = append(messages, createBatchTestMessage("assistant", content, i))
	}
	
	width := 120
	showToolDetails := false
	
	b.Run("Sequential_Memory", func(b *testing.B) {
		b.ReportAllocs()
		initBatchTestTheme()
		
		for i := 0; i < b.N; i++ {
			cache := NewPartCache()
			processor := NewBatchProcessor(cache)
			
			blocks, _, err := processor.RenderMessagesSequential(messages, width, showToolDetails)
			if err != nil {
				b.Fatalf("Sequential rendering failed: %v", err)
			}
			_ = strings.Join(blocks, "\n\n")
		}
	})
	
	b.Run("Parallel_Memory", func(b *testing.B) {
		b.ReportAllocs()
		initBatchTestTheme()
		
		for i := 0; i < b.N; i++ {
			cache := NewPartCache()
			processor := NewBatchProcessor(cache)
			
			blocks, _, err := processor.RenderMessagesParallel(messages, width, showToolDetails)
			if err != nil {
				b.Fatalf("Parallel rendering failed: %v", err)
			}
			_ = strings.Join(blocks, "\n\n")
		}
	})
}

func BenchmarkBatchWithRealWorkload(b *testing.B) {
	// Simulate real-world workload with mixed message types
	messageCount := 100
	messages := make([]app.Message, 0, messageCount)
	
	for i := 0; i < messageCount; i++ {
		if i%3 == 0 {
			// User message
			content := fmt.Sprintf("User question %d: Can you help me understand this code?", i)
			messages = append(messages, createBatchTestMessage("user", content, i))
		} else {
			// Assistant message with varying complexity
			var content string
			switch i % 4 {
			case 0:
				content = "Short response"
			case 1:
				content = createBatchLongMessage(5)
			case 2:
				content = createBatchLongMessage(15)
			default:
				content = createBatchLongMessage(30)
			}
			messages = append(messages, createBatchTestMessage("assistant", content, i))
		}
	}
	
	width := 120
	showToolDetails := false
	
	b.Run("Realistic_Sequential", func(b *testing.B) {
		initBatchTestTheme()
		cache := NewPartCache()
		processor := NewBatchProcessor(cache)
		
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			blocks, _, err := processor.RenderMessagesSequential(messages, width, showToolDetails)
			if err != nil {
				b.Fatalf("Sequential rendering failed: %v", err)
			}
			_ = strings.Join(blocks, "\n\n")
		}
	})
	
	b.Run("Realistic_Parallel", func(b *testing.B) {
		initBatchTestTheme()
		cache := NewPartCache()
		processor := NewBatchProcessor(cache)
		
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			blocks, _, err := processor.RenderMessagesParallel(messages, width, showToolDetails)
			if err != nil {
				b.Fatalf("Parallel rendering failed: %v", err)
			}
			_ = strings.Join(blocks, "\n\n")
		}
	})
}

func TestBatchRenderingCorrectness(t *testing.T) {
	// Verify that parallel rendering produces the same results as sequential
	initBatchTestTheme()
	
	messages := make([]app.Message, 0, 50)
	for i := 0; i < 50; i++ {
		role := "assistant"
		if i%3 == 0 {
			role = "user"
		}
		content := createBatchLongMessage(5)
		messages = append(messages, createBatchTestMessage(role, content, i))
	}
	
	width := 120
	showToolDetails := false
	
	cache := NewPartCache()
	processor := NewBatchProcessor(cache)
	
	// Sequential rendering
	sequentialBlocks, _, err := processor.RenderMessagesSequential(messages, width, showToolDetails)
	if err != nil {
		t.Fatalf("Sequential rendering failed: %v", err)
	}
	sequentialResult := strings.Join(sequentialBlocks, "\n\n")
	
	// Parallel rendering
	parallelBlocks, _, err := processor.RenderMessagesParallel(messages, width, showToolDetails)
	if err != nil {
		t.Fatalf("Parallel rendering failed: %v", err)
	}
	parallelResult := strings.Join(parallelBlocks, "\n\n")
	
	// Compare results (they should be identical)
	if sequentialResult != parallelResult {
		t.Errorf("Sequential and parallel rendering produced different results")
		t.Logf("Sequential length: %d", len(sequentialResult))
		t.Logf("Parallel length: %d", len(parallelResult))
		
		// Print first difference for debugging
		minLen := len(sequentialResult)
		if len(parallelResult) < minLen {
			minLen = len(parallelResult)
		}
		
		for i := 0; i < minLen; i++ {
			if sequentialResult[i] != parallelResult[i] {
				t.Logf("First difference at position %d", i)
				start := max(0, i-50)
				end := min(minLen, i+50)
				t.Logf("Sequential context: %q", sequentialResult[start:end])
				t.Logf("Parallel context: %q", parallelResult[start:end])
				break
			}
		}
	}
}