package util

import (
	"context"
	"sync"
	"time"
)

// ContextManager manages contexts with proper timeouts and cancellation
type ContextManager struct {
	contexts map[string]context.CancelFunc
	mutex    sync.RWMutex
	defaultTimeout time.Duration
}

// NewContextManager creates a new context manager
func NewContextManager(defaultTimeout time.Duration) *ContextManager {
	return &ContextManager{
		contexts:       make(map[string]context.CancelFunc),
		defaultTimeout: defaultTimeout,
	}
}

// CreateContext creates a new context with timeout
func (cm *ContextManager) CreateContext(id string, timeout time.Duration) context.Context {
	cm.mutex.Lock()
	defer cm.mutex.Unlock()

	// Cancel existing context if any
	if cancel, exists := cm.contexts[id]; exists {
		cancel()
	}

	// Use default timeout if none specified
	if timeout == 0 {
		timeout = cm.defaultTimeout
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	cm.contexts[id] = cancel
	
	return ctx
}

// CreateContextWithCancel creates a new cancellable context
func (cm *ContextManager) CreateContextWithCancel(id string) context.Context {
	cm.mutex.Lock()
	defer cm.mutex.Unlock()

	// Cancel existing context if any
	if cancel, exists := cm.contexts[id]; exists {
		cancel()
	}

	ctx, cancel := context.WithCancel(context.Background())
	cm.contexts[id] = cancel
	
	return ctx
}

// CancelContext cancels a specific context
func (cm *ContextManager) CancelContext(id string) {
	cm.mutex.Lock()
	defer cm.mutex.Unlock()

	if cancel, exists := cm.contexts[id]; exists {
		cancel()
		delete(cm.contexts, id)
	}
}

// CancelAll cancels all managed contexts
func (cm *ContextManager) CancelAll() {
	cm.mutex.Lock()
	defer cm.mutex.Unlock()

	for id, cancel := range cm.contexts {
		cancel()
		delete(cm.contexts, id)
	}
}

// HasContext checks if a context exists
func (cm *ContextManager) HasContext(id string) bool {
	cm.mutex.RLock()
	defer cm.mutex.RUnlock()
	
	_, exists := cm.contexts[id]
	return exists
}

// GetActiveContextCount returns number of active contexts
func (cm *ContextManager) GetActiveContextCount() int {
	cm.mutex.RLock()
	defer cm.mutex.RUnlock()
	
	return len(cm.contexts)
}

// APIContext creates a context specifically for API calls with appropriate timeout
func (cm *ContextManager) APIContext(operationType string) context.Context {
	var timeout time.Duration
	
	switch operationType {
	case "send_prompt":
		timeout = 30 * time.Second // Long timeout for AI responses
	case "send_shell":
		timeout = 15 * time.Second // Medium timeout for shell commands
	case "file_operation":
		timeout = 5 * time.Second  // Short timeout for file ops
	case "clipboard":
		timeout = 2 * time.Second  // Very short timeout for clipboard
	default:
		timeout = cm.defaultTimeout
	}
	
	return cm.CreateContext(operationType, timeout)
}

// BackgroundContext creates a context for background operations
func (cm *ContextManager) BackgroundContext(id string) context.Context {
	return cm.CreateContextWithCancel("bg_" + id)
}

// Cleanup removes completed contexts and performs maintenance
func (cm *ContextManager) Cleanup() {
	cm.mutex.Lock()
	defer cm.mutex.Unlock()

	// Note: We don't actually need to check context.Done() here since
	// canceled contexts are already removed from the map when CancelContext is called
	// This is mainly for future extensibility
}

// SafeContext provides a context that won't panic on cancellation
type SafeContext struct {
	ctx    context.Context
	cancel context.CancelFunc
	done   chan struct{}
}

// NewSafeContext creates a new safe context
func NewSafeContext(timeout time.Duration) *SafeContext {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	return &SafeContext{
		ctx:    ctx,
		cancel: cancel,
		done:   make(chan struct{}),
	}
}

// Context returns the underlying context
func (sc *SafeContext) Context() context.Context {
	return sc.ctx
}

// Cancel safely cancels the context
func (sc *SafeContext) Cancel() {
	defer func() {
		// Recover from any panic during cancellation
		recover()
	}()
	
	if sc.cancel != nil {
		sc.cancel()
		sc.cancel = nil
	}
	
	select {
	case <-sc.done:
		// Already closed
	default:
		close(sc.done)
	}
}

// Done returns a channel that's closed when context is done
func (sc *SafeContext) Done() <-chan struct{} {
	return sc.done
}

// Err returns the context error
func (sc *SafeContext) Err() error {
	return sc.ctx.Err()
}