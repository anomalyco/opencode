package textarea

import (
	"os"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/sst/opencode/internal/history"
)

func TestHistoryNavigation(t *testing.T) {
	// Create a new textarea model
	m := New()

	// Set up some history
	historyEntries := []history.HistoryEntry{
		{Prompt: "first command", Attachments: []history.Attachment{}, Timestamp: time.Now()},
		{Prompt: "second command", Attachments: []history.Attachment{}, Timestamp: time.Now()},
		{Prompt: "third command", Attachments: []history.Attachment{}, Timestamp: time.Now()},
	}
	m.SetHistory(historyEntries)

	// Test that history is set correctly
	if len(m.history) != 3 {
		t.Errorf("Expected history length 3, got %d", len(m.history))
	}

	// Test that historyIndex is set to the end
	if m.historyIndex != 3 {
		t.Errorf("Expected historyIndex 3, got %d", m.historyIndex)
	}
}

func TestHistoryNavigationUp(t *testing.T) {
	m := New()
	m.Focus() // Focus the model for key handling
	historyEntries := []history.HistoryEntry{
		{Prompt: "first command", Attachments: []history.Attachment{}, Timestamp: time.Now()},
		{Prompt: "second command", Attachments: []history.Attachment{}, Timestamp: time.Now()},
		{Prompt: "third command", Attachments: []history.Attachment{}, Timestamp: time.Now()},
	}
	m.SetHistory(historyEntries)

	// Test up arrow navigation (should go to most recent)
	upKey := tea.KeyPressMsg{Code: tea.KeyUp}
	updatedModel, _ := m.Update(upKey)
	m = updatedModel

	// Should now have the most recent command
	if m.Value() != "third command" {
		t.Errorf("Expected 'third command', got '%s'", m.Value())
	}

	// Test another up arrow (should go to second command)
	updatedModel, _ = m.Update(upKey)
	m = updatedModel

	if m.Value() != "second command" {
		t.Errorf("Expected 'second command', got '%s'", m.Value())
	}
}

func TestHistoryNavigationDown(t *testing.T) {
	m := New()
	m.Focus() // Focus the model for key handling
	historyEntries := []history.HistoryEntry{
		{Prompt: "first command", Attachments: []history.Attachment{}, Timestamp: time.Now()},
		{Prompt: "second command", Attachments: []history.Attachment{}, Timestamp: time.Now()},
		{Prompt: "third command", Attachments: []history.Attachment{}, Timestamp: time.Now()},
	}
	m.SetHistory(historyEntries)

	// Navigate up to get to a history item
	upKey := tea.KeyPressMsg{Code: tea.KeyUp}
	updatedModel, _ := m.Update(upKey)
	m = updatedModel
	updatedModel, _ = m.Update(upKey)
	m = updatedModel

	// Now we should be at "second command"
	if m.Value() != "second command" {
		t.Errorf("Expected 'second command', got '%s'", m.Value())
	}

	// Test down arrow navigation
	downKey := tea.KeyPressMsg{Code: tea.KeyDown}
	updatedModel, _ = m.Update(downKey)
	m = updatedModel

	// Should now have the third command
	if m.Value() != "third command" {
		t.Errorf("Expected 'third command', got '%s'", m.Value())
	}

	// Test down arrow past the end (should clear)
	updatedModel, _ = m.Update(downKey)
	m = updatedModel

	if m.Value() != "" {
		t.Errorf("Expected empty string, got '%s'", m.Value())
	}
}

func TestHistoryModified(t *testing.T) {
	m := New()
	m.Focus() // Focus the model for key handling
	historyEntries := []history.HistoryEntry{
		{Prompt: "command", Attachments: []history.Attachment{}, Timestamp: time.Now()},
	}
	m.SetHistory(historyEntries)

	// Navigate to a history item
	upKey := tea.KeyPressMsg{Code: tea.KeyUp}
	updatedModel, _ := m.Update(upKey)
	m = updatedModel

	// Modify the text
	textKey := tea.KeyPressMsg{Text: "x"}
	updatedModel, _ = m.Update(textKey)
	m = updatedModel

	// History should be marked as modified
	if !m.historyModified {
		t.Error("Expected historyModified to be true after text input")
	}

	// Up arrow should not work now
	if m.shouldNavigateHistory() {
		t.Error("Expected shouldNavigateHistory to return false when history is modified")
	}
}

func TestShouldNavigateHistory(t *testing.T) {
	m := New()

	// No history - should return false
	if m.shouldNavigateHistory() {
		t.Error("Expected shouldNavigateHistory to return false with no history")
	}

	// Add history
	historyEntries := []history.HistoryEntry{
		{Prompt: "command", Attachments: []history.Attachment{}, Timestamp: time.Now()},
	}
	m.SetHistory(historyEntries)

	// Empty input at beginning - should return true
	if !m.shouldNavigateHistory() {
		t.Error("Expected shouldNavigateHistory to return true with empty input at beginning")
	}

	// Add some text and move cursor to middle (not beginning or end)
	m.InsertString("test")
	m.historyModified = false // Reset modification flag
	m.SetCursorColumn(2)      // Move to middle
	if m.shouldNavigateHistory() {
		t.Error("Expected shouldNavigateHistory to return false when cursor not at beginning or end")
	}

	// Reset and test with history content
	m.Reset()
	m.SetHistory(historyEntries)
	m.InsertString("command") // Insert content that matches history
	m.historyModified = false // Reset modification flag
	m.historyIndex = 0        // Set to match the history entry

	// Test cursor at end allows navigation
	m.SetCursorColumn(len(m.value[0])) // Move to end
	if !m.shouldNavigateHistory() {
		t.Error("Expected shouldNavigateHistory to return true when cursor at end")
	}

	// Test cursor at beginning also allows navigation
	m.SetCursorColumn(0)
	if !m.shouldNavigateHistory() {
		t.Error("Expected shouldNavigateHistory to return true when cursor at beginning")
	}

	// Reset for next test
	m.Reset()
	m.SetHistory(historyEntries)

	// Add some text and mark as modified
	m.InsertString("test")
	m.historyModified = true
	if m.shouldNavigateHistory() {
		t.Error("Expected shouldNavigateHistory to return false when history is modified")
	}
}

func TestHistoryNavigationConditions(t *testing.T) {
	m := New()
	historyEntries := []history.HistoryEntry{
		{Prompt: "command", Attachments: []history.Attachment{}, Timestamp: time.Now()},
	}
	m.SetHistory(historyEntries)

	// Add multiple lines (should prevent history navigation)
	m.InsertString("line1\nline2")
	if m.shouldNavigateHistory() {
		t.Error("Expected shouldNavigateHistory to return false with multiline input")
	}

	// Reset to single line
	m.Reset()
	m.SetHistory(historyEntries)

	// Should work with empty single line
	if !m.shouldNavigateHistory() {
		t.Error("Expected shouldNavigateHistory to return true with empty single line")
	}
}

func TestAttachmentRestoration(t *testing.T) {
	m := New()
	m.Focus()

	// Create a temporary file for testing
	tmpFile := "/tmp/test_attachment.txt"
	content := "test content"
	if err := os.WriteFile(tmpFile, []byte(content), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}
	defer os.Remove(tmpFile)

	// Create history entry with attachment
	historyEntries := []history.HistoryEntry{
		{
			Prompt: "@test_attachment.txt hello world",
			Attachments: []history.Attachment{
				{
					Display:   "@test_attachment.txt",
					Path:      tmpFile,
					URL:       "file://" + tmpFile,
					Filename:  "test_attachment.txt",
					MediaType: "text/plain",
				},
			},
			Timestamp: time.Now(),
		},
	}
	m.SetHistory(historyEntries)

	// Navigate to history entry
	upKey := tea.KeyPressMsg{Code: tea.KeyUp}
	updatedModel, _ := m.Update(upKey)
	m = updatedModel

	// Check that attachment was restored properly
	if len(m.value) == 0 || len(m.value[0]) == 0 {
		t.Fatal("Expected restored content to have attachments")
	}

	// First item should be an attachment
	if att, ok := m.value[0][0].(*Attachment); ok {
		if att.Display != "@test_attachment.txt" {
			t.Errorf("Expected attachment display '@test_attachment.txt', got '%s'", att.Display)
		}
		if att.Filename != "test_attachment.txt" {
			t.Errorf("Expected filename 'test_attachment.txt', got '%s'", att.Filename)
		}
		if att.URL != "file://"+tmpFile {
			t.Errorf("Expected URL 'file://%s', got '%s'", tmpFile, att.URL)
		}
	} else {
		t.Error("Expected first item to be an attachment")
	}
}

func TestAttachmentRestorationWithMissingFile(t *testing.T) {
	m := New()
	m.Focus()

	// Use a non-existent file path
	missingFile := "/tmp/nonexistent_file.txt"

	// Create history entry with attachment to missing file
	historyEntries := []history.HistoryEntry{
		{
			Prompt: "@nonexistent_file.txt hello world",
			Attachments: []history.Attachment{
				{
					Display:   "@nonexistent_file.txt",
					Path:      missingFile,
					URL:       "file://" + missingFile,
					Filename:  "nonexistent_file.txt",
					MediaType: "text/plain",
				},
			},
			Timestamp: time.Now(),
		},
	}
	m.SetHistory(historyEntries)

	// Navigate to history entry
	upKey := tea.KeyPressMsg{Code: tea.KeyUp}
	updatedModel, _ := m.Update(upKey)
	m = updatedModel

	// Check that attachment was restored with [missing] indicator
	if len(m.value) == 0 || len(m.value[0]) == 0 {
		t.Fatal("Expected restored content to have attachments")
	}

	// First item should be an attachment with [missing] indicator
	if att, ok := m.value[0][0].(*Attachment); ok {
		expectedDisplay := "@nonexistent_file.txt [missing]"
		if att.Display != expectedDisplay {
			t.Errorf("Expected attachment display '%s', got '%s'", expectedDisplay, att.Display)
		}
		if att.Filename != "nonexistent_file.txt" {
			t.Errorf("Expected filename 'nonexistent_file.txt', got '%s'", att.Filename)
		}
	} else {
		t.Error("Expected first item to be an attachment")
	}
}

func TestAttachmentRestorationWithURLEncoding(t *testing.T) {
	m := New()
	m.Focus()

	// Create a file with special characters that need URL encoding
	tmpFile := "/tmp/test+file&more.txt"
	content := "test content"
	if err := os.WriteFile(tmpFile, []byte(content), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}
	defer os.Remove(tmpFile)

	// Create URL-encoded path (simulating what would be stored in history)
	encodedPath := "/tmp/test%2Bfile%26more.txt"

	// Create history entry with URL-encoded attachment path
	historyEntries := []history.HistoryEntry{
		{
			Prompt: "@test+file&more.txt hello world",
			Attachments: []history.Attachment{
				{
					Display:   "@test+file&more.txt",
					Path:      encodedPath, // URL-encoded path
					URL:       "file://" + encodedPath,
					Filename:  "test+file&more.txt",
					MediaType: "text/plain",
				},
			},
			Timestamp: time.Now(),
		},
	}
	m.SetHistory(historyEntries)

	// Navigate to history entry
	upKey := tea.KeyPressMsg{Code: tea.KeyUp}
	updatedModel, _ := m.Update(upKey)
	m = updatedModel

	// Check that attachment was restored properly
	if len(m.value) == 0 || len(m.value[0]) == 0 {
		t.Fatal("Expected restored content to have attachments")
	}

	// First item should be an attachment without [missing] indicator
	if att, ok := m.value[0][0].(*Attachment); ok {
		// Should NOT have [missing] because the file exists and URL decoding worked
		if att.Display != "@test+file&more.txt" {
			t.Errorf("Expected attachment display '@test+file&more.txt', got '%s'", att.Display)
		}
		if att.Filename != "test+file&more.txt" {
			t.Errorf("Expected filename 'test+file&more.txt', got '%s'", att.Filename)
		}
	} else {
		t.Error("Expected first item to be an attachment")
	}
}
func TestValidateAttachmentFile(t *testing.T) {
	m := New()

	// Test with empty path
	if m.validateAttachmentFile("") {
		t.Error("Expected validateAttachmentFile to return false for empty path")
	}

	// Test with non-existent file
	if m.validateAttachmentFile("/tmp/nonexistent_file.txt") {
		t.Error("Expected validateAttachmentFile to return false for non-existent file")
	}

	// Test with existing file
	tmpFile := "/tmp/test_validation.txt"
	if err := os.WriteFile(tmpFile, []byte("test"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}
	defer os.Remove(tmpFile)

	if !m.validateAttachmentFile(tmpFile) {
		t.Error("Expected validateAttachmentFile to return true for existing file")
	}
}

func TestReconstructAttachment(t *testing.T) {
	m := New()

	// Test with existing file
	tmpFile := "/tmp/test_reconstruct.txt"
	if err := os.WriteFile(tmpFile, []byte("test"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}
	defer os.Remove(tmpFile)

	histAtt := history.Attachment{
		Display:   "@test_reconstruct.txt",
		Path:      tmpFile,
		URL:       "file://" + tmpFile,
		Filename:  "test_reconstruct.txt",
		MediaType: "text/plain",
	}

	att, err := m.reconstructAttachment(histAtt)
	if err != nil {
		t.Fatalf("Expected reconstructAttachment to succeed, got error: %v", err)
	}

	if att.Display != "@test_reconstruct.txt" {
		t.Errorf("Expected display '@test_reconstruct.txt', got '%s'", att.Display)
	}
	if att.Filename != "test_reconstruct.txt" {
		t.Errorf("Expected filename 'test_reconstruct.txt', got '%s'", att.Filename)
	}
	if att.URL != "file://"+tmpFile {
		t.Errorf("Expected URL 'file://%s', got '%s'", tmpFile, att.URL)
	}

	// Test with missing file
	missingHistAtt := history.Attachment{
		Display:   "@missing.txt",
		Path:      "/tmp/missing.txt",
		URL:       "file:///tmp/missing.txt",
		Filename:  "missing.txt",
		MediaType: "text/plain",
	}

	missingAtt, err := m.reconstructAttachment(missingHistAtt)
	if err != nil {
		t.Fatalf("Expected reconstructAttachment to succeed even with missing file, got error: %v", err)
	}

	expectedDisplay := "@missing.txt [missing]"
	if missingAtt.Display != expectedDisplay {
		t.Errorf("Expected display '%s', got '%s'", expectedDisplay, missingAtt.Display)
	}
}
