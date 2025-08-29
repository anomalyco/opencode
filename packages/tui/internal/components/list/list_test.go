package list

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/sst/opencode/internal/styles"
)

// testItem is a simple test implementation of ListItem
type testItem struct {
	value string
}

func (t testItem) Render(
	selected bool,
	width int,
	isFirstInViewport bool,
	baseStyle styles.Style,
) string {
	return t.value
}

func (t testItem) Selectable() bool {
	return true
}

// createTestList creates a list with test items for testing
func createTestList() *listComponent[testItem] {
	items := []testItem{
		{value: "item1"},
		{value: "item2"},
		{value: "item3"},
	}
	list := NewListComponent(
		WithItems(items),
		WithMaxVisibleHeight[testItem](5),
		WithFallbackMessage[testItem]("empty"),
		WithAlphaNumericKeys[testItem](false),
		WithRenderFunc(
			func(item testItem, selected bool, width int, baseStyle styles.Style) string {
				return item.Render(selected, width, false, baseStyle)
			},
		),
		WithSelectableFunc(func(item testItem) bool {
			return item.Selectable()
		}),
	)

	return list.(*listComponent[testItem])
}

func TestArrowKeyNavigation(t *testing.T) {
	list := createTestList()

	// Test down arrow navigation
	downKey := tea.KeyPressMsg{Code: tea.KeyDown}
	updatedModel, _ := list.Update(downKey)
	list = updatedModel.(*listComponent[testItem])
	_, idx := list.GetSelectedItem()
	if idx != 1 {
		t.Errorf("Expected selected index 1 after down arrow, got %d", idx)
	}

	// Test up arrow navigation
	upKey := tea.KeyPressMsg{Code: tea.KeyUp}
	updatedModel, _ = list.Update(upKey)
	list = updatedModel.(*listComponent[testItem])
	_, idx = list.GetSelectedItem()
	if idx != 0 {
		t.Errorf("Expected selected index 0 after up arrow, got %d", idx)
	}
}

func TestJKKeyNavigation(t *testing.T) {
	items := []testItem{
		{value: "item1"},
		{value: "item2"},
		{value: "item3"},
	}
	// Create list with alpha keys enabled
	list := NewListComponent(
		WithItems(items),
		WithMaxVisibleHeight[testItem](5),
		WithFallbackMessage[testItem]("empty"),
		WithAlphaNumericKeys[testItem](true),
		WithRenderFunc(
			func(item testItem, selected bool, width int, baseStyle styles.Style) string {
				return item.Render(selected, width, false, baseStyle)
			},
		),
		WithSelectableFunc(func(item testItem) bool {
			return item.Selectable()
		}),
	)

	// Test j key (down)
	jKey := tea.KeyPressMsg{Code: 'j', Text: "j"}
	updatedModel, _ := list.Update(jKey)
	list = updatedModel.(*listComponent[testItem])
	_, idx := list.GetSelectedItem()
	if idx != 1 {
		t.Errorf("Expected selected index 1 after 'j' key, got %d", idx)
	}

	// Test k key (up)
	kKey := tea.KeyPressMsg{Code: 'k', Text: "k"}
	updatedModel, _ = list.Update(kKey)
	list = updatedModel.(*listComponent[testItem])
	_, idx = list.GetSelectedItem()
	if idx != 0 {
		t.Errorf("Expected selected index 0 after 'k' key, got %d", idx)
	}
}

func TestCtrlNavigation(t *testing.T) {
	list := createTestList()

	// Test Ctrl-N (down)
	ctrlN := tea.KeyPressMsg{Code: 'n', Mod: tea.ModCtrl}
	updatedModel, _ := list.Update(ctrlN)
	list = updatedModel.(*listComponent[testItem])
	_, idx := list.GetSelectedItem()
	if idx != 1 {
		t.Errorf("Expected selected index 1 after Ctrl-N, got %d", idx)
	}

	// Test Ctrl-P (up)
	ctrlP := tea.KeyPressMsg{Code: 'p', Mod: tea.ModCtrl}
	updatedModel, _ = list.Update(ctrlP)
	list = updatedModel.(*listComponent[testItem])
	_, idx = list.GetSelectedItem()
	if idx != 0 {
		t.Errorf("Expected selected index 0 after Ctrl-P, got %d", idx)
	}
}

func TestNavigationBoundaries(t *testing.T) {
	list := createTestList()

	// Test up arrow at first item (should wrap to last item)
	upKey := tea.KeyPressMsg{Code: tea.KeyUp}
	updatedModel, _ := list.Update(upKey)
	list = updatedModel.(*listComponent[testItem])
	_, idx := list.GetSelectedItem()
	if idx != 2 {
		t.Errorf("Expected to wrap to index 2 when pressing up at first item, got %d", idx)
	}

	// Move to first item
	list.SetSelectedIndex(0)

	// Move to last item
	downKey := tea.KeyPressMsg{Code: tea.KeyDown}
	updatedModel, _ = list.Update(downKey)
	list = updatedModel.(*listComponent[testItem])
	updatedModel, _ = list.Update(downKey)
	list = updatedModel.(*listComponent[testItem])
	_, idx = list.GetSelectedItem()
	if idx != 2 {
		t.Errorf("Expected to be at index 2, got %d", idx)
	}

	// Test down arrow at last item (should wrap to first item)
	updatedModel, _ = list.Update(downKey)
	list = updatedModel.(*listComponent[testItem])
	_, idx = list.GetSelectedItem()
	if idx != 0 {
		t.Errorf("Expected to wrap to index 0 when pressing down at last item, got %d", idx)
	}
}

func TestEmptyList(t *testing.T) {
	emptyList := NewListComponent(
		WithItems([]testItem{}),
		WithMaxVisibleHeight[testItem](5),
		WithFallbackMessage[testItem]("empty"),
		WithAlphaNumericKeys[testItem](false),
		WithRenderFunc(
			func(item testItem, selected bool, width int, baseStyle styles.Style) string {
				return item.Render(selected, width, false, baseStyle)
			},
		),
		WithSelectableFunc(func(item testItem) bool {
			return item.Selectable()
		}),
	)

	// Test navigation on empty list (should not crash)
	downKey := tea.KeyPressMsg{Code: tea.KeyDown}
	upKey := tea.KeyPressMsg{Code: tea.KeyUp}
	ctrlN := tea.KeyPressMsg{Code: 'n', Mod: tea.ModCtrl}
	ctrlP := tea.KeyPressMsg{Code: 'p', Mod: tea.ModCtrl}

	updatedModel, _ := emptyList.Update(downKey)
	emptyList = updatedModel.(*listComponent[testItem])
	updatedModel, _ = emptyList.Update(upKey)
	emptyList = updatedModel.(*listComponent[testItem])
	updatedModel, _ = emptyList.Update(ctrlN)
	emptyList = updatedModel.(*listComponent[testItem])
	updatedModel, _ = emptyList.Update(ctrlP)
	emptyList = updatedModel.(*listComponent[testItem])

	// Verify empty list behavior
	_, idx := emptyList.GetSelectedItem()
	if idx != -1 {
		t.Errorf("Expected index -1 for empty list, got %d", idx)
	}

	if !emptyList.IsEmpty() {
		t.Error("Expected IsEmpty() to return true for empty list")
	}
}

func TestWrapAroundNavigation(t *testing.T) {
	list := createTestList()

	// Start at first item (index 0)
	_, idx := list.GetSelectedItem()
	if idx != 0 {
		t.Errorf("Expected to start at index 0, got %d", idx)
	}

	// Press up arrow - should wrap to last item (index 2)
	upKey := tea.KeyPressMsg{Code: tea.KeyUp}
	updatedModel, _ := list.Update(upKey)
	list = updatedModel.(*listComponent[testItem])
	_, idx = list.GetSelectedItem()
	if idx != 2 {
		t.Errorf("Expected to wrap to index 2 when pressing up from first item, got %d", idx)
	}

	// Press down arrow - should wrap to first item (index 0)
	downKey := tea.KeyPressMsg{Code: tea.KeyDown}
	updatedModel, _ = list.Update(downKey)
	list = updatedModel.(*listComponent[testItem])
	_, idx = list.GetSelectedItem()
	if idx != 0 {
		t.Errorf("Expected to wrap to index 0 when pressing down from last item, got %d", idx)
	}

	// Navigate to middle and verify normal navigation still works
	updatedModel, _ = list.Update(downKey)
	list = updatedModel.(*listComponent[testItem])
	_, idx = list.GetSelectedItem()
	if idx != 1 {
		t.Errorf("Expected to move to index 1, got %d", idx)
	}
}
