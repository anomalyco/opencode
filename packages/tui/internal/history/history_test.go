package history

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestHistoryStore_Add(t *testing.T) {
	// Create a temporary directory for test files
	tempDir, err := os.MkdirTemp("", "history_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	filePath := filepath.Join(tempDir, "test_history.json")
	store, err := NewHistoryStore(filePath, 5)
	if err != nil {
		t.Fatal(err)
	}

	// Test adding entries
	entry1 := HistoryEntry{
		Prompt:      "Test prompt 1",
		Attachments: []Attachment{},
		Timestamp:   time.Now(),
	}
	entry2 := HistoryEntry{
		Prompt:      "Test prompt 2",
		Attachments: []Attachment{},
		Timestamp:   time.Now(),
	}

	store.Add(entry1)
	store.Add(entry2)

	entries := store.Entries()
	if len(entries) != 2 {
		t.Errorf("Expected 2 entries, got %d", len(entries))
	}

	if entries[0].Prompt != "Test prompt 1" {
		t.Errorf("Expected first entry to be 'Test prompt 1', got '%s'", entries[0].Prompt)
	}
	if entries[1].Prompt != "Test prompt 2" {
		t.Errorf("Expected second entry to be 'Test prompt 2', got '%s'", entries[1].Prompt)
	}
}

func TestHistoryStore_Truncation(t *testing.T) {
	// Create a temporary directory for test files
	tempDir, err := os.MkdirTemp("", "history_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	filePath := filepath.Join(tempDir, "test_history.json")
	store, err := NewHistoryStore(filePath, 3) // Max 3 entries
	if err != nil {
		t.Fatal(err)
	}

	// Add 5 entries to test truncation
	for i := 1; i <= 5; i++ {
		entry := HistoryEntry{
			Prompt:      fmt.Sprintf("Test prompt %d", i),
			Attachments: []Attachment{},
			Timestamp:   time.Now(),
		}
		store.Add(entry)
	}

	entries := store.Entries()
	if len(entries) != 3 {
		t.Errorf("Expected 3 entries after truncation, got %d", len(entries))
	}

	// Should keep the most recent 3 entries
	if entries[0].Prompt != "Test prompt 3" {
		t.Errorf("Expected first entry to be 'Test prompt 3', got '%s'", entries[0].Prompt)
	}
	if entries[2].Prompt != "Test prompt 5" {
		t.Errorf("Expected last entry to be 'Test prompt 5', got '%s'", entries[2].Prompt)
	}
}

func TestHistoryStore_Persistence(t *testing.T) {
	// Create a temporary directory for test files
	tempDir, err := os.MkdirTemp("", "history_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	filePath := filepath.Join(tempDir, "test_history.json")
	
	// Create first store and add entries
	store1, err := NewHistoryStore(filePath, 5)
	if err != nil {
		t.Fatal(err)
	}

	entry1 := HistoryEntry{
		Prompt:      "Persistent prompt 1",
		Attachments: []Attachment{},
		Timestamp:   time.Now(),
	}
	entry2 := HistoryEntry{
		Prompt:      "Persistent prompt 2",
		Attachments: []Attachment{},
		Timestamp:   time.Now(),
	}

	store1.Add(entry1)
	store1.Add(entry2)

	// Create second store from the same file
	store2, err := NewHistoryStore(filePath, 5)
	if err != nil {
		t.Fatal(err)
	}

	entries := store2.Entries()
	if len(entries) != 2 {
		t.Errorf("Expected 2 entries after loading from file, got %d", len(entries))
	}

	if entries[0].Prompt != "Persistent prompt 1" {
		t.Errorf("Expected first entry to be 'Persistent prompt 1', got '%s'", entries[0].Prompt)
	}
	if entries[1].Prompt != "Persistent prompt 2" {
		t.Errorf("Expected second entry to be 'Persistent prompt 2', got '%s'", entries[1].Prompt)
	}
}

func TestHistoryStore_Clear(t *testing.T) {
	// Create a temporary directory for test files
	tempDir, err := os.MkdirTemp("", "history_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	filePath := filepath.Join(tempDir, "test_history.json")
	store, err := NewHistoryStore(filePath, 5)
	if err != nil {
		t.Fatal(err)
	}

	// Add some entries
	entry1 := HistoryEntry{
		Prompt:      "To be cleared 1",
		Attachments: []Attachment{},
		Timestamp:   time.Now(),
	}
	entry2 := HistoryEntry{
		Prompt:      "To be cleared 2",
		Attachments: []Attachment{},
		Timestamp:   time.Now(),
	}

	store.Add(entry1)
	store.Add(entry2)

	// Verify entries were added
	entries := store.Entries()
	if len(entries) != 2 {
		t.Errorf("Expected 2 entries before clear, got %d", len(entries))
	}

	// Clear the store
	err = store.Clear()
	if err != nil {
		t.Fatal(err)
	}

	// Verify entries were cleared
	entries = store.Entries()
	if len(entries) != 0 {
		t.Errorf("Expected 0 entries after clear, got %d", len(entries))
	}

	// Verify file was cleared by creating a new store
	newStore, err := NewHistoryStore(filePath, 5)
	if err != nil {
		t.Fatal(err)
	}

	entries = newStore.Entries()
	if len(entries) != 0 {
		t.Errorf("Expected 0 entries after loading cleared file, got %d", len(entries))
	}
}