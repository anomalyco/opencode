package dialog

import (
	"context"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/components/list"
	"github.com/sst/opencode/internal/components/modal"
	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/util"
	"github.com/sst/opencode/pkg/client"
)

// SessionDialog interface for the session switching dialog
type SessionDialog interface {
	layout.Modal
}

type sessionDialog struct {
	width    int
	height   int
	modal    *modal.Modal
	sessions []client.SessionInfo
	list     list.List[list.StringItem]
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
			if _, idx := s.list.GetSelectedItem(); idx >= 0 && idx < len(s.sessions) {
				selectedSession := s.sessions[idx]
				return s, tea.Sequence(
					util.CmdHandler(modal.CloseModalMsg{}),
					util.CmdHandler(app.SessionSelectedMsg(&selectedSession)),
				)
			}
		}
	}

	var cmd tea.Cmd
	listModel, cmd := s.list.Update(msg)
	s.list = listModel.(list.List[list.StringItem])
	return s, cmd
}

func (s *sessionDialog) Render(background string) string {
	return s.modal.Render(s.list.View(), background)
}

func (s *sessionDialog) Close() tea.Cmd {
	return nil
}

// NewSessionDialog creates a new session switching dialog
func NewSessionDialog(app *app.App) SessionDialog {
	sessions, _ := app.ListSessions(context.Background())

	var filteredSessions []client.SessionInfo
	var sessionTitles []string
	for _, sess := range sessions {
		if sess.ParentID != nil {
			continue
		}
		filteredSessions = append(filteredSessions, sess)
		sessionTitles = append(sessionTitles, sess.Title)
	}

	list := list.NewStringList(
		sessionTitles,
		10, // maxVisibleSessions
		"No sessions available",
		true, // useAlphaNumericKeys
	)
	list.SetMaxWidth(layout.Current.Container.Width - 12)

	return &sessionDialog{
		sessions: filteredSessions,
		list:     list,
		modal: modal.New(
			modal.WithTitle("Switch Session"),
			modal.WithMaxWidth(layout.Current.Container.Width-8),
		),
	}
}
