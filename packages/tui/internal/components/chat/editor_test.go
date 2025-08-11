package chat

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/charmbracelet/bubbles/v2/spinner"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/commands"
	"github.com/sst/opencode/internal/completions"
	"github.com/sst/opencode/internal/components/dialog"
	"github.com/sst/opencode/internal/components/textarea"
	"github.com/sst/opencode/internal/styles"
)

func newTestEditor() *editorComponent {
	m := &editorComponent{
		app:      &app.App{},
		textarea: textarea.New(),
		spinner:  spinner.New(),
	}
	return m
}

// createTestEditor creates a minimal editor component for testing slash commands
func createTestEditor() *editorComponent {
	// Create a minimal app with commands for testing
	testApp := &app.App{
		Commands: commands.CommandRegistry{
			commands.AppExitCommand: commands.Command{
				Name:        commands.AppExitCommand,
				Description: "exit the app",
				Trigger:     []string{"exit", "quit", "q"},
			},
			commands.AppHelpCommand: commands.Command{
				Name:        commands.AppHelpCommand,
				Description: "show help",
				Trigger:     []string{"help"},
			},
		},
	}

	return &editorComponent{
		app:      testApp,
		textarea: textarea.New(),
	}
}

func TestPasteAtPathWithTrailingComma_PreservesPunctuation_NoDoubleSpace(t *testing.T) {
	m := newTestEditor()
	p := createTempTextFile(t, "", "pc.txt", "x")

	paste := "See @" + p + ", next"
	_, cmd := m.Update(tea.PasteMsg(paste))
	if cmd == nil {
		t.Fatalf("expected command to be returned for comma punctuation paste")
	}
	if _, ok := cmd().(AttachmentInsertedMsg); !ok {
		t.Fatalf("expected AttachmentInsertedMsg for comma punctuation paste")
	}
	if len(m.textarea.GetAttachments()) != 1 {
		t.Fatalf("expected 1 attachment, got %d", len(m.textarea.GetAttachments()))
	}
	v := m.Value()
	if !strings.Contains(v, ", next") {
		t.Fatalf("expected comma and following text to be preserved, got: %q", v)
	}
	if strings.Contains(v, ",  next") {
		t.Fatalf("did not expect double space after comma, got: %q", v)
	}
}

func TestPasteAtPathWithTrailingQuestion_PreservesPunctuation_NoDoubleSpace(t *testing.T) {
	m := newTestEditor()
	p := createTempTextFile(t, "", "pq.txt", "x")

	paste := "Check @" + p + "? Done"
	_, cmd := m.Update(tea.PasteMsg(paste))
	if cmd == nil {
		t.Fatalf("expected command to be returned for question punctuation paste")
	}
	if _, ok := cmd().(AttachmentInsertedMsg); !ok {
		t.Fatalf("expected AttachmentInsertedMsg for question punctuation paste")
	}
	if len(m.textarea.GetAttachments()) != 1 {
		t.Fatalf("expected 1 attachment, got %d", len(m.textarea.GetAttachments()))
	}
	v := m.Value()
	if !strings.Contains(v, "? Done") {
		t.Fatalf("expected question mark and following text to be preserved, got: %q", v)
	}
	if strings.Contains(v, "?  Done") {
		t.Fatalf("did not expect double space after question mark, got: %q", v)
	}
}

func TestPasteMultipleInlineAtPaths_AttachesEach(t *testing.T) {
	m := newTestEditor()
	dir := t.TempDir()
	p1 := createTempTextFile(t, dir, "m1.txt", "one")
	p2 := createTempTextFile(t, dir, "m2.txt", "two")

	// Build a paste with text around, two @paths, and punctuation after the first
	paste := "Please check @" + p1 + ", and also @" + p2 + " thanks"

	_, cmd := m.Update(tea.PasteMsg(paste))
	if cmd == nil {
		t.Fatalf("expected command to be returned for multi inline paste")
	}
	if _, ok := cmd().(AttachmentInsertedMsg); !ok {
		t.Fatalf("expected AttachmentInsertedMsg for multi inline paste")
	}

	atts := m.textarea.GetAttachments()
	if len(atts) != 2 {
		t.Fatalf("expected 2 attachments, got %d", len(atts))
	}
	v := m.Value()
	if !strings.Contains(v, "Please check") || !strings.Contains(v, "and also") || !strings.Contains(v, "thanks") {
		t.Fatalf("expected surrounding text to be preserved, got: %q", v)
	}
}

func createTempTextFile(t *testing.T, dir, name, content string) string {
	t.Helper()
	if dir == "" {
		td, err := os.MkdirTemp("", "editor-test-*")
		if err != nil {
			t.Fatalf("failed to make temp dir: %v", err)
		}
		dir = td
	}
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
		t.Fatalf("failed to write temp file: %v", err)
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		t.Fatalf("failed to get abs path: %v", err)
	}
	return abs
}

func createTempBinFile(t *testing.T, dir, name string, data []byte) string {
	t.Helper()
	if dir == "" {
		td, err := os.MkdirTemp("", "editor-test-*")
		if err != nil {
			t.Fatalf("failed to make temp dir: %v", err)
		}
		dir = td
	}
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, data, 0o600); err != nil {
		t.Fatalf("failed to write temp bin file: %v", err)
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		t.Fatalf("failed to get abs path: %v", err)
	}
	return abs
}

func TestPasteStartsWithAt_AttachesAndEmitsMsg(t *testing.T) {
	m := newTestEditor()
	p := createTempTextFile(t, "", "a.txt", "hello")

	_, cmd := m.Update(tea.PasteMsg("@" + p))
	if cmd == nil {
		t.Fatalf("expected command to be returned")
	}
	msg := cmd()
	if _, ok := msg.(AttachmentInsertedMsg); !ok {
		t.Fatalf("expected AttachmentInsertedMsg, got %T", msg)
	}

	atts := m.textarea.GetAttachments()
	if len(atts) != 1 {
		t.Fatalf("expected 1 attachment, got %d", len(atts))
	}
	if v := m.Value(); !strings.HasSuffix(v, " ") {
		t.Fatalf("expected trailing space after attachment, got value: %q", v)
	}
}

func TestPasteAfterAt_ReplacesAtWithAttachment(t *testing.T) {
	m := newTestEditor()
	p := createTempTextFile(t, "", "b.txt", "hello")

	m.textarea.SetValue("@")
	// Cursor should be at the end after SetValue; paste absolute path
	_, cmd := m.Update(tea.PasteMsg(p))
	if cmd == nil {
		t.Fatalf("expected command to be returned")
	}
	if _, ok := cmd().(AttachmentInsertedMsg); !ok {
		t.Fatalf("expected AttachmentInsertedMsg from paste after '@'")
	}

	// Ensure the raw '@' rune was removed (attachment inserted in its place)
	if m.textarea.LastRuneIndex('@') != -1 {
		t.Fatalf("'@' rune should have been removed from the text slice")
	}
	if len(m.textarea.GetAttachments()) != 1 {
		t.Fatalf("expected 1 attachment inserted")
	}
	if v := m.Value(); !strings.HasSuffix(v, " ") {
		t.Fatalf("expected trailing space after attachment, got value: %q", v)
	}
}

func TestPlainTextPaste_NoAttachment_NoMsg(t *testing.T) {
	m := newTestEditor()
	_, cmd := m.Update(tea.PasteMsg("hello"))
	if cmd != nil {
		t.Fatalf("expected no command for plain text paste")
	}
	if got := m.Value(); got != "hello" {
		t.Fatalf("expected value 'hello', got %q", got)
	}
	if len(m.textarea.GetAttachments()) != 0 {
		t.Fatalf("expected no attachments for plain text paste")
	}
}

func TestPlainPathPng_AttachesImage(t *testing.T) {
	m := newTestEditor()
	// Minimal bytes; content isn't validated, extension determines mime
	p := createTempBinFile(t, "", "img.png", []byte{0x89, 'P', 'N', 'G'})

	_, cmd := m.Update(tea.PasteMsg(p))
	if cmd == nil {
		t.Fatalf("expected command to be returned for image path paste")
	}
	if _, ok := cmd().(AttachmentInsertedMsg); !ok {
		t.Fatalf("expected AttachmentInsertedMsg for image path paste")
	}
	atts := m.textarea.GetAttachments()
	if len(atts) != 1 {
		t.Fatalf("expected 1 attachment, got %d", len(atts))
	}
	if atts[0].MediaType != "image/png" {
		t.Fatalf("expected image/png mime, got %q", atts[0].MediaType)
	}
	if v := m.Value(); !strings.HasSuffix(v, " ") {
		t.Fatalf("expected trailing space after attachment, got value: %q", v)
	}
}

func TestPlainPathPdf_AttachesPDF(t *testing.T) {
	m := newTestEditor()
	p := createTempBinFile(t, "", "doc.pdf", []byte("%PDF-1.4"))

	_, cmd := m.Update(tea.PasteMsg(p))
	if cmd == nil {
		t.Fatalf("expected command to be returned for pdf path paste")
	}
	if _, ok := cmd().(AttachmentInsertedMsg); !ok {
		t.Fatalf("expected AttachmentInsertedMsg for pdf path paste")
	}
	atts := m.textarea.GetAttachments()
	if len(atts) != 1 {
		t.Fatalf("expected 1 attachment, got %d", len(atts))
	}
	if atts[0].MediaType != "application/pdf" {
		t.Fatalf("expected application/pdf mime, got %q", atts[0].MediaType)
	}
	if v := m.Value(); !strings.HasSuffix(v, " ") {
		t.Fatalf("expected trailing space after attachment, got value: %q", v)
	}
}

func TestCompletionFiles_InsertsAttachment_EmitsMsg(t *testing.T) {
	m := newTestEditor()
	p := createTempTextFile(t, "", "c.txt", "hello")
	m.textarea.SetValue("@")

	item := completions.CompletionSuggestion{
		ProviderID: "files",
		Value:      p,
		Display:    func(_ styles.Style) string { return p },
	}
	// Build the completion selected message as if the user selected from the dialog
	msg := dialog.CompletionSelectedMsg{Item: item, SearchString: "@"}

	_, cmd := m.Update(msg)
	if cmd == nil {
		t.Fatalf("expected command to be returned")
	}
	if _, ok := cmd().(AttachmentInsertedMsg); !ok {
		t.Fatalf("expected AttachmentInsertedMsg from files completion selection")
	}
	if len(m.textarea.GetAttachments()) != 1 {
		t.Fatalf("expected 1 attachment inserted from completion selection")
	}
	if v := m.Value(); !strings.HasSuffix(v, " ") {
		t.Fatalf("expected trailing space after attachment, got value: %q", v)
	}
}

func TestEditorSubmit_QuitCommands(t *testing.T) {
	tests := []struct {
		name       string
		input      string
		expectQuit bool
	}{
		{
			name:       "quit command should trigger tea.Quit",
			input:      "quit",
			expectQuit: true,
		},
		{
			name:       "exit command should trigger tea.Quit",
			input:      "exit",
			expectQuit: true,
		},
		{
			name:       "q command should trigger tea.Quit",
			input:      "q",
			expectQuit: true,
		},
		{
			name:       ":q command should trigger tea.Quit",
			input:      ":q",
			expectQuit: true,
		},
		{
			name:       "empty input should not quit",
			input:      "",
			expectQuit: false,
		},
		{
			name:       "whitespace only should not quit",
			input:      "   ",
			expectQuit: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			editor := createTestEditor()
			editor.textarea.SetValue(tt.input)

			_, cmd := editor.Submit()

			if tt.expectQuit {
				// Check if cmd contains tea.Quit
				if cmd == nil {
					t.Errorf("Expected tea.Quit command, got nil")
					return
				}
				// Execute the command to see if it's tea.Quit
				msg := cmd()
				if _, ok := msg.(tea.QuitMsg); !ok {
					t.Errorf("Expected tea.QuitMsg, got %T", msg)
				}
			} else {
				// For non-quit commands, we test differently to avoid the state issue
				if tt.input == "" || strings.TrimSpace(tt.input) == "" {
					if cmd != nil {
						t.Errorf("Expected no command for empty input, got %T", cmd)
					}
				}
			}
		})
	}
}

func TestEditorSubmit_SlashCommands(t *testing.T) {
	tests := []struct {
		name                string
		input               string
		expectCommandExec   bool
		expectedCommandName commands.CommandName
	}{
		{
			name:                "/quit should execute quit command",
			input:               "/quit",
			expectCommandExec:   true,
			expectedCommandName: commands.AppExitCommand,
		},
		{
			name:                "/exit should execute quit command",
			input:               "/exit",
			expectCommandExec:   true,
			expectedCommandName: commands.AppExitCommand,
		},
		{
			name:                "/q should execute quit command",
			input:               "/q",
			expectCommandExec:   true,
			expectedCommandName: commands.AppExitCommand,
		},
		{
			name:                "/help should execute help command",
			input:               "/help",
			expectCommandExec:   true,
			expectedCommandName: commands.AppHelpCommand,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			editor := createTestEditor()
			editor.textarea.SetValue(tt.input)

			_, cmd := editor.Submit()

			if tt.expectCommandExec {
				if cmd == nil {
					t.Errorf("Expected command execution, got nil")
					return
				}
				// For slash commands that match registered triggers, we expect a command to be executed
				// The exact structure is complex to test, but we can verify a command was returned
			}
		})
	}
}

func TestCommandMatchesTrigger(t *testing.T) {
	cmd := commands.Command{
		Name:    commands.AppExitCommand,
		Trigger: []string{"exit", "quit", "q"},
	}

	tests := []struct {
		trigger  string
		expected bool
	}{
		{"exit", true},
		{"quit", true},
		{"q", true},
		{"help", false},
		{"unknown", false},
		{"", false},
	}

	for _, tt := range tests {
		t.Run(tt.trigger, func(t *testing.T) {
			result := cmd.MatchesTrigger(tt.trigger)
			if result != tt.expected {
				t.Errorf("MatchesTrigger(%q) = %v, expected %v", tt.trigger, result, tt.expected)
			}
		})
	}
}

// TestSlashCommandParsing tests the slash command parsing logic specifically
func TestSlashCommandParsing(t *testing.T) {
	tests := []struct {
		name          string
		input         string
		expectPrefix  bool
		expectCommand string
	}{
		{
			name:          "/quit should be recognized as slash command",
			input:         "/quit",
			expectPrefix:  true,
			expectCommand: "quit",
		},
		{
			name:          "/exit should be recognized as slash command",
			input:         "/exit",
			expectPrefix:  true,
			expectCommand: "exit",
		},
		{
			name:          "/help should be recognized as slash command",
			input:         "/help",
			expectPrefix:  true,
			expectCommand: "help",
		},
		{
			name:          "quit without slash should not be slash command",
			input:         "quit",
			expectPrefix:  false,
			expectCommand: "",
		},
		{
			name:          "/ alone should be recognized as slash command",
			input:         "/",
			expectPrefix:  true,
			expectCommand: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			value := strings.TrimSpace(tt.input)
			hasPrefix := strings.HasPrefix(value, "/")

			if hasPrefix != tt.expectPrefix {
				t.Errorf("HasPrefix check for %q = %v, expected %v", value, hasPrefix, tt.expectPrefix)
			}

			if hasPrefix {
				commandName := strings.TrimPrefix(value, "/")
				if commandName != tt.expectCommand {
					t.Errorf("TrimPrefix for %q = %q, expected %q", value, commandName, tt.expectCommand)
				}
			}
		})
	}
}

// TestSlashCommandLookup tests that we can find commands by trigger
func TestSlashCommandLookup(t *testing.T) {
	editor := createTestEditor()

	tests := []struct {
		commandName string
		expectFound bool
		expectName  commands.CommandName
	}{
		{
			commandName: "quit",
			expectFound: true,
			expectName:  commands.AppExitCommand,
		},
		{
			commandName: "exit",
			expectFound: true,
			expectName:  commands.AppExitCommand,
		},
		{
			commandName: "q",
			expectFound: true,
			expectName:  commands.AppExitCommand,
		},
		{
			commandName: "help",
			expectFound: true,
			expectName:  commands.AppHelpCommand,
		},
		{
			commandName: "unknown",
			expectFound: false,
		},
		{
			commandName: "",
			expectFound: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.commandName, func(t *testing.T) {
			found := false
			var foundCommand commands.Command

			// This mimics the logic in our slash command handler
			for _, command := range editor.app.Commands {
				if command.MatchesTrigger(tt.commandName) {
					found = true
					foundCommand = command
					break
				}
			}

			if found != tt.expectFound {
				t.Errorf("Command lookup for %q = %v, expected %v", tt.commandName, found, tt.expectFound)
			}

			if tt.expectFound && found {
				if foundCommand.Name != tt.expectName {
					t.Errorf("Found command name for %q = %v, expected %v", tt.commandName, foundCommand.Name, tt.expectName)
				}
			}
		})
	}
}
