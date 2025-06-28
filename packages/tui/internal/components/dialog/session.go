package dialog

import (
	"context"
	"strings"

	"slices"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/muesli/reflow/truncate"
	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/components/list"
	"github.com/sst/opencode/internal/components/modal"
	"github.com/sst/opencode/internal/components/toast"
	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
)

// SessionDialog interface for the session switching dialog
type SessionDialog interface {
	layout.Modal
}

// sessionItem is a custom list item for sessions that can show delete confirmation
type sessionItem struct {
	title              string
	isDeleteConfirming bool
}

func (s sessionItem) Render(selected bool, width int) string {
	t := theme.CurrentTheme()
	baseStyle := styles.NewStyle()

	var text string
	if s.isDeleteConfirming {
		text = "Press again to confirm delete"
	} else {
		text = s.title
	}

	truncatedStr := truncate.StringWithTail(text, uint(width-1), "...")

	var itemStyle styles.Style
	if selected {
		if s.isDeleteConfirming {
			// Red background for delete confirmation
			itemStyle = baseStyle.
				Background(t.Error()).
				Foreground(t.BackgroundElement()).
				Width(width).
				PaddingLeft(1)
		} else {
			// Normal selection
			itemStyle = baseStyle.
				Background(t.Primary()).
				Foreground(t.BackgroundElement()).
				Width(width).
				PaddingLeft(1)
		}
	} else {
		if s.isDeleteConfirming {
			// Red text for delete confirmation when not selected
			itemStyle = baseStyle.
				Foreground(t.Error()).
				PaddingLeft(1)
		} else {
			itemStyle = baseStyle.
				PaddingLeft(1)
		}
	}

	return itemStyle.Render(truncatedStr)
}

type sessionDialog struct {
	width              int
	height             int
	modal              *modal.Modal
	sessions           []opencode.Session
	list               list.List[sessionItem]
	app                *app.App
	deleteConfirmation int // -1 means no confirmation, >= 0 means confirming deletion of session at this index
}

func (s *sessionDialog) Init() tea.Cmd {
	return nil
}

func (s *sessionDialog) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		s.width = msg.Width
		s.height = msg.Height
		s.list.SetMaxWidth(layout.Current.Container.Width - 12)
	case tea.KeyPressMsg:
		switch msg.String() {
		case "enter":
			if s.deleteConfirmation >= 0 {
				s.deleteConfirmation = -1
				s.updateListItems()
				return s, nil
			}
			if _, idx := s.list.GetSelectedItem(); idx >= 0 && idx < len(s.sessions) {
				selectedSession := s.sessions[idx]
				return s, tea.Sequence(
					util.CmdHandler(modal.CloseModalMsg{}),
					util.CmdHandler(app.SessionSelectedMsg(&selectedSession)),
				)
			}
		case "x", "delete", "backspace":
			if _, idx := s.list.GetSelectedItem(); idx >= 0 && idx < len(s.sessions) {
				if s.deleteConfirmation == idx {
					// Second press - actually delete the session
					sessionToDelete := s.sessions[idx]
					return s, tea.Sequence(
						func() tea.Msg {
							s.sessions = slices.Delete(s.sessions, idx, idx+1)
							s.deleteConfirmation = -1
							s.updateListItems()
							return nil
						},
						s.deleteSession(sessionToDelete.ID),
					)
				} else {
					// First press - enter delete confirmation mode
					s.deleteConfirmation = idx
					s.updateListItems()
					return s, nil
				}
			}
		case "esc":
			if s.deleteConfirmation >= 0 {
				s.deleteConfirmation = -1
				s.updateListItems()
				return s, nil
			}
		}
	}

	var cmd tea.Cmd
	listModel, cmd := s.list.Update(msg)
	s.list = listModel.(list.List[sessionItem])
	return s, cmd
}

func (s *sessionDialog) Render(background string) string {
	listView := s.list.View()

	t := theme.CurrentTheme()
	helpStyle := styles.NewStyle().PaddingLeft(1).PaddingTop(1)
	helpText := styles.NewStyle().Foreground(t.Text()).Render("x/del")
	helpText = helpText + styles.NewStyle().Background(t.BackgroundElement()).Foreground(t.TextMuted()).Render(" delete session")
	helpText = helpStyle.Render(helpText)

	content := strings.Join([]string{listView, helpText}, "\n")

	return s.modal.Render(content, background)
}

func (s *sessionDialog) updateListItems() {
	_, currentIdx := s.list.GetSelectedItem()

	var items []sessionItem
	for i, sess := range s.sessions {
		item := sessionItem{
			title:              sess.Title,
			isDeleteConfirming: s.deleteConfirmation == i,
		}
		items = append(items, item)
	}
	s.list.SetItems(items)
	s.list.SetSelectedIndex(currentIdx)
}

func (s *sessionDialog) deleteSession(sessionID string) tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		if err := s.app.DeleteSession(ctx, sessionID); err != nil {
			return toast.NewErrorToast("Failed to delete session: " + err.Error())()
		}
		return nil
	}
}

func (s *sessionDialog) Close() tea.Cmd {
	return nil
}

// NewSessionDialog creates a new session switching dialog
func NewSessionDialog(app *app.App) SessionDialog {
	sessions, _ := app.ListSessions(context.Background())

	var filteredSessions []opencode.Session
	var items []sessionItem
	for _, sess := range sessions {
		if sess.ParentID != "" {
			continue
		}
		filteredSessions = append(filteredSessions, sess)
		items = append(items, sessionItem{
			title:              sess.Title,
			isDeleteConfirming: false,
		})
	}

	// Create a generic list component
	listComponent := list.NewListComponent(
		items,
		10, // maxVisibleSessions
		"No sessions available",
		true, // useAlphaNumericKeys
	)
	listComponent.SetMaxWidth(layout.Current.Container.Width - 12)

	return &sessionDialog{
		sessions:           filteredSessions,
		list:               listComponent,
		app:                app,
		deleteConfirmation: -1,
		modal: modal.New(
			modal.WithTitle("Switch Session"),
			modal.WithMaxWidth(layout.Current.Container.Width-8),
		),
	}
}
