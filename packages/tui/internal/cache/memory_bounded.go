package cache

import (
	"container/list"
	"sync"
)

// MemoryBoundedCache is a thread-safe LRU cache with memory limit
type MemoryBoundedCache struct {
	items      map[string]*list.Element
	order      *list.List
	mu         sync.RWMutex
	
	memoryUsed int64
	maxMemory  int64  // in bytes
}

type cacheEntry struct {
	key   string
	value string
	size  int64
}

// NewMemoryBoundedCache creates a cache with max memory limit in MB
func NewMemoryBoundedCache(maxMemoryMB int) *MemoryBoundedCache {
	return &MemoryBoundedCache{
		items:     make(map[string]*list.Element),
		order:     list.New(),
		maxMemory: int64(maxMemoryMB) * 1024 * 1024,
	}
}

// Set adds or updates a key-value pair, evicting old entries if needed
func (c *MemoryBoundedCache) Set(key string, value string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	
	size := int64(len(value))
	
	// Update existing entry
	if elem, exists := c.items[key]; exists {
		entry := elem.Value.(*cacheEntry)
		c.memoryUsed -= entry.size
		entry.value = value
		entry.size = size
		c.memoryUsed += size
		c.order.MoveToFront(elem)
		return
	}
	
	// Evict until we have space
	for c.memoryUsed+size > c.maxMemory && c.order.Len() > 0 {
		oldest := c.order.Back()
		if oldest != nil {
			entry := oldest.Value.(*cacheEntry)
			delete(c.items, entry.key)
			c.order.Remove(oldest)
			c.memoryUsed -= entry.size
		}
	}
	
	// Add new entry
	entry := &cacheEntry{key: key, value: value, size: size}
	elem := c.order.PushFront(entry)
	c.items[key] = elem
	c.memoryUsed += size
}

// Get retrieves a value and marks it as recently used
func (c *MemoryBoundedCache) Get(key string) (string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	
	if elem, exists := c.items[key]; exists {
		c.order.MoveToFront(elem)
		return elem.Value.(*cacheEntry).value, true
	}
	
	return "", false
}

// Clear removes all entries
func (c *MemoryBoundedCache) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	
	c.items = make(map[string]*list.Element)
	c.order = list.New()
	c.memoryUsed = 0
}

// Stats returns current cache statistics
func (c *MemoryBoundedCache) Stats() (entries int, memoryMB float64) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.order.Len(), float64(c.memoryUsed) / 1024 / 1024
}