package util

import (
	"sync"
	"time"
)

// APIDebouncer implements request debouncing and caching for API calls
type APIDebouncer struct {
	timer     *time.Timer
	delay     time.Duration
	mu        sync.Mutex
	lastQuery string
	cache     map[string]any
	cacheTTL  time.Duration
	cacheTime map[string]time.Time
}

// NewAPIDebouncer creates a new API debouncer with specified delay and cache TTL
func NewAPIDebouncer(delay time.Duration, cacheTTL time.Duration) *APIDebouncer {
	return &APIDebouncer{
		delay:     delay,
		cache:     make(map[string]any),
		cacheTTL:  cacheTTL,
		cacheTime: make(map[string]time.Time),
	}
}

// Debounce executes the function after delay, with caching and deduplication
func (d *APIDebouncer) Debounce(query string, fn func() any) <-chan any {
	d.mu.Lock()

	// Create result channel with buffer to prevent blocking
	result := make(chan any, 1)

	// Check cache first (with TTL)
	if cached, exists := d.cache[query]; exists {
		if cacheTime, timeExists := d.cacheTime[query]; timeExists {
			if time.Since(cacheTime) < d.cacheTTL {
				d.mu.Unlock()
				result <- cached
				return result
			}
			// Cache expired, remove it
			delete(d.cache, query)
			delete(d.cacheTime, query)
		}
	}

	// Request deduplication: if same query as last request and timer is active
	if d.lastQuery == query && d.timer != nil {
		d.mu.Unlock()
		// Wait for existing operation
		go func() {
			time.Sleep(d.delay + 50*time.Millisecond)
			d.mu.Lock()
			if cached, exists := d.cache[query]; exists {
				result <- cached
			} else {
				result <- fn() // Execute if cache miss
			}
			d.mu.Unlock()
		}()
		return result
	}

	// Cancel existing timer if any
	if d.timer != nil {
		d.timer.Stop()
	}

	d.lastQuery = query

	// Execute after delay
	d.timer = time.AfterFunc(d.delay, func() {
		data := fn()
		d.mu.Lock()
		d.cache[query] = data
		d.cacheTime[query] = time.Now()
		d.timer = nil // Clear timer reference
		d.mu.Unlock()
		result <- data
	})

	d.mu.Unlock()
	return result
}

// ClearCache clears the cache (useful for invalidation)
func (d *APIDebouncer) ClearCache() {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.cache = make(map[string]any)
	d.cacheTime = make(map[string]time.Time)
}
