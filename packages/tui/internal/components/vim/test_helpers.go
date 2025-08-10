package vim

import (
	tea "github.com/charmbracelet/bubbletea/v2"
)

// Test helpers to make the vim package testable independently
// These mock the external dependencies we need

type MockConfig struct {
	VimEnabled bool
}

type MockApp struct {
	Config *MockConfig
}

// MockTextArea provides a minimal interface for testing
type MockTextArea interface {
	Value() string
	SetValue(string)
	Focus() tea.Cmd
	Blur()
	GetAttachments() []any
	SetAttachment(any)
	InsertRunesFromUserInput([]rune)
}

// MockTextAreaWrapper wraps a regular textarea for testing
type MockTextAreaWrapper struct {
	value string
}

func (m *MockTextAreaWrapper) Value() string {
	return m.value
}

func (m *MockTextAreaWrapper) SetValue(v string) {
	m.value = v
}

func (m *MockTextAreaWrapper) Focus() tea.Cmd {
	return nil
}

func (m *MockTextAreaWrapper) Blur() {
}

func (m *MockTextAreaWrapper) GetAttachments() []any {
	return nil
}

func (m *MockTextAreaWrapper) SetAttachment(a any) {
}

func (m *MockTextAreaWrapper) InsertRunesFromUserInput(r []rune) {
	m.value += string(r)
}

func (m *MockTextAreaWrapper) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	return m, nil
}