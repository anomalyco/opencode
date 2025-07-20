package textarea

import (
	"crypto/sha256"
	"fmt"
	"strconv"
	"strings"

	"github.com/charmbracelet/bubbles/v2/cursor"
	"github.com/charmbracelet/bubbles/v2/key"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
	"github.com/rivo/uniseg"
	"github.com/sst/opencode/internal/rope"
)

const (
	minRopeHeight        = 1
	defaultRopeHeight    = 1
	defaultRopeWidth     = 40
	defaultRopeCharLimit = 0 // no limit
	defaultRopeMaxHeight = 99
	defaultRopeMaxWidth  = 500

	// Rope-specific constants
	maxRopeLines = 100000
)

// RopeModel is the rope-based text area model that provides efficient operations for large texts.
type RopeModel struct {
	Err error

	// General settings.
	cache *MemoCache[ropeWrapLine, [][]any]

	// Prompt is printed at the beginning of each line.
	Prompt string

	// Placeholder is the text displayed when the user hasn't entered anything yet.
	Placeholder string

	// ShowLineNumbers, if enabled, causes line numbers to be printed after the prompt.
	ShowLineNumbers bool

	// EndOfBufferCharacter is displayed at the end of the input.
	EndOfBufferCharacter rune

	// KeyMap encodes the keybindings recognized by the widget.
	KeyMap KeyMap

	// Styling. FocusedStyle and BlurredStyle are used to style the textarea in
	// focused and blurred states.
	Styles Styles

	// virtualCursor manages the virtual cursor.
	virtualCursor cursor.Model

	// VirtualCursor determines whether or not to use the virtual cursor.
	VirtualCursor bool

	// CharLimit is the maximum number of characters this input element will accept.
	CharLimit int

	// MaxHeight is the maximum height of the text area in rows.
	MaxHeight int

	// MaxWidth is the maximum width of the text area in columns.
	MaxWidth int

	// promptFunc can replace Prompt as a generator for prompt strings.
	promptFunc func(line int) string

	// promptWidth is the width of the prompt.
	promptWidth int

	// width is the maximum number of characters that can be displayed at once.
	width int

	// height is the maximum number of lines that can be displayed at once.
	height int

	// Underlying text buffer using rope data structure
	buffer *rope.TextBuffer

	// Rope-specific attachments mapping: position -> Attachment
	attachments map[int]*Attachment

	// focus indicates whether user input focus should be on this input component.
	focus bool

	// Cursor position in the rope buffer
	cursorPos int

	// Last character offset, used to maintain state when the cursor is moved vertically
	lastCharOffset int

	// Current line and column for compatibility
	row int
	col int

	// rune sanitizer for input.
	rsan Sanitizer
}

// ropeWrapLine is the input to the text wrapping function for rope model.
type ropeWrapLine struct {
	content string // Text content of the line
	width   int    // Width for wrapping
}

// Hash returns a hash of the rope wrap line.
func (w ropeWrapLine) Hash() string {
	v := fmt.Sprintf("%s:%d", w.content, w.width)
	return fmt.Sprintf("%x", sha256.Sum256([]byte(v)))
}

// NewRope creates a new rope-based textarea model with default settings.
func NewRope() *RopeModel {
	cur := cursor.New()
	styles := DefaultDarkStyles()

	m := &RopeModel{
		CharLimit:            defaultRopeCharLimit,
		MaxHeight:            defaultRopeMaxHeight,
		MaxWidth:             defaultRopeMaxWidth,
		Prompt:               lipgloss.ThickBorder().Left + " ",
		Styles:               styles,
		cache:                NewMemoCache[ropeWrapLine, [][]any](maxRopeLines),
		EndOfBufferCharacter: ' ',
		ShowLineNumbers:      true,
		VirtualCursor:        true,
		virtualCursor:        cur,
		KeyMap:               DefaultKeyMap(),

		buffer:      rope.NewTextBuffer(""),
		attachments: make(map[int]*Attachment),
		focus:       false,
		cursorPos:   0,
		row:         0,
		col:         0,
	}

	m.SetWidth(defaultRopeWidth)
	m.SetHeight(defaultRopeHeight)

	return m
}

// SetValue sets the value of the text input using the rope buffer.
func (m *RopeModel) SetValue(s string) {
	m.Reset()
	m.InsertString(s)
}

// Value returns the value of the text input from the rope buffer.
func (m *RopeModel) Value() string {
	return m.buffer.String()
}

// InsertString inserts a string at the cursor position using rope operations.
func (m *RopeModel) InsertString(s string) {
	m.InsertRunesFromUserInput([]rune(s))
}

// InsertRune inserts a rune at the cursor position.
func (m *RopeModel) InsertRune(r rune) {
	m.InsertRunesFromUserInput([]rune{r})
}

// InsertAttachment inserts an attachment at the cursor position.
func (m *RopeModel) InsertAttachment(att *Attachment) {
	if m.CharLimit > 0 {
		availSpace := m.CharLimit - m.Length()
		if availSpace <= 0 {
			return
		}
	}

	// Store attachment in the mapping
	m.attachments[m.cursorPos] = att
	
	// Insert the attachment display text into the rope
	m.buffer.Insert(m.cursorPos, att.Display)
	m.cursorPos += len(att.Display)
	m.updateRowCol()
}

// InsertRunesFromUserInput inserts runes at the current cursor position using rope operations.
func (m *RopeModel) InsertRunesFromUserInput(runes []rune) {
	// Clean up any special characters in the input
	runes = m.san().Sanitize(runes)

	if m.CharLimit > 0 {
		availSpace := m.CharLimit - m.Length()
		if availSpace <= 0 {
			return
		}
		if availSpace < len(runes) {
			runes = runes[:availSpace]
		}
	}

	text := string(runes)
	
	// Insert text into rope buffer
	m.buffer.Insert(m.cursorPos, text)
	
	// Update cursor position
	m.cursorPos += len(text)
	
	// Shift attachment positions that come after the insertion point
	m.shiftAttachments(m.cursorPos-len(text), len(text))
	
	m.updateRowCol()
}

// shiftAttachments shifts attachment positions when text is inserted or deleted.
func (m *RopeModel) shiftAttachments(pos int, delta int) {
	newAttachments := make(map[int]*Attachment)
	for attachPos, att := range m.attachments {
		if attachPos >= pos {
			newAttachments[attachPos+delta] = att
		} else {
			newAttachments[attachPos] = att
		}
	}
	m.attachments = newAttachments
}

// updateRowCol updates the row and column based on the current cursor position.
func (m *RopeModel) updateRowCol() {
	// Convert cursor position to row/col
	content := m.buffer.String()
	if m.cursorPos > len(content) {
		m.cursorPos = len(content)
	}
	
	m.row = 0
	m.col = 0
	
	for i, r := range content {
		if i >= m.cursorPos {
			break
		}
		if r == '\n' {
			m.row++
			m.col = 0
		} else {
			m.col++
		}
	}
}

// Length returns the number of characters currently in the text input.
func (m *RopeModel) Length() int {
	return m.buffer.Len()
}

// LineCount returns the number of lines that are currently in the text input.
func (m *RopeModel) LineCount() int {
	return m.buffer.LineCount()
}

// Line returns the line position.
func (m *RopeModel) Line() int {
	return m.row
}

// CursorColumn returns the cursor's column position.
func (m *RopeModel) CursorColumn() int {
	return m.col
}

// Reset sets the input to its default state with no input.
func (m *RopeModel) Reset() {
	m.buffer.Clear()
	m.attachments = make(map[int]*Attachment)
	m.cursorPos = 0
	m.row = 0
	m.col = 0
}

// Focus sets the focus state on the model.
func (m *RopeModel) Focus() tea.Cmd {
	m.focus = true
	return m.virtualCursor.Focus()
}

// Blur removes the focus state on the model.
func (m *RopeModel) Blur() {
	m.focus = false
	m.virtualCursor.Blur()
}

// Focused returns the focus state on the model.
func (m *RopeModel) Focused() bool {
	return m.focus
}

// SetWidth sets the width of the textarea to fit exactly within the given width.
func (m *RopeModel) SetWidth(w int) {
	if m.promptFunc == nil {
		m.promptWidth = uniseg.StringWidth(m.Prompt)
	}

	reservedOuter := m.activeStyle().Base.GetHorizontalFrameSize()
	reservedInner := m.promptWidth

	if m.ShowLineNumbers {
		const gap = 2
		reservedInner += numDigits(m.MaxHeight) + gap
	}

	minWidth := reservedInner + reservedOuter + 1
	inputWidth := max(w, minWidth)

	if m.MaxWidth > 0 {
		inputWidth = min(inputWidth, m.MaxWidth)
	}

	m.width = inputWidth - reservedOuter - reservedInner
}

// SetHeight sets the height of the textarea.
func (m *RopeModel) SetHeight(h int) {
	contentHeight := m.ContentHeight()
	if m.MaxHeight > 0 {
		m.height = clamp(contentHeight, minRopeHeight, m.MaxHeight)
	} else {
		m.height = max(contentHeight, minRopeHeight)
	}
}

// ContentHeight returns the actual height needed to display all content.
func (m *RopeModel) ContentHeight() int {
	lineCount := m.buffer.LineCount()
	if lineCount == 0 {
		return 1
	}
	return lineCount
}

// Width returns the width of the textarea.
func (m *RopeModel) Width() int {
	return m.width
}

// Height returns the current height of the textarea.
func (m *RopeModel) Height() int {
	return m.height
}

// activeStyle returns the appropriate set of styles to use depending on focus state.
func (m *RopeModel) activeStyle() *StyleState {
	if m.focus {
		return &m.Styles.Focused
	}
	return &m.Styles.Blurred
}

// san initializes or retrieves the rune sanitizer.
func (m *RopeModel) san() Sanitizer {
	if m.rsan == nil {
		m.rsan = NewSanitizer()
	}
	return m.rsan
}

// updateVirtualCursorStyle sets styling on the virtual cursor.
func (m *RopeModel) updateVirtualCursorStyle() {
	if !m.VirtualCursor {
		m.virtualCursor.SetMode(cursor.CursorHide)
		return
	}

	m.virtualCursor.Style = lipgloss.NewStyle().Foreground(m.Styles.Cursor.Color)

	if m.Styles.Cursor.Blink {
		if m.Styles.Cursor.BlinkSpeed > 0 {
			m.virtualCursor.BlinkSpeed = m.Styles.Cursor.BlinkSpeed
		}
		m.virtualCursor.SetMode(cursor.CursorBlink)
		return
	}
	m.virtualCursor.SetMode(cursor.CursorStatic)
}

// characterRight moves the cursor one character to the right.
func (m *RopeModel) characterRight() {
	content := m.buffer.String()
	if m.cursorPos < len(content) {
		if content[m.cursorPos] == '\n' {
			m.row++
			m.col = 0
		} else {
			m.col++
		}
		m.cursorPos++
	}
}

// characterLeft moves the cursor one character to the left.
func (m *RopeModel) characterLeft() {
	if m.cursorPos > 0 {
		m.cursorPos--
		content := m.buffer.String()
		if m.cursorPos < len(content) && content[m.cursorPos] == '\n' {
			// Find the previous line length
			lineStart := m.cursorPos
			for lineStart > 0 && content[lineStart-1] != '\n' {
				lineStart--
			}
			m.row--
			m.col = m.cursorPos - lineStart
		} else {
			m.col--
			if m.col < 0 {
				m.col = 0
			}
		}
	}
}

// CursorStart moves the cursor to the start of the current line.
func (m *RopeModel) CursorStart() {
	content := m.buffer.String()
	// Find the start of the current line
	for m.cursorPos > 0 && m.cursorPos <= len(content) {
		if content[m.cursorPos-1] == '\n' {
			break
		}
		m.cursorPos--
		m.col--
	}
	if m.col < 0 {
		m.col = 0
	}
}

// CursorEnd moves the cursor to the end of the current line.
func (m *RopeModel) CursorEnd() {
	content := m.buffer.String()
	// Find the end of the current line
	for m.cursorPos < len(content) {
		if content[m.cursorPos] == '\n' {
			break
		}
		m.cursorPos++
		m.col++
	}
}

// CursorDown moves the cursor down by one line.
func (m *RopeModel) CursorDown() {
	if m.row < m.buffer.LineCount()-1 {
		targetCol := m.col
		m.row++
		
		// Find the start of the target line
		content := m.buffer.String()
		lineStart := 0
		currentLine := 0
		for i, r := range content {
			if currentLine == m.row {
				lineStart = i
				break
			}
			if r == '\n' {
				currentLine++
				lineStart = i + 1
			}
		}
		
		// Move to the target column or end of line
		m.cursorPos = lineStart
		m.col = 0
		lineEnd := len(content)
		for i := lineStart; i < len(content); i++ {
			if content[i] == '\n' {
				lineEnd = i
				break
			}
		}
		
		targetPos := lineStart + targetCol
		if targetPos <= lineEnd {
			m.cursorPos = targetPos
			m.col = targetCol
		} else {
			m.cursorPos = lineEnd
			m.col = lineEnd - lineStart
		}
	}
}

// CursorUp moves the cursor up by one line.
func (m *RopeModel) CursorUp() {
	if m.row > 0 {
		targetCol := m.col
		m.row--
		
		// Find the start of the target line
		content := m.buffer.String()
		lineStart := 0
		currentLine := 0
		for i, r := range content {
			if currentLine == m.row {
				lineStart = i
				break
			}
			if r == '\n' {
				currentLine++
				lineStart = i + 1
			}
		}
		
		// Move to the target column or end of line
		m.cursorPos = lineStart
		m.col = 0
		lineEnd := len(content)
		for i := lineStart; i < len(content); i++ {
			if content[i] == '\n' {
				lineEnd = i
				break
			}
		}
		
		targetPos := lineStart + targetCol
		if targetPos <= lineEnd {
			m.cursorPos = targetPos
			m.col = targetCol
		} else {
			m.cursorPos = lineEnd
			m.col = lineEnd - lineStart
		}
	}
}

// Newline inserts a newline at the cursor position.
func (m *RopeModel) Newline() {
	if m.MaxHeight > 0 && m.buffer.LineCount() >= m.MaxHeight {
		return
	}
	m.buffer.Insert(m.cursorPos, "\n")
	m.cursorPos++
	m.row++
	m.col = 0
	m.shiftAttachments(m.cursorPos-1, 1)
}

// deleteBeforeCursor deletes all text before the cursor on the current line.
func (m *RopeModel) deleteBeforeCursor() {
	content := m.buffer.String()
	// Find the start of the current line
	lineStart := m.cursorPos
	for lineStart > 0 && content[lineStart-1] != '\n' {
		lineStart--
	}
	
	if lineStart < m.cursorPos {
		deleteLen := m.cursorPos - lineStart
		m.buffer.Delete(lineStart, m.cursorPos)
		m.shiftAttachments(lineStart, -deleteLen)
		m.cursorPos = lineStart
		m.col = 0
	}
}

// deleteAfterCursor deletes all text after the cursor on the current line.
func (m *RopeModel) deleteAfterCursor() {
	content := m.buffer.String()
	// Find the end of the current line
	lineEnd := m.cursorPos
	for lineEnd < len(content) && content[lineEnd] != '\n' {
		lineEnd++
	}
	
	if lineEnd > m.cursorPos {
		deleteLen := lineEnd - m.cursorPos
		m.buffer.Delete(m.cursorPos, lineEnd)
		m.shiftAttachments(m.cursorPos, -deleteLen)
	}
}

// Update is the Bubble Tea update loop.
func (m *RopeModel) Update(msg tea.Msg) (*RopeModel, tea.Cmd) {
	if !m.focus {
		m.virtualCursor.Blur()
		return m, nil
	}

	oldRow, oldCol := m.row, m.col
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.KeyPressMsg:
		switch {
		case key.Matches(msg, m.KeyMap.DeleteAfterCursor):
			m.deleteAfterCursor()
		case key.Matches(msg, m.KeyMap.DeleteBeforeCursor):
			m.deleteBeforeCursor()
		case key.Matches(msg, m.KeyMap.DeleteCharacterBackward):
			if m.cursorPos > 0 {
				m.buffer.Delete(m.cursorPos-1, m.cursorPos)
				m.shiftAttachments(m.cursorPos-1, -1)
				m.cursorPos--
				m.updateRowCol()
			}
		case key.Matches(msg, m.KeyMap.DeleteCharacterForward):
			content := m.buffer.String()
			if m.cursorPos < len(content) {
				m.buffer.Delete(m.cursorPos, m.cursorPos+1)
				m.shiftAttachments(m.cursorPos, -1)
			}
		case key.Matches(msg, m.KeyMap.InsertNewline):
			m.Newline()
		case key.Matches(msg, m.KeyMap.LineEnd):
			m.CursorEnd()
		case key.Matches(msg, m.KeyMap.LineStart):
			m.CursorStart()
		case key.Matches(msg, m.KeyMap.CharacterForward):
			m.characterRight()
		case key.Matches(msg, m.KeyMap.LineNext):
			m.CursorDown()
		case key.Matches(msg, m.KeyMap.CharacterBackward):
			m.characterLeft()
		case key.Matches(msg, m.KeyMap.LinePrevious):
			m.CursorUp()
		default:
			m.InsertRunesFromUserInput([]rune(msg.Text))
		}

	case pasteMsg:
		m.InsertRunesFromUserInput([]rune(msg))

	case pasteErrMsg:
		m.Err = msg
	}

	var cmd tea.Cmd
	newRow, newCol := m.row, m.col
	m.virtualCursor, cmd = m.virtualCursor.Update(msg)
	if (newRow != oldRow || newCol != oldCol) && m.virtualCursor.Mode() == cursor.CursorBlink {
		m.virtualCursor.Blink = false
		cmd = m.virtualCursor.BlinkCmd()
	}
	cmds = append(cmds, cmd)

	return m, tea.Batch(cmds...)
}

// LastRuneIndex finds the last occurrence of a rune in the text
func (m *RopeModel) LastRuneIndex(r rune) int {
	content := m.buffer.String()
	runeToFind := string(r)
	lastIndex := strings.LastIndex(content, runeToFind)
	return lastIndex
}

// ReplaceRange replaces text from start to end position with replacement
func (m *RopeModel) ReplaceRange(start, end int, replacement string) {
	content := m.buffer.String()
	if start < 0 || start > end || end > len(content) {
		return // Invalid range
	}
	
	// Remove the range
	m.buffer.Delete(start, end-start)
	
	// Insert the replacement
	if replacement != "" {
		m.buffer.Insert(start, replacement)
	}
	
	// Update cursor position if it's affected
	if m.cursorPos >= start {
		if m.cursorPos <= end {
			// Cursor was in the deleted range, move to start of replacement
			m.cursorPos = start + len(replacement)
		} else {
			// Cursor was after the range, adjust by the difference
			m.cursorPos += len(replacement) - (end - start)
		}
	}
	
	m.updateRowCol()
}

// CurrentRowLength returns the length of the current row
func (m *RopeModel) CurrentRowLength() int {
	content := m.buffer.String()
	lines := strings.Split(content, "\n")
	
	if m.row >= 0 && m.row < len(lines) {
		return len(lines[m.row])
	}
	
	return 0
}

// View renders the text area in its current state.
func (m *RopeModel) View() string {
	m.updateVirtualCursorStyle()
	
	content := m.buffer.String()
	if content == "" && m.cursorPos == 0 && m.Placeholder != "" {
		return m.placeholderView()
	}
	
	m.virtualCursor.TextStyle = m.activeStyle().computedCursorLine()

	var (
		s       strings.Builder
		style   lipgloss.Style
		styles  = m.activeStyle()
	)

	lines := strings.Split(content, "\n")
	if len(lines) == 0 {
		lines = []string{""}
	}

	for lineNum, line := range lines {
		isCursorLine := lineNum == m.row
		
		if isCursorLine {
			style = styles.computedCursorLine()
		} else {
			style = styles.computedText()
		}

		// Render prompt
		prompt := m.promptView(lineNum)
		prompt = styles.computedPrompt().Render(prompt)
		s.WriteString(style.Render(prompt))

		// Render line number
		if m.ShowLineNumbers {
			s.WriteString(m.lineNumberView(lineNum+1, isCursorLine))
		}

		// Render line content
		if isCursorLine && m.col <= len(line) {
			// Render text before cursor
			if m.col > 0 {
				beforeCursor := line[:m.col]
				s.WriteString(style.Render(beforeCursor))
			}
			
			// Render cursor
			if m.col < len(line) {
				m.virtualCursor.SetChar(string(line[m.col]))
				s.WriteString(style.Render(m.virtualCursor.View()))
				// Render text after cursor
				if m.col+1 < len(line) {
					afterCursor := line[m.col+1:]
					s.WriteString(style.Render(afterCursor))
				}
			} else {
				// Cursor at end of line
				m.virtualCursor.SetChar(" ")
				s.WriteString(style.Render(m.virtualCursor.View()))
			}
		} else {
			// Regular line without cursor
			s.WriteString(style.Render(line))
		}

		// Add padding
		lineWidth := uniseg.StringWidth(line)
		padding := m.width - lineWidth
		if padding > 0 {
			s.WriteString(style.Render(strings.Repeat(" ", padding)))
		}

		// Add newline except for the last line
		if lineNum < len(lines)-1 {
			s.WriteRune('\n')
		}
	}

	return styles.Base.Render(s.String())
}

// promptView renders a single line of the prompt.
func (m *RopeModel) promptView(displayLine int) string {
	prompt := m.Prompt
	if m.promptFunc != nil {
		prompt = m.promptFunc(displayLine)
		width := lipgloss.Width(prompt)
		if width < m.promptWidth {
			prompt = fmt.Sprintf("%*s%s", m.promptWidth-width, "", prompt)
		}
	}
	return prompt
}

// lineNumberView renders the line number.
func (m *RopeModel) lineNumberView(n int, isCursorLine bool) string {
	if !m.ShowLineNumbers {
		return ""
	}

	str := strconv.Itoa(n)
	textStyle := m.activeStyle().computedText()
	lineNumberStyle := m.activeStyle().computedLineNumber()
	if isCursorLine {
		textStyle = m.activeStyle().computedCursorLine()
		lineNumberStyle = m.activeStyle().computedCursorLineNumber()
	}

	digits := len(strconv.Itoa(m.MaxHeight))
	str = fmt.Sprintf(" %*v ", digits, str)

	return textStyle.Render(lineNumberStyle.Render(str))
}

// placeholderView returns the prompt and placeholder, if any.
func (m *RopeModel) placeholderView() string {
	var (
		s      strings.Builder
		p      = m.Placeholder
		styles = m.activeStyle()
	)

	// Word wrap placeholder
	pwordwrap := ansi.Wordwrap(p, m.width, "")
	pwrap := ansi.Hardwrap(pwordwrap, m.width, true)
	plines := strings.Split(strings.TrimSpace(pwrap), "\n")

	maxLines := max(len(plines), 1)
	for i := range maxLines {
		lineStyle := styles.computedPlaceholder()
		if len(plines) > i {
			lineStyle = styles.computedCursorLine()
		}

		// Render prompt
		prompt := m.promptView(i)
		prompt = styles.computedPrompt().Render(prompt)
		s.WriteString(lineStyle.Render(prompt))

		// Render line numbers
		if m.ShowLineNumbers {
			var ln int
			if i == 0 {
				ln = i + 1
			}
			if len(plines) > i {
				s.WriteString(m.lineNumberView(ln, i == 0))
			}
		}

		switch {
		case i == 0 && len(plines) > 0:
			// First line with cursor
			m.virtualCursor.TextStyle = styles.computedPlaceholder()
			if len(plines[0]) > 0 {
				m.virtualCursor.SetChar(string(plines[0][0]))
				s.WriteString(lineStyle.Render(m.virtualCursor.View()))
				
				placeholderTail := ""
				if len(plines[0]) > 1 {
					placeholderTail = plines[0][1:]
				}
				gap := strings.Repeat(" ", max(0, m.width-uniseg.StringWidth(plines[0])))
				renderedPlaceholder := styles.computedPlaceholder().Render(placeholderTail + gap)
				s.WriteString(lineStyle.Render(renderedPlaceholder))
			}
		case len(plines) > i:
			placeholderLine := plines[i]
			gap := strings.Repeat(" ", max(0, m.width-uniseg.StringWidth(plines[i])))
			s.WriteString(lineStyle.Render(placeholderLine + gap))
		default:
			eob := styles.computedEndOfBuffer().Render(string(m.EndOfBufferCharacter))
			s.WriteString(eob)
		}

		if i < maxLines-1 {
			s.WriteRune('\n')
		}
	}

	return styles.Base.Render(s.String())
}