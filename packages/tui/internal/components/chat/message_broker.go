package chat

import (
	"sync"

	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/cache"
)

// Type alias for convenience
type Message = app.Message

// MessageBroker manages message loading and caching between API and UI
type MessageBroker struct {
	// Reference to app messages (from API)
	app *app.App
	
	// Memory-bounded cache for message data
	messageCache *cache.MemoryBoundedCache
	
	// Current working window
	windowStart  int
	windowEnd    int
	windowData   []Message
	windowMutex  sync.RWMutex
	
	// Window size configuration
	windowSize   int  // Number of messages to keep in memory window
}

// NewMessageBroker creates a new message broker
func NewMessageBroker(app *app.App, cacheSizeMB int) *MessageBroker {
	return &MessageBroker{
		app:          app,
		messageCache: cache.NewMemoryBoundedCache(cacheSizeMB),
		windowSize:   1000, // Keep 1000 messages in working window
		windowData:   make([]Message, 0),
	}
}

// GetMessageCount returns the total number of messages
func (mb *MessageBroker) GetMessageCount() int {
	return len(mb.app.Messages)
}

// GetMessages returns messages for the specified range
func (mb *MessageBroker) GetMessages(start, end int) []Message {
	mb.windowMutex.Lock()
	defer mb.windowMutex.Unlock()
	
	totalMessages := len(mb.app.Messages)
	if start < 0 {
		start = 0
	}
	if end > totalMessages {
		end = totalMessages
	}
	if start >= end {
		return []Message{}
	}
	
	// Check if requested range is within current window
	if start >= mb.windowStart && end <= mb.windowEnd && len(mb.windowData) > 0 {
		windowStart := start - mb.windowStart
		windowEnd := end - mb.windowStart
		return mb.windowData[windowStart:windowEnd]
	}
	
	// Update window to cover requested range
	mb.updateWindow(start, end, totalMessages)
	
	// Return requested slice from window
	if len(mb.windowData) == 0 {
		return []Message{}
	}
	
	windowStart := start - mb.windowStart
	windowEnd := end - mb.windowStart
	if windowStart < 0 {
		windowStart = 0
	}
	if windowEnd > len(mb.windowData) {
		windowEnd = len(mb.windowData)
	}
	
	return mb.windowData[windowStart:windowEnd]
}

// updateWindow loads a new window of messages centered around the requested range
func (mb *MessageBroker) updateWindow(start, end, totalMessages int) {
	// Calculate optimal window bounds
	requestedSize := end - start
	padding := (mb.windowSize - requestedSize) / 2
	
	newStart := max(0, start-padding)
	newEnd := min(totalMessages, end+padding)
	
	// Extend window if it's smaller than windowSize
	if newEnd-newStart < mb.windowSize {
		if newStart == 0 {
			newEnd = min(totalMessages, newStart+mb.windowSize)
		} else if newEnd == totalMessages {
			newStart = max(0, newEnd-mb.windowSize)
		}
	}
	
	// Load messages from app.Messages
	windowMessages := make([]Message, newEnd-newStart)
	copy(windowMessages, mb.app.Messages[newStart:newEnd])
	
	// Update window state
	mb.windowStart = newStart
	mb.windowEnd = newEnd
	mb.windowData = windowMessages
}

// GetMessage returns a single message by index
func (mb *MessageBroker) GetMessage(index int) (Message, bool) {
	if index < 0 || index >= len(mb.app.Messages) {
		return Message{}, false
	}
	
	messages := mb.GetMessages(index, index+1)
	if len(messages) == 0 {
		return Message{}, false
	}
	
	return messages[0], true
}

// InvalidateCache clears all cached message data
func (mb *MessageBroker) InvalidateCache() {
	mb.windowMutex.Lock()
	defer mb.windowMutex.Unlock()
	
	mb.messageCache.Clear()
	mb.windowData = make([]Message, 0)
	mb.windowStart = 0
	mb.windowEnd = 0
}

// GetCacheStats returns cache statistics
func (mb *MessageBroker) GetCacheStats() (entries int, memoryMB float64) {
	return mb.messageCache.Stats()
}