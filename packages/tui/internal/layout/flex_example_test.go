package layout_test

import (
	"fmt"
	"github.com/sst/opencode/internal/layout"
)

func ExampleRender_withGap() {
	// Create a horizontal layout with 3px gap between items
	result := layout.Render(
		layout.FlexOptions{
			Direction: layout.Row,
			Width:     30,
			Height:    1,
			Gap:       3,
		},
		layout.FlexItem{View: "Item1"},
		layout.FlexItem{View: "Item2"},
		layout.FlexItem{View: "Item3"},
	)
	fmt.Println(result)
	// Output: Item1   Item2   Item3
}

func ExampleRender_withGapAndJustify() {
	// Create a horizontal layout with gap and space-between justification
	result := layout.Render(
		layout.FlexOptions{
			Direction: layout.Row,
			Width:     30,
			Height:    1,
			Gap:       2,
			Justify:   layout.JustifySpaceBetween,
		},
		layout.FlexItem{View: "A"},
		layout.FlexItem{View: "B"},
		layout.FlexItem{View: "C"},
	)
	fmt.Println(result)
	// Output: A             B             C
}
