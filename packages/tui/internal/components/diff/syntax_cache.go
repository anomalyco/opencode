package diff

import (
	"bytes"
	"hash/fnv"
	"io"
	"strings"
	"sync"
	"time"

	"github.com/alecthomas/chroma/v2"
	"github.com/alecthomas/chroma/v2/formatters"
	"github.com/alecthomas/chroma/v2/lexers"
	"github.com/alecthomas/chroma/v2/styles"
	"image/color"
)

// FastSyntaxHighlighter provides ultra-fast cached syntax highlighting
type FastSyntaxHighlighter struct {
	cache       *SyntaxCache
	lexerCache  *LexerCache
	formatter   chroma.Formatter
	style       *chroma.Style
	bgColor     color.Color
}

// SyntaxCache caches highlighted content with LRU eviction
type SyntaxCache struct {
	entries map[uint64]*CacheEntry
	mutex   sync.RWMutex
	maxSize int
	hits    int64
	misses  int64
}

// CacheEntry represents a cached syntax highlighting result
type CacheEntry struct {
	content   string
	timestamp time.Time
	accessCount int64
}

// LexerCache caches lexers by file extension for faster lookup
type LexerCache struct {
	lexers map[string]chroma.Lexer
	mutex  sync.RWMutex
}

// NewFastSyntaxHighlighter creates an optimized syntax highlighter
func NewFastSyntaxHighlighter(bgColor color.Color) *FastSyntaxHighlighter {
	formatter := formatters.Get("terminal16m")
	if formatter == nil {
		formatter = formatters.Fallback
	}
	
	return &FastSyntaxHighlighter{
		cache:      NewSyntaxCache(2000), // Cache 2000 highlighted chunks
		lexerCache: NewLexerCache(),
		formatter:  formatter,
		style:      styles.Get("github"),
		bgColor:    bgColor,
	}
}

// NewSyntaxCache creates a new syntax highlighting cache
func NewSyntaxCache(maxSize int) *SyntaxCache {
	return &SyntaxCache{
		entries: make(map[uint64]*CacheEntry, maxSize),
		maxSize: maxSize,
	}
}

// NewLexerCache creates a new lexer cache
func NewLexerCache() *LexerCache {
	return &LexerCache{
		lexers: make(map[string]chroma.Lexer),
	}
}

// HighlightFast performs ultra-fast syntax highlighting with aggressive caching
func (fsh *FastSyntaxHighlighter) HighlightFast(w io.Writer, source, fileName string) error {
	// Create composite cache key from content + filename + bg color
	contentHash := fsh.hashContent(source)
	fileExt := getFileExtension(fileName)
	bgHash := fsh.hashColor(fsh.bgColor)
	cacheKey := contentHash ^ uint64(len(fileExt))<<32 ^ bgHash
	
	// Check cache first
	if cached := fsh.cache.Get(cacheKey); cached != "" {
		_, err := w.Write([]byte(cached))
		return err
	}
	
	// Cache miss - perform highlighting with optimizations
	result, err := fsh.highlightUncached(source, fileName)
	if err != nil {
		fsh.cache.RecordMiss()
		return err
	}
	
	// Store in cache
	fsh.cache.Set(cacheKey, result)
	
	_, err = w.Write([]byte(result))
	return err
}

// highlightUncached performs the actual syntax highlighting
func (fsh *FastSyntaxHighlighter) highlightUncached(source, fileName string) (string, error) {
	// Get cached lexer for file extension
	lexer := fsh.lexerCache.GetLexer(fileName)
	if lexer == nil {
		// Fallback to plain text for unknown file types
		return source, nil
	}
	
	// Tokenize the source
	iterator, err := lexer.Tokenise(nil, source)
	if err != nil {
		return source, nil // Fallback to plain text on error
	}
	
	// Format with our cached formatter
	var buf bytes.Buffer
	err = fsh.formatter.Format(&buf, fsh.style, iterator)
	if err != nil {
		return source, nil // Fallback to plain text on error
	}
	
	return buf.String(), nil
}

// GetLexer retrieves a cached lexer for the file extension
func (lc *LexerCache) GetLexer(fileName string) chroma.Lexer {
	ext := getFileExtension(fileName)
	
	lc.mutex.RLock()
	if lexer, exists := lc.lexers[ext]; exists {
		lc.mutex.RUnlock()
		return lexer
	}
	lc.mutex.RUnlock()
	
	// Cache miss - find and cache the lexer
	lc.mutex.Lock()
	defer lc.mutex.Unlock()
	
	// Double-check after acquiring write lock
	if lexer, exists := lc.lexers[ext]; exists {
		return lexer
	}
	
	// Find lexer by filename
	lexer := lexers.Match(fileName)
	if lexer == nil {
		// Try by extension if filename match failed
		lexer = lexers.Get(ext)
	}
	
	// Cache the result (even if nil)
	lc.lexers[ext] = lexer
	
	return lexer
}

// Get retrieves cached syntax highlighting result
func (sc *SyntaxCache) Get(key uint64) string {
	sc.mutex.RLock()
	defer sc.mutex.RUnlock()
	
	if entry, exists := sc.entries[key]; exists {
		// Update access statistics
		entry.accessCount++
		entry.timestamp = time.Now()
		sc.hits++
		return entry.content
	}
	
	return ""
}

// Set stores syntax highlighting result in cache
func (sc *SyntaxCache) Set(key uint64, content string) {
	sc.mutex.Lock()
	defer sc.mutex.Unlock()
	
	// If cache is at capacity, evict LRU entries
	if len(sc.entries) >= sc.maxSize {
		sc.evictLRU()
	}
	
	sc.entries[key] = &CacheEntry{
		content:     content,
		timestamp:   time.Now(),
		accessCount: 1,
	}
}

// RecordMiss records a cache miss for statistics
func (sc *SyntaxCache) RecordMiss() {
	sc.mutex.Lock()
	defer sc.mutex.Unlock()
	sc.misses++
}

// evictLRU removes the least recently used cache entries
func (sc *SyntaxCache) evictLRU() {
	if len(sc.entries) == 0 {
		return
	}
	
	// Simple LRU: remove oldest 25% of entries
	evictCount := sc.maxSize / 4
	if evictCount < 1 {
		evictCount = 1
	}
	
	// Find oldest entries
	type entryAge struct {
		key       uint64
		timestamp time.Time
	}
	
	var ages []entryAge
	for key, entry := range sc.entries {
		ages = append(ages, entryAge{key: key, timestamp: entry.timestamp})
	}
	
	// Sort by timestamp (oldest first)
	for i := 0; i < len(ages)-1; i++ {
		for j := i + 1; j < len(ages); j++ {
			if ages[i].timestamp.After(ages[j].timestamp) {
				ages[i], ages[j] = ages[j], ages[i]
			}
		}
	}
	
	// Remove oldest entries
	for i := 0; i < evictCount && i < len(ages); i++ {
		delete(sc.entries, ages[i].key)
	}
}

// GetStats returns cache performance statistics
func (sc *SyntaxCache) GetStats() (hits, misses int64, hitRatio float64, size int) {
	sc.mutex.RLock()
	defer sc.mutex.RUnlock()
	
	total := sc.hits + sc.misses
	if total > 0 {
		hitRatio = float64(sc.hits) / float64(total)
	}
	
	return sc.hits, sc.misses, hitRatio, len(sc.entries)
}

// hashContent creates a fast hash of the content for caching
func (fsh *FastSyntaxHighlighter) hashContent(content string) uint64 {
	h := fnv.New64a()
	h.Write([]byte(content))
	return h.Sum64()
}

// hashColor creates a hash of the background color
func (fsh *FastSyntaxHighlighter) hashColor(c color.Color) uint64 {
	if c == nil {
		return 0
	}
	r, g, b, a := c.RGBA()
	return uint64(r)<<48 | uint64(g)<<32 | uint64(b)<<16 | uint64(a)
}

// getFileExtension extracts the file extension for lexer lookup
func getFileExtension(fileName string) string {
	if fileName == "" {
		return ""
	}
	
	// Find the last dot
	lastDot := strings.LastIndex(fileName, ".")
	if lastDot == -1 || lastDot == len(fileName)-1 {
		return ""
	}
	
	return strings.ToLower(fileName[lastDot+1:])
}

// BatchHighlight highlights multiple lines efficiently
func (fsh *FastSyntaxHighlighter) BatchHighlight(lines []string, fileName string) ([]string, error) {
	if len(lines) == 0 {
		return lines, nil
	}
	
	results := make([]string, len(lines))
	
	// Process in batches for better cache performance
	const batchSize = 50
	for i := 0; i < len(lines); i += batchSize {
		end := min(i+batchSize, len(lines))
		
		for j := i; j < end; j++ {
			var buf bytes.Buffer
			err := fsh.HighlightFast(&buf, lines[j], fileName)
			if err != nil {
				results[j] = lines[j] // Fallback to original on error
			} else {
				results[j] = buf.String()
			}
		}
	}
	
	return results, nil
}

// Global instance for optimal performance
var globalSyntaxHighlighter = NewFastSyntaxHighlighter(nil)

// WarmupCache pre-loads common syntax highlighting patterns
func (fsh *FastSyntaxHighlighter) WarmupCache(commonPatterns map[string][]string) {
	for fileName, patterns := range commonPatterns {
		for _, pattern := range patterns {
			var buf bytes.Buffer
			fsh.HighlightFast(&buf, pattern, fileName)
		}
	}
}

