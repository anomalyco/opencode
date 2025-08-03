package vim

import (
	"fmt"
	"strings"
)

// VimMode represents the current mode of the Vim editor
type VimMode int

const (
	ModeNormal VimMode = iota
	ModeInsert
	ModeVisual
	ModeVisualLine
	ModeReplace
)

// String returns the string representation of the mode
func (m VimMode) String() string {
	switch m {
	case ModeNormal:
		return "NORMAL"
	case ModeInsert:
		return "INSERT"
	case ModeVisual:
		return "VISUAL"
	case ModeVisualLine:
		return "V-LINE"
	case ModeReplace:
		return "REPLACE"
	default:
		return "UNKNOWN"
	}
}

// DisplayString returns a formatted string for status line display
func (m VimMode) DisplayString() string {
	return m.String()
}

// Position represents a cursor position in the buffer
type Position struct {
	Row int
	Col int
}

// TextRange represents a range of text in the buffer
type TextRange struct {
	Start Position
	End   Position
}

// Change represents a change operation for dot repeat
type Change struct {
	Type      ChangeType
	Text      string
	Position  Position
	Count     int
	Motion    *Motion // For delete/change operations
	Operator  string  // The operator used (d, c, etc.)
	InsertCmd string  // How insert mode was entered (i, a, o, etc.)
}

type ChangeType int

const (
	ChangeInsert ChangeType = iota
	ChangeDelete
	ChangeReplace
)

// Register stores the content and metadata for a vim register
type Register struct {
	Content  string
	Linewise bool // Whether this was a line-wise operation (yy, dd, etc.)
}

// VimModeManager manages the state of Vim mode
type VimModeManager struct {
	currentMode     VimMode
	previousMode    VimMode
	enabled         bool
	pendingCount    string // For multi-digit counts (e.g., "12j")
	pendingOperator string // For operators awaiting motion (e.g., "d", "c", "y")
	visualStart     Position
	visualEnd       Position
	lastChange      *Change // For dot repeat
	registers       map[string]*Register
	searchPattern   string
	searchDirection bool // true for forward, false for backward
}

// NewVimModeManager creates a new VimModeManager
func NewVimModeManager() *VimModeManager {
	return &VimModeManager{
		currentMode: ModeNormal,
		enabled:     false,
		registers: map[string]*Register{
			"\"": {Content: "", Linewise: false}, // unnamed register
			"0":  {Content: "", Linewise: false}, // yank register
			"+":  {Content: "", Linewise: false}, // system clipboard
			"*":  {Content: "", Linewise: false}, // system clipboard (alternative)
		},
	}
}

// Enable enables Vim mode
func (m *VimModeManager) Enable() {
	m.enabled = true
	m.currentMode = ModeNormal
}

// Disable disables Vim mode
func (m *VimModeManager) Disable() {
	m.enabled = false
	// Reset to insert mode when disabled
	m.currentMode = ModeInsert
}

// IsEnabled returns whether Vim mode is enabled
func (m *VimModeManager) IsEnabled() bool {
	return m.enabled
}

// CurrentMode returns the current mode
func (m *VimModeManager) CurrentMode() VimMode {
	return m.currentMode
}

// SetMode sets the current mode
func (m *VimModeManager) SetMode(mode VimMode) {
	if m.currentMode != mode {
		m.previousMode = m.currentMode
		m.currentMode = mode
		// Clear pending states when changing modes
		m.pendingCount = ""
		m.pendingOperator = ""
	}
}

// IsOperatorPending returns true if an operator is waiting for a motion
func (m *VimModeManager) IsOperatorPending() bool {
	return m.pendingOperator != ""
}

// SetPendingOperator sets the pending operator
func (m *VimModeManager) SetPendingOperator(op string) {
	m.pendingOperator = op
}

// ClearPendingOperator clears the pending operator
func (m *VimModeManager) ClearPendingOperator() {
	m.pendingOperator = ""
	m.pendingCount = ""
}

// AppendCount appends a digit to the pending count
func (m *VimModeManager) AppendCount(digit string) {
	// Don't allow leading zeros
	if m.pendingCount == "" && digit == "0" {
		return
	}
	m.pendingCount += digit
}

// GetCount returns the current count (default 1)
func (m *VimModeManager) GetCount() int {
	if m.pendingCount == "" {
		return 1
	}
	count := 1
	if _, err := fmt.Sscanf(m.pendingCount, "%d", &count); err != nil {
		return 1
	}
	return count
}

// ClearCount clears the pending count
func (m *VimModeManager) ClearCount() {
	m.pendingCount = ""
}

// SetVisualStart sets the start position for visual mode
func (m *VimModeManager) SetVisualStart(pos Position) {
	m.visualStart = pos
}

// SetVisualEnd sets the end position for visual mode
func (m *VimModeManager) SetVisualEnd(pos Position) {
	m.visualEnd = pos
}

// GetVisualRange returns the current visual selection range
func (m *VimModeManager) GetVisualRange() TextRange {
	// Normalize the range so start is always before end
	if m.visualStart.Row < m.visualEnd.Row ||
		(m.visualStart.Row == m.visualEnd.Row && m.visualStart.Col <= m.visualEnd.Col) {
		return TextRange{Start: m.visualStart, End: m.visualEnd}
	}
	return TextRange{Start: m.visualEnd, End: m.visualStart}
}

// SetLastChange sets the last change for dot repeat
func (m *VimModeManager) SetLastChange(change *Change) {
	m.lastChange = change
}

// GetLastChange returns the last change
func (m *VimModeManager) GetLastChange() *Change {
	return m.lastChange
}

// SetRegister sets the content of a register
func (m *VimModeManager) SetRegister(name string, content string) {
	m.SetRegisterWithMetadata(name, content, false)
}

// SetRegisterWithMetadata sets the content and metadata of a register
func (m *VimModeManager) SetRegisterWithMetadata(name string, content string, linewise bool) {
	if name == "" {
		name = "\"" // default to unnamed register
	}
	m.registers[name] = &Register{
		Content:  content,
		Linewise: linewise,
	}

	// Also set to yank register if it's a yank operation
	if name == "\"" {
		m.registers["0"] = &Register{
			Content:  content,
			Linewise: linewise,
		}
	}
}

// GetRegister returns the content of a register
func (m *VimModeManager) GetRegister(name string) string {
	if name == "" {
		name = "\""
	}
	if reg, ok := m.registers[name]; ok && reg != nil {
		return reg.Content
	}
	return ""
}

// GetRegisterWithMetadata gets the register with full metadata
func (m *VimModeManager) GetRegisterWithMetadata(name string) *Register {
	if name == "" {
		name = "\"" // default to unnamed register
	}
	return m.registers[name]
}

// SetSearchPattern sets the current search pattern
func (m *VimModeManager) SetSearchPattern(pattern string, forward bool) {
	m.searchPattern = pattern
	m.searchDirection = forward
}

// GetSearchPattern returns the current search pattern and direction
func (m *VimModeManager) GetSearchPattern() (string, bool) {
	return m.searchPattern, m.searchDirection
}

// GetStatusLine returns a string for the status line
func (m *VimModeManager) GetStatusLine() string {
	if !m.enabled {
		return ""
	}

	var parts []string

	// Mode indicator
	if m.currentMode != ModeNormal && m.currentMode != ModeVisual && m.currentMode != ModeVisualLine {
		parts = append(parts, m.currentMode.DisplayString())
	}

	// Visual mode selection info (don't include mode name, just selection size)
	if m.currentMode == ModeVisual || m.currentMode == ModeVisualLine {
		// Calculate selection size
		start, end := m.visualStart, m.visualEnd
		if start.Row > end.Row || (start.Row == end.Row && start.Col > end.Col) {
			start, end = end, start
		}

		if m.currentMode == ModeVisualLine {
			lines := end.Row - start.Row + 1
			if lines == 1 {
				parts = append(parts, "1 line")
			} else {
				parts = append(parts, fmt.Sprintf("%d lines", lines))
			}
		} else {
			if start.Row == end.Row {
				chars := end.Col - start.Col + 1
				if chars == 1 {
					parts = append(parts, "1 char")
				} else {
					parts = append(parts, fmt.Sprintf("%d chars", chars))
				}
			} else {
				parts = append(parts, fmt.Sprintf("%d lines", end.Row-start.Row+1))
			}
		}
		return strings.Join(parts, " ") // Return early to avoid including mode name
	}

	// Pending count/operator
	if m.pendingCount != "" || m.pendingOperator != "" {
		pending := m.pendingCount + m.pendingOperator
		parts = append(parts, pending)
	}

	return strings.Join(parts, " ")
}
