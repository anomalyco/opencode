package textarea

import (
	"crypto/sha256"
	"fmt"
	"image/color"
	"strconv"
	"strings"
	"time"
	"unicode"

	"slices"

	"github.com/charmbracelet/bubbles/v2/cursor"
	"github.com/charmbracelet/bubbles/v2/key"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
	rw "github.com/mattn/go-runewidth"
	"github.com/rivo/uniseg"
	"github.com/sst/opencode/internal/attachment"
)

const (
	minHeight        = 1
	defaultHeight    = 1
	defaultWidth     = 40
	defaultCharLimit = 0 // no limit
	defaultMaxHeight = 99
	defaultMaxWidth  = 500

	// XXX: in v2, make max lines dynamic and default max lines configurable.
	maxLines = 10000
)

// Helper functions for converting between runes and any slices

// runesToInterfaces converts a slice of runes to a slice of interfaces
func runesToInterfaces(runes []rune) []any {
	result := make([]any, len(runes))
	for i, r := range runes {
		result[i] = r
	}
	return result
}

// interfacesToRunes converts a slice of interfaces to a slice of runes (for display purposes)
func interfacesToRunes(items []any) []rune {
	var result []rune
	for _, item := range items {
		switch val := item.(type) {
		case rune:
			result = append(result, val)
		case *attachment.Attachment:
			result = append(result, []rune(val.Display)...)
		}
	}
	return result
}

// copyInterfaceSlice creates a copy of an any slice
func copyInterfaceSlice(src []any) []any {
	dst := make([]any, len(src))
	copy(dst, src)
	return dst
}

// interfacesToString converts a slice of interfaces to a string for display
func interfacesToString(items []any) string {
	var s strings.Builder
	for _, item := range items {
		switch val := item.(type) {
		case rune:
			s.WriteRune(val)
		case *attachment.Attachment:
			s.WriteString(val.Display)
		}
	}
	return s.String()
}

// isAttachmentAtCursor checks if the cursor is positioned on or immediately after an attachment.
// This allows for proper highlighting even when the cursor is technically at the position
// after the attachment object in the underlying slice.
func (m Model) isAttachmentAtCursor() (*attachment.Attachment, int, int) {
	if m.row >= len(m.value) {
		return nil, -1, -1
	}

	row := m.value[m.row]
	col := m.col

	if col < 0 || col > len(row) {
		return nil, -1, -1
	}

	// Check if the cursor is at the same index as an attachment.
	if col < len(row) {
		if att, ok := row[col].(*attachment.Attachment); ok {
			return att, col, col
		}
	}

	// Check if the cursor is immediately after an attachment. This is a common
	// state, for example, after just inserting one.
	if col > 0 && col <= len(row) {
		if att, ok := row[col-1].(*attachment.Attachment); ok {
			return att, col - 1, col - 1
		}
	}

	return nil, -1, -1
}

// renderLineWithAttachments renders a line with proper attachment highlighting
func (m Model) renderLineWithAttachments(
	items []any,
	style lipgloss.Style,
) string {
	var s strings.Builder
	currentAttachment, _, _ := m.isAttachmentAtCursor()

	for _, item := range items {
		switch val := item.(type) {
		case rune:
			s.WriteString(style.Render(string(val)))
		case *attachment.Attachment:
			// Check if this is the attachment the cursor is currently on
			if currentAttachment != nil && currentAttachment.ID == val.ID {
				// Cursor is on this attachment, highlight it
				s.WriteString(m.Styles.SelectedAttachment.Render(val.Display))
			} else {
				s.WriteString(m.Styles.Attachment.Render(val.Display))
			}
		}
	}
	return s.String()
}

// getRuneAt safely gets a rune at a specific position, returns 0 if not a rune
func getRuneAt(items []any, index int) rune {
	if index < 0 || index >= len(items) {
		return 0
	}
	if r, ok := items[index].(rune); ok {
		return r
	}
	return 0
}

// isSpaceAt checks if the item at index is a space rune
func isSpaceAt(items []any, index int) bool {
	r := getRuneAt(items, index)
	return r != 0 && unicode.IsSpace(r)
}

// setRuneAt safely sets a rune at a specific position if it's a rune
func setRuneAt(items []any, index int, r rune) {
	if index >= 0 && index < len(items) {
		if _, ok := items[index].(rune); ok {
			items[index] = r
		}
	}
}

// Internal messages for clipboard operations.
type (
	pasteMsg    string
	pasteErrMsg struct{ error }
)

// KeyMap is the key bindings for different actions within the textarea.
type KeyMap struct {
	CharacterBackward       key.Binding
	CharacterForward        key.Binding
	DeleteAfterCursor       key.Binding
	DeleteBeforeCursor      key.Binding
	DeleteCharacterBackward key.Binding
	DeleteCharacterForward  key.Binding
	DeleteWordBackward      key.Binding
	DeleteWordForward       key.Binding
	InsertNewline           key.Binding
	LineEnd                 key.Binding
	LineNext                key.Binding
	LinePrevious            key.Binding
	LineStart               key.Binding
	Paste                   key.Binding
	WordBackward            key.Binding
	WordForward             key.Binding
	InputBegin              key.Binding
	InputEnd                key.Binding

	UppercaseWordForward  key.Binding
	LowercaseWordForward  key.Binding
	CapitalizeWordForward key.Binding

	TransposeCharacterBackward key.Binding
}

// DefaultKeyMap returns the default set of key bindings for navigating and acting
// upon the textarea.
func DefaultKeyMap() KeyMap {
	return KeyMap{
		CharacterForward: key.NewBinding(
			key.WithKeys("right", "ctrl+f"),
			key.WithHelp("right", "character forward"),
		),
		CharacterBackward: key.NewBinding(
			key.WithKeys("left", "ctrl+b"),
			key.WithHelp("left", "character backward"),
		),
		WordForward: key.NewBinding(
			key.WithKeys("alt+right", "ctrl+right", "alt+f"),
			key.WithHelp("alt+right", "word forward"),
		),
		WordBackward: key.NewBinding(
			key.WithKeys("alt+left", "ctrl+left", "alt+b"),
			key.WithHelp("alt+left", "word backward"),
		),
		LineNext: key.NewBinding(
			key.WithKeys("down", "ctrl+n"),
			key.WithHelp("down", "next line"),
		),
		LinePrevious: key.NewBinding(
			key.WithKeys("up", "ctrl+p"),
			key.WithHelp("up", "previous line"),
		),
		DeleteWordBackward: key.NewBinding(
			key.WithKeys("alt+backspace", "ctrl+w"),
			key.WithHelp("alt+backspace", "delete word backward"),
		),
		DeleteWordForward: key.NewBinding(
			key.WithKeys("alt+delete", "alt+d"),
			key.WithHelp("alt+delete", "delete word forward"),
		),
		DeleteAfterCursor: key.NewBinding(
			key.WithKeys("ctrl+k"),
			key.WithHelp("ctrl+k", "delete after cursor"),
		),
		DeleteBeforeCursor: key.NewBinding(
			key.WithKeys("ctrl+u"),
			key.WithHelp("ctrl+u", "delete before cursor"),
		),
		InsertNewline: key.NewBinding(
			key.WithKeys("enter", "ctrl+m"),
			key.WithHelp("enter", "insert newline"),
		),
		DeleteCharacterBackward: key.NewBinding(
			key.WithKeys("backspace", "ctrl+h"),
			key.WithHelp("backspace", "delete character backward"),
		),
		DeleteCharacterForward: key.NewBinding(
			key.WithKeys("delete", "ctrl+d"),
			key.WithHelp("delete", "delete character forward"),
		),
		LineStart: key.NewBinding(
			key.WithKeys("home", "ctrl+a"),
			key.WithHelp("home", "line start"),
		),
		LineEnd: key.NewBinding(
			key.WithKeys("end", "ctrl+e"),
			key.WithHelp("end", "line end"),
		),
		Paste: key.NewBinding(
			key.WithKeys("ctrl+v"),
			key.WithHelp("ctrl+v", "paste"),
		),
		InputBegin: key.NewBinding(
			key.WithKeys("alt+<", "ctrl+home"),
			key.WithHelp("alt+<", "input begin"),
		),
		InputEnd: key.NewBinding(
			key.WithKeys("alt+>", "ctrl+end"),
			key.WithHelp("alt+>", "input end"),
		),

		CapitalizeWordForward: key.NewBinding(
			key.WithKeys("alt+c"),
			key.WithHelp("alt+c", "capitalize word forward"),
		),
		LowercaseWordForward: key.NewBinding(
			key.WithKeys("alt+l"),
			key.WithHelp("alt+l", "lowercase word forward"),
		),
		UppercaseWordForward: key.NewBinding(
			key.WithKeys("alt+u"),
			key.WithHelp("alt+u", "uppercase word forward"),
		),

		TransposeCharacterBackward: key.NewBinding(
			key.WithKeys("ctrl+t"),
			key.WithHelp("ctrl+t", "transpose character backward"),
		),
	}
}

// LineInfo is a helper for keeping track of line information regarding
// soft-wrapped lines.
type LineInfo struct {
	// Width is the number of columns in the line.
	Width int

	// CharWidth is the number of characters in the line to account for
	// double-width runes.
	CharWidth int

	// Height is the number of rows in the line.
	Height int

	// StartColumn is the index of the first column of the line.
	StartColumn int

	// ColumnOffset is the number of columns that the cursor is offset from the
	// start of the line.
	ColumnOffset int

	// RowOffset is the number of rows that the cursor is offset from the start
	// of the line.
	RowOffset int

	// CharOffset is the number of characters that the cursor is offset
	// from the start of the line. This will generally be equivalent to
	// ColumnOffset, but will be different there are double-width runes before
	// the cursor.
	CharOffset int
}

// CursorStyle is the style for real and virtual cursors.
type CursorStyle struct {
	// Style styles the cursor block.
	//
	// For real cursors, the foreground color set here will be used as the
	// cursor color.
	Color color.Color

	// Shape is the cursor shape. The following shapes are available:
	//
	// - tea.CursorBlock
	// - tea.CursorUnderline
	// - tea.CursorBar
	//
	// This is only used for real cursors.
	Shape tea.CursorShape

	// CursorBlink determines whether or not the cursor should blink.
	Blink bool

	// BlinkSpeed is the speed at which the virtual cursor blinks. This has no
	// effect on real cursors as well as no effect if the cursor is set not to
	// [CursorBlink].
	//
	// By default, the blink speed is set to about 500ms.
	BlinkSpeed time.Duration
}

// Styles are the styles for the textarea, separated into focused and blurred
// states. The appropriate styles will be chosen based on the focus state of
// the textarea.
type Styles struct {
	Focused            StyleState
	Blurred            StyleState
	Cursor             CursorStyle
	Attachment         lipgloss.Style
	SelectedAttachment lipgloss.Style
}

// StyleState that will be applied to the text area.
//
// StyleState can be applied to focused and unfocused states to change the styles
// depending on the focus state.
//
// For an introduction to styling with Lip Gloss see:
// https://github.com/charmbracelet/lipgloss
type StyleState struct {
	Base             lipgloss.Style
	Text             lipgloss.Style
	LineNumber       lipgloss.Style
	CursorLineNumber lipgloss.Style
	CursorLine       lipgloss.Style
	EndOfBuffer      lipgloss.Style
	Placeholder      lipgloss.Style
	Prompt           lipgloss.Style
}

func (s StyleState) computedCursorLine() lipgloss.Style {
	return s.CursorLine.Inherit(s.Base).Inline(true)
}

func (s StyleState) computedCursorLineNumber() lipgloss.Style {
	return s.CursorLineNumber.
		Inherit(s.CursorLine).
		Inherit(s.Base).
		Inline(true)
}

func (s StyleState) computedEndOfBuffer() lipgloss.Style {
	return s.EndOfBuffer.Inherit(s.Base).Inline(true)
}

func (s StyleState) computedLineNumber() lipgloss.Style {
	return s.LineNumber.Inherit(s.Base).Inline(true)
}

func (s StyleState) computedPlaceholder() lipgloss.Style {
	return s.Placeholder.Inherit(s.Base).Inline(true)
}

func (s StyleState) computedPrompt() lipgloss.Style {
	return s.Prompt.Inherit(s.Base).Inline(true)
}

func (s StyleState) computedText() lipgloss.Style {
	return s.Text.Inherit(s.Base).Inline(true)
}

// line is the input to the text wrapping function. This is stored in a struct
// so that it can be hashed and memoized.
type line struct {
	content []any // Contains runes and *Attachment
	width   int
}

// Hash returns a hash of the line.
func (w line) Hash() string {
	var s strings.Builder
	for _, item := range w.content {
		switch v := item.(type) {
		case rune:
			s.WriteRune(v)
		case *attachment.Attachment:
			s.WriteString(v.ID)
		}
	}
	v := fmt.Sprintf("%s:%d", s.String(), w.width)
	return fmt.Sprintf("%x", sha256.Sum256([]byte(v)))
}

// Model is the Bubble Tea model for this text area element.
type Model struct {
	Err error

	// General settings.
	cache *MemoCache[line, [][]any]

	// Prompt is printed at the beginning of each line.
	//
	// When changing the value of Prompt after the model has been
	// initialized, ensure that SetWidth() gets called afterwards.
	//
	// See also [SetPromptFunc] for a dynamic prompt.
	Prompt string

	// Placeholder is the text displayed when the user
	// hasn't entered anything yet.
	Placeholder string

	// ShowLineNumbers, if enabled, causes line numbers to be printed
	// after the prompt.
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

	// VirtualCursor determines whether or not to use the virtual cursor. If
	// set to false, use [Model.Cursor] to return a real cursor for rendering.
	VirtualCursor bool

	// CharLimit is the maximum number of characters this input element will
	// accept. If 0 or less, there's no limit.
	CharLimit int

	// MaxHeight is the maximum height of the text area in rows. If 0 or less,
	// there's no limit.
	MaxHeight int

	// MaxWidth is the maximum width of the text area in columns. If 0 or less,
	// there's no limit.
	MaxWidth int

	// If promptFunc is set, it replaces Prompt as a generator for
	// prompt strings at the beginning of each line.
	promptFunc func(line int) string

	// promptWidth is the width of the prompt.
	promptWidth int

	// width is the maximum number of characters that can be displayed at once.
	// If 0 or less this setting is ignored.
	width int

	// height is the maximum number of lines that can be displayed at once. It
	// essentially treats the text field like a vertically scrolling viewport
	// if there are more lines than the permitted height.
	height int

	// Underlying text value. Contains either rune or *Attachment types.
	value [][]any

	// focus indicates whether user input focus should be on this input
	// component. When false, ignore keyboard input and hide the cursor.
	focus bool

	// Cursor column (slice index).
	col int

	// Cursor row.
	row int

	// Last character offset, used to maintain state when the cursor is moved
	// vertically such that we can maintain the same navigating position.
	lastCharOffset int

	// rune sanitizer for input.
	rsan Sanitizer
}

// New creates a new model with default settings.
func New() Model {
	cur := cursor.New()

	styles := DefaultDarkStyles()

	m := Model{
		CharLimit:            defaultCharLimit,
		MaxHeight:            defaultMaxHeight,
		MaxWidth:             defaultMaxWidth,
		Prompt:               lipgloss.ThickBorder().Left + " ",
		Styles:               styles,
		cache:                NewMemoCache[line, [][]any](maxLines),
		EndOfBufferCharacter: ' ',
		ShowLineNumbers:      true,
		VirtualCursor:        true,
		virtualCursor:        cur,
		KeyMap:               DefaultKeyMap(),

		value: make([][]any, minHeight, maxLines),
		focus: false,
		col:   0,
		row:   0,
	}

	m.SetWidth(defaultWidth)
	m.SetHeight(defaultHeight)

	return m
}

// DefaultStyles returns the default styles for focused and blurred states for
// the textarea.
func DefaultStyles(isDark bool) Styles {
	lightDark := lipgloss.LightDark(isDark)

	var s Styles
	s.Focused = StyleState{
		Base: lipgloss.NewStyle(),
		CursorLine: lipgloss.NewStyle().
			Background(lightDark(lipgloss.Color("255"), lipgloss.Color("0"))),
		CursorLineNumber: lipgloss.NewStyle().
			Foreground(lightDark(lipgloss.Color("240"), lipgloss.Color("240"))),
		EndOfBuffer: lipgloss.NewStyle().
			Foreground(lightDark(lipgloss.Color("254"), lipgloss.Color("0"))),
		LineNumber: lipgloss.NewStyle().
			Foreground(lightDark(lipgloss.Color("249"), lipgloss.Color("7"))),
		Placeholder: lipgloss.NewStyle().Foreground(lipgloss.Color("240")),
		Prompt:      lipgloss.NewStyle().Foreground(lipgloss.Color("7")),
		Text:        lipgloss.NewStyle(),
	}
	s.Blurred = StyleState{
		Base: lipgloss.NewStyle(),
		CursorLine: lipgloss.NewStyle().
			Foreground(lightDark(lipgloss.Color("245"), lipgloss.Color("7"))),
		CursorLineNumber: lipgloss.NewStyle().
			Foreground(lightDark(lipgloss.Color("249"), lipgloss.Color("7"))),
		EndOfBuffer: lipgloss.NewStyle().
			Foreground(lightDark(lipgloss.Color("254"), lipgloss.Color("0"))),
		LineNumber: lipgloss.NewStyle().
			Foreground(lightDark(lipgloss.Color("249"), lipgloss.Color("7"))),
		Placeholder: lipgloss.NewStyle().Foreground(lipgloss.Color("240")),
		Prompt:      lipgloss.NewStyle().Foreground(lipgloss.Color("7")),
		Text: lipgloss.NewStyle().
			Foreground(lightDark(lipgloss.Color("245"), lipgloss.Color("7"))),
	}
	s.Attachment = lipgloss.NewStyle().
		Background(lipgloss.Color("11")).
		Foreground(lipgloss.Color("0"))
	s.SelectedAttachment = lipgloss.NewStyle().
		Background(lipgloss.Color("11")).
		Foreground(lipgloss.Color("0"))
	s.Cursor = CursorStyle{
		Color: lipgloss.Color("7"),
		Shape: tea.CursorBlock,
		Blink: true,
	}
	return s
}

// DefaultLightStyles returns the default styles for a light background.
func DefaultLightStyles() Styles {
	return DefaultStyles(false)
}

// DefaultDarkStyles returns the default styles for a dark background.
func DefaultDarkStyles() Styles {
	return DefaultStyles(true)
}

// updateVirtualCursorStyle sets styling on the virtual cursor based on the
// textarea's style settings.
func (m *Model) updateVirtualCursorStyle() {
	if !m.VirtualCursor {
		m.virtualCursor.SetMode(cursor.CursorHide)
		return
	}

	m.virtualCursor.Style = lipgloss.NewStyle().Foreground(m.Styles.Cursor.Color)

	// By default, the blink speed of the cursor is set to a default
	// internally.
	if m.Styles.Cursor.Blink {
		if m.Styles.Cursor.BlinkSpeed > 0 {
			m.virtualCursor.BlinkSpeed = m.Styles.Cursor.BlinkSpeed
		}
		m.virtualCursor.SetMode(cursor.CursorBlink)
		return
	}
	m.virtualCursor.SetMode(cursor.CursorStatic)
}

// SetValue sets the value of the text input.
func (m *Model) SetValue(s string) {
	m.Reset()
	m.InsertString(s)
}

// InsertString inserts a string at the cursor position.
func (m *Model) InsertString(s string) {
	m.InsertRunesFromUserInput([]rune(s))
}

// InsertRune inserts a rune at the cursor position.
func (m *Model) InsertRune(r rune) {
	m.InsertRunesFromUserInput([]rune{r})
}

// InsertAttachment inserts an attachment at the cursor position.
func (m *Model) InsertAttachment(att *attachment.Attachment) {
	if m.CharLimit > 0 {
		availSpace := m.CharLimit - m.Length()
		// If the char limit's been reached, cancel.
		if availSpace <= 0 {
			return
		}
	}

	// Insert the attachment at the current cursor position
	m.value[m.row] = append(
		m.value[m.row][:m.col],
		append([]any{att}, m.value[m.row][m.col:]...)...)
	m.col++
	m.SetCursorColumn(m.col)
}

// removeAttachmentAtCursor replaces the attachment at or immediately before the
// cursor with its textual display and positions the cursor at the end of the
// inserted text. Returns true if an attachment was removed.
func (m *Model) removeAttachmentAtCursor() bool {
	att, startIdx, _ := m.isAttachmentAtCursor()
	if att == nil {
		return false
	}
	// Replace the attachment element with the display runes
	before := m.value[m.row][:startIdx]
	after := m.value[m.row][startIdx+1:]
	replacement := runesToInterfaces([]rune(att.Display))
	newRow := make([]any, 0, len(before)+len(replacement)+len(after))
	newRow = append(newRow, before...)
	newRow = append(newRow, replacement...)
	newRow = append(newRow, after...)
	m.value[m.row] = newRow
	m.col = startIdx + len(replacement)
	m.SetCursorColumn(m.col)
	return true
}

// ReplaceRange replaces text from startCol to endCol on the current row with the given string.
// This preserves attachments outside the replaced range.
func (m *Model) ReplaceRange(startCol, endCol int, replacement string) {
	if m.row >= len(m.value) || startCol < 0 || endCol < startCol {
		return
	}

	// Ensure bounds are within the current row
	rowLen := len(m.value[m.row])
	startCol = max(0, min(startCol, rowLen))
	endCol = max(startCol, min(endCol, rowLen))

	// Create new row content: before + replacement + after
	before := m.value[m.row][:startCol]
	after := m.value[m.row][endCol:]
	replacementRunes := runesToInterfaces([]rune(replacement))

	// Combine the parts
	newRow := make([]any, 0, len(before)+len(replacementRunes)+len(after))
	newRow = append(newRow, before...)
	newRow = append(newRow, replacementRunes...)
	newRow = append(newRow, after...)

	m.value[m.row] = newRow

	// Position cursor at end of replacement
	m.col = startCol + len(replacementRunes)
	m.SetCursorColumn(m.col)
}

// CurrentRowLength returns the length of the current row.
func (m *Model) CurrentRowLength() int {
	if m.row >= len(m.value) {
		return 0
	}
	return len(m.value[m.row])
}

// GetAttachments returns all attachments in the textarea with accurate position indices.
func (m Model) GetAttachments() []*attachment.Attachment {
	var attachments []*attachment.Attachment
	position := 0 // Track absolute position in the text

	for rowIdx, row := range m.value {
		colPosition := 0 // Track position within the current row

		for _, item := range row {
			switch v := item.(type) {
			case *attachment.Attachment:
				// Clone the attachment to avoid modifying the original
				att := *v
				att.StartIndex = position + colPosition
				att.EndIndex = position + colPosition + len(v.Display)
				attachments = append(attachments, &att)
				colPosition += len(v.Display)
			case rune:
				colPosition++
			}
		}

		// Add newline character position (except for last row)
		if rowIdx < len(m.value)-1 {
			position += colPosition + 1 // +1 for newline
		} else {
			position += colPosition
		}
	}

	return attachments
}

// InsertRunesFromUserInput inserts runes at the current cursor position.
func (m *Model) InsertRunesFromUserInput(runes []rune) {
	// Clean up any special characters in the input provided by the
	// clipboard. This avoids bugs due to e.g. tab characters and
	// whatnot.
	runes = m.san().Sanitize(runes)

	if m.CharLimit > 0 {
		availSpace := m.CharLimit - m.Length()
		// If the char limit's been reached, cancel.
		if availSpace <= 0 {
			return
		}
		// If there's not enough space to paste the whole thing cut the pasted
		// runes down so they'll fit.
		if availSpace < len(runes) {
			runes = runes[:availSpace]
		}
	}

	// Split the input into lines.
	var lines [][]rune
	lstart := 0
	for i := range runes {
		if runes[i] == '\n' {
			// Queue a line to become a new row in the text area below.
			// Beware to clamp the max capacity of the slice, to ensure no
			// data from different rows get overwritten when later edits
			// will modify this line.
			lines = append(lines, runes[lstart:i:i])
			lstart = i + 1
		}
	}
	if lstart <= len(runes) {
		// The last line did not end with a newline character.
		// Take it now.
		lines = append(lines, runes[lstart:])
	}

	// Obey the maximum line limit.
	if maxLines > 0 && len(m.value)+len(lines)-1 > maxLines {
		allowedHeight := max(0, maxLines-len(m.value)+1)
		lines = lines[:allowedHeight]
	}

	if len(lines) == 0 {
		// Nothing left to insert.
		return
	}

	// Save the remainder of the original line at the current
	// cursor position.
	tail := copyInterfaceSlice(m.value[m.row][m.col:])

	// Paste the first line at the current cursor position.
	m.value[m.row] = append(m.value[m.row][:m.col], runesToInterfaces(lines[0])...)
	m.col += len(lines[0])

	if numExtraLines := len(lines) - 1; numExtraLines > 0 {
		// Add the new lines.
		// We try to reuse the slice if there's already space.
		var newGrid [][]any
		if cap(m.value) >= len(m.value)+numExtraLines {
			// Can reuse the extra space.
			newGrid = m.value[:len(m.value)+numExtraLines]
		} else {
			// No space left; need a new slice.
			newGrid = make([][]any, len(m.value)+numExtraLines)
			copy(newGrid, m.value[:m.row+1])
		}
		// Add all the rows that were after the cursor in the original
		// grid at the end of the new grid.
		copy(newGrid[m.row+1+numExtraLines:], m.value[m.row+1:])
		m.value = newGrid
		// Insert all the new lines in the middle.
		for _, l := range lines[1:] {
			m.row++
			m.value[m.row] = runesToInterfaces(l)
			m.col = len(l)
		}
	}

	// Finally add the tail at the end of the last line inserted.
	m.value[m.row] = append(m.value[m.row], tail...)

	m.SetCursorColumn(m.col)
}

// Value returns the value of the text input.
func (m Model) Value() string {
	if m.value == nil {
		return ""
	}

	var v strings.Builder
	for _, l := range m.value {
		for _, item := range l {
			switch val := item.(type) {
			case rune:
				v.WriteRune(val)
			case *attachment.Attachment:
				v.WriteString(val.Display)
			}
		}
		v.WriteByte('\n')
	}

	return strings.TrimSuffix(v.String(), "\n")
}

// Length returns the number of characters currently in the text input.
func (m *Model) Length() int {
	var l int
	for _, row := range m.value {
		for _, item := range row {
			switch val := item.(type) {
			case rune:
				l += rw.RuneWidth(val)
			case *attachment.Attachment:
				l += uniseg.StringWidth(val.Display)
			}
		}
	}
	// We add len(m.value) to include the newline characters.
	return l + len(m.value) - 1
}

// LineCount returns the number of lines that are currently in the text input.
func (m *Model) LineCount() int {
	return m.ContentHeight()
}

// Line returns the line position.
func (m Model) Line() int {
	return m.row
}

// CursorColumn returns the cursor's column position (slice index).
func (m Model) CursorColumn() int {
	return m.col
}

// LastRuneIndex returns the index of the last occurrence of a rune on the current line,
// searching backwards from the current cursor position.
// Returns -1 if the rune is not found before the cursor.
func (m Model) LastRuneIndex(r rune) int {
	if m.row >= len(m.value) {
		return -1
	}
	// Iterate backwards from just before the cursor position
	for i := m.col - 1; i >= 0; i-- {
		if i < len(m.value[m.row]) {
			if item, ok := m.value[m.row][i].(rune); ok && item == r {
				return i
			}
		}
	}
	return -1
}

func (m *Model) Newline() {
	if m.MaxHeight > 0 && len(m.value) >= m.MaxHeight {
		return
	}
	m.col = clamp(m.col, 0, len(m.value[m.row]))
	m.splitLine(m.row, m.col)
}

// mapVisualOffsetToSliceIndex converts a visual column offset to a slice index.
// This is used to maintain the cursor's horizontal position when moving vertically.
func (m *Model) mapVisualOffsetToSliceIndex(row int, charOffset int) int {
	if row < 0 || row >= len(m.value) {
		return 0
	}

	offset := 0
	// Find the slice index that corresponds to the visual offset.
	for i, item := range m.value[row] {
		var itemWidth int
		switch v := item.(type) {
		case rune:
			itemWidth = rw.RuneWidth(v)
		case *attachment.Attachment:
			itemWidth = uniseg.StringWidth(v.Display)
		}

		// If the target offset falls within the current item, this is our index.
		if offset+itemWidth > charOffset {
			// Decide whether to stick with the previous index or move to the current
			// one based on which is closer to the target offset.
			if (charOffset - offset) > ((offset + itemWidth) - charOffset) {
				return i + 1
			}
			return i
		}
		offset += itemWidth
	}

	return len(m.value[row])
}

// CursorDown moves the cursor down by one line.
func (m *Model) CursorDown() {
	li := m.LineInfo()
	charOffset := max(m.lastCharOffset, li.CharOffset)
	m.lastCharOffset = charOffset

	if li.RowOffset+1 >= li.Height && m.row < len(m.value)-1 {
		// Move to the next model line
		m.row++

		// We want to land on the first wrapped line of the new model line.
		grid := m.memoizedWrap(m.value[m.row], m.width)
		targetLineContent := grid[0]

		// Find position within the first wrapped line.
		offset := 0
		colInLine := 0
		for i, item := range targetLineContent {
			var itemWidth int
			switch v := item.(type) {
			case rune:
				itemWidth = rw.RuneWidth(v)
			case *attachment.Attachment:
				itemWidth = uniseg.StringWidth(v.Display)
			}
			if offset+itemWidth > charOffset {
				// Decide whether to stick with the previous index or move to the current
				// one based on which is closer to the target offset.
				if (charOffset - offset) > ((offset + itemWidth) - charOffset) {
					colInLine = i + 1
				} else {
					colInLine = i
				}
				goto foundNextLine
			}
			offset += itemWidth
		}
		colInLine = len(targetLineContent)
	foundNextLine:
		m.col = colInLine // startCol is 0 for the first wrapped line
	} else if li.RowOffset+1 < li.Height {
		// Move to the next wrapped line within the same model line
		grid := m.memoizedWrap(m.value[m.row], m.width)
		targetLineContent := grid[li.RowOffset+1]

		startCol := 0
		for i := 0; i < li.RowOffset+1; i++ {
			startCol += len(grid[i])
		}

		// Find position within the target wrapped line.
		offset := 0
		colInLine := 0
		for i, item := range targetLineContent {
			var itemWidth int
			switch v := item.(type) {
			case rune:
				itemWidth = rw.RuneWidth(v)
			case *attachment.Attachment:
				itemWidth = uniseg.StringWidth(v.Display)
			}
			if offset+itemWidth > charOffset {
				// Decide whether to stick with the previous index or move to the current
				// one based on which is closer to the target offset.
				if (charOffset - offset) > ((offset + itemWidth) - charOffset) {
					colInLine = i + 1
				} else {
					colInLine = i
				}
				goto foundSameLine
			}
			offset += itemWidth
		}
		colInLine = len(targetLineContent)
	foundSameLine:
		m.col = startCol + colInLine
	}
	m.SetCursorColumn(m.col)
}

// CursorUp moves the cursor up by one line.
func (m *Model) CursorUp() {
	li := m.LineInfo()
	charOffset := max(m.lastCharOffset, li.CharOffset)
	m.lastCharOffset = charOffset

	if li.RowOffset <= 0 && m.row > 0 {
		// Move to the previous model line. We want to land on the last wrapped
		// line of the previous model line.
		m.row--
		grid := m.memoizedWrap(m.value[m.row], m.width)
		targetLineContent := grid[len(grid)-1]

		// Find start of last wrapped line.
		startCol := len(m.value[m.row]) - len(targetLineContent)

		// Find position within the last wrapped line.
		offset := 0
		colInLine := 0
		for i, item := range targetLineContent {
			var itemWidth int
			switch v := item.(type) {
			case rune:
				itemWidth = rw.RuneWidth(v)
			case *attachment.Attachment:
				itemWidth = uniseg.StringWidth(v.Display)
			}
			if offset+itemWidth > charOffset {
				// Decide whether to stick with the previous index or move to the current
				// one based on which is closer to the target offset.
				if (charOffset - offset) > ((offset + itemWidth) - charOffset) {
					colInLine = i + 1
				} else {
					colInLine = i
				}
				goto foundPrevLine
			}
			offset += itemWidth
		}
		colInLine = len(targetLineContent)
	foundPrevLine:
		m.col = startCol + colInLine
	} else if li.RowOffset > 0 {
		// Move to the previous wrapped line within the same model line.
		grid := m.memoizedWrap(m.value[m.row], m.width)
		targetLineContent := grid[li.RowOffset-1]

		startCol := 0
		for i := 0; i < li.RowOffset-1; i++ {
			startCol += len(grid[i])
		}

		// Find position within the target wrapped line.
		offset := 0
		colInLine := 0
		for i, item := range targetLineContent {
			var itemWidth int
			switch v := item.(type) {
			case rune:
				itemWidth = rw.RuneWidth(v)
			case *attachment.Attachment:
				itemWidth = uniseg.StringWidth(v.Display)
			}
			if offset+itemWidth > charOffset {
				// Decide whether to stick with the previous index or move to the current
				// one based on which is closer to the target offset.
				if (charOffset - offset) > ((offset + itemWidth) - charOffset) {
					colInLine = i + 1
				} else {
					colInLine = i
				}
				goto foundSameLine
			}
			offset += itemWidth
		}
		colInLine = len(targetLineContent)
	foundSameLine:
		m.col = startCol + colInLine
	}
	m.SetCursorColumn(m.col)
}

// SetCursorColumn moves the cursor to the given position. If the position is
// out of bounds the cursor will be moved to the start or end accordingly.
func (m *Model) SetCursorColumn(col int) {
	m.col = clamp(col, 0, len(m.value[m.row]))
	// Any time that we move the cursor horizontally we need to reset the last
	// offset so that the horizontal position when navigating is adjusted.
	m.lastCharOffset = 0
}

// CursorStart moves the cursor to the start of the input field.
func (m *Model) CursorStart() {
	m.SetCursorColumn(0)
}

// CursorEnd moves the cursor to the end of the input field.
func (m *Model) CursorEnd() {
	m.SetCursorColumn(len(m.value[m.row]))
}

func (m *Model) IsCursorAtEnd() bool {
	return m.CursorColumn() == len(m.value[m.row])
}

// Focused returns the focus state on the model.
func (m Model) Focused() bool {
	return m.focus
}

// activeStyle returns the appropriate set of styles to use depending on
// whether the textarea is focused or blurred.
func (m Model) activeStyle() *StyleState {
	if m.focus {
		return &m.Styles.Focused
	}
	return &m.Styles.Blurred
}

// Focus sets the focus state on the model. When the model is in focus it can
// receive keyboard input and the cursor will be hidden.
func (m *Model) Focus() tea.Cmd {
	m.focus = true
	return m.virtualCursor.Focus()
}

// Blur removes the focus state on the model. When the model is blurred it can
// not receive keyboard input and the cursor will be hidden.
func (m *Model) Blur() {
	m.focus = false
	m.virtualCursor.Blur()
}

// Reset sets the input to its default state with no input.
func (m *Model) Reset() {
	m.value = make([][]any, minHeight, maxLines)
	m.col = 0
	m.row = 0
	m.SetCursorColumn(0)
}

// san initializes or retrieves the rune sanitizer.
func (m *Model) san() Sanitizer {
	if m.rsan == nil {
		// Textinput has all its input on a single line so collapse
		// newlines/tabs to single spaces.
		m.rsan = NewSanitizer()
	}
	return m.rsan
}

// deleteBeforeCursor deletes all text before the cursor. Returns whether or
// not the cursor blink should be reset.
func (m *Model) deleteBeforeCursor() {
	m.value[m.row] = m.value[m.row][m.col:]
	m.SetCursorColumn(0)
}

// deleteAfterCursor deletes all text after the cursor. Returns whether or not
// the cursor blink should be reset. If input is masked delete everything after
// the cursor so as not to reveal word breaks in the masked input.
func (m *Model) deleteAfterCursor() {
	m.value[m.row] = m.value[m.row][:m.col]
	m.SetCursorColumn(len(m.value[m.row]))
}

// transposeLeft exchanges the runes at the cursor and immediately
// before. No-op if the cursor is at the beginning of the line.  If
// the cursor is not at the end of the line yet, moves the cursor to
// the right.
func (m *Model) transposeLeft() {
	if m.col == 0 || len(m.value[m.row]) < 2 {
		return
	}
	if m.col >= len(m.value[m.row]) {
		m.SetCursorColumn(m.col - 1)
	}
	m.value[m.row][m.col-1], m.value[m.row][m.col] = m.value[m.row][m.col], m.value[m.row][m.col-1]
	if m.col < len(m.value[m.row]) {
		m.SetCursorColumn(m.col + 1)
	}
}

// deleteWordLeft deletes the word left to the cursor. Returns whether or not
// the cursor blink should be reset.
func (m *Model) deleteWordLeft() {
	if m.col == 0 || len(m.value[m.row]) == 0 {
		return
	}

	// Linter note: it's critical that we acquire the initial cursor position
	// here prior to altering it via SetCursor() below. As such, moving this
	// call into the corresponding if clause does not apply here.
	oldCol := m.col //nolint:ifshort

	m.SetCursorColumn(m.col - 1)
	for isSpaceAt(m.value[m.row], m.col) {
		if m.col <= 0 {
			break
		}
		// ignore series of whitespace before cursor
		m.SetCursorColumn(m.col - 1)
	}

	for m.col > 0 {
		if !isSpaceAt(m.value[m.row], m.col) {
			m.SetCursorColumn(m.col - 1)
		} else {
			if m.col > 0 {
				// keep the previous space
				m.SetCursorColumn(m.col + 1)
			}
			break
		}
	}

	if oldCol > len(m.value[m.row]) {
		m.value[m.row] = m.value[m.row][:m.col]
	} else {
		m.value[m.row] = append(m.value[m.row][:m.col], m.value[m.row][oldCol:]...)
	}
}

// deleteWordRight deletes the word right to the cursor.
func (m *Model) deleteWordRight() {
	if m.col >= len(m.value[m.row]) || len(m.value[m.row]) == 0 {
		return
	}

	oldCol := m.col

	for m.col < len(m.value[m.row]) && isSpaceAt(m.value[m.row], m.col) {
		// ignore series of whitespace after cursor
		m.SetCursorColumn(m.col + 1)
	}

	for m.col < len(m.value[m.row]) {
		if !isSpaceAt(m.value[m.row], m.col) {
			m.SetCursorColumn(m.col + 1)
		} else {
			break
		}
	}

	if m.col > len(m.value[m.row]) {
		m.value[m.row] = m.value[m.row][:oldCol]
	} else {
		m.value[m.row] = append(m.value[m.row][:oldCol], m.value[m.row][m.col:]...)
	}

	m.SetCursorColumn(oldCol)
}

// characterRight moves the cursor one character to the right.
func (m *Model) characterRight() {
	if m.col < len(m.value[m.row]) {
		m.SetCursorColumn(m.col + 1)
	} else {
		if m.row < len(m.value)-1 {
			m.row++
			m.CursorStart()
		}
	}
}

// characterLeft moves the cursor one character to the left.
// If insideLine is set, the cursor is moved to the last
// character in the previous line, instead of one past that.
func (m *Model) characterLeft(insideLine bool) {
	if m.col == 0 && m.row != 0 {
		m.row--
		m.CursorEnd()
		if !insideLine {
			return
		}
	}
	if m.col > 0 {
		m.SetCursorColumn(m.col - 1)
	}
}

// wordLeft moves the cursor one word to the left. Returns whether or not the
// cursor blink should be reset. If input is masked, move input to the start
// so as not to reveal word breaks in the masked input.
func (m *Model) wordLeft() {
	for {
		m.characterLeft(true /* insideLine */)
		if m.col < len(m.value[m.row]) && !isSpaceAt(m.value[m.row], m.col) {
			break
		}
	}

	for m.col > 0 {
		if isSpaceAt(m.value[m.row], m.col-1) {
			break
		}
		m.SetCursorColumn(m.col - 1)
	}
}

// wordRight moves the cursor one word to the right. Returns whether or not the
// cursor blink should be reset. If the input is masked, move input to the end
// so as not to reveal word breaks in the masked input.
func (m *Model) wordRight() {
	m.doWordRight(func(int, int) { /* nothing */ })
}

func (m *Model) doWordRight(fn func(charIdx int, pos int)) {
	// Skip spaces forward.
	for m.col >= len(m.value[m.row]) || isSpaceAt(m.value[m.row], m.col) {
		if m.row == len(m.value)-1 && m.col == len(m.value[m.row]) {
			// End of text.
			break
		}
		m.characterRight()
	}

	charIdx := 0
	for m.col < len(m.value[m.row]) {
		if isSpaceAt(m.value[m.row], m.col) {
			break
		}
		fn(charIdx, m.col)
		m.SetCursorColumn(m.col + 1)
		charIdx++
	}
}

// uppercaseRight changes the word to the right to uppercase.
func (m *Model) uppercaseRight() {
	m.doWordRight(func(_ int, i int) {
		if r, ok := m.value[m.row][i].(rune); ok {
			m.value[m.row][i] = unicode.ToUpper(r)
		}
	})
}

// lowercaseRight changes the word to the right to lowercase.
func (m *Model) lowercaseRight() {
	m.doWordRight(func(_ int, i int) {
		if r, ok := m.value[m.row][i].(rune); ok {
			m.value[m.row][i] = unicode.ToLower(r)
		}
	})
}

// capitalizeRight changes the word to the right to title case.
func (m *Model) capitalizeRight() {
	m.doWordRight(func(charIdx int, i int) {
		if charIdx == 0 {
			if r, ok := m.value[m.row][i].(rune); ok {
				m.value[m.row][i] = unicode.ToTitle(r)
			}
		}
	})
}

// LineInfo returns the number of characters from the start of the
// (soft-wrapped) line and the (soft-wrapped) line width.
func (m Model) LineInfo() LineInfo {
	grid := m.memoizedWrap(m.value[m.row], m.width)

	// Find out which line we are currently on. This can be determined by the
	// m.col and counting the number of runes that we need to skip.
	var counter int
	for i, line := range grid {
		start := counter
		end := counter + len(line)

		if m.col >= start && m.col <= end {
			// This is the wrapped line the cursor is on.

			// Special case: if the cursor is at the end of a wrapped line,
			// and there's another wrapped line after it, the cursor should
			// be considered at the beginning of the next line.
			if m.col == end && i < len(grid)-1 {
				nextLine := grid[i+1]
				return LineInfo{
					CharOffset:   0,
					ColumnOffset: 0,
					Height:       len(grid),
					RowOffset:    i + 1,
					StartColumn:  end,
					Width:        len(nextLine),
					CharWidth:    uniseg.StringWidth(interfacesToString(nextLine)),
				}
			}

			return LineInfo{
				CharOffset:   uniseg.StringWidth(interfacesToString(line[:max(0, m.col-start)])),
				ColumnOffset: m.col - start,
				Height:       len(grid),
				RowOffset:    i,
				StartColumn:  start,
				Width:        len(line),
				CharWidth:    uniseg.StringWidth(interfacesToString(line)),
			}
		}
		counter = end
	}
	return LineInfo{}
}

// Width returns the width of the textarea.
func (m Model) Width() int {
	return m.width
}

// MoveToBegin moves the cursor to the beginning of the input.
func (m *Model) MoveToBegin() {
	m.row = 0
	m.SetCursorColumn(0)
}

// MoveToEnd moves the cursor to the end of the input.
func (m *Model) MoveToEnd() {
	m.row = len(m.value) - 1
	m.SetCursorColumn(len(m.value[m.row]))
}

// SetWidth sets the width of the textarea to fit exactly within the given width.
// This means that the textarea will account for the width of the prompt and
// whether or not line numbers are being shown.
//
// Ensure that SetWidth is called after setting the Prompt and ShowLineNumbers,
// It is important that the width of the textarea be exactly the given width
// and no more.
func (m *Model) SetWidth(w int) {
	// Update prompt width only if there is no prompt function as
	// [SetPromptFunc] updates the prompt width when it is called.
	if m.promptFunc == nil {
		// XXX: Do we even need this or can we calculate the prompt width
		// at render time?
		m.promptWidth = uniseg.StringWidth(m.Prompt)
	}

	// Add base style borders and padding to reserved outer width.
	reservedOuter := m.activeStyle().Base.GetHorizontalFrameSize()

	// Add prompt width to reserved inner width.
	reservedInner := m.promptWidth

	// Add line number width to reserved inner width.
	if m.ShowLineNumbers {
		// XXX: this was originally documented as needing "1 cell" but was,
		// in practice, effectively hardcoded to 2 cells. We can, and should,
		// reduce this to one gap and update the tests accordingly.
		const gap = 2

		// Number of digits plus 1 cell for the margin.
		reservedInner += numDigits(m.MaxHeight) + gap
	}

	// Input width must be at least one more than the reserved inner and outer
	// width. This gives us a minimum input width of 1.
	minWidth := reservedInner + reservedOuter + 1
	inputWidth := max(w, minWidth)

	// Input width must be no more than maximum width.
	if m.MaxWidth > 0 {
		inputWidth = min(inputWidth, m.MaxWidth)
	}

	// Since the width of the viewport and input area is dependent on the width of
	// borders, prompt and line numbers, we need to calculate it by subtracting
	// the reserved width from them.

	m.width = inputWidth - reservedOuter - reservedInner
}

// SetPromptFunc supersedes the Prompt field and sets a dynamic prompt instead.
//
// If the function returns a prompt that is shorter than the specified
// promptWidth, it will be padded to the left. If it returns a prompt that is
// longer, display artifacts may occur; the caller is responsible for computing
// an adequate promptWidth.
func (m *Model) SetPromptFunc(promptWidth int, fn func(lineIndex int) string) {
	m.promptFunc = fn
	m.promptWidth = promptWidth
}

// Height returns the current height of the textarea.
func (m Model) Height() int {
	return m.height
}

// ContentHeight returns the actual height needed to display all content
// including wrapped lines.
func (m Model) ContentHeight() int {
	totalLines := 0
	for _, line := range m.value {
		wrappedLines := m.memoizedWrap(line, m.width)
		totalLines += len(wrappedLines)
	}
	// Ensure at least one line is shown
	if totalLines == 0 {
		totalLines = 1
	}
	return totalLines
}

// SetHeight sets the height of the textarea.
func (m *Model) SetHeight(h int) {
	// Calculate the actual content height
	contentHeight := m.ContentHeight()

	// Use the content height as the actual height
	if m.MaxHeight > 0 {
		m.height = clamp(contentHeight, minHeight, m.MaxHeight)
	} else {
		m.height = max(contentHeight, minHeight)
	}
}

// Update is the Bubble Tea update loop.
func (m Model) Update(msg tea.Msg) (Model, tea.Cmd) {
	if !m.focus {
		m.virtualCursor.Blur()
		return m, nil
	}

	// Used to determine if the cursor should blink.
	oldRow, oldCol := m.cursorLineNumber(), m.col

	var cmds []tea.Cmd

	if m.row >= len(m.value) {
		m.value = append(m.value, make([]any, 0))
	}
	if m.value[m.row] == nil {
		m.value[m.row] = make([]any, 0)
	}

	if m.MaxHeight > 0 && m.MaxHeight != m.cache.Capacity() {
		m.cache = NewMemoCache[line, [][]any](m.MaxHeight)
	}

	switch msg := msg.(type) {
	case tea.KeyPressMsg:
		switch {
		case key.Matches(msg, m.KeyMap.DeleteAfterCursor):
			m.col = clamp(m.col, 0, len(m.value[m.row]))
			if m.col >= len(m.value[m.row]) {
				m.mergeLineBelow(m.row)
				break
			}
			m.deleteAfterCursor()
		case key.Matches(msg, m.KeyMap.DeleteBeforeCursor):
			m.col = clamp(m.col, 0, len(m.value[m.row]))
			if m.col <= 0 {
				m.mergeLineAbove(m.row)
				break
			}
			m.deleteBeforeCursor()
		case key.Matches(msg, m.KeyMap.DeleteCharacterBackward):
			// If the cursor is at or just after an attachment, convert it to text instead of deleting
			if att, _, _ := m.isAttachmentAtCursor(); att != nil {
				if m.removeAttachmentAtCursor() {
					break
				}
			}
			m.col = clamp(m.col, 0, len(m.value[m.row]))
			if m.col <= 0 {
				m.mergeLineAbove(m.row)
				break
			}
			if len(m.value[m.row]) > 0 && m.col > 0 {
				m.value[m.row] = slices.Delete(m.value[m.row], m.col-1, m.col)
				m.SetCursorColumn(m.col - 1)
			}
		case key.Matches(msg, m.KeyMap.DeleteCharacterForward):
			// If the cursor is on an attachment, convert it to text instead of deleting
			if att, _, _ := m.isAttachmentAtCursor(); att != nil {
				if m.removeAttachmentAtCursor() {
					break
				}
			}
			if len(m.value[m.row]) > 0 && m.col < len(m.value[m.row]) {
				m.value[m.row] = slices.Delete(m.value[m.row], m.col, m.col+1)
			}
			if m.col >= len(m.value[m.row]) {
				m.mergeLineBelow(m.row)
				break
			}
		case key.Matches(msg, m.KeyMap.DeleteWordBackward):
			if m.col <= 0 {
				m.mergeLineAbove(m.row)
				break
			}
			m.deleteWordLeft()
		case key.Matches(msg, m.KeyMap.DeleteWordForward):
			m.col = clamp(m.col, 0, len(m.value[m.row]))
			if m.col >= len(m.value[m.row]) {
				m.mergeLineBelow(m.row)
				break
			}
			m.deleteWordRight()
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
		case key.Matches(msg, m.KeyMap.WordForward):
			m.wordRight()
		case key.Matches(msg, m.KeyMap.CharacterBackward):
			m.characterLeft(false /* insideLine */)
		case key.Matches(msg, m.KeyMap.LinePrevious):
			m.CursorUp()
		case key.Matches(msg, m.KeyMap.WordBackward):
			m.wordLeft()
		case key.Matches(msg, m.KeyMap.InputBegin):
			m.MoveToBegin()
		case key.Matches(msg, m.KeyMap.InputEnd):
			m.MoveToEnd()
		case key.Matches(msg, m.KeyMap.LowercaseWordForward):
			m.lowercaseRight()
		case key.Matches(msg, m.KeyMap.UppercaseWordForward):
			m.uppercaseRight()
		case key.Matches(msg, m.KeyMap.CapitalizeWordForward):
			m.capitalizeRight()
		case key.Matches(msg, m.KeyMap.TransposeCharacterBackward):
			m.transposeLeft()

		default:
			m.InsertRunesFromUserInput([]rune(msg.Text))
		}

	case pasteMsg:
		m.InsertRunesFromUserInput([]rune(msg))

	case pasteErrMsg:
		m.Err = msg
	}

	var cmd tea.Cmd
	newRow, newCol := m.cursorLineNumber(), m.col
	m.virtualCursor, cmd = m.virtualCursor.Update(msg)
	if (newRow != oldRow || newCol != oldCol) && m.virtualCursor.Mode() == cursor.CursorBlink {
		m.virtualCursor.Blink = false
		cmd = m.virtualCursor.BlinkCmd()
	}
	cmds = append(cmds, cmd)

	return m, tea.Batch(cmds...)
}

// View renders the text area in its current state.
func (m Model) View() string {
	m.updateVirtualCursorStyle()
	if m.Value() == "" && m.row == 0 && m.col == 0 && m.Placeholder != "" {
		return m.placeholderView()
	}
	m.virtualCursor.TextStyle = m.activeStyle().computedCursorLine()

	var (
		s                strings.Builder
		style            lipgloss.Style
		newLines         int
		widestLineNumber int
		lineInfo         = m.LineInfo()
		styles           = m.activeStyle()
	)

	displayLine := 0
	for l, line := range m.value {
		wrappedLines := m.memoizedWrap(line, m.width)

		if m.row == l {
			style = styles.computedCursorLine()
		} else {
			style = styles.computedText()
		}

		for wl, wrappedLine := range wrappedLines {
			prompt := m.promptView(displayLine)
			prompt = styles.computedPrompt().Render(prompt)
			s.WriteString(style.Render(prompt))
			displayLine++

			var ln string
			if m.ShowLineNumbers {
				if wl == 0 { // normal line
					isCursorLine := m.row == l
					s.WriteString(m.lineNumberView(l+1, isCursorLine))
				} else { // soft wrapped line
					isCursorLine := m.row == l
					s.WriteString(m.lineNumberView(-1, isCursorLine))
				}
			}

			// Note the widest line number for padding purposes later.
			lnw := uniseg.StringWidth(ln)
			if lnw > widestLineNumber {
				widestLineNumber = lnw
			}

			wrappedLineStr := interfacesToString(wrappedLine)
			strwidth := uniseg.StringWidth(wrappedLineStr)
			padding := m.width - strwidth
			// If the trailing space causes the line to be wider than the
			// width, we should not draw it to the screen since it will result
			// in an extra space at the end of the line which can look off when
			// the cursor line is showing.
			if strwidth > m.width {
				// The character causing the line to be wider than the width is
				// guaranteed to be a space since any other character would
				// have been wrapped.
				wrappedLineStr = strings.TrimSuffix(wrappedLineStr, " ")
				padding = m.width - uniseg.StringWidth(wrappedLineStr)
			}

			if m.row == l && lineInfo.RowOffset == wl {
				// Render the part of the line before the cursor
				s.WriteString(
					m.renderLineWithAttachments(
						wrappedLine[:lineInfo.ColumnOffset],
						style,
					),
				)

				if m.col >= len(line) && lineInfo.CharOffset >= m.width {
					m.virtualCursor.SetChar(" ")
					s.WriteString(m.virtualCursor.View())
				} else if lineInfo.ColumnOffset < len(wrappedLine) {
					// Render the item under the cursor
					item := wrappedLine[lineInfo.ColumnOffset]
					if att, ok := item.(*attachment.Attachment); ok {
						// Item at cursor is an attachment. Render it with the selection style.
						// This becomes the "cursor" visually.
						s.WriteString(m.Styles.SelectedAttachment.Render(att.Display))
					} else {
						// Item at cursor is a rune. Render it with the virtual cursor.
						m.virtualCursor.SetChar(string(item.(rune)))
						s.WriteString(style.Render(m.virtualCursor.View()))
					}

					// Render the part of the line after the cursor
					s.WriteString(m.renderLineWithAttachments(wrappedLine[lineInfo.ColumnOffset+1:], style))
				} else {
					// Cursor is at the end of the line
					m.virtualCursor.SetChar(" ")
					s.WriteString(style.Render(m.virtualCursor.View()))
				}
			} else {
				s.WriteString(m.renderLineWithAttachments(wrappedLine, style))
			}

			s.WriteString(style.Render(strings.Repeat(" ", max(0, padding))))
			s.WriteRune('\n')
			newLines++
		}
	}

	// Remove the trailing newline from the last line
	result := s.String()
	if len(result) > 0 && result[len(result)-1] == '\n' {
		result = result[:len(result)-1]
	}

	return styles.Base.Render(result)
}

// promptView renders a single line of the prompt.
func (m Model) promptView(displayLine int) (prompt string) {
	prompt = m.Prompt
	if m.promptFunc == nil {
		return prompt
	}
	prompt = m.promptFunc(displayLine)
	width := lipgloss.Width(prompt)
	if width < m.promptWidth {
		prompt = fmt.Sprintf("%*s%s", m.promptWidth-width, "", prompt)
	}

	return m.activeStyle().computedPrompt().Render(prompt)
}

// lineNumberView renders the line number.
//
// If the argument is less than 0, a space styled as a line number is returned
// instead. Such cases are used for soft-wrapped lines.
//
// The second argument indicates whether this line number is for a 'cursorline'
// line number.
func (m Model) lineNumberView(n int, isCursorLine bool) (str string) {
	if !m.ShowLineNumbers {
		return ""
	}

	if n <= 0 {
		str = " "
	} else {
		str = strconv.Itoa(n)
	}

	// XXX: is textStyle really necessary here?
	textStyle := m.activeStyle().computedText()
	lineNumberStyle := m.activeStyle().computedLineNumber()
	if isCursorLine {
		textStyle = m.activeStyle().computedCursorLine()
		lineNumberStyle = m.activeStyle().computedCursorLineNumber()
	}

	// Format line number dynamically based on the maximum number of lines.
	digits := len(strconv.Itoa(m.MaxHeight))
	str = fmt.Sprintf(" %*v ", digits, str)

	return textStyle.Render(lineNumberStyle.Render(str))
}

// placeholderView returns the prompt and placeholder, if any.
func (m Model) placeholderView() string {
	var (
		s      strings.Builder
		p      = m.Placeholder
		styles = m.activeStyle()
	)
	// word wrap lines
	pwordwrap := ansi.Wordwrap(p, m.width, "")
	// hard wrap lines (handles lines that could not be word wrapped)
	pwrap := ansi.Hardwrap(pwordwrap, m.width, true)
	// split string by new lines
	plines := strings.Split(strings.TrimSpace(pwrap), "\n")

	// Only render the actual placeholder lines, not padded to m.height
	maxLines := max(len(plines), 1) // At least show one line for cursor
	for i := range maxLines {
		isLineNumber := len(plines) > i

		lineStyle := styles.computedPlaceholder()
		if len(plines) > i {
			lineStyle = styles.computedCursorLine()
		}

		// render prompt
		prompt := m.promptView(i)
		prompt = styles.computedPrompt().Render(prompt)
		s.WriteString(lineStyle.Render(prompt))

		// when show line numbers enabled:
		// - render line number for only the cursor line
		// - indent other placeholder lines
		// this is consistent with vim with line numbers enabled
		if m.ShowLineNumbers {
			var ln int

			switch {
			case i == 0:
				ln = i + 1
				fallthrough
			case len(plines) > i:
				s.WriteString(m.lineNumberView(ln, isLineNumber))
			default:
			}
		}

		switch {
		// first line
		case i == 0:
			// first character of first line as cursor with character
			m.virtualCursor.TextStyle = styles.computedPlaceholder()
			m.virtualCursor.SetChar(string(plines[0][0]))
			s.WriteString(lineStyle.Render(m.virtualCursor.View()))

			// the rest of the first line
			placeholderTail := plines[0][1:]
			gap := strings.Repeat(" ", max(0, m.width-uniseg.StringWidth(plines[0])))
			renderedPlaceholder := styles.computedPlaceholder().Render(placeholderTail + gap)
			s.WriteString(lineStyle.Render(renderedPlaceholder))
		// remaining lines
		case len(plines) > i:
			// current line placeholder text
			if len(plines) > i {
				placeholderLine := plines[i]
				gap := strings.Repeat(" ", max(0, m.width-uniseg.StringWidth(plines[i])))
				s.WriteString(lineStyle.Render(placeholderLine + gap))
			}
		default:
			// end of line buffer character
			eob := styles.computedEndOfBuffer().Render(string(m.EndOfBufferCharacter))
			s.WriteString(eob)
		}

		// terminate with new line (except for last line)
		if i < maxLines-1 {
			s.WriteRune('\n')
		}
	}

	return styles.Base.Render(s.String())
}

// Blink returns the blink command for the virtual cursor.
func Blink() tea.Msg {
	return cursor.Blink()
}

// Cursor returns a [tea.Cursor] for rendering a real cursor in a Bubble Tea
// program. This requires that [Model.VirtualCursor] is set to false.
//
// Note that you will almost certainly also need to adjust the offset cursor
// position per the textarea's per the textarea's position in the terminal.
//
// Example:
//
//	// In your top-level View function:
//	f := tea.NewFrame(m.textarea.View())
//	f.Cursor = m.textarea.Cursor()
//	f.Cursor.Position.X += offsetX
//	f.Cursor.Position.Y += offsetY
func (m Model) Cursor() *tea.Cursor {
	if m.VirtualCursor {
		return nil
	}

	lineInfo := m.LineInfo()
	w := lipgloss.Width
	baseStyle := m.activeStyle().Base

	xOffset := lineInfo.CharOffset +
		w(m.promptView(0)) +
		w(m.lineNumberView(0, false)) +
		baseStyle.GetMarginLeft() +
		baseStyle.GetPaddingLeft() +
		baseStyle.GetBorderLeftSize()

	yOffset := m.cursorLineNumber() -
		baseStyle.GetMarginTop() +
		baseStyle.GetPaddingTop() +
		baseStyle.GetBorderTopSize()

	c := tea.NewCursor(xOffset, yOffset)
	c.Blink = m.Styles.Cursor.Blink
	c.Color = m.Styles.Cursor.Color
	c.Shape = m.Styles.Cursor.Shape
	return c
}

func (m Model) memoizedWrap(content []any, width int) [][]any {
	input := line{content: content, width: width}
	if v, ok := m.cache.Get(input); ok {
		return v
	}
	v := wrapInterfaces(content, width)
	m.cache.Set(input, v)
	return v
}

// cursorLineNumber returns the line number that the cursor is on.
// This accounts for soft wrapped lines.
func (m Model) cursorLineNumber() int {
	line := 0
	for i := range m.row {
		// Calculate the number of lines that the current line will be split
		// into.
		line += len(m.memoizedWrap(m.value[i], m.width))
	}
	line += m.LineInfo().RowOffset
	return line
}

// mergeLineBelow merges the current line the cursor is on with the line below.
func (m *Model) mergeLineBelow(row int) {
	if row >= len(m.value)-1 {
		return
	}

	// To perform a merge, we will need to combine the two lines and then
	m.value[row] = append(m.value[row], m.value[row+1]...)

	// Shift all lines up by one
	for i := row + 1; i < len(m.value)-1; i++ {
		m.value[i] = m.value[i+1]
	}

	// And, remove the last line
	if len(m.value) > 0 {
		m.value = m.value[:len(m.value)-1]
	}
}

// mergeLineAbove merges the current line the cursor is on with the line above.
func (m *Model) mergeLineAbove(row int) {
	if row <= 0 {
		return
	}

	m.col = len(m.value[row-1])
	m.row = m.row - 1

	// To perform a merge, we will need to combine the two lines and then
	m.value[row-1] = append(m.value[row-1], m.value[row]...)

	// Shift all lines up by one
	for i := row; i < len(m.value)-1; i++ {
		m.value[i] = m.value[i+1]
	}

	// And, remove the last line
	if len(m.value) > 0 {
		m.value = m.value[:len(m.value)-1]
	}
}

func (m *Model) splitLine(row, col int) {
	// To perform a split, take the current line and keep the content before
	// the cursor, take the content after the cursor and make it the content of
	// the line underneath, and shift the remaining lines down by one
	head, tailSrc := m.value[row][:col], m.value[row][col:]
	tail := copyInterfaceSlice(tailSrc)

	m.value = append(m.value[:row+1], m.value[row:]...)

	m.value[row] = head
	m.value[row+1] = tail

	m.col = 0
	m.row++
}

func itemWidth(item any) int {
	switch v := item.(type) {
	case rune:
		return rw.RuneWidth(v)
	case *attachment.Attachment:
		return uniseg.StringWidth(v.Display)
	}
	return 0
}

// forceWrapAttachment splits an attachment's display text across multiple lines
func forceWrapAttachment(att *attachment.Attachment, width int) [][]any {
	if width <= 0 {
		return [][]any{{att}}
	}

	display := att.Display
	displayRunes := []rune(display)

	if len(displayRunes) <= width {
		return [][]any{{att}}
	}

	var lines [][]any
	start := 0

	for start < len(displayRunes) {
		// Calculate how many runes fit in this line
		end := start + width
		if end > len(displayRunes) {
			end = len(displayRunes)
		}

		// Create a wrapped attachment for this segment
		wrappedAtt := &attachment.Attachment{
			ID:        att.ID,
			Type:      att.Type,
			Display:   string(displayRunes[start:end]),
			URL:       att.URL,
			Filename:  att.Filename,
			MediaType: att.MediaType,
			Source:    att.Source,
		}

		lines = append(lines, []any{wrappedAtt})
		start = end
	}

	return lines
}

// forceWrapWord splits a word that's too long to fit within the given width
func forceWrapWord(word []any, width int) [][]any {
	if width <= 0 || len(word) == 0 {
		return [][]any{word}
	}

	var lines [][]any
	currentLine := []any{}
	currentWidth := 0

	for _, item := range word {
		if att, ok := item.(*attachment.Attachment); ok {
			// Handle attachment that might be too wide
			attWidth := uniseg.StringWidth(att.Display)

			// If the attachment display is too wide, split it
			if attWidth > width {
				// Finish current line if it has content
				if len(currentLine) > 0 {
					lines = append(lines, currentLine)
					currentLine = []any{}
					currentWidth = 0
				}

				// Split the attachment display across multiple lines
				wrappedAttachment := forceWrapAttachment(att, width)
				lines = append(lines, wrappedAttachment...)
				continue
			}

			// If adding this attachment would exceed the width, start a new line
			if currentWidth+attWidth > width && len(currentLine) > 0 {
				lines = append(lines, currentLine)
				currentLine = []any{}
				currentWidth = 0
			}

			currentLine = append(currentLine, item)
			currentWidth += attWidth
		} else if r, ok := item.(rune); ok {
			itemWidth := rw.RuneWidth(r)

			// If adding this rune would exceed the width, start a new line
			if currentWidth+itemWidth > width && len(currentLine) > 0 {
				lines = append(lines, currentLine)
				currentLine = []any{}
				currentWidth = 0
			}

			currentLine = append(currentLine, item)
			currentWidth += itemWidth
		}
	}

	// Add the last line if it has content
	if len(currentLine) > 0 {
		lines = append(lines, currentLine)
	}

	return lines
}

func wrapInterfaces(content []any, width int) [][]any {
	if width <= 0 {
		return [][]any{content}
	}

	var (
		lines    = [][]any{{}}
		word     = []any{}
		wordW    int
		lineW    int
		spaceW   int
		inSpaces bool
	)

	for _, item := range content {
		itemW := 0
		isSpace := false

		if r, ok := item.(rune); ok {
			if unicode.IsSpace(r) {
				isSpace = true
			}
			itemW = rw.RuneWidth(r)
		} else if att, ok := item.(*attachment.Attachment); ok {
			itemW = uniseg.StringWidth(att.Display)
		}

		if isSpace {
			if !inSpaces {
				// End of a word
				if lineW > 0 && lineW+wordW > width {
					// If the word itself is too long to fit on a line, force-wrap it
					if wordW > width {
						wrappedLines := forceWrapWord(word, width)
						lines = append(lines, wrappedLines...)
						// Calculate width of the last wrapped line
						lastLine := wrappedLines[len(wrappedLines)-1]
						lineW = 0
						for _, item := range lastLine {
							if r, ok := item.(rune); ok {
								lineW += rw.RuneWidth(r)
							} else if att, ok := item.(*attachment.Attachment); ok {
								lineW += uniseg.StringWidth(att.Display)
							}
						}
					} else {
						lines = append(lines, word)
						lineW = wordW
					}
				} else {
					// Check if the word needs to be force-wrapped even when it fits on the current line
					if wordW > width {
						currentLine := lines[len(lines)-1]
						wrappedWord := forceWrapWord(word, width-lineW)
						if len(wrappedWord) > 0 {
							lines[len(lines)-1] = append(currentLine, wrappedWord[0]...)
							for i := 1; i < len(wrappedWord); i++ {
								lines = append(lines, wrappedWord[i])
							}
							// Calculate width of the last wrapped line
							lastLine := wrappedWord[len(wrappedWord)-1]
							lineW = 0
							for _, item := range lastLine {
								if r, ok := item.(rune); ok {
									lineW += rw.RuneWidth(r)
								} else if att, ok := item.(*attachment.Attachment); ok {
									lineW += uniseg.StringWidth(att.Display)
								}
							}
						}
					} else {
						lines[len(lines)-1] = append(lines[len(lines)-1], word...)
						lineW += wordW
					}
				}
				word = nil
				wordW = 0
			}
			inSpaces = true
			spaceW += itemW
		} else { // It's not a space, it's a character for a word.
			if inSpaces {
				// We just finished a block of spaces. Handle them now.
				lineW += spaceW
				for i := 0; i < spaceW; i++ {
					lines[len(lines)-1] = append(lines[len(lines)-1], rune(' '))
				}
				if lineW > width {
					// The spaces made the line overflow. Start a new line for the upcoming word.
					lines = append(lines, []any{})
					lineW = 0
				}
				spaceW = 0
			}
			inSpaces = false
			word = append(word, item)
			wordW += itemW
		}
	}

	// Handle any remaining word/spaces at the end of the content.
	if wordW > 0 {
		if lineW > 0 && lineW+wordW > width {
			// If the word itself is too long to fit on a line, force-wrap it
			if wordW > width {
				wrappedLines := forceWrapWord(word, width)
				lines = append(lines, wrappedLines...)
				// Calculate width of the last wrapped line
				lastLine := wrappedLines[len(wrappedLines)-1]
				lineW = 0
				for _, item := range lastLine {
					if r, ok := item.(rune); ok {
						lineW += rw.RuneWidth(r)
					} else if att, ok := item.(*attachment.Attachment); ok {
						lineW += uniseg.StringWidth(att.Display)
					}
				}
			} else {
				lines = append(lines, word)
				lineW = wordW
			}
		} else {
			// Check if the word needs to be force-wrapped even when it fits on the current line
			if wordW > width {
				currentLine := lines[len(lines)-1]
				wrappedWord := forceWrapWord(word, width-lineW)
				if len(wrappedWord) > 0 {
					lines[len(lines)-1] = append(currentLine, wrappedWord[0]...)
					for i := 1; i < len(wrappedWord); i++ {
						lines = append(lines, wrappedWord[i])
					}
					// Calculate width of the last wrapped line
					lastLine := wrappedWord[len(wrappedWord)-1]
					lineW = 0
					for _, item := range lastLine {
						if r, ok := item.(rune); ok {
							lineW += rw.RuneWidth(r)
						} else if att, ok := item.(*attachment.Attachment); ok {
							lineW += uniseg.StringWidth(att.Display)
						}
					}
				}
			} else {
				lines[len(lines)-1] = append(lines[len(lines)-1], word...)
				lineW += wordW
			}
		}
	}
	if spaceW > 0 {
		// There are trailing spaces. Add them.
		for i := 0; i < spaceW; i++ {
			lines[len(lines)-1] = append(lines[len(lines)-1], rune(' '))
			lineW += 1
		}
		if lineW > width {
			lines = append(lines, []any{})
		}
	}

	return lines
}

func repeatSpaces(n int) []rune {
	return []rune(strings.Repeat(string(' '), n))
}

// numDigits returns the number of digits in an integer.
func numDigits(n int) int {
	if n == 0 {
		return 1
	}
	count := 0
	num := abs(n)
	for num > 0 {
		count++
		num /= 10
	}
	return count
}

func clamp(v, low, high int) int {
	if high < low {
		low, high = high, low
	}
	return min(high, max(low, v))
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}
