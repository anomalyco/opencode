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
	cache     map[string]interface{}
	cacheTTL  time.Duration
	cacheTime map[string]time.Time
}

// NewAPIDebouncer creates a new API debouncer with specified delay and cache TTL
func NewAPIDebouncer(delay time.Duration, cacheTTL time.Duration) *APIDebouncer {
	return &APIDebouncer{
		delay:     delay,
		cache:     make(map[string]interface{}),
		cacheTTL:  cacheTTL,
		cacheTime: make(map[string]time.Time),
	}
}

// Debounce executes the function after delay, with caching and deduplication
func (d *APIDebouncer) Debounce(query string, fn func() interface{}) <-chan interface{} {
	d.mu.Lock()
	defer d.mu.Unlock()

	result := make(chan interface{}, 1)

	// Check cache first (with TTL)
	if cached, exists := d.cache[query]; exists {
		if cacheTime, timeExists := d.cacheTime[query]; timeExists {
			if time.Since(cacheTime) < d.cacheTTL {
				result <- cached
				return result
			}
			// Cache expired, remove it
			delete(d.cache, query)
			delete(d.cacheTime, query)
		}
	}

	// Request deduplication: if same query as last request, skip
	if d.lastQuery == query && d.timer != nil {
		// Same query, just wait for existing timer
		go func() {
			time.Sleep(d.delay + 50*time.Millisecond) // Wait a bit longer than the timer
			d.mu.Lock()
			if cached, exists := d.cache[query]; exists {
				result <- cached
			} else {
				result <- nil // Cache miss, request may have failed
			}
			d.mu.Unlock()
		}()
		return result
	}

	// Cancel existing timer
	if d.timer != nil {
		d.timer.Stop()
	}

	d.lastQuery = query

	// Start new timer
	d.timer = time.AfterFunc(d.delay, func() {
		data := fn()
		d.mu.Lock()
		d.cache[query] = data
		d.cacheTime[query] = time.Now()
		d.mu.Unlock()
		result <- data
	})

	return result
}

// ClearCache clears the cache (useful for invalidation)
func (d *APIDebouncer) ClearCache() {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.cache = make(map[string]interface{})
	d.cacheTime = make(map[string]time.Time)
}