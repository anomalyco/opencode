package util

import (
	"context"
	"fmt"
	"sync"
	"time"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/sst/opencode-sdk-go"
)

// AsyncAPIManager manages non-blocking API operations
type AsyncAPIManager struct {
	contextManager   *ContextManager
	inputBuffer      *InputBufferManager
	activeOperations map[string]*APIOperation
	mutex            sync.RWMutex
	errorHandler     func(error)
}

// APIOperation represents an ongoing API operation
type APIOperation struct {
	ID        string
	Type      string
	StartTime time.Time
	Context   context.Context
	Cancel    context.CancelFunc
	Done      chan APIResult
}

// APIResult contains the result of an API operation
type APIResult struct {
	Success bool
	Error   error
	Data    interface{}
	OpID    string
}

// APIOperationMsg is a tea.Msg for API operation completion
type APIOperationMsg struct {
	Result APIResult
}

// NewAsyncAPIManager creates a new async API manager
func NewAsyncAPIManager(errorHandler func(error)) *AsyncAPIManager {
	return &AsyncAPIManager{
		contextManager:   NewContextManager(10 * time.Second),
		inputBuffer:      NewInputBufferManager(errorHandler),
		activeOperations: make(map[string]*APIOperation),
		errorHandler:     errorHandler,
	}
}

// StartAPIOperation starts a new non-blocking API operation
func (aam *AsyncAPIManager) StartAPIOperation(opID, opType string, operation func(context.Context) (interface{}, error)) tea.Cmd {
	aam.mutex.Lock()
	defer aam.mutex.Unlock()

	// Cancel existing operation with same ID if any
	if existing, exists := aam.activeOperations[opID]; exists {
		existing.Cancel()
		delete(aam.activeOperations, opID)
	}

	// Create context for this operation
	ctx := aam.contextManager.APIContext(opType)
	ctx, cancel := context.WithCancel(ctx)

	// Create operation
	op := &APIOperation{
		ID:        opID,
		Type:      opType,
		StartTime: time.Now(),
		Context:   ctx,
		Cancel:    cancel,
		Done:      make(chan APIResult, 1),
	}

	aam.activeOperations[opID] = op

	// Start input buffering for long operations
	if opType == "send_prompt" || opType == "send_shell" {
		aam.inputBuffer.StartResponse()
	}

	// Return tea.Cmd that runs the operation
	return func() tea.Msg {
		defer func() {
			// Cleanup on completion
			aam.mutex.Lock()
			delete(aam.activeOperations, opID)
			aam.mutex.Unlock()

			// Stop input buffering
			if opType == "send_prompt" || opType == "send_shell" {
				aam.inputBuffer.EndResponse()
			}

			// Cancel context
			cancel()
		}()

		// Execute operation with panic recovery
		result, success := SafeExecuteWithResult(func() APIResult {
			data, err := operation(ctx)
			return APIResult{
				Success: err == nil,
				Error:   err,
				Data:    data,
				OpID:    opID,
			}
		}, aam.errorHandler)

		if !success {
			result = APIResult{
				Success: false,
				Error:   fmt.Errorf("operation %s panicked", opID),
				OpID:    opID,
			}
		}

		// Check for context cancellation
		if ctx.Err() != nil {
			result.Success = false
			if result.Error == nil {
				result.Error = ctx.Err()
			}
		}

		return APIOperationMsg{Result: result}
	}
}

// CancelOperation cancels an ongoing operation
func (aam *AsyncAPIManager) CancelOperation(opID string) {
	aam.mutex.Lock()
	defer aam.mutex.Unlock()

	if op, exists := aam.activeOperations[opID]; exists {
		op.Cancel()
		delete(aam.activeOperations, opID)
	}
}

// CancelAllOperations cancels all ongoing operations
func (aam *AsyncAPIManager) CancelAllOperations() {
	aam.mutex.Lock()
	defer aam.mutex.Unlock()

	for opID, op := range aam.activeOperations {
		op.Cancel()
		delete(aam.activeOperations, opID)
	}

	aam.inputBuffer.EndResponse()
}

// GetActiveOperations returns list of active operation IDs
func (aam *AsyncAPIManager) GetActiveOperations() []string {
	aam.mutex.RLock()
	defer aam.mutex.RUnlock()

	ops := make([]string, 0, len(aam.activeOperations))
	for opID := range aam.activeOperations {
		ops = append(ops, opID)
	}
	return ops
}

// IsOperationActive checks if an operation is currently active
func (aam *AsyncAPIManager) IsOperationActive(opID string) bool {
	aam.mutex.RLock()
	defer aam.mutex.RUnlock()

	_, exists := aam.activeOperations[opID]
	return exists
}

// GetInputBuffer returns the input buffer manager
func (aam *AsyncAPIManager) GetInputBuffer() *InputBufferManager {
	return aam.inputBuffer
}

// HandleBufferedInput handles a key that might be buffered
func (aam *AsyncAPIManager) HandleBufferedInput(key tea.KeyPressMsg) bool {
	return aam.inputBuffer.HandleKey(key)
}

// SendPromptAsync creates an async version of SendPrompt
func (aam *AsyncAPIManager) SendPromptAsync(client *opencode.Client, sessionID, messageID string, params opencode.SessionChatParams) tea.Cmd {
	return aam.StartAPIOperation("send_prompt", "send_prompt", func(ctx context.Context) (interface{}, error) {
		return client.Session.Chat(ctx, sessionID, params)
	})
}

// SendShellAsync creates an async version of SendShell
func (aam *AsyncAPIManager) SendShellAsync(client *opencode.Client, sessionID string, params opencode.SessionShellParams) tea.Cmd {
	return aam.StartAPIOperation("send_shell", "send_shell", func(ctx context.Context) (interface{}, error) {
		return client.Session.Shell(ctx, sessionID, params)
	})
}

// GetOperationStats returns statistics about operations
func (aam *AsyncAPIManager) GetOperationStats() AsyncAPIStats {
	aam.mutex.RLock()
	defer aam.mutex.RUnlock()

	stats := AsyncAPIStats{
		ActiveOperations: len(aam.activeOperations),
		InputBufferStats: aam.inputBuffer.GetKeyBuffer().GetStats(),
	}

	for _, op := range aam.activeOperations {
		stats.Operations = append(stats.Operations, OperationInfo{
			ID:       op.ID,
			Type:     op.Type,
			Duration: time.Since(op.StartTime),
		})
	}

	return stats
}

// AsyncAPIStats contains statistics about async operations
type AsyncAPIStats struct {
	ActiveOperations int
	InputBufferStats BufferStats
	Operations       []OperationInfo
}

// OperationInfo contains information about an operation
type OperationInfo struct {
	ID       string
	Type     string
	Duration time.Duration
}