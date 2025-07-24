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

func TestRestoreFromPromptWithMultilineAttachments(t *testing.T) {
	// Create a mock app for testing
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

	editor := NewEditorComponent(appInstance).(*editorComponent)

	// Test case 1: Multi-line text with attachment on second line
	prompt := app.Prompt{
		Text: "read this:\n@path/to/my/file.txt\nand then proceed",
		Attachments: []*attachment.Attachment{
			{
				ID:         "test-attachment-1",
				Type:       "file",
				Display:    "@path/to/my/file.txt",
				StartIndex: 11, // Position of "@path..." in the text
				EndIndex:   31, // End of "@path/to/my/file.txt"
				Source: &attachment.FileSource{
					Path: "/test/path/to/my/file.txt",
					Mime: "text/plain",
				},
			},
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

func TestRestoreFromPromptReproduceBugScenario(t *testing.T) {
	// Reproduce the exact bug scenario described in the spec
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

	editor := NewEditorComponent(appInstance).(*editorComponent)

	// Original message: "read this:\n@path/to/my/file.txt"
	originalText := "read this:\n@path/to/my/file.txt"

	prompt := app.Prompt{
		Text: originalText,
		Attachments: []*attachment.Attachment{
			{
				ID:         "bug-test",
				Type:       "file",
				Display:    "@path/to/my/file.txt",
				StartIndex: 11, // After "read this:\n"
				EndIndex:   31, // End of attachment path
				Source: &attachment.FileSource{
					Path: "/test/path/to/my/file.txt",
					Mime: "text/plain",
				},
			},
		},
	}

	// Restore from history (simulate up arrow key)
	editor.RestoreFromPrompt(prompt)

	// Check that the restored text exactly matches the original
	result := editor.Value()
	if result != originalText {
		t.Errorf("Bug reproduction failed. Expected %q, got %q", originalText, result)

		// Check for the specific corruption pattern mentioned in the spec
		if len(result) > len(originalText) {
			t.Errorf("Text appears to be duplicated - got %d characters, expected %d", len(result), len(originalText))
		}
	}
}

func TestRestoreFromPromptMultipleAttachments(t *testing.T) {
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

	editor := NewEditorComponent(appInstance).(*editorComponent)

	// Test with multiple attachments in multi-line text
	originalText := "Check these files:\n@file1.txt\nand also:\n@file2.txt\nbefore proceeding"

	prompt := app.Prompt{
		Text: originalText,
		Attachments: []*attachment.Attachment{
			{
				ID:         "attachment-1",
				Type:       "file",
				Display:    "@file1.txt",
				StartIndex: 19, // Position of first attachment
				EndIndex:   29,
				Source: &attachment.FileSource{
					Path: "/test/file1.txt",
					Mime: "text/plain",
				},
			},
			{
				ID:         "attachment-2",
				Type:       "file",
				Display:    "@file2.txt",
				StartIndex: 40, // Position of second attachment
				EndIndex:   50,
				Source: &attachment.FileSource{
					Path: "/test/file2.txt",
					Mime: "text/plain",
				},
			},
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

	editor := NewEditorComponent(appInstance).(*editorComponent)

	// Test attachment at line boundary
	originalText := "@start.txt\nsecond line\n@end.txt"

	prompt := app.Prompt{
		Text: originalText,
		Attachments: []*attachment.Attachment{
			{
				ID:         "start-attachment",
				Type:       "file",
				Display:    "@start.txt",
				StartIndex: 0, // Start of first line
				EndIndex:   10,
				Source: &attachment.FileSource{
					Path: "/test/start.txt",
					Mime: "text/plain",
				},
			},
			{
				ID:         "end-attachment",
				Type:       "file",
				Display:    "@end.txt",
				StartIndex: 23, // Start of last line
				EndIndex:   31,
				Source: &attachment.FileSource{
					Path: "/test/end.txt",
					Mime: "text/plain",
				},
			},
		},
	}

	editor.RestoreFromPrompt(prompt)

	result := editor.Value()
	if result != originalText {
		t.Errorf("Line boundary test failed. Expected %q, got %q", originalText, result)
	}
}

func TestRestoreFromPromptEmptyLinesWithAttachments(t *testing.T) {
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

	editor := NewEditorComponent(appInstance).(*editorComponent)

	// Test with empty lines between text and attachments
	originalText := "first line\n\n@file.txt\n\nlast line"

	prompt := app.Prompt{
		Text: originalText,
		Attachments: []*attachment.Attachment{
			{
				ID:         "empty-lines-test",
				Type:       "file",
				Display:    "@file.txt",
				StartIndex: 12, // After "first line\n\n"
				EndIndex:   21,
				Source: &attachment.FileSource{
					Path: "/test/file.txt",
					Mime: "text/plain",
				},
			},
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
						{
							ID:         "hist-1",
							Type:       "file",
							Display:    "@file1.txt",
							StartIndex: 14,
							EndIndex:   24,
							Source: &attachment.FileSource{
								Path: "/test/file1.txt",
								Mime: "text/plain",
							},
						},
					},
				},
				{
					Text: "second message\n@file2.txt",
					Attachments: []*attachment.Attachment{
						{
							ID:         "hist-2",
							Type:       "file",
							Display:    "@file2.txt",
							StartIndex: 15,
							EndIndex:   25,
							Source: &attachment.FileSource{
								Path: "/test/file2.txt",
								Mime: "text/plain",
							},
						},
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
