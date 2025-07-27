package chat

import (
	"encoding/hex"
	"fmt"
	"hash/fnv"
	"sync"
)

// PartCache caches rendered messages to avoid re-rendering
type PartCache struct {
	mu    sync.RWMutex
	cache map[string]string
}

// NewPartCache creates a new message cache
func NewPartCache() *PartCache {
	return &PartCache{
		cache: make(map[string]string),
	}
}

// generateKey creates a unique key for a message based on its content and rendering parameters
func (c *PartCache) GenerateKey(params ...any) string {
	h := fnv.New64a()
	for _, param := range params {
		h.Write(fmt.Appendf(nil, ":%v", param))
	}
	return hex.EncodeToString(h.Sum(nil))
}

// Get retrieves a cached rendered message
func (c *PartCache) Get(key string) (string, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	content, exists := c.cache[key]
	return content, exists
}

// Set stores a rendered message in the cache
func (c *PartCache) Set(key string, content string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.cache[key] = content
}

// Clear removes all entries from the cache
func (c *PartCache) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.cache = make(map[string]string)
}

// Size returns the number of cached entries
func (c *PartCache) Size() int {
	c.mu.RLock()
	defer c.mu.RUnlock()

	return len(c.cache)
}
