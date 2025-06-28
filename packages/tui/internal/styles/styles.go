package styles

import (
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/charmbracelet/lipgloss/v2/compat"
)

func WhitespaceStyle(bg compat.AdaptiveColor) lipgloss.WhitespaceOption {
	return lipgloss.WithWhitespaceStyle(NewStyle().Background(bg).Lipgloss())
}
