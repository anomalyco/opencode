package textarea

import tea "github.com/charmbracelet/bubbletea/v2"

// ModelWrapper wraps the Model to implement the TextArea interface
type ModelWrapper struct {
	*Model
}

// Update implements tea.Model
func (m *ModelWrapper) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	model, cmd := m.Model.Update(msg)
	m.Model = &model
	return m, cmd
}

// Init implements tea.Model
func (m *ModelWrapper) Init() tea.Cmd {
	return nil
}

// View implements TextArea
func (m *ModelWrapper) View() string {
	return m.Model.View()
}

// NewWrapper creates a new ModelWrapper from a Model
func NewWrapper(model Model) *ModelWrapper {
	return &ModelWrapper{Model: &model}
}

// The following methods delegate to the underlying Model to satisfy the TextArea interface

// SetWidth sets the width of the textarea
func (m *ModelWrapper) SetWidth(width int) {
	m.Model.SetWidth(width)
}

// SetHeight sets the height of the textarea
func (m *ModelWrapper) SetHeight(height int) {
	m.Model.SetHeight(height)
}

// Value returns the current text value
func (m *ModelWrapper) Value() string {
	return m.Model.Value()
}

// SetValue sets the text value
func (m *ModelWrapper) SetValue(s string) {
	m.Model.SetValue(s)
}

// Reset resets the textarea
func (m *ModelWrapper) Reset() {
	m.Model.Reset()
}

// Length returns the length of the content
func (m *ModelWrapper) Length() int {
	return m.Model.Length()
}

// LineCount returns the number of lines
func (m *ModelWrapper) LineCount() int {
	return m.Model.LineCount()
}

// Focus sets focus on the textarea
func (m *ModelWrapper) Focus() tea.Cmd {
	return m.Model.Focus()
}

// Blur removes focus from the textarea
func (m *ModelWrapper) Blur() {
	m.Model.Blur()
}

// Focused returns whether the textarea is focused
func (m *ModelWrapper) Focused() bool {
	return m.Model.Focused()
}

// InsertNewline inserts a newline
func (m *ModelWrapper) InsertNewline() {
	// The Model doesn't have InsertNewline, use Newline
	m.Model.Newline()
}

// Newline inserts a newline
func (m *ModelWrapper) Newline() {
	m.Model.Newline()
}

// InsertRunesFromUserInput inserts runes from user input
func (m *ModelWrapper) InsertRunesFromUserInput(runes []rune) {
	m.Model.InsertRunesFromUserInput(runes)
}

// InsertString inserts a string at the current cursor position
func (m *ModelWrapper) InsertString(s string) {
	m.Model.InsertString(s)
}

// ReplaceRange replaces text in the given range
func (m *ModelWrapper) ReplaceRange(start, end int, replacement string) {
	m.Model.ReplaceRange(start, end, replacement)
}

// GetAttachments returns the attachments
func (m *ModelWrapper) GetAttachments() []*Attachment {
	return m.Model.GetAttachments()
}

// SetAttachment sets an attachment
func (m *ModelWrapper) SetAttachment(attachment *Attachment) {
	// SetAttachment doesn't exist, use InsertAttachment instead
	m.Model.InsertAttachment(attachment)
}

// InsertAttachment inserts an attachment
func (m *ModelWrapper) InsertAttachment(attachment *Attachment) {
	m.Model.InsertAttachment(attachment)
}

// Paste handles paste operations
func (m *ModelWrapper) Paste() tea.Cmd {
	// The Model doesn't have a Paste method
	return nil
}
