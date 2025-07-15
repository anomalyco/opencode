package textarea

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea/v2"
)

func TestHistoryNavigation(t *testing.T) {
	// Create a new textarea model
	m := New()
	
	// Set up some history
	history := []string{"first command", "second command", "third command"}
	m.SetHistory(history)
	
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
	history := []string{"first command", "second command", "third command"}
	m.SetHistory(history)
	
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
	history := []string{"first command", "second command", "third command"}
	m.SetHistory(history)
	
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
	history := []string{"command"}
	m.SetHistory(history)
	
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
	history := []string{"command"}
	m.SetHistory(history)
	
	// Empty input at beginning - should return true
	if !m.shouldNavigateHistory() {
		t.Error("Expected shouldNavigateHistory to return true with empty input at beginning")
	}
	
	// Add some text and move cursor to middle (not beginning or end)
	m.InsertString("test")
	m.historyModified = false // Reset modification flag
	m.SetCursorColumn(2) // Move to middle
	if m.shouldNavigateHistory() {
		t.Error("Expected shouldNavigateHistory to return false when cursor not at beginning or end")
	}
	
	// Reset and test with history content
	m.Reset()
	m.SetHistory(history)
	m.InsertString("command") // Insert content that matches history
	m.historyModified = false // Reset modification flag
	m.historyIndex = 0 // Set to match the history entry
	
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
	m.SetHistory(history)
	
	// Add some text and mark as modified
	m.InsertString("test")
	m.historyModified = true
	if m.shouldNavigateHistory() {
		t.Error("Expected shouldNavigateHistory to return false when history is modified")
	}
}

func TestHistoryNavigationConditions(t *testing.T) {
	m := New()
	history := []string{"command"}
	m.SetHistory(history)
	
	// Add multiple lines (should prevent history navigation)
	m.InsertString("line1\nline2")
	if m.shouldNavigateHistory() {
		t.Error("Expected shouldNavigateHistory to return false with multiline input")
	}
	
	// Reset to single line
	m.Reset()
	m.SetHistory(history)
	
	// Should work with empty single line
	if !m.shouldNavigateHistory() {
		t.Error("Expected shouldNavigateHistory to return true with empty single line")
	}
}