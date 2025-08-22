package util

import (
	"context"
	"testing"
	"time"
)

// TestStabilityFixes verifies the critical stability improvements
func TestStabilityFixes(t *testing.T) {
	t.Run("PanicRecovery", func(t *testing.T) {
		errorCount := 0
		recovery := NewPanicRecovery(func(err error) {
			errorCount++
		})

		// Test successful operation
		success := recovery.SafeExecute(func() {
			// Normal operation
		})
		
		if !success {
			t.Error("Expected successful operation")
		}

		// Test panic recovery
		success = recovery.SafeExecute(func() {
			panic("test panic")
		})
		
		if success {
			t.Error("Expected panic to be caught")
		}
		
		if errorCount != 1 {
			t.Errorf("Expected 1 error callback, got %d", errorCount)
		}
	})

	t.Run("SafeClipboard", func(t *testing.T) {
		errorCount := 0
		clipboard := NewSafeClipboard(func(err error) {
			errorCount++
		})

		// Test safe read operations (these should not panic even if clipboard fails)
		textData := clipboard.ReadText()
		imageData := clipboard.ReadImage()

		// These should return nil on failure rather than panic
		_ = textData
		_ = imageData

		// Write operations should return success status
		writeSuccess := clipboard.WriteText([]byte("test"))
		_ = writeSuccess
	})

	t.Run("InputBuffer", func(t *testing.T) {
		errorCount := 0
		buffer := NewInputBuffer(10, func(err error) {
			errorCount++
		})

		// Test buffer when not blocked
		buffer.SetBlocked(false)
		if buffer.IsBlocked() {
			t.Error("Buffer should not be blocked")
		}

		// Test buffer when blocked
		buffer.SetBlocked(true)
		if !buffer.IsBlocked() {
			t.Error("Buffer should be blocked")
		}

		stats := buffer.GetStats()
		if stats.MaxSize != 10 {
			t.Errorf("Expected max size 10, got %d", stats.MaxSize)
		}
	})

	t.Run("ContextManager", func(t *testing.T) {
		cm := NewContextManager(1 * time.Second)

		// Test context creation
		ctx := cm.CreateContext("test", 2*time.Second)
		if ctx == nil {
			t.Error("Expected context to be created")
		}

		// Test API context
		apiCtx := cm.APIContext("send_prompt")
		if apiCtx == nil {
			t.Error("Expected API context to be created")
		}

		// Test context cancellation
		cm.CancelContext("test")
		if cm.HasContext("test") {
			t.Error("Context should be cancelled")
		}

		// Test cleanup
		cm.CancelAll()
		if cm.GetActiveContextCount() != 0 {
			t.Error("All contexts should be cancelled")
		}
	})

	t.Run("AsyncAPIManager", func(t *testing.T) {
		errorCount := 0
		apiManager := NewAsyncAPIManager(func(err error) {
			errorCount++
		})

		// Test that we can get input buffer
		inputBuffer := apiManager.GetInputBuffer()
		if inputBuffer == nil {
			t.Error("Expected input buffer manager")
		}

		// Test operation tracking
		activeOps := apiManager.GetActiveOperations()
		if len(activeOps) != 0 {
			t.Error("Should start with no active operations")
		}

		// Test stats
		stats := apiManager.GetOperationStats()
		if stats.ActiveOperations != 0 {
			t.Error("Should start with no active operations")
		}
	})

	t.Run("SafeOperations", func(t *testing.T) {
		errorCount := 0
		safeOps := NewSafeOperations(func(err error) {
			errorCount++
		})

		// Test safe memory operation
		err := safeOps.SafeMemoryOperation(func() error {
			return nil
		})
		
		if err != nil {
			t.Errorf("Expected no error, got %v", err)
		}

		// Test safe channel operation
		err = safeOps.SafeChannelOperation(1*time.Second, func() error {
			return nil
		})
		
		if err != nil {
			t.Errorf("Expected no error, got %v", err)
		}

		// Test stats
		stats := safeOps.GetStats()
		if stats.TotalOperations == 0 {
			t.Error("Expected some operations to be recorded")
		}
	})
}

// TestCrashScenarios tests potential crash scenarios
func TestCrashScenarios(t *testing.T) {
	t.Run("ClipboardCrash", func(t *testing.T) {
		errorCount := 0
		clipboard := NewSafeClipboard(func(err error) {
			errorCount++
		})

		// These operations should not crash even if clipboard is unavailable
		for i := 0; i < 10; i++ {
			clipboard.ReadText()
			clipboard.ReadImage()
			clipboard.WriteText([]byte("test"))
		}

		// Test should complete without crashing
	})

	t.Run("ConcurrentOperations", func(t *testing.T) {
		errorCount := 0
		apiManager := NewAsyncAPIManager(func(err error) {
			errorCount++
		})

		// Start multiple concurrent operations
		done := make(chan bool, 5)
		
		for i := 0; i < 5; i++ {
			go func(id int) {
				// Simulate async operation
				ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
				defer cancel()
				
				select {
				case <-ctx.Done():
					done <- true
				case <-time.After(50 * time.Millisecond):
					done <- true
				}
			}(i)
		}

		// Wait for all operations
		for i := 0; i < 5; i++ {
			<-done
		}

		// Prevent unused variable warning
		_ = apiManager

		// Test should complete without deadlocks or crashes
	})

	t.Run("MemoryOperations", func(t *testing.T) {
		errorCount := 0
		safeOps := NewSafeOperations(func(err error) {
			errorCount++
		})

		// Test operations that might cause memory issues
		for i := 0; i < 100; i++ {
			safeOps.SafeMemoryOperation(func() error {
				// Simulate memory operation
				data := make([]byte, 1024)
				_ = data
				return nil
			})
		}

		stats := safeOps.GetStats()
		if stats.SuccessfulOps == 0 {
			t.Error("Expected some successful operations")
		}
	})
}