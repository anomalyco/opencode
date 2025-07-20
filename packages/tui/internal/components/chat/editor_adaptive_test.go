package chat

import (
	"testing"
	"github.com/sst/opencode/internal/app"
)


func TestEditorUsesAdaptiveTextarea(t *testing.T) {
	// Initialize theme to prevent nil pointer panics
	initTestTheme()
	
	// Create a test app
	testApp := &app.App{}
	
	// Create editor component
	editor := NewEditorComponent(testApp)
	editorImpl := editor.(*editorComponent)
	
	// Verify that the textarea is an adaptive model
	if editorImpl.textarea == nil {
		t.Fatal("Editor textarea is nil")
	}
	
	// Test with small content - should use original implementation
	editorImpl.textarea.SetValue("Small test content")
	impl, reason := editorImpl.textarea.GetCurrentImplementation()
	if impl != "original" {
		t.Errorf("Expected original implementation for small content, got %s: %s", impl, reason)
	}
	
	// Test with large content - should switch to rope implementation
	largeContent := ""
	for i := 0; i < 1000; i++ {
		largeContent += "This is a long line of text that will create a large document.\n"
	}
	
	editorImpl.textarea.SetValue(largeContent)
	impl, reason = editorImpl.textarea.GetCurrentImplementation()
	if impl != "rope" {
		t.Errorf("Expected rope implementation for large content, got %s: %s", impl, reason)
	}
	
	// Verify basic operations work
	editorImpl.textarea.InsertString("Additional text")
	if editorImpl.textarea.Length() == 0 {
		t.Error("Textarea length should not be zero after inserting content")
	}
	
	// Verify focus/blur operations
	editorImpl.textarea.Focus()
	if !editorImpl.textarea.Focused() {
		t.Error("Textarea should be focused after calling Focus()")
	}
	
	editorImpl.textarea.Blur()
	if editorImpl.textarea.Focused() {
		t.Error("Textarea should not be focused after calling Blur()")
	}
}

func TestEditorAdaptivePerformance(t *testing.T) {
	// Initialize theme to prevent nil pointer panics
	initTestTheme()
	
	testApp := &app.App{}
	editor := NewEditorComponent(testApp)
	editorImpl := editor.(*editorComponent)
	
	// Start with small content
	editorImpl.textarea.SetValue("Initial small content")
	
	// Gradually grow the content and verify automatic switching
	for i := 0; i < 600; i++ { // Need more iterations to exceed the 500 line threshold
		editorImpl.textarea.InsertString("Line of text to gradually grow the document size.\n")
		
		// Check implementation after significant growth
		if i == 510 { // Check after we've definitely crossed the 500 line threshold
			impl, _ := editorImpl.textarea.GetCurrentImplementation()
			if impl != "rope" {
				t.Errorf("Expected automatic switch to rope implementation after growth, got %s", impl)
			}
		}
	}
	
	// Verify final state
	impl, reason := editorImpl.textarea.GetCurrentImplementation()
	if impl != "rope" {
		t.Errorf("Expected rope implementation for final large content, got %s: %s", impl, reason)
	}
	
	// Verify content preservation
	finalContent := editorImpl.textarea.Value()
	if len(finalContent) == 0 {
		t.Error("Content should be preserved throughout growth")
	}
}