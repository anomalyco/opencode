package textarea

import (
	"fmt"
	
	"github.com/charmbracelet/bubbles/v2/key"
	tea "github.com/charmbracelet/bubbletea/v2"
)

const (
	// Threshold for switching from original to rope implementation
	// Based on benchmarks: rope becomes beneficial around 500-1000 lines
	ropeThresholdLines = 500
	ropeThresholdChars = 25000 // Approximately 500 lines of 50 chars each
)

// AdaptiveModel automatically chooses between original and rope implementations
// based on content size for optimal performance.
type AdaptiveModel struct {
	// Current implementation being used
	useRope bool
	
	// Both implementations
	original *Model
	rope     *RopeModel
	
	// Shared configuration
	width  int
	height int
	styles Styles
	keyMap KeyMap
}

// NewAdaptive creates a new adaptive textarea that chooses the best implementation
// based on content size.
func NewAdaptive() *AdaptiveModel {
	original := New()
	return &AdaptiveModel{
		useRope:  false,
		original: &original,
		rope:     NewRope(),
	}
}

// shouldUseRope determines if we should switch to rope implementation
func (m *AdaptiveModel) shouldUseRope(content string) bool {
	if len(content) > ropeThresholdChars {
		return true
	}
	
	// Count lines for more accurate threshold
	lines := 1
	for _, char := range content {
		if char == '\n' {
			lines++
		}
	}
	
	return lines > ropeThresholdLines
}

// switchImplementation switches between original and rope implementations
func (m *AdaptiveModel) switchImplementation(newUseRope bool) {
	if m.useRope == newUseRope {
		return // No change needed
	}
	
	// Save current state
	var (
		content     = m.Value()
		focused     = m.Focused()
		cursorLine  = m.Line()
		cursorCol   = m.CursorColumn()
		prompt      = m.getPrompt()
		placeholder = m.getPlaceholder()
		showLineNum = m.getShowLineNumbers()
		charLimit   = m.getCharLimit()
		maxHeight   = m.getMaxHeight()
		maxWidth    = m.getMaxWidth()
	)
	
	// Switch implementation
	m.useRope = newUseRope
	
	// Configure new implementation
	if m.useRope {
		m.rope.SetValue(content)
		m.rope.Prompt = prompt
		m.rope.Placeholder = placeholder
		m.rope.ShowLineNumbers = showLineNum
		m.rope.CharLimit = charLimit
		m.rope.MaxHeight = maxHeight
		m.rope.MaxWidth = maxWidth
		m.rope.Styles = m.styles
		m.rope.KeyMap = m.keyMap
		m.rope.SetWidth(m.width)
		m.rope.SetHeight(m.height)
		
		if focused {
			m.rope.Focus()
		}
		
		// Restore cursor position approximately
		m.rope.row = cursorLine
		m.rope.col = cursorCol
		m.rope.updateRowCol()
	} else {
		m.original.SetValue(content)
		m.original.Prompt = prompt
		m.original.Placeholder = placeholder
		m.original.ShowLineNumbers = showLineNum
		m.original.CharLimit = charLimit
		m.original.MaxHeight = maxHeight
		m.original.MaxWidth = maxWidth
		m.original.Styles = m.styles
		m.original.KeyMap = m.keyMap
		m.original.SetWidth(m.width)
		m.original.SetHeight(m.height)
		
		if focused {
			m.original.Focus()
		}
		
		// Restore cursor position
		if cursorLine < len(m.original.value) {
			m.original.row = cursorLine
			if cursorCol <= len(m.original.value[cursorLine]) {
				m.original.col = cursorCol
			}
		}
	}
}

// Getters for shared configuration
func (m *AdaptiveModel) getPrompt() string {
	if m.useRope {
		return m.rope.Prompt
	}
	return m.original.Prompt
}

func (m *AdaptiveModel) getPlaceholder() string {
	if m.useRope {
		return m.rope.Placeholder
	}
	return m.original.Placeholder
}

func (m *AdaptiveModel) getShowLineNumbers() bool {
	if m.useRope {
		return m.rope.ShowLineNumbers
	}
	return m.original.ShowLineNumbers
}

func (m *AdaptiveModel) getCharLimit() int {
	if m.useRope {
		return m.rope.CharLimit
	}
	return m.original.CharLimit
}

func (m *AdaptiveModel) getMaxHeight() int {
	if m.useRope {
		return m.rope.MaxHeight
	}
	return m.original.MaxHeight
}

func (m *AdaptiveModel) getMaxWidth() int {
	if m.useRope {
		return m.rope.MaxWidth
	}
	return m.original.MaxWidth
}

// Public API that delegates to the appropriate implementation

// SetValue sets the value and automatically chooses the best implementation
func (m *AdaptiveModel) SetValue(s string) {
	newUseRope := m.shouldUseRope(s)
	m.switchImplementation(newUseRope)
	
	if m.useRope {
		m.rope.SetValue(s)
	} else {
		m.original.SetValue(s)
	}
}

// Value returns the current value
func (m *AdaptiveModel) Value() string {
	if m.useRope {
		return m.rope.Value()
	}
	return m.original.Value()
}

// InsertString inserts text and may trigger implementation switch
func (m *AdaptiveModel) InsertString(s string) {
	if m.useRope {
		m.rope.InsertString(s)
	} else {
		m.original.InsertString(s)
	}
	
	// Check if we should switch implementations after insertion
	newContent := m.Value()
	newUseRope := m.shouldUseRope(newContent)
	if newUseRope != m.useRope {
		m.switchImplementation(newUseRope)
		// Re-apply the insertion to the new implementation if needed
		// The content is already set during switchImplementation
	}
}

// InsertRune inserts a rune
func (m *AdaptiveModel) InsertRune(r rune) {
	if m.useRope {
		m.rope.InsertRune(r)
	} else {
		m.original.InsertRune(r)
	}
	
	// Check if we should switch implementations
	newContent := m.Value()
	newUseRope := m.shouldUseRope(newContent)
	if newUseRope != m.useRope {
		m.switchImplementation(newUseRope)
	}
}

// InsertAttachment inserts an attachment
func (m *AdaptiveModel) InsertAttachment(att *Attachment) {
	if m.useRope {
		m.rope.InsertAttachment(att)
	} else {
		m.original.InsertAttachment(att)
	}
}

// Length returns the content length
func (m *AdaptiveModel) Length() int {
	if m.useRope {
		return m.rope.Length()
	}
	return m.original.Length()
}

// LineCount returns the number of lines
func (m *AdaptiveModel) LineCount() int {
	if m.useRope {
		return m.rope.LineCount()
	}
	return m.original.LineCount()
}

// Line returns the current line number
func (m *AdaptiveModel) Line() int {
	if m.useRope {
		return m.rope.Line()
	}
	return m.original.Line()
}

// CursorColumn returns the cursor column
func (m *AdaptiveModel) CursorColumn() int {
	if m.useRope {
		return m.rope.CursorColumn()
	}
	return m.original.CursorColumn()
}

// Focus sets focus
func (m *AdaptiveModel) Focus() tea.Cmd {
	if m.useRope {
		return m.rope.Focus()
	}
	return m.original.Focus()
}

// Blur removes focus
func (m *AdaptiveModel) Blur() {
	if m.useRope {
		m.rope.Blur()
	} else {
		m.original.Blur()
	}
}

// Focused returns focus state
func (m *AdaptiveModel) Focused() bool {
	if m.useRope {
		return m.rope.Focused()
	}
	return m.original.Focused()
}

// Reset resets the textarea
func (m *AdaptiveModel) Reset() {
	// Reset both implementations and switch to original for empty content
	m.original.Reset()
	m.rope.Reset()
	m.useRope = false
}

// SetWidth sets the width
func (m *AdaptiveModel) SetWidth(w int) {
	m.width = w
	m.original.SetWidth(w)
	m.rope.SetWidth(w)
}

// SetHeight sets the height
func (m *AdaptiveModel) SetHeight(h int) {
	m.height = h
	m.original.SetHeight(h)
	m.rope.SetHeight(h)
}

// Width returns the width
func (m *AdaptiveModel) Width() int {
	if m.useRope {
		return m.rope.Width()
	}
	return m.original.Width()
}

// Height returns the height
func (m *AdaptiveModel) Height() int {
	if m.useRope {
		return m.rope.Height()
	}
	return m.original.Height()
}

// Configuration setters that apply to both implementations

// SetPrompt sets the prompt
func (m *AdaptiveModel) SetPrompt(prompt string) {
	m.original.Prompt = prompt
	m.rope.Prompt = prompt
}

// SetPlaceholder sets the placeholder
func (m *AdaptiveModel) SetPlaceholder(placeholder string) {
	m.original.Placeholder = placeholder
	m.rope.Placeholder = placeholder
}

// SetShowLineNumbers sets line number visibility
func (m *AdaptiveModel) SetShowLineNumbers(show bool) {
	m.original.ShowLineNumbers = show
	m.rope.ShowLineNumbers = show
}

// SetCharLimit sets character limit
func (m *AdaptiveModel) SetCharLimit(limit int) {
	m.original.CharLimit = limit
	m.rope.CharLimit = limit
}

// SetMaxHeight sets maximum height
func (m *AdaptiveModel) SetMaxHeight(height int) {
	m.original.MaxHeight = height
	m.rope.MaxHeight = height
}

// SetMaxWidth sets maximum width
func (m *AdaptiveModel) SetMaxWidth(width int) {
	m.original.MaxWidth = width
	m.rope.MaxWidth = width
}

// SetStyles sets the styles
func (m *AdaptiveModel) SetStyles(styles Styles) {
	m.styles = styles
	m.original.Styles = styles
	m.rope.Styles = styles
}

// SetKeyMap sets the key map
func (m *AdaptiveModel) SetKeyMap(keyMap KeyMap) {
	m.keyMap = keyMap
	m.original.KeyMap = keyMap
	m.rope.KeyMap = keyMap
}

// Update handles the update loop
func (m *AdaptiveModel) Update(msg tea.Msg) (*AdaptiveModel, tea.Cmd) {
	var cmd tea.Cmd
	
	if m.useRope {
		var newRope *RopeModel
		newRope, cmd = m.rope.Update(msg)
		m.rope = newRope
	} else {
		var newOriginal Model
		newOriginal, cmd = m.original.Update(msg)
		m.original = &newOriginal
	}
	
	// Check if we should switch implementations after the update
	// Only check on content-changing operations to avoid overhead
	switch msg := msg.(type) {
	case tea.KeyPressMsg:
		if key.Matches(msg, m.keyMap.InsertNewline) ||
		   key.Matches(msg, m.keyMap.DeleteCharacterBackward) ||
		   key.Matches(msg, m.keyMap.DeleteCharacterForward) ||
		   key.Matches(msg, m.keyMap.DeleteWordBackward) ||
		   key.Matches(msg, m.keyMap.DeleteWordForward) ||
		   key.Matches(msg, m.keyMap.DeleteAfterCursor) ||
		   key.Matches(msg, m.keyMap.DeleteBeforeCursor) ||
		   (msg.Text != "" && msg.Text != "\x00") { // Regular text input
			
			newContent := m.Value()
			newUseRope := m.shouldUseRope(newContent)
			if newUseRope != m.useRope {
				m.switchImplementation(newUseRope)
			}
		}
	case pasteMsg:
		newContent := m.Value()
		newUseRope := m.shouldUseRope(newContent)
		if newUseRope != m.useRope {
			m.switchImplementation(newUseRope)
		}
	}
	
	return m, cmd
}

// View renders the textarea
func (m *AdaptiveModel) View() string {
	if m.useRope {
		return m.rope.View()
	}
	return m.original.View()
}

// GetCurrentImplementation returns information about which implementation is active
func (m *AdaptiveModel) GetCurrentImplementation() (implementation string, reason string) {
	if m.useRope {
		lines := m.LineCount()
		chars := m.Length()
		return "rope", fmt.Sprintf("using rope for large content (%d lines, %d chars)", lines, chars)
	}
	lines := m.LineCount()
	chars := m.Length()
	return "original", fmt.Sprintf("using original for small content (%d lines, %d chars)", lines, chars)
}

// GetAttachments returns attachments (only works with original implementation currently)
func (m *AdaptiveModel) GetAttachments() []*Attachment {
	if m.useRope {
		// TODO: Implement attachment support for rope
		return []*Attachment{}
	}
	return m.original.GetAttachments()
}

// InsertRunesFromUserInput inserts runes from user input
func (m *AdaptiveModel) InsertRunesFromUserInput(runes []rune) {
	if m.useRope {
		m.rope.InsertRunesFromUserInput(runes)
	} else {
		m.original.InsertRunesFromUserInput(runes)
	}
	
	// Check if we should switch implementations
	newContent := m.Value()
	newUseRope := m.shouldUseRope(newContent)
	if newUseRope != m.useRope {
		m.switchImplementation(newUseRope)
	}
}

// LastRuneIndex finds the last occurrence of a rune
func (m *AdaptiveModel) LastRuneIndex(r rune) int {
	if m.useRope {
		return m.rope.LastRuneIndex(r)
	}
	return m.original.LastRuneIndex(r)
}

// ReplaceRange replaces text in a range
func (m *AdaptiveModel) ReplaceRange(start, end int, replacement string) {
	if m.useRope {
		m.rope.ReplaceRange(start, end, replacement)
	} else {
		m.original.ReplaceRange(start, end, replacement)
	}
	
	// Check if we should switch implementations
	newContent := m.Value()
	newUseRope := m.shouldUseRope(newContent)
	if newUseRope != m.useRope {
		m.switchImplementation(newUseRope)
	}
}

// CurrentRowLength returns the length of the current row
func (m *AdaptiveModel) CurrentRowLength() int {
	if m.useRope {
		return m.rope.CurrentRowLength()
	}
	return m.original.CurrentRowLength()
}

// Newline inserts a newline at cursor position
func (m *AdaptiveModel) Newline() {
	if m.useRope {
		m.rope.Newline()
	} else {
		m.original.Newline()
	}
	
	// Check if we should switch implementations (newlines can affect line count)
	newContent := m.Value()
	newUseRope := m.shouldUseRope(newContent)
	if newUseRope != m.useRope {
		m.switchImplementation(newUseRope)
	}
}