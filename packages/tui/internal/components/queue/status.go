package queue

import (
	"fmt"

	"github.com/charmbracelet/lipgloss/v2"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/theme"
)

// StatusComponent displays the current queue status
type StatusComponent struct {
	app *app.App
}

// NewStatusComponent creates a new queue status component
func NewStatusComponent(app *app.App) *StatusComponent {
	return &StatusComponent{app: app}
}

// View renders the queue status if there's a queued message
func (s *StatusComponent) View() string {
	if s.app.MessageQueue.IsEmpty() {
		return ""
	}

	preview := s.app.MessageQueue.GetPreview(47)
	if preview == "" {
		return ""
	}

	t := theme.CurrentTheme()
	style := lipgloss.NewStyle().
		Foreground(t.Warning()).
		Background(t.BackgroundPanel()).
		Padding(0, 1).
		MarginTop(1)

	return style.Render(fmt.Sprintf("📫 Queued: %s (<leader>b to edit)", preview))
}

// Height returns the height of the queue status component
func (s *StatusComponent) Height() int {
	if s.app.MessageQueue.IsEmpty() {
		return 0
	}
	return 2 // 1 line for content + 1 for margin
}