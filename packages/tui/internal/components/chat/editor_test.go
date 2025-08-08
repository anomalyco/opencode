package chat

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/charmbracelet/bubbles/v2/spinner"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/sst/opencode/internal/app"
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
