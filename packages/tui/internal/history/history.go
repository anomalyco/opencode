package history

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Attachment represents a file attachment in a history entry
type Attachment struct {
	Type string `json:"type"`
	Path string `json:"path"`
}

// HistoryEntry represents a single entry in the prompt history
type HistoryEntry struct {
	Prompt      string       `json:"prompt"`
	Attachments []Attachment `json:"attachments"`
	Timestamp   time.Time    `json:"timestamp"`
}

// HistoryFile represents the top-level JSON structure for the history file
type HistoryFile struct {
	Version int            `json:"version"`
	Entries []HistoryEntry `json:"entries"`
}

// HistoryStore manages the persistent prompt history
type HistoryStore struct {
	entries    []HistoryEntry
	filePath   string
	maxEntries int
	mu         sync.Mutex
}

// NewHistoryStore creates a new HistoryStore instance
func NewHistoryStore(filePath string, maxEntries int) (*HistoryStore, error) {
	store := &HistoryStore{
		filePath:   filePath,
		maxEntries: maxEntries,
	}
	
	if err := store.load(); err != nil {
		return nil, fmt.Errorf("failed to load history: %w", err)
	}
	
	return store, nil
}

// load reads the history from disk
func (s *HistoryStore) load() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	// If file doesn't exist, start with empty history
	if _, err := os.Stat(s.filePath); os.IsNotExist(err) {
		s.entries = []HistoryEntry{}
		return nil
	}
	
	data, err := os.ReadFile(s.filePath)
	if err != nil {
		return fmt.Errorf("failed to read history file: %w", err)
	}
	
	var historyFile HistoryFile
	if err := json.Unmarshal(data, &historyFile); err != nil {
		// If JSON is corrupted, start with empty history
		s.entries = []HistoryEntry{}
		return nil
	}
	
	s.entries = historyFile.Entries
	return nil
}

// save writes the current history to disk
func (s *HistoryStore) save() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	// Create directory if it doesn't exist
	if err := os.MkdirAll(filepath.Dir(s.filePath), 0755); err != nil {
		return fmt.Errorf("failed to create config directory: %w", err)
	}
	
	historyFile := HistoryFile{
		Version: 1,
		Entries: s.entries,
	}
	
	data, err := json.MarshalIndent(historyFile, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal history: %w", err)
	}
	
	if err := os.WriteFile(s.filePath, data, 0644); err != nil {
		return fmt.Errorf("failed to write history file: %w", err)
	}
	
	return nil
}

// Add adds a new entry to the history
func (s *HistoryStore) Add(entry HistoryEntry) {
	s.entries = append(s.entries, entry)
	
	// Truncate if we exceed maxEntries
	if len(s.entries) > s.maxEntries {
		s.entries = s.entries[len(s.entries)-s.maxEntries:]
	}
	
	// Save to disk (ignore error for now, as this is called frequently)
	s.save()
}

// Clear clears all history entries
func (s *HistoryStore) Clear() error {
	s.entries = []HistoryEntry{}
	
	// Save empty state
	if err := s.save(); err != nil {
		return err
	}
	
	// Also attempt to remove the file
	os.Remove(s.filePath) // Ignore error if file doesn't exist
	
	return nil
}

// Entries returns a copy of the current history entries
func (s *HistoryStore) Entries() []HistoryEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	// Return a copy to prevent external modification
	entries := make([]HistoryEntry, len(s.entries))
	copy(entries, s.entries)
	return entries
}