package util

import (
	"fmt"
	"runtime"
	"sync"
	"time"
	"unsafe"
)

// SafeOperations provides safer wrappers for potentially unsafe operations
type SafeOperations struct {
	recovery *PanicRecovery
	mutex    sync.RWMutex
	stats    SafeOperationStats
}

// SafeOperationStats tracks operation statistics
type SafeOperationStats struct {
	TotalOperations    int64
	SuccessfulOps      int64
	FailedOps          int64
	PanicRecoveries    int64
	LastFailure        time.Time
	LastFailureMessage string
}

// NewSafeOperations creates a new safe operations wrapper
func NewSafeOperations(errorHandler func(error)) *SafeOperations {
	return &SafeOperations{
		recovery: NewPanicRecovery(errorHandler),
	}
}

// SafeMemoryOperation performs a memory operation with safety checks
func (so *SafeOperations) SafeMemoryOperation(operation func() error) error {
	so.mutex.Lock()
	defer so.mutex.Unlock()

	so.stats.TotalOperations++

	// Create a recovery function specific to memory operations
	memoryErrorHandler := func(err error) {
		so.stats.PanicRecoveries++
		so.stats.FailedOps++
		so.stats.LastFailure = time.Now()
		so.stats.LastFailureMessage = fmt.Sprintf("Memory operation panic: %v", err)
		if so.recovery.ErrorCallback != nil {
			so.recovery.ErrorCallback(err)
		}
	}

	err := SafeExecuteWithError(operation, memoryErrorHandler)
	
	if err != nil {
		so.stats.FailedOps++
		so.stats.LastFailure = time.Now()
		so.stats.LastFailureMessage = err.Error()
		return err
	}

	so.stats.SuccessfulOps++
	return nil
}

// SafePointerOperation performs pointer operations with null checks
func (so *SafeOperations) SafePointerOperation(ptr unsafe.Pointer, operation func(unsafe.Pointer) error) error {
	if ptr == nil {
		return fmt.Errorf("nil pointer passed to safe operation")
	}

	return so.SafeMemoryOperation(func() error {
		return operation(ptr)
	})
}

// SafeSliceOperation performs slice operations with bounds checking
func (so *SafeOperations) SafeSliceOperation(slice interface{}, index int, operation func() error) error {
	// Use reflection-free approach for common slice types
	switch s := slice.(type) {
	case []byte:
		if index < 0 || index >= len(s) {
			return fmt.Errorf("slice index %d out of bounds for slice of length %d", index, len(s))
		}
	case []string:
		if index < 0 || index >= len(s) {
			return fmt.Errorf("slice index %d out of bounds for slice of length %d", index, len(s))
		}
	case []int:
		if index < 0 || index >= len(s) {
			return fmt.Errorf("slice index %d out of bounds for slice of length %d", index, len(s))
		}
	}

	return so.SafeMemoryOperation(operation)
}

// SafeGoroutineOperation starts a goroutine with panic recovery
func (so *SafeOperations) SafeGoroutineOperation(name string, operation func()) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				err := fmt.Errorf("goroutine %s panicked: %v\nStack trace:\n%s", name, r, getStackTrace())
				so.mutex.Lock()
				so.stats.PanicRecoveries++
				so.stats.FailedOps++
				so.stats.LastFailure = time.Now()
				so.stats.LastFailureMessage = err.Error()
				so.mutex.Unlock()
				
				if so.recovery.ErrorCallback != nil {
					so.recovery.ErrorCallback(err)
				}
			}
		}()

		so.mutex.Lock()
		so.stats.TotalOperations++
		so.mutex.Unlock()

		operation()

		so.mutex.Lock()
		so.stats.SuccessfulOps++
		so.mutex.Unlock()
	}()
}

// SafeChannelOperation performs channel operations with timeout
func (so *SafeOperations) SafeChannelOperation(timeout time.Duration, operation func() error) error {
	done := make(chan error, 1)
	
	go func() {
		defer func() {
			if r := recover(); r != nil {
				done <- fmt.Errorf("channel operation panicked: %v", r)
			}
		}()
		
		done <- operation()
	}()

	select {
	case err := <-done:
		return so.SafeMemoryOperation(func() error { return err })
	case <-time.After(timeout):
		return so.SafeMemoryOperation(func() error { 
			return fmt.Errorf("channel operation timed out after %v", timeout) 
		})
	}
}

// GetStats returns current operation statistics
func (so *SafeOperations) GetStats() SafeOperationStats {
	so.mutex.RLock()
	defer so.mutex.RUnlock()
	return so.stats
}

// ResetStats resets operation statistics
func (so *SafeOperations) ResetStats() {
	so.mutex.Lock()
	defer so.mutex.Unlock()
	so.stats = SafeOperationStats{}
}

// getStackTrace returns a formatted stack trace
func getStackTrace() string {
	buf := make([]byte, 1024*4)
	n := runtime.Stack(buf, false)
	return string(buf[:n])
}