package util

import (
	"sync"
	"testing"
	"time"
)

func TestAPIDebouncer(t *testing.T) {
	t.Run("basic debouncing", func(t *testing.T) {
		debouncer := NewAPIDebouncer(50*time.Millisecond, 200*time.Millisecond)
		callCount := 0
		var mu sync.Mutex

		// Make multiple rapid calls
		for range 5 {
			resultCh := debouncer.Debounce("test", func() any {
				mu.Lock()
				callCount++
				mu.Unlock()
				return "result"
			})

			// Ensure we get a result
			result := <-resultCh
			if result != "result" {
				t.Errorf("Expected 'result', got %v", result)
			}
		}

		// Wait for debounce period
		time.Sleep(100 * time.Millisecond)

		mu.Lock()
		if callCount != 1 {
			t.Errorf("Expected 1 call, got %d", callCount)
		}
		mu.Unlock()
	})

	t.Run("cache functionality", func(t *testing.T) {
		debouncer := NewAPIDebouncer(50*time.Millisecond, 200*time.Millisecond)
		callCount := 0
		var mu sync.Mutex

		// First call
		resultCh := debouncer.Debounce("test", func() any {
			mu.Lock()
			callCount++
			mu.Unlock()
			return "result1"
		})

		result1 := <-resultCh
		time.Sleep(100 * time.Millisecond) // Wait for result to be cached

		// Second call with same query should use cache
		resultCh = debouncer.Debounce("test", func() any {
			mu.Lock()
			callCount++
			mu.Unlock()
			return "result2"
		})

		result2 := <-resultCh

		if result1 != result2 {
			t.Errorf("Cache not working, got different results: %v != %v", result1, result2)
		}

		mu.Lock()
		if callCount != 1 {
			t.Errorf("Expected 1 call due to caching, got %d", callCount)
		}
		mu.Unlock()

		// Wait for cache to expire
		time.Sleep(250 * time.Millisecond)

		// Call after cache expiry
		resultCh = debouncer.Debounce("test", func() any {
			mu.Lock()
			callCount++
			mu.Unlock()
			return "result3"
		})

		<-resultCh
		time.Sleep(100 * time.Millisecond) // Wait for operation to complete

		mu.Lock()
		if callCount != 2 {
			t.Errorf("Expected 2 calls after cache expiry, got %d", callCount)
		}
		mu.Unlock()
	})

	t.Run("clear cache", func(t *testing.T) {
		debouncer := NewAPIDebouncer(50*time.Millisecond, 200*time.Millisecond)
		callCount := 0
		var mu sync.Mutex

		// First call
		resultCh := debouncer.Debounce("test", func() any {
			mu.Lock()
			callCount++
			mu.Unlock()
			return "result1"
		})

		<-resultCh
		time.Sleep(100 * time.Millisecond) // Wait for result to be cached

		// Clear cache
		debouncer.ClearCache()

		// Second call should not use cache
		resultCh = debouncer.Debounce("test", func() any {
			mu.Lock()
			callCount++
			mu.Unlock()
			return "result2"
		})

		<-resultCh
		time.Sleep(100 * time.Millisecond) // Wait for operation to complete

		mu.Lock()
		if callCount != 2 {
			t.Errorf("Expected 2 calls after cache clear, got %d", callCount)
		}
		mu.Unlock()
	})
}
