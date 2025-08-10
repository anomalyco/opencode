package vim

import (
	"testing"
)

// Test search functionality we implemented
func TestSearchCommands(t *testing.T) {
	t.Run("Forward search initiation", func(t *testing.T) {
		v := NewVimTextarea()
		v.vimMode.Enable()
		v.vimMode.SetMode(ModeNormal)
		
		// Simulate "/" key press - the handleNormalMode function checks keyStr
		// Directly call handleNormalMode to test the logic
		keyStr := "/"
		v.handleNormalMode(keyStr, CreateTestKeyMsg(keyStr))
		
		if !v.searchActive {
			t.Error("Search should be active after pressing /")
		}
		if v.searchInput != "/" {
			t.Errorf("Search input should be '/', got %s", v.searchInput)
		}
	})
	
	t.Run("Backward search initiation", func(t *testing.T) {
		v := NewVimTextarea()
		v.vimMode.Enable()
		v.vimMode.SetMode(ModeNormal)
		
		// Simulate "?" key press
		keyStr := "?"
		v.handleNormalMode(keyStr, CreateTestKeyMsg(keyStr))
		
		if !v.searchActive {
			t.Error("Search should be active after pressing ?")
		}
		if v.searchInput != "?" {
			t.Errorf("Search input should be '?', got %s", v.searchInput)
		}
	})
	
	t.Run("Search navigation with n/N", func(t *testing.T) {
		parser := NewCommandParser()
		
		// Test 'n' for next search
		cmd, complete := parser.parseNormalCommand("n", "", "")
		if !complete {
			t.Error("Command 'n' should be complete")
		}
		if cmd == nil {
			t.Fatal("Command 'n' should parse")
		}
		if cmd.Type != CommandSearch {
			t.Errorf("'n' should be search command, got %v", cmd.Type)
		}
		if cmd.Text != "next" {
			t.Errorf("'n' should have text 'next', got %s", cmd.Text)
		}
		
		// Test 'N' for previous search
		cmd, complete = parser.parseNormalCommand("N", "", "")
		if !complete {
			t.Error("Command 'N' should be complete")
		}
		if cmd == nil {
			t.Fatal("Command 'N' should parse")
		}
		if cmd.Type != CommandSearch {
			t.Errorf("'N' should be search command, got %v", cmd.Type)
		}
		if cmd.Text != "prev" {
			t.Errorf("'N' should have text 'prev', got %s", cmd.Text)
		}
	})
	
	t.Run("Search with count", func(t *testing.T) {
		parser := NewCommandParser()
		
		// Test '3n' for searching 3 times
		cmd, complete := parser.parseNormalCommand("n", "", "3")
		if !complete {
			t.Error("Command '3n' should be complete")
		}
		if cmd == nil {
			t.Fatal("Command '3n' should parse")
		}
		if cmd.Count != 3 {
			t.Errorf("'3n' should have count 3, got %d", cmd.Count)
		}
	})
}

// Test that search doesn't interfere with leader mappings
func TestSearchVsLeaderMappings(t *testing.T) {
	m := NewVimModeManager()
	m.Enable()
	
	// Verify / is NOT in leader mappings anymore
	_, hasSlash := m.GetLeaderMapping("/")
	if hasSlash {
		t.Error("Leader mapping should not contain '/' for search")
	}
	
	// Verify other leader mappings are present
	mappings := []string{"w", "q", "c", "p", "P", "y", "d", "v", "r", "n", "b"}
	for _, key := range mappings {
		mapping, ok := m.GetLeaderMapping(key)
		if !ok {
			t.Errorf("Leader mapping %s should exist", key)
		}
		if mapping.Command == "" {
			t.Errorf("Leader mapping %s should have a command", key)
		}
		if mapping.Description == "" {
			t.Errorf("Leader mapping %s should have a description", key)
		}
	}
}

// Test search pattern storage
func TestSearchPatternStorage(t *testing.T) {
	m := NewVimModeManager()
	m.Enable()
	
	// Set forward search pattern
	m.SetSearchPattern("hello", true)
	pattern, forward := m.GetSearchPattern()
	if pattern != "hello" {
		t.Errorf("Pattern should be 'hello', got %s", pattern)
	}
	if !forward {
		t.Error("Direction should be forward")
	}
	
	// Set backward search pattern
	m.SetSearchPattern("world", false)
	pattern, forward = m.GetSearchPattern()
	if pattern != "world" {
		t.Errorf("Pattern should be 'world', got %s", pattern)
	}
	if forward {
		t.Error("Direction should be backward")
	}
}