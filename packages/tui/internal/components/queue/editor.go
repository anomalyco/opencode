package queue

import (
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/components/toast"
	"github.com/sst/opencode/internal/components/textarea"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
)

// EditorComponent allows editing of queued messages
type EditorComponent struct {
	app      *app.App
	textarea textarea.Model
	active   bool
}

// NewEditorComponent creates a new queue editor component
func NewEditorComponent(app *app.App) *EditorComponent {
	ta := textarea.New()
	ta.Placeholder = "Edit your queued message..."
	ta.Focus()

	return &EditorComponent{
		app:      app,
		textarea: ta,
		active:   false,
	}
}

// Activate opens the editor with the current queued message
func (e *EditorComponent) Activate() (*EditorComponent, tea.Cmd) {
	content, attachments, exists := e.app.EditQueuedMessage()
	if !exists {
		return e, toast.NewErrorToast("No message in queue to edit")
	}

	// Set the content in the textarea
	e.textarea.SetValue(content)
	
	// TODO: Handle attachments - for now we'll focus on text content
	// In a full implementation, we'd need to display and allow editing of attachments
	_ = attachments

	e.active = true
	e.textarea.Focus()

	return e, nil
}

// Deactivate closes the editor
func (e *EditorComponent) Deactivate() *EditorComponent {
	e.active = false
	e.textarea.Blur()
	return e
}

// IsActive returns whether the editor is currently active
func (e *EditorComponent) IsActive() bool {
	return e.active
}

// Update handles the editor's update cycle
func (e *EditorComponent) Update(msg tea.Msg) (*EditorComponent, tea.Cmd) {
	if !e.active {
		return e, nil
	}

	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+s", "ctrl+enter":
			// Save the edited message
			return e.save()
		case "esc", "ctrl+c":
			// Cancel editing
			return e.cancel()
		}
	}

	// Update the textarea
	var cmd tea.Cmd
	e.textarea, cmd = e.textarea.Update(msg)
	return e, cmd
}

// save updates the queued message with the edited content
func (e *EditorComponent) save() (*EditorComponent, tea.Cmd) {
	content := e.textarea.Value()
	if content == "" {
		return e, toast.NewErrorToast("Message cannot be empty")
	}

	// Get current attachments (we're not editing these in this simple implementation)
	_, attachments, exists := e.app.EditQueuedMessage()
	if !exists {
		return e, toast.NewErrorToast("No message in queue")
	}

	// Update the queued message
	success := e.app.UpdateQueuedMessage(content, attachments)
	if !success {
		return e, toast.NewErrorToast("Failed to update queued message")
	}

	e.active = false
	e.textarea.Blur()
	return e, toast.NewInfoToast("Queued message updated")
}

// cancel discards changes and closes the editor
func (e *EditorComponent) cancel() (*EditorComponent, tea.Cmd) {
	e.active = false
	e.textarea.Blur()
	return e, nil
}

// View renders the queue editor
func (e *EditorComponent) View(width, height int) string {
	if !e.active {
		return ""
	}

	t := theme.CurrentTheme()
	
	// Set textarea dimensions
	e.textarea.SetWidth(width - 4) // Account for padding
	e.textarea.SetHeight(height - 6) // Account for header, footer, and padding

	headerStyle := lipgloss.NewStyle().
		Foreground(t.Text()).
		Background(t.Primary()).
		Padding(0, 1).
		Width(width - 2).
		Align(lipgloss.Center)

	footerStyle := lipgloss.NewStyle().
		Foreground(t.TextMuted()).
		Padding(0, 1).
		Width(width - 2).
		Align(lipgloss.Center)

	containerStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(t.Primary()).
		Padding(1)

	header := headerStyle.Render("Edit Queued Message")
	footer := footerStyle.Render("Ctrl+S to save • Esc to cancel")
	content := e.textarea.View()

	return containerStyle.Render(
		lipgloss.JoinVertical(lipgloss.Left,
			header,
			"",
			content,
			"",
			footer,
		),
	)
}

// ClearQueue provides a command to clear the message queue
func (e *EditorComponent) ClearQueue() tea.Cmd {
	return util.CmdHandler(app.ClearQueueMsg{})
}