package vim

import (
	"testing"
)

func TestVimModeManager_ModeTransitions(t *testing.T) {
	m := NewVimModeManager()
	
	// Test initial state
	if m.CurrentMode() != ModeNormal {
		t.Errorf("Initial mode should be Normal, got %v", m.CurrentMode())
	}
	if m.IsEnabled() {
		t.Error("VimMode should not be enabled by default")
	}
	
	// Enable vim mode
	m.Enable()
	if !m.IsEnabled() {
		t.Error("VimMode should be enabled after Enable()")
	}
	if m.CurrentMode() != ModeNormal {
		t.Errorf("Mode should be Normal after Enable(), got %v", m.CurrentMode())
	}
	
	// Switch to Insert mode
	m.SetMode(ModeInsert)
	if m.CurrentMode() != ModeInsert {
		t.Errorf("Mode should be Insert, got %v", m.CurrentMode())
	}
	if m.previousMode != ModeNormal {
		t.Errorf("Previous mode should be Normal, got %v", m.previousMode)
	}
	
	// Switch to Visual mode
	m.SetMode(ModeVisual)
	if m.CurrentMode() != ModeVisual {
		t.Errorf("Mode should be Visual, got %v", m.CurrentMode())
	}
	
	// Switch to Visual Line mode
	m.SetMode(ModeVisualLine)
	if m.CurrentMode() != ModeVisualLine {
		t.Errorf("Mode should be VisualLine, got %v", m.CurrentMode())
	}
	
	// Switch to Replace mode
	m.SetMode(ModeReplace)
	if m.CurrentMode() != ModeReplace {
		t.Errorf("Mode should be Replace, got %v", m.CurrentMode())
	}
	
	// Disable vim mode
	m.Disable()
	if m.IsEnabled() {
		t.Error("VimMode should not be enabled after Disable()")
	}
	if m.CurrentMode() != ModeInsert {
		t.Errorf("Mode should be Insert after Disable(), got %v", m.CurrentMode())
	}
}

func TestVimModeManager_PendingOperator(t *testing.T) {
	m := NewVimModeManager()
	m.Enable()
	
	// Initially no pending operator
	if m.IsOperatorPending() {
		t.Error("Should not have pending operator initially")
	}
	
	// Set pending operator
	m.SetPendingOperator("d")
	if !m.IsOperatorPending() {
		t.Error("Should have pending operator after setting")
	}
	if m.pendingOperator != "d" {
		t.Errorf("Pending operator should be 'd', got %s", m.pendingOperator)
	}
	
	// Clear pending operator
	m.ClearPendingOperator()
	if m.IsOperatorPending() {
		t.Error("Should not have pending operator after clearing")
	}
	if m.pendingCount != "" {
		t.Error("Pending count should be cleared with operator")
	}
}

func TestVimModeManager_Count(t *testing.T) {
	m := NewVimModeManager()
	m.Enable()
	
	// Default count is 1
	if m.GetCount() != 1 {
		t.Errorf("Default count should be 1, got %d", m.GetCount())
	}
	
	// Append digits to build count
	m.AppendCount("2")
	if m.GetCount() != 2 {
		t.Errorf("Count should be 2, got %d", m.GetCount())
	}
	
	m.AppendCount("3")
	if m.GetCount() != 23 {
		t.Errorf("Count should be 23, got %d", m.GetCount())
	}
	
	// Clear count
	m.ClearCount()
	if m.GetCount() != 1 {
		t.Errorf("Count should be 1 after clear, got %d", m.GetCount())
	}
	
	// Don't allow leading zeros
	m.AppendCount("0")
	if m.pendingCount != "" {
		t.Error("Should not allow leading zero")
	}
	
	// But allow zero after other digits
	m.AppendCount("1")
	m.AppendCount("0")
	if m.GetCount() != 10 {
		t.Errorf("Count should be 10, got %d", m.GetCount())
	}
}

func TestVimModeManager_VisualRange(t *testing.T) {
	m := NewVimModeManager()
	m.Enable()
	
	// Set visual range
	m.SetVisualStart(Position{Row: 1, Col: 2})
	m.SetVisualEnd(Position{Row: 3, Col: 4})
	
	// Get normalized range (start before end)
	r := m.GetVisualRange()
	if r.Start != (Position{Row: 1, Col: 2}) {
		t.Errorf("Range start should be (1,2), got %v", r.Start)
	}
	if r.End != (Position{Row: 3, Col: 4}) {
		t.Errorf("Range end should be (3,4), got %v", r.End)
	}
	
	// Set reversed range
	m.SetVisualStart(Position{Row: 5, Col: 6})
	m.SetVisualEnd(Position{Row: 2, Col: 3})
	
	// Should still get normalized range
	r = m.GetVisualRange()
	if r.Start != (Position{Row: 2, Col: 3}) {
		t.Errorf("Range start should be (2,3), got %v", r.Start)
	}
	if r.End != (Position{Row: 5, Col: 6}) {
		t.Errorf("Range end should be (5,6), got %v", r.End)
	}
}

func TestVimModeManager_Registers(t *testing.T) {
	m := NewVimModeManager()
	m.Enable()
	
	// Set unnamed register
	m.SetRegister("", "hello")
	if m.GetRegister("") != "hello" {
		t.Errorf("Unnamed register should contain 'hello', got %s", m.GetRegister(""))
	}
	if m.GetRegister("\"") != "hello" {
		t.Errorf("Unnamed register (\") should contain 'hello', got %s", m.GetRegister("\""))
	}
	
	// Setting unnamed register also sets yank register
	if m.GetRegister("0") != "hello" {
		t.Errorf("Yank register (0) should contain 'hello', got %s", m.GetRegister("0"))
	}
	
	// Set named register
	m.SetRegister("a", "world")
	if m.GetRegister("a") != "world" {
		t.Errorf("Register 'a' should contain 'world', got %s", m.GetRegister("a"))
	}
	
	// Set system clipboard
	m.SetRegister("+", "clipboard")
	if m.GetRegister("+") != "clipboard" {
		t.Errorf("System clipboard (+) should contain 'clipboard', got %s", m.GetRegister("+"))
	}
	
	// Test linewise metadata
	m.SetRegisterWithMetadata("b", "line\n", true)
	reg := m.GetRegisterWithMetadata("b")
	if reg == nil {
		t.Fatal("Register 'b' should exist")
	}
	if !reg.Linewise {
		t.Error("Register 'b' should be linewise")
	}
	if reg.Content != "line\n" {
		t.Errorf("Register 'b' should contain 'line\\n', got %s", reg.Content)
	}
}

func TestVimModeManager_LastChange(t *testing.T) {
	m := NewVimModeManager()
	m.Enable()
	
	// Initially no last change
	if m.GetLastChange() != nil {
		t.Error("Should not have last change initially")
	}
	
	// Set last change
	change := &Change{
		Type:     ChangeInsert,
		Text:     "hello",
		Position: Position{Row: 1, Col: 2},
		Count:    1,
	}
	m.SetLastChange(change)
	
	got := m.GetLastChange()
	if got == nil {
		t.Fatal("Should have last change after setting")
	}
	if got.Type != ChangeInsert {
		t.Errorf("Change type should be Insert, got %v", got.Type)
	}
	if got.Text != "hello" {
		t.Errorf("Change text should be 'hello', got %s", got.Text)
	}
}

func TestVimModeManager_SearchPattern(t *testing.T) {
	m := NewVimModeManager()
	m.Enable()
	
	// Initially no search pattern
	pattern, forward := m.GetSearchPattern()
	if pattern != "" {
		t.Errorf("Initial search pattern should be empty, got %s", pattern)
	}
	
	// Set forward search
	m.SetSearchPattern("test", true)
	pattern, forward = m.GetSearchPattern()
	if pattern != "test" {
		t.Errorf("Search pattern should be 'test', got %s", pattern)
	}
	if !forward {
		t.Error("Search should be forward")
	}
	
	// Set backward search
	m.SetSearchPattern("back", false)
	pattern, forward = m.GetSearchPattern()
	if pattern != "back" {
		t.Errorf("Search pattern should be 'back', got %s", pattern)
	}
	if forward {
		t.Error("Search should be backward")
	}
}

func TestVimModeManager_LeaderKey(t *testing.T) {
	m := NewVimModeManager()
	m.Enable()
	
	// Default leader key is space
	if m.GetLeaderKey() != " " {
		t.Errorf("Default leader key should be space, got %s", m.GetLeaderKey())
	}
	
	// Leader not active initially
	if m.IsLeaderActive() {
		t.Error("Leader should not be active initially")
	}
	
	// Activate leader
	m.SetLeaderActive(true)
	if !m.IsLeaderActive() {
		t.Error("Leader should be active after setting")
	}
	
	// Deactivate leader
	m.SetLeaderActive(false)
	if m.IsLeaderActive() {
		t.Error("Leader should not be active after clearing")
	}
	
	// Change leader key
	m.SetLeaderKey(",")
	if m.GetLeaderKey() != "," {
		t.Errorf("Leader key should be ',', got %s", m.GetLeaderKey())
	}
}

func TestVimModeManager_LeaderMappings(t *testing.T) {
	m := NewVimModeManager()
	m.Enable()
	
	// Check default mappings exist
	mapping, ok := m.GetLeaderMapping("w")
	if !ok {
		t.Error("Default mapping for 'w' should exist")
	}
	if mapping.Command != "save" {
		t.Errorf("Leader-w should map to 'save', got %s", mapping.Command)
	}
	
	mapping, ok = m.GetLeaderMapping("q")
	if !ok {
		t.Error("Default mapping for 'q' should exist")
	}
	if mapping.Command != "quit" {
		t.Errorf("Leader-q should map to 'quit', got %s", mapping.Command)
	}
	
	// Add custom mapping
	m.SetLeaderMapping("x", LeaderMapping{
		Command:     "custom",
		Description: "Custom command",
	})
	
	mapping, ok = m.GetLeaderMapping("x")
	if !ok {
		t.Error("Custom mapping for 'x' should exist")
	}
	if mapping.Command != "custom" {
		t.Errorf("Leader-x should map to 'custom', got %s", mapping.Command)
	}
	
	// Non-existent mapping
	_, ok = m.GetLeaderMapping("z")
	if ok {
		t.Error("Mapping for 'z' should not exist")
	}
}

func TestVimModeManager_StatusLine(t *testing.T) {
	m := NewVimModeManager()
	
	// Disabled vim mode shows empty status
	if m.GetStatusLine() != "" {
		t.Error("Status line should be empty when vim disabled")
	}
	
	m.Enable()
	
	// Normal mode shows nothing (it's the default)
	status := m.GetStatusLine()
	if status != "" {
		t.Errorf("Normal mode status should be empty, got %s", status)
	}
	
	// Insert mode shows mode
	m.SetMode(ModeInsert)
	status = m.GetStatusLine()
	if status != "INSERT" {
		t.Errorf("Insert mode status should show 'INSERT', got %s", status)
	}
	
	// Visual mode with selection
	m.SetMode(ModeVisual)
	m.SetVisualStart(Position{Row: 0, Col: 0})
	m.SetVisualEnd(Position{Row: 0, Col: 5})
	status = m.GetStatusLine()
	if status != "6 chars" {
		t.Errorf("Visual mode should show '6 chars', got %s", status)
	}
	
	// Visual line mode
	m.SetMode(ModeVisualLine)
	m.SetVisualStart(Position{Row: 0, Col: 0})
	m.SetVisualEnd(Position{Row: 2, Col: 0})
	status = m.GetStatusLine()
	if status != "3 lines" {
		t.Errorf("Visual line mode should show '3 lines', got %s", status)
	}
	
	// Pending operator
	m.SetMode(ModeNormal)
	m.SetPendingOperator("d")
	status = m.GetStatusLine()
	if status != "d" {
		t.Errorf("Should show pending operator 'd', got %s", status)
	}
	
	// Pending count and operator
	m.AppendCount("2")
	status = m.GetStatusLine()
	if status != "2d" {
		t.Errorf("Should show '2d', got %s", status)
	}
	
	// Leader active
	m.ClearPendingOperator()
	m.SetLeaderActive(true)
	status = m.GetStatusLine()
	if status != "< >" {
		t.Errorf("Should show leader key active '< >', got %s", status)
	}
}

func TestVimMode_String(t *testing.T) {
	tests := []struct {
		mode VimMode
		want string
	}{
		{ModeNormal, "NORMAL"},
		{ModeInsert, "INSERT"},
		{ModeVisual, "VISUAL"},
		{ModeVisualLine, "V-LINE"},
		{ModeReplace, "REPLACE"},
		{VimMode(99), "UNKNOWN"},
	}
	
	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			if got := tt.mode.String(); got != tt.want {
				t.Errorf("String() = %v, want %v", got, tt.want)
			}
			if got := tt.mode.DisplayString(); got != tt.want {
				t.Errorf("DisplayString() = %v, want %v", got, tt.want)
			}
		})
	}
}