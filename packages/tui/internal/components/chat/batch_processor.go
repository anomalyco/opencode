package chat

import (
	"runtime"
	"sync"

	"github.com/charmbracelet/lipgloss/v2"
	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
)

// BatchProcessor handles concurrent message rendering using simple batch processing
type BatchProcessor struct {
	cache *PartCache
}

// NewBatchProcessor creates a new batch processor
func NewBatchProcessor(cache *PartCache) *BatchProcessor {
	return &BatchProcessor{
		cache: cache,
	}
}

// processMessageBatch processes a batch of messages concurrently
func (bp *BatchProcessor) processMessageBatch(messages []app.Message, startIndex, width int, showToolDetails bool) (map[int]string, error) {
	results := make(map[int]string)
	var mu sync.Mutex
	var wg sync.WaitGroup
	
	// Process messages in this batch
	for i, message := range messages {
		wg.Add(1)
		go func(idx int, msg app.Message) {
			defer wg.Done()
			
			content := bp.renderSingleMessage(msg, width, showToolDetails)
			if content != "" {
				// Center the content horizontally
				t := theme.CurrentTheme()
				content = lipgloss.PlaceHorizontal(
					width,
					lipgloss.Center,
					content,
					styles.WhitespaceStyle(t.Background()),
				)
				
				mu.Lock()
				results[startIndex+idx] = content
				mu.Unlock()
			}
		}(i, message)
	}
	
	wg.Wait()
	return results, nil
}

// renderSingleMessage renders a single message (similar to the original logic)
func (bp *BatchProcessor) renderSingleMessage(message app.Message, width int, showToolDetails bool) string {
	switch casted := message.Info.(type) {
	case opencode.UserMessage:
		return bp.renderUserMessage(casted, message.Parts, width)
	case opencode.AssistantMessage:
		return bp.renderAssistantMessage(casted, message.Parts, width, showToolDetails)
	}
	return ""
}

// renderUserMessage handles user message rendering with caching
func (bp *BatchProcessor) renderUserMessage(userMsg opencode.UserMessage, parts []opencode.PartUnion, width int) string {
	for _, part := range parts {
		switch part := part.(type) {
		case opencode.TextPart:
			if part.Synthetic {
				continue
			}
			
			// Simplified file parts collection (for now, just empty string)
			files := ""
			
			// Generate cache key
			key := bp.cache.GenerateKey(userMsg.ID, part.Text, width, files)
			if content, cached := bp.cache.Get(key); cached {
				return content
			}
			
			// Render new content
			content := renderText(
				nil, // app reference not needed for basic rendering
				userMsg,
				part.Text,
				"user", // TODO: Get actual username from context
				false,  // showToolDetails not relevant for user
				width,
				files,
			)
			
			bp.cache.Set(key, content)
			return content
		}
	}
	return ""
}

// renderAssistantMessage handles assistant message rendering with caching
func (bp *BatchProcessor) renderAssistantMessage(assistantMsg opencode.AssistantMessage, parts []opencode.PartUnion, width int, showToolDetails bool) string {
	for _, p := range parts {
		switch part := p.(type) {
		case opencode.TextPart:
			finished := part.Time.End > 0
			
			if finished {
				// Check cache for completed content
				key := bp.cache.GenerateKey(assistantMsg.ID, part.Text, width, showToolDetails)
				if cachedContent, cached := bp.cache.Get(key); cached {
					return cachedContent
				}
			}
			
			// Render content (simplified - no tool calls for now)
			content := renderText(
				nil,
				assistantMsg,
				part.Text,
				assistantMsg.ModelID,
				showToolDetails,
				width,
				"",
			)
			
			if finished {
				// Cache completed content
				key := bp.cache.GenerateKey(assistantMsg.ID, part.Text, width, showToolDetails)
				bp.cache.Set(key, content)
			}
			
			return content
		}
	}
	return ""
}

// RenderMessagesParallel renders messages using concurrent batch processing
func (bp *BatchProcessor) RenderMessagesParallel(messages []app.Message, width int, showToolDetails bool) ([]string, int, error) {
	if len(messages) == 0 {
		return nil, 0, nil
	}
	
	measure := util.Measure("batch.RenderMessagesParallel")
	defer measure()
	
	// Determine optimal batch size based on CPU cores
	numCPU := runtime.NumCPU()
	batchSize := len(messages) / numCPU
	if batchSize < 1 {
		batchSize = 1
	}
	if batchSize > 50 { // Don't make batches too large
		batchSize = 50
	}
	
	// Collect all results
	allResults := make(map[int]string)
	var mu sync.Mutex
	var wg sync.WaitGroup
	
	// Process messages in batches
	for i := 0; i < len(messages); i += batchSize {
		end := i + batchSize
		if end > len(messages) {
			end = len(messages)
		}
		
		wg.Add(1)
		go func(startIdx int, batch []app.Message) {
			defer wg.Done()
			
			batchResults, err := bp.processMessageBatch(batch, startIdx, width, showToolDetails)
			if err != nil {
				return // Skip this batch on error
			}
			
			mu.Lock()
			for idx, content := range batchResults {
				allResults[idx] = content
			}
			mu.Unlock()
		}(i, messages[i:end])
	}
	
	wg.Wait()
	
	// Reassemble results in order
	blocks := make([]string, 0, len(messages))
	totalLineCount := 0
	
	for i := 0; i < len(messages); i++ {
		if content, exists := allResults[i]; exists && content != "" {
			blocks = append(blocks, content)
			totalLineCount += lipgloss.Height(content) + 1
		}
	}
	
	return blocks, totalLineCount, nil
}

// RenderMessagesSequential renders messages sequentially (for comparison)
func (bp *BatchProcessor) RenderMessagesSequential(messages []app.Message, width int, showToolDetails bool) ([]string, int, error) {
	if len(messages) == 0 {
		return nil, 0, nil
	}
	
	measure := util.Measure("batch.RenderMessagesSequential")
	defer measure()
	
	blocks := make([]string, 0, len(messages))
	totalLineCount := 0
	
	t := theme.CurrentTheme()
	
	for _, message := range messages {
		content := bp.renderSingleMessage(message, width, showToolDetails)
		if content != "" {
			// Center the content horizontally
			content = lipgloss.PlaceHorizontal(
				width,
				lipgloss.Center,
				content,
				styles.WhitespaceStyle(t.Background()),
			)
			
			blocks = append(blocks, content)
			totalLineCount += lipgloss.Height(content) + 1
		}
	}
	
	return blocks, totalLineCount, nil
}

// Stats returns batch processor statistics
func (bp *BatchProcessor) Stats() map[string]interface{} {
	return map[string]interface{}{
		"cache_size": bp.cache.Size(),
		"cpu_count":  runtime.NumCPU(),
	}
}