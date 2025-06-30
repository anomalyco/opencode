package layout

import (
	tea "github.com/charmbracelet/bubbletea/v2"
)

var Current *LayoutInfo

func init() {
	Current = &LayoutInfo{
		Viewport:  Dimensions{Width: 80, Height: 25},
		Container: Dimensions{Width: 80, Height: 25},
	}
}

type LayoutSize string

type Dimensions struct {
	Width  int
	Height int
}

type LayoutInfo struct {
	Viewport  Dimensions
	Container Dimensions
}

type Modal interface {
	tea.Model
	Render(background string) string
	Close() tea.Cmd
}
