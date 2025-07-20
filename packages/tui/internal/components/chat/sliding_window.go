package chat

import (
	"fmt"
	"hash/fnv"
	"strings"
	"sync"
	
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/cache"
	"github.com/sst/opencode/internal/util"
)

// hashString creates a hash from a string
func hashString(s string) uint64 {
	h := fnv.New64a()
	h.Write([]byte(s))
	return h.Sum64()
}

// MessageMeta holds lightweight metadata about a message for indexing
type MessageMeta struct {
	StartLine   int    // Cumulative line position
	Height      int    // Lines this message takes (including spacing)
	ContentHash uint64 // For cache lookups
}

// SlidingWindowRenderer efficiently renders only visible messages
type SlidingWindowRenderer struct {
	// Configuration
	viewportHeight int // Terminal height in lines
	windowSize     int // Number of messages to keep rendered
	
	// Message index (lightweight, always in memory)
	messageIndex []MessageMeta
	indexMutex   sync.RWMutex
	
	// Sliding window state
	windowStart    int                // First message index in window
	windowEnd      int                // Last message index in window  
	renderedWindow map[int]string     // Message index -> rendered content
	windowMutex    sync.RWMutex
	
	// Dependencies
	cache          *PartCache
	batchProcessor *BatchProcessor
	
	// Global app-lifetime cache for all rendered content
	globalCache    *cache.MemoryBoundedCache
}

// NewSlidingWindowRenderer creates a new sliding window renderer
func NewSlidingWindowRenderer(cache *PartCache, globalCache *cache.MemoryBoundedCache) *SlidingWindowRenderer {
	return &SlidingWindowRenderer{
		renderedWindow: make(map[int]string),
		messageIndex:   make([]MessageMeta, 0),
		cache:          cache,
		batchProcessor: NewBatchProcessor(cache),
		globalCache:    globalCache,
		windowSize:     25, // Default, will be adjusted based on viewport
	}
}

// SetViewportHeight updates viewport height and recalculates window size
func (swr *SlidingWindowRenderer) SetViewportHeight(height int) {
	swr.viewportHeight = height
	swr.windowSize = swr.calculateWindowSize(height)
}

// calculateWindowSize determines optimal window size based on viewport
func (swr *SlidingWindowRenderer) calculateWindowSize(viewportHeight int) int {
	// Estimate messages visible (assuming avg 5 lines per message + spacing)
	messagesVisible := viewportHeight / 5
	
	// 2.5x buffer for smooth scrolling
	windowSize := int(float64(messagesVisible) * 2.5)
	
	// Bounds
	minWindow := 20  // Never less than 20
	maxWindow := 50  // Never more than 50
	
	return max(minWindow, min(windowSize, maxWindow))
}

// generateCacheKey creates a unique key for rendered content
func (swr *SlidingWindowRenderer) generateCacheKey(msg app.Message, width int, showToolDetails bool) string {
	var msgID string
	switch info := msg.Info.(type) {
	case opencode.UserMessage:
		msgID = info.ID
	case opencode.AssistantMessage:
		msgID = info.ID
	}
	
	// Include content hash for cache invalidation
	var contentHash uint64
	for _, part := range msg.Parts {
		if textPart, ok := part.(opencode.TextPart); ok {
			contentHash = contentHash*31 + hashString(textPart.Text)
		}
	}
	
	return fmt.Sprintf("%s:%d:%t:%x", msgID, width, showToolDetails, contentHash)
}

// UpdateIndex updates the message index when messages change
func (swr *SlidingWindowRenderer) UpdateIndex(broker *MessageBroker, width int) {
	measure := util.Measure("sliding_window.UpdateIndex")
	defer measure()
	
	swr.indexMutex.Lock()
	defer swr.indexMutex.Unlock()
	
	// Get message count and rebuild index
	messageCount := broker.GetMessageCount()
	newIndex := make([]MessageMeta, messageCount)
	cumulativeHeight := 0
	
	// Process messages in batches to avoid loading all at once
	batchSize := 100
	for start := 0; start < messageCount; start += batchSize {
		end := min(start+batchSize, messageCount)
		messages := broker.GetMessages(start, end)
		
		for i, msg := range messages {
			globalIndex := start + i
			
			// Get content hash based on message content
			var hash uint64
			switch info := msg.Info.(type) {
			case opencode.UserMessage:
				hash = hashString(info.ID)
				for _, part := range msg.Parts {
					if textPart, ok := part.(opencode.TextPart); ok {
						hash = hash*31 + hashString(textPart.Text)
					}
				}
			case opencode.AssistantMessage:
				hash = hashString(info.ID)
				for _, part := range msg.Parts {
					if textPart, ok := part.(opencode.TextPart); ok {
						hash = hash*31 + hashString(textPart.Text)
					}
				}
			}
			
			// Estimate height (will be corrected when actually rendered)
			estimatedHeight := swr.estimateMessageHeight(msg)
			
			newIndex[globalIndex] = MessageMeta{
				StartLine:   cumulativeHeight,
				Height:      estimatedHeight,
				ContentHash: hash,
			}
			
			cumulativeHeight += estimatedHeight + 2 // +2 for spacing between messages
		}
	}
	
	swr.messageIndex = newIndex
}

// estimateMessageHeight provides a rough estimate of message height
func (swr *SlidingWindowRenderer) estimateMessageHeight(msg app.Message) int {
	// Quick estimation based on message type and content length
	// This will be corrected when the message is actually rendered
	switch msg.Info.(type) {
	case opencode.UserMessage:
		for _, part := range msg.Parts {
			if textPart, ok := part.(opencode.TextPart); ok {
				// Rough estimate: ~80 chars per line
				return max(3, len(textPart.Text)/80)
			}
		}
	case opencode.AssistantMessage:
		totalHeight := 0
		for _, part := range msg.Parts {
			if textPart, ok := part.(opencode.TextPart); ok {
				totalHeight += max(3, len(textPart.Text)/80)
			}
		}
		return max(3, totalHeight)
	}
	return 5 // Default estimate
}

// GetVisibleContent returns rendered content for the current scroll position
func (swr *SlidingWindowRenderer) GetVisibleContent(
	broker *MessageBroker,
	scrollOffset int,
	width int,
	showToolDetails bool,
) (content string, totalHeight int) {
	measure := util.Measure("sliding_window.GetVisibleContent")
	defer measure()
	
	messageCount := broker.GetMessageCount()
	if messageCount == 0 {
		return "", 0
	}
	
	// Find which messages are visible
	visibleStart, visibleEnd := swr.findVisibleMessageRange(scrollOffset)
	
	// Calculate window range (centered on visible area)
	windowStart, windowEnd := swr.calculateWindowRange(visibleStart, visibleEnd, messageCount)
	
	// Update window if needed
	if windowStart != swr.windowStart || windowEnd != swr.windowEnd {
		messages := broker.GetMessages(windowStart, windowEnd)
		swr.updateWindow(messages, windowStart, windowEnd, width, showToolDetails)
	}
	
	// Build content from window
	content = swr.buildVisibleContent(visibleStart, visibleEnd)
	
	// Calculate total height
	swr.indexMutex.RLock()
	if len(swr.messageIndex) > 0 {
		lastMsg := swr.messageIndex[len(swr.messageIndex)-1]
		totalHeight = lastMsg.StartLine + lastMsg.Height
	}
	swr.indexMutex.RUnlock()
	
	return content, totalHeight
}

// findVisibleMessageRange finds which messages are visible at scroll offset
func (swr *SlidingWindowRenderer) findVisibleMessageRange(scrollOffset int) (start, end int) {
	swr.indexMutex.RLock()
	defer swr.indexMutex.RUnlock()
	
	if len(swr.messageIndex) == 0 {
		return 0, 0
	}
	
	// Binary search for first visible message
	start = 0
	for i, meta := range swr.messageIndex {
		if meta.StartLine+meta.Height > scrollOffset {
			start = i
			break
		}
	}
	
	// Find last visible message
	viewportBottom := scrollOffset + swr.viewportHeight
	end = len(swr.messageIndex)
	for i := start; i < len(swr.messageIndex); i++ {
		if swr.messageIndex[i].StartLine > viewportBottom {
			end = i
			break
		}
	}
	
	return start, end
}

// calculateWindowRange determines the window bounds centered on visible area
func (swr *SlidingWindowRenderer) calculateWindowRange(visibleStart, visibleEnd, totalMessages int) (start, end int) {
	visibleCount := visibleEnd - visibleStart
	
	// Center the window on visible messages
	padding := (swr.windowSize - visibleCount) / 2
	
	start = max(0, visibleStart-padding)
	end = min(totalMessages, visibleEnd+padding)
	
	// If we hit bounds, extend in the other direction
	if start == 0 {
		end = min(totalMessages, start+swr.windowSize)
	} else if end == totalMessages {
		start = max(0, end-swr.windowSize)
	}
	
	return start, end
}

// updateWindow renders messages in the new window range
func (swr *SlidingWindowRenderer) updateWindow(
	messages []app.Message,
	windowStart, windowEnd int,
	width int,
	showToolDetails bool,
) {
	swr.windowMutex.Lock()
	defer swr.windowMutex.Unlock()
	
	// Clear old entries outside new window
	for idx := range swr.renderedWindow {
		if idx < windowStart || idx >= windowEnd {
			delete(swr.renderedWindow, idx)
		}
	}
	
	// Prepare messages to render
	toRender := make([]int, 0)
	for i := windowStart; i < windowEnd; i++ {
		// Check if already in window
		if _, inWindow := swr.renderedWindow[i]; !inWindow {
			// Check global cache
			messageIndex := i - windowStart // Convert to local index in messages slice
			cacheKey := swr.generateCacheKey(messages[messageIndex], width, showToolDetails)
			if _, inGlobal := swr.globalCache.Get(cacheKey); !inGlobal {
				toRender = append(toRender, i)
			}
		}
	}
	
	// Batch render new messages
	if len(toRender) > 0 {
		messagesToRender := make([]app.Message, len(toRender))
		for i, idx := range toRender {
			messageIndex := idx - windowStart // Convert to local index
			messagesToRender[i] = messages[messageIndex]
		}
		
		rendered, _, err := swr.batchProcessor.RenderMessagesParallel(
			messagesToRender, width, showToolDetails,
		)
		if err == nil {
			// Store rendered content and update heights
			swr.indexMutex.Lock()
			for i, content := range rendered {
				idx := toRender[i]
				swr.renderedWindow[idx] = content
				
				// Store in global cache
				messageIndex := idx - windowStart // Convert to local index
				cacheKey := swr.generateCacheKey(messages[messageIndex], width, showToolDetails)
				swr.globalCache.Set(cacheKey, content)
				
				// Update actual height in index
				if idx < len(swr.messageIndex) {
					actualHeight := lipgloss.Height(content)
					swr.messageIndex[idx].Height = actualHeight
					
					// Update cumulative heights for subsequent messages
					for j := idx + 1; j < len(swr.messageIndex); j++ {
						swr.messageIndex[j].StartLine = swr.messageIndex[j-1].StartLine + 
							swr.messageIndex[j-1].Height + 2
					}
				}
			}
			swr.indexMutex.Unlock()
		}
	}
	
	// Copy from global cache to window
	for i := windowStart; i < windowEnd; i++ {
		if _, inWindow := swr.renderedWindow[i]; !inWindow {
			messageIndex := i - windowStart // Convert to local index
			cacheKey := swr.generateCacheKey(messages[messageIndex], width, showToolDetails)
			if content, inGlobal := swr.globalCache.Get(cacheKey); inGlobal {
				swr.renderedWindow[i] = content
			}
		}
	}
	
	swr.windowStart = windowStart
	swr.windowEnd = windowEnd
}

// buildVisibleContent constructs the final content string
func (swr *SlidingWindowRenderer) buildVisibleContent(visibleStart, visibleEnd int) string {
	swr.windowMutex.RLock()
	defer swr.windowMutex.RUnlock()
	
	var content strings.Builder
	content.WriteString("\n")
	
	first := true
	for i := visibleStart; i < visibleEnd; i++ {
		if rendered, ok := swr.renderedWindow[i]; ok {
			if !first {
				content.WriteString("\n\n")
			}
			content.WriteString(rendered)
			first = false
		}
	}
	
	return content.String()
}

// ClearCache clears the sliding window cache (but not global cache)
func (swr *SlidingWindowRenderer) ClearCache() {
	swr.windowMutex.Lock()
	swr.renderedWindow = make(map[int]string)
	swr.windowStart = 0
	swr.windowEnd = 0
	swr.windowMutex.Unlock()
}

// GetMemoryUsage returns estimated memory usage
func (swr *SlidingWindowRenderer) GetMemoryUsage() (indexSize, windowSize, cacheSize int) {
	swr.indexMutex.RLock()
	indexSize = len(swr.messageIndex) * 24 // Rough estimate: 24 bytes per MessageMeta
	swr.indexMutex.RUnlock()
	
	swr.windowMutex.RLock()
	for _, content := range swr.renderedWindow {
		windowSize += len(content)
	}
	swr.windowMutex.RUnlock()
	
	_, cacheMB := swr.globalCache.Stats()
	cacheSize = int(cacheMB * 1024 * 1024) // Convert MB back to bytes
	
	return
}