package dialog

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
)

func init() {
	// Ensure we have a theme loaded for tests
	if theme.CurrentTheme() == nil {
		evalOpsTheme := theme.NewEvalOpsTheme()
		theme.RegisterTheme("evalops", evalOpsTheme)
	}
}

func TestEvalsDialog_Creation(t *testing.T) {
	mockApp := &app.App{}
	dialog := NewEvalsDialog(mockApp)
	
	if dialog == nil {
		t.Fatal("NewEvalsDialog returned nil")
	}
}

func TestEvalsDialog_View(t *testing.T) {
	mockApp := &app.App{}
	dialog := NewEvalsDialog(mockApp).(*evalsDialog)
	
	// Set reasonable dimensions
	dialog.width = 80
	dialog.height = 20
	dialog.dialogWidth = 60
	dialog.searchDialog.SetWidth(60)
	dialog.searchDialog.SetHeight(20)
	
	// Initialize the dialog
	dialog.Init()
	
	view := dialog.View()
	
	t.Logf("Dialog view output:\n%s", view)
	t.Logf("View length: %d", len(view))
	t.Logf("View as bytes: %v", []byte(view))
	
	if strings.TrimSpace(view) == "S" {
		t.Error("Dialog view is showing only 'S'")
	}
	
	if !strings.Contains(view, "Search evaluation suites") && !strings.Contains(view, "code-quality") {
		t.Error("Dialog view doesn't contain expected content")
	}
}

func TestEvalsDialog_SearchDialogView(t *testing.T) {
	mockApp := &app.App{}
	dialog := NewEvalsDialog(mockApp).(*evalsDialog)
	
	// Set dimensions
	dialog.searchDialog.SetWidth(60)
	dialog.searchDialog.SetHeight(20)
	
	// Initialize
	dialog.Init()
	
	searchView := dialog.searchDialog.View()
	
	t.Logf("Search dialog view:\n%s", searchView)
	t.Logf("Search view length: %d", len(searchView))
	t.Logf("Search view as bytes: %v", []byte(searchView))
}

func TestEvalsDialog_Update(t *testing.T) {
	mockApp := &app.App{}
	dialog := NewEvalsDialog(mockApp).(*evalsDialog)
	
	// Initialize
	dialog.Init()
	
	// Test window size update
	windowMsg := tea.WindowSizeMsg{Width: 80, Height: 24}
	updatedDialog, _ := dialog.Update(windowMsg)
	
	if updatedDialog == nil {
		t.Error("Update returned nil")
	}
}

func TestEvalItem_Render(t *testing.T) {
	item := evalItem{
		Name:   "test-eval.js",
		Status: "passed",
	}
	
	baseStyle := styles.NewStyle()
	rendered := item.Render(false, 50, baseStyle)
	
	t.Logf("Item render: %s", rendered)
	t.Logf("Item render length: %d", len(rendered))
	
	if !strings.Contains(rendered, "test-eval.js") {
		t.Error("Rendered item doesn't contain name")
	}
}
