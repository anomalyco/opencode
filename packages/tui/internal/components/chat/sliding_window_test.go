package chat

import (
	"fmt"
	"strings"
	"testing"
	"time"
	
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/cache"
	"github.com/sst/opencode/internal/theme"
)

// createViewportTestMessage creates a test message for sliding window testing
func createViewportTestMessage(role string, content string, index int) Message {
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
	
	return Message{
		Info:  messageInfo,
		Parts: parts,
	}
}

func TestSlidingWindow(t *testing.T) {
	// Initialize theme
	if err := theme.LoadThemesFromJSON(); err != nil {
		testTheme := theme.NewSystemTheme(lipgloss.Color("#000000"), true)
		theme.RegisterTheme("test", testTheme)
		theme.SetTheme("test")
	} else {
		theme.SetTheme("opencode")
	}
	
	// Create test messages
	messages := make([]Message, 100)
	for i := 0; i < 100; i++ {
		content := fmt.Sprintf("Message %d\nWith multiple lines\nLine 3", i)
		messages[i] = createViewportTestMessage("user", content, i)
	}
	
	// Create app with test messages
	testApp := &app.App{Messages: messages}
	
	// Create message broker
	broker := NewMessageBroker(testApp, 100)
	
	// Create sliding window
	partCache := NewPartCache()
	globalCache := cache.NewMemoryBoundedCache(500)
	sw := NewSlidingWindowRenderer(partCache, globalCache)
	sw.SetViewportHeight(20) // 20 lines visible
	
	// Build index
	sw.UpdateIndex(broker, 120)
	
	// Test 1: Get content at top
	content, totalHeight := sw.GetVisibleContent(broker, 0, 120, false)
	if content == "" {
		t.Error("Expected content at top, got empty")
	}
	if totalHeight == 0 {
		t.Error("Expected total height > 0")
	}
	
	// Test 2: Scroll to middle
	content2, _ := sw.GetVisibleContent(broker, 150, 120, false)
	if content2 == content {
		t.Error("Expected different content when scrolled")
	}
	
	// Test 3: Check window size adapts
	sw.SetViewportHeight(60) // Larger viewport
	if sw.windowSize <= 25 {
		t.Errorf("Expected window size to increase with viewport, got %d", sw.windowSize)
	}
}

func TestAdaptiveWindowSize(t *testing.T) {
	partCache := NewPartCache()
	globalCache := cache.NewMemoryBoundedCache(500)
	sw := NewSlidingWindowRenderer(partCache, globalCache)
	
	tests := []struct {
		viewportHeight int
		expectedMin    int
		expectedMax    int
	}{
		{20, 20, 20},  // Small viewport - hits minimum
		{40, 20, 25},  // Medium viewport
		{80, 35, 45},  // Large viewport
		{120, 45, 50}, // Huge viewport - hits maximum
	}
	
	for _, tt := range tests {
		t.Run(fmt.Sprintf("viewport_%d", tt.viewportHeight), func(t *testing.T) {
			sw.SetViewportHeight(tt.viewportHeight)
			windowSize := sw.calculateWindowSize(tt.viewportHeight)
			
			if windowSize < tt.expectedMin || windowSize > tt.expectedMax {
				t.Errorf("Window size %d not in expected range [%d, %d]",
					windowSize, tt.expectedMin, tt.expectedMax)
			}
		})
	}
}

func TestMemoryUsage(t *testing.T) {
	// Initialize theme
	if err := theme.LoadThemesFromJSON(); err != nil {
		testTheme := theme.NewSystemTheme(lipgloss.Color("#000000"), true)
		theme.RegisterTheme("test", testTheme)
		theme.SetTheme("test")
	} else {
		theme.SetTheme("opencode")
	}
	
	partCache := NewPartCache()
	globalCache := cache.NewMemoryBoundedCache(500)
	sw := NewSlidingWindowRenderer(partCache, globalCache)
	sw.SetViewportHeight(30)
	
	// Create large message set
	messages := make([]Message, 1000)
	for i := 0; i < 1000; i++ {
		content := fmt.Sprintf("Message %d: %s", i, strings.Repeat("x", 100))
		messages[i] = createViewportTestMessage("assistant", content, i)
	}
	
	// Create app and broker
	testApp := &app.App{Messages: messages}
	broker := NewMessageBroker(testApp, 100)
	
	// Update index
	sw.UpdateIndex(broker, 120)
	
	// Get visible content multiple times (simulating scrolling)
	for offset := 0; offset < 5000; offset += 100 {
		sw.GetVisibleContent(broker, offset, 120, false)
	}
	
	// Check memory usage
	indexSize, windowSize, cacheSize := sw.GetMemoryUsage()
	
	// Index should be small (just metadata)
	expectedIndexSize := 1000 * 24 // ~24KB for 1000 messages
	if indexSize > expectedIndexSize*2 {
		t.Errorf("Index too large: %d bytes (expected ~%d)", indexSize, expectedIndexSize)
	}
	
	// Window should be limited
	maxWindowSize := 50 * 1024 // 50KB max for window (50 messages × 1KB)
	if windowSize > maxWindowSize {
		t.Errorf("Window too large: %d bytes (max %d)", windowSize, maxWindowSize)
	}
	
	t.Logf("Memory usage - Index: %d bytes, Window: %d bytes, Cache: %d bytes",
		indexSize, windowSize, cacheSize)
}

// Benchmark sliding window vs full rendering
func BenchmarkSlidingWindowVsFullRender(b *testing.B) {
	// Initialize theme
	if err := theme.LoadThemesFromJSON(); err != nil {
		testTheme := theme.NewSystemTheme(lipgloss.Color("#000000"), true)
		theme.RegisterTheme("test", testTheme)
		theme.SetTheme("test")
	} else {
		theme.SetTheme("opencode")
	}
	
	messageCounts := []int{100, 1000, 10000}
	
	for _, count := range messageCounts {
		// Create messages
		messages := make([]Message, count)
		for i := 0; i < count; i++ {
			content := fmt.Sprintf("Message %d: This is a test message.\nWith multiple lines.\nLine 3", i)
			messages[i] = createViewportTestMessage("assistant", content, i)
		}
		
		// Benchmark full render (current approach)
		b.Run(fmt.Sprintf("FullRender_%d", count), func(b *testing.B) {
			cache := NewPartCache()
			processor := NewBatchProcessor(cache)
			
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				// Render ALL messages
				blocks, _, _ := processor.RenderMessagesSequential(messages, 120, false)
				content := strings.Join(blocks, "\n\n")
				_ = content
			}
		})
		
		// Benchmark sliding window
		b.Run(fmt.Sprintf("SlidingWindow_%d", count), func(b *testing.B) {
			partCache := NewPartCache()
			globalCache := cache.NewMemoryBoundedCache(500)
			sw := NewSlidingWindowRenderer(partCache, globalCache)
			sw.SetViewportHeight(30)
			
			// Create app and broker
			testApp := &app.App{Messages: messages}
			broker := NewMessageBroker(testApp, 100)
			sw.UpdateIndex(broker, 120)
			
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				// Render only visible portion
				content, _ := sw.GetVisibleContent(broker, count*2, 120, false)
				_ = content
			}
		})
	}
}

// Benchmark memory allocations
func BenchmarkSlidingWindowMemory(b *testing.B) {
	// Initialize theme
	if err := theme.LoadThemesFromJSON(); err != nil {
		testTheme := theme.NewSystemTheme(lipgloss.Color("#000000"), true)
		theme.RegisterTheme("test", testTheme)
		theme.SetTheme("test")
	} else {
		theme.SetTheme("opencode")
	}
	
	messages := make([]Message, 10000)
	for i := 0; i < 10000; i++ {
		content := fmt.Sprintf("Message %d: %s", i, strings.Repeat("x", 200))
		messages[i] = createViewportTestMessage("user", content, i)
	}
	
	b.Run("FullRender_Memory", func(b *testing.B) {
		b.ReportAllocs()
		cache := NewPartCache()
		processor := NewBatchProcessor(cache)
		
		for i := 0; i < b.N; i++ {
			blocks, _, _ := processor.RenderMessagesSequential(messages[:1000], 120, false)
			_ = strings.Join(blocks, "\n\n")
		}
	})
	
	b.Run("SlidingWindow_Memory", func(b *testing.B) {
		b.ReportAllocs()
		partCache := NewPartCache()
		globalCache := cache.NewMemoryBoundedCache(500)
		sw := NewSlidingWindowRenderer(partCache, globalCache)
		sw.SetViewportHeight(30)
		
		// Create app and broker
		testApp := &app.App{Messages: messages}
		broker := NewMessageBroker(testApp, 100)
		sw.UpdateIndex(broker, 120)
		
		for i := 0; i < b.N; i++ {
			content, _ := sw.GetVisibleContent(broker, 2000, 120, false)
			_ = content
		}
	})
}