package chat

import (
	"image/color"
	"testing"

	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/attachment"
	"github.com/sst/opencode/internal/theme"
)

func init() {
	// Initialize a simple theme for testing to avoid nil pointer dereference
	systemTheme := theme.NewSystemTheme(color.RGBA{0, 0, 0, 255}, true)
	theme.RegisterTheme("test", systemTheme)
	theme.SetTheme("test")
}

func createTestEditor() *editorComponent {
	appInstance := &app.App{
		State: &app.State{
			MessageHistory: []app.Prompt{},
		},
		Info: opencode.App{
			Path: opencode.AppPath{
				Cwd: "/test",
			},
		},
	}
	return NewEditorComponent(appInstance).(*editorComponent)
}

func createFileAttachment(id, display string, startIndex, endIndex int, path string) *attachment.Attachment {
	return &attachment.Attachment{
		ID:         id,
		Type:       "file",
		Display:    display,
		StartIndex: startIndex,
		EndIndex:   endIndex,
		Source: &attachment.FileSource{
			Path: path,
			Mime: "text/plain",
		},
	}
}

func TestRestoreFromPromptWithMultilineAttachments(t *testing.T) {
	editor := createTestEditor()

	prompt := app.Prompt{
		Text: "read this:\n@path/to/my/file.txt\nand then proceed",
		Attachments: []*attachment.Attachment{
			createFileAttachment("test-attachment-1", "@path/to/my/file.txt", 11, 31, "/test/path/to/my/file.txt"),
		},
	}

	// Restore the prompt
	editor.RestoreFromPrompt(prompt)

	// Check that the text was correctly restored
	result := editor.Value()
	expected := "read this:\n@path/to/my/file.txt\nand then proceed"
	if result != expected {
		t.Errorf("Expected %q, got %q", expected, result)
	}

	// Check that attachments are correctly positioned
	attachments := editor.textarea.GetAttachments()
	if len(attachments) != 1 {
		t.Fatalf("Expected 1 attachment, got %d", len(attachments))
	}

	att := attachments[0]
	if att.ID != "test-attachment-1" {
		t.Errorf("Expected attachment ID 'test-attachment-1', got %q", att.ID)
	}
}

func TestRestoreFromPromptMultipleAttachments(t *testing.T) {
	editor := createTestEditor()

	// Test with multiple attachments in multi-line text
	originalText := "Check these files:\n@file1.txt\nand also:\n@file2.txt\nbefore proceeding"

	prompt := app.Prompt{
		Text: originalText,
		Attachments: []*attachment.Attachment{
			createFileAttachment("attachment-1", "@file1.txt", 19, 29, "/test/file1.txt"),
			createFileAttachment("attachment-2", "@file2.txt", 40, 50, "/test/file2.txt"),
		},
	}

	editor.RestoreFromPrompt(prompt)

	result := editor.Value()
	if result != originalText {
		t.Errorf("Multiple attachments test failed. Expected %q, got %q", originalText, result)
	}

	// Verify both attachments are present
	attachments := editor.textarea.GetAttachments()
	if len(attachments) != 2 {
		t.Errorf("Expected 2 attachments, got %d", len(attachments))
	}
}

func TestRestoreFromPromptAttachmentsAtLineBoundaries(t *testing.T) {
	editor := createTestEditor()

	// Test attachment at line boundary
	originalText := "@start.txt\nsecond line\n@end.txt"

	prompt := app.Prompt{
		Text: originalText,
		Attachments: []*attachment.Attachment{
			createFileAttachment("start-attachment", "@start.txt", 0, 10, "/test/start.txt"),
			createFileAttachment("end-attachment", "@end.txt", 23, 31, "/test/end.txt"),
		},
	}

	editor.RestoreFromPrompt(prompt)

	result := editor.Value()
	if result != originalText {
		t.Errorf("Line boundary test failed. Expected %q, got %q", originalText, result)
	}
}

func TestRestoreFromPromptEmptyLinesWithAttachments(t *testing.T) {
	editor := createTestEditor()

	// Test with empty lines between text and attachments
	originalText := "first line\n\n@file.txt\n\nlast line"

	prompt := app.Prompt{
		Text: originalText,
		Attachments: []*attachment.Attachment{
			createFileAttachment("empty-lines-test", "@file.txt", 12, 21, "/test/file.txt"),
		},
	}

	editor.RestoreFromPrompt(prompt)

	result := editor.Value()
	if result != originalText {
		t.Errorf("Empty lines test failed. Expected %q, got %q", originalText, result)
	}
}

func TestRestoreFromHistoryIndex(t *testing.T) {
	// Test the RestoreFromHistory method that calls RestoreFromPrompt
	appInstance := &app.App{
		State: &app.State{
			MessageHistory: []app.Prompt{
				{
					Text: "first message\n@file1.txt",
					Attachments: []*attachment.Attachment{
						createFileAttachment("hist-1", "@file1.txt", 14, 24, "/test/file1.txt"),
					},
				},
				{
					Text: "second message\n@file2.txt",
					Attachments: []*attachment.Attachment{
						createFileAttachment("hist-2", "@file2.txt", 15, 25, "/test/file2.txt"),
					},
				},
			},
		},
		Info: opencode.App{
			Path: opencode.AppPath{
				Cwd: "/test",
			},
		},
	}

	editor := NewEditorComponent(appInstance).(*editorComponent)

	// Test restoring first message (index 0)
	editor.RestoreFromHistory(0)
	result := editor.Value()
	expected := "first message\n@file1.txt"
	if result != expected {
		t.Errorf("History index 0 test failed. Expected %q, got %q", expected, result)
	}

	// Test restoring second message (index 1)
	editor.RestoreFromHistory(1)
	result = editor.Value()
	expected = "second message\n@file2.txt"
	if result != expected {
		t.Errorf("History index 1 test failed. Expected %q, got %q", expected, result)
	}

	// Test invalid index (should not crash)
	editor.RestoreFromHistory(10)
	// Should still have the previous value since invalid index should be ignored
	result = editor.Value()
	if result != expected {
		t.Errorf("Invalid index test failed. Expected %q, got %q", expected, result)
	}
}
