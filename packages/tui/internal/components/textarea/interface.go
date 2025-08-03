package textarea

import tea "github.com/charmbracelet/bubbletea/v2"

// TextArea defines the interface for text area implementations
type TextArea interface {
	tea.Model

	// View and Layout
	View() string
	SetWidth(width int)
	SetHeight(height int)

	// Content Management
	Value() string
	SetValue(string)
	Reset()
	Length() int
	LineCount() int

	// Cursor and Focus
	Focus() tea.Cmd
	Blur()
	Focused() bool

	// Text Operations
	InsertNewline()
	Newline()
	InsertRunesFromUserInput([]rune)
	InsertString(string)
	ReplaceRange(start, end int, replacement string)

	// Attachments
	GetAttachments() []*Attachment
	SetAttachment(attachment *Attachment)
	InsertAttachment(attachment *Attachment)

	// Clipboard Support
	Paste() tea.Cmd
}
