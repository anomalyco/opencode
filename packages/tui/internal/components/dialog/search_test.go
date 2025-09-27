package dialog

import (
	"testing"

	"github.com/sst/opencode/internal/theme"
)

func TestSearchDialog_TextInput(t *testing.T) {
	// Ensure we have a theme
	if theme.CurrentTheme() == nil {
		evalOpsTheme := theme.NewEvalOpsTheme()
		theme.RegisterTheme("evalops", evalOpsTheme)
	}

	searchDialog := NewSearchDialog("", 5)
	searchDialog.SetWidth(60)
	
	// Initialize
	searchDialog.Init()
	
	view := searchDialog.View()
	
	t.Logf("Search dialog view:\n%s", view)
	t.Logf("View length: %d", len(view))
	t.Logf("View as bytes: %v", []byte(view))
	
	// Check the textinput specifically
	textInputView := searchDialog.textInput.View()
	t.Logf("Text input view:\n%s", textInputView)
	t.Logf("Text input length: %d", len(textInputView))
	t.Logf("Text input as bytes: %v", []byte(textInputView))
	
	// Check textinput content
	t.Logf("Text input value: '%s'", searchDialog.textInput.Value())
	t.Logf("Text input prompt: '%s'", searchDialog.textInput.Prompt)
	t.Logf("Text input placeholder: '%s'", searchDialog.textInput.Placeholder)
}
