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

// Initialize theme for testing - loads the actual opencode theme for realistic benchmarks
func initTestTheme() {
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

// Helper to create test messages using the actual Message structure
func createTestMessage(role string, content string, index int) Message {
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

func createLongMessage(lines int) string {
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

func createTestApp() *app.App {
	return &app.App{
		Config: &opencode.Config{},
		Model: &opencode.Model{
			Limit: opencode.ModelLimit{
				Context: 100000,
			},
			Cost: opencode.ModelCost{
				Input:  0.001,
				Output: 0.002,
			},
		},
		Session: &opencode.Session{
			ID:    "test-session",
			Title: "Test Session",
		},
	}
}

func BenchmarkMessagesRendering(b *testing.B) {
	messageCounts := []int{10, 100, 1000}
	
	for _, count := range messageCounts {
		// Create messages with varying content
		messages := make([]Message, 0, count)
		for i := 0; i < count; i++ {
			role := "user"
			if i%2 == 0 {
				role = "assistant"
			}
			
			// Mix of short and long messages
			content := fmt.Sprintf("Message %d: Short content", i)
			if i%5 == 0 {
				content = createLongMessage(20) // 20 line message
			}
			
			messages = append(messages, createTestMessage(role, content, i))
		}
		
		b.Run(fmt.Sprintf("RenderMessages_%d", count), func(b *testing.B) {
			initTestTheme() // Initialize theme for realistic performance measurements
			app := createTestApp()
			m := NewMessagesComponent(app)
			mc := m.(*messagesComponent)
			mc.width = 120
			mc.height = 50
			
			// Set messages
			app.Messages = messages
			
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				_ = mc.View()
			}
		})
		
		b.Run(fmt.Sprintf("BuildViewportContent_%d", count), func(b *testing.B) {
			initTestTheme() // Initialize theme for realistic performance measurements
			app := createTestApp()
			m := NewMessagesComponent(app)
			mc := m.(*messagesComponent)
			mc.width = 120
			mc.height = 50
			
			// Set messages
			app.Messages = messages
			
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				// Force rebuild of viewport content
				mc.renderView()
			}
		})
	}
}

func BenchmarkMessagesConcatenation(b *testing.B) {
	messageCounts := []int{100, 500, 1000}
	
	for _, count := range messageCounts {
		messages := make([]Message, 0, count)
		for i := 0; i < count; i++ {
			content := createLongMessage(10)
			messages = append(messages, createTestMessage("assistant", content, i))
		}
		
		b.Run(fmt.Sprintf("StringConcatenation_%d", count), func(b *testing.B) {
			app := createTestApp()
			app.Messages = messages
			
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				var content string
				for _, msg := range messages {
					for _, part := range msg.Parts {
						if textPart, ok := part.(opencode.TextPart); ok {
							content += textPart.Text + "\n"
						}
					}
				}
				_ = content
			}
		})
		
		b.Run(fmt.Sprintf("StringBuilderConcatenation_%d", count), func(b *testing.B) {
			app := createTestApp()
			app.Messages = messages
			
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				var sb strings.Builder
				for _, msg := range messages {
					for _, part := range msg.Parts {
						if textPart, ok := part.(opencode.TextPart); ok {
							sb.WriteString(textPart.Text)
							sb.WriteString("\n")
						}
					}
				}
				_ = sb.String()
			}
		})
	}
}

func BenchmarkMessagesNavigation(b *testing.B) {
	// Create a large conversation
	messageCount := 1000
	messages := make([]Message, 0, messageCount)
	for i := 0; i < messageCount; i++ {
		content := createLongMessage(5)
		messages = append(messages, createTestMessage("assistant", content, i))
	}
	
	b.Run("ScrollOperations", func(b *testing.B) {
		initTestTheme() // Initialize theme for realistic performance measurements
		app := createTestApp()
		m := NewMessagesComponent(app)
		mc := m.(*messagesComponent)
		mc.width = 120
		mc.height = 50
		
		app.Messages = messages
		mc.renderView()
		
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			// Simulate scrolling
			for j := 0; j < 10; j++ {
				mc.PageDown()
			}
			for j := 0; j < 10; j++ {
				mc.PageUp()
			}
		}
	})
	
	b.Run("GotoOperations", func(b *testing.B) {
		initTestTheme() // Initialize theme for realistic performance measurements
		app := createTestApp()
		m := NewMessagesComponent(app)
		mc := m.(*messagesComponent)
		mc.width = 120
		mc.height = 50
		
		app.Messages = messages
		mc.renderView()
		
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			mc.GotoBottom()
			mc.GotoTop()
		}
	})
}

func BenchmarkMessagesStreaming(b *testing.B) {
	sizes := []int{100, 1000, 10000} // Characters to stream
	
	for _, size := range sizes {
		content := strings.Repeat("This is streaming content. ", size/27)
		
		b.Run(fmt.Sprintf("StreamContent_%d_chars", size), func(b *testing.B) {
			initTestTheme() // Initialize theme for realistic performance measurements
			app := createTestApp()
			m := NewMessagesComponent(app)
			mc := m.(*messagesComponent)
			mc.width = 120
			mc.height = 50
			
			// Add initial messages
			for i := 0; i < 10; i++ {
				msg := createTestMessage("user", "Initial message", i)
				app.Messages = append(app.Messages, msg)
			}
			
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				// Simulate streaming by appending content in chunks
				msg := createTestMessage("assistant", "", 100)
				app.Messages = append(app.Messages, msg)
				
				chunkSize := 50
				for j := 0; j < len(content); j += chunkSize {
					end := j + chunkSize
					if end > len(content) {
						end = len(content)
					}
					
					// Update the last message
					if len(app.Messages) > 0 {
						lastMsg := &app.Messages[len(app.Messages)-1]
						if len(lastMsg.Parts) > 0 {
							if textPart, ok := lastMsg.Parts[0].(opencode.TextPart); ok {
								textPart.Text += content[j:end]
								lastMsg.Parts[0] = textPart
							}
						}
					}
					
					// Re-render
					mc.renderView()
				}
				
				// Reset for next iteration
				app.Messages = app.Messages[:10]
			}
		})
	}
}

func BenchmarkMessagesMemoryAllocation(b *testing.B) {
	messageCounts := []int{10, 100, 1000}
	
	for _, count := range messageCounts {
		messages := make([]Message, 0, count)
		for i := 0; i < count; i++ {
			content := createLongMessage(10)
			messages = append(messages, createTestMessage("assistant", content, i))
		}
		
		b.Run(fmt.Sprintf("AddMessages_%d", count), func(b *testing.B) {
			b.ReportAllocs()
			
			for i := 0; i < b.N; i++ {
				initTestTheme() // Initialize theme for realistic performance measurements
				app := createTestApp()
				m := NewMessagesComponent(app)
				// Type assertion not needed here - just create the component
				_ = m
				
				// Add messages to app
				app.Messages = messages
			}
		})
		
		b.Run(fmt.Sprintf("RenderWithAllocs_%d", count), func(b *testing.B) {
			initTestTheme() // Initialize theme for realistic performance measurements
			app := createTestApp()
			m := NewMessagesComponent(app)
			mc := m.(*messagesComponent)
			mc.width = 120
			mc.height = 50
			
			app.Messages = messages
			
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				mc.renderView()
			}
		})
	}
}

func BenchmarkMessagesLargeConversations(b *testing.B) {
	// Simulate very large conversations
	b.Run("VeryLargeConversation_10k_messages", func(b *testing.B) {
		initTestTheme() // Initialize theme for realistic performance measurements
		app := createTestApp()
		m := NewMessagesComponent(app)
		mc := m.(*messagesComponent)
		mc.width = 120
		mc.height = 50
		
		// Add 10k messages  
		messages := make([]Message, 0, 10000)
		for i := 0; i < 10000; i++ {
			content := fmt.Sprintf("Message %d with some content", i)
			if i%10 == 0 {
				content = createLongMessage(20)
			}
			messages = append(messages, createTestMessage("assistant", content, i))
		}
		app.Messages = messages
		
		b.ResetTimer()
		b.SetBytes(int64(mc.viewport.TotalLineCount()))
		
		for i := 0; i < b.N; i++ {
			// Force full re-render
			mc.dirty = true
			mc.renderView()
			_ = mc.View()
		}
	})
	
	b.Run("SearchInLargeConversation", func(b *testing.B) {
		app := createTestApp()
		
		// Add many messages
		messages := make([]Message, 0, 5000)
		for i := 0; i < 5000; i++ {
			content := createLongMessage(5)
			messages = append(messages, createTestMessage("assistant", content, i))
		}
		app.Messages = messages
		
		searchTerm := "Line 10:"
		
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			// Simulate searching through all messages
			found := 0
			for _, msg := range app.Messages {
				for _, part := range msg.Parts {
					if textPart, ok := part.(opencode.TextPart); ok {
						if strings.Contains(textPart.Text, searchTerm) {
							found++
						}
					}
				}
			}
			_ = found
		}
	})
}