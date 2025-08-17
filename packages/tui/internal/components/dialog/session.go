package dialog

import (
	"context"
	"strings"

	"slices"

	"github.com/charmbracelet/bubbles/v2/textinput"
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
	isCurrentSession   bool
}

func (s sessionItem) Render(
	selected bool,
	width int,
	isFirstInViewport bool,
	baseStyle styles.Style,
) string {
	t := theme.CurrentTheme()

	var text string
	if s.isDeleteConfirming {
		text = "Press again to confirm delete"
	} else {
		if s.isCurrentSession {
			text = "● " + s.title
		} else {
			text = s.title
		}
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
		} else if s.isCurrentSession {
			// Different style for current session when selected
			itemStyle = baseStyle.
				Background(t.Primary()).
				Foreground(t.BackgroundElement()).
				Width(width).
				PaddingLeft(1).
				Bold(true)
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
		} else if s.isCurrentSession {
			// Highlight current session when not selected
			itemStyle = baseStyle.
				Foreground(t.Primary()).
				PaddingLeft(1).
				Bold(true)
		} else {
			itemStyle = baseStyle.
				PaddingLeft(1)
		}
	}

	return itemStyle.Render(truncatedStr)
}

func (s sessionItem) Selectable() bool {
	return true
}

type sessionDialog struct {
	width              int
	height             int
	modal              *modal.Modal
	sessions           []opencode.Session
	list               list.List[sessionItem]
	app                *app.App
	deleteConfirmation int // -1 means no confirmation, >= 0 means confirming deletion of session at this index
	renameMode         bool
	renameInput        textinput.Model
	renameIndex        int // index of session being renamed
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
		if s.renameMode {
			switch msg.String() {
			case "enter":
				if _, idx := s.list.GetSelectedItem(); idx >= 0 && idx < len(s.sessions) && idx == s.renameIndex {
					newTitle := s.renameInput.Value()
					if strings.TrimSpace(newTitle) != "" {
						sessionToUpdate := s.sessions[idx]
						return s, tea.Sequence(
							func() tea.Msg {
								ctx := context.Background()
								err := s.app.UpdateSession(ctx, sessionToUpdate.ID, newTitle)
								if err != nil {
									return toast.NewErrorToast("Failed to rename session: " + err.Error())()
								}
								s.sessions[idx].Title = newTitle
								s.renameMode = false
								s.modal.SetTitle("Switch Session")
								s.updateListItems()
								return toast.NewSuccessToast("Session renamed successfully")()
							},
						)
					}
				}
				s.renameMode = false
				s.modal.SetTitle("Switch Session")
				s.updateListItems()
				return s, nil
			default:
				var cmd tea.Cmd
				s.renameInput, cmd = s.renameInput.Update(msg)
				return s, cmd
			}
		} else {
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
			case "n":
				return s, tea.Sequence(
					util.CmdHandler(modal.CloseModalMsg{}),
					util.CmdHandler(app.SessionClearedMsg{}),
				)
			case "r":
				if _, idx := s.list.GetSelectedItem(); idx >= 0 && idx < len(s.sessions) {
					s.renameMode = true
					s.renameIndex = idx
					s.setupRenameInput(s.sessions[idx].Title)
					s.modal.SetTitle("Rename Session")
					s.updateListItems()
					return s, textinput.Blink
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
	}

	if !s.renameMode {
		var cmd tea.Cmd
		listModel, cmd := s.list.Update(msg)
		s.list = listModel.(list.List[sessionItem])
		return s, cmd
	}
	return s, nil
}

func (s *sessionDialog) Render(background string) string {
	if s.renameMode {
		// Show rename input instead of list
		t := theme.CurrentTheme()
		renameView := s.renameInput.View()

		mutedStyle := styles.NewStyle().
			Foreground(t.TextMuted()).
			Background(t.BackgroundPanel()).
			Render
		helpText := mutedStyle("Enter to confirm, Esc to cancel")
		helpText = styles.NewStyle().PaddingLeft(1).PaddingTop(1).Render(helpText)

		content := strings.Join([]string{renameView, helpText}, "\n")
		return s.modal.Render(content, background)
	}

	listView := s.list.View()

	t := theme.CurrentTheme()
	keyStyle := styles.NewStyle().
		Foreground(t.Text()).
		Background(t.BackgroundPanel()).
		Bold(true).
		Render
	mutedStyle := styles.NewStyle().Foreground(t.TextMuted()).Background(t.BackgroundPanel()).Render

	leftHelp := keyStyle("n") + mutedStyle(" new   ") + keyStyle("r") + mutedStyle(" rename")
	rightHelp := keyStyle("x/del") + mutedStyle(" delete")

	bgColor := t.BackgroundPanel()
	helpText := layout.Render(layout.FlexOptions{
		Direction:  layout.Row,
		Justify:    layout.JustifySpaceBetween,
		Width:      layout.Current.Container.Width - 14,
		Background: &bgColor,
	}, layout.FlexItem{View: leftHelp}, layout.FlexItem{View: rightHelp})

	helpText = styles.NewStyle().PaddingLeft(1).PaddingTop(1).Render(helpText)

	content := strings.Join([]string{listView, helpText}, "\n")

	return s.modal.Render(content, background)
}

func (s *sessionDialog) setupRenameInput(currentTitle string) {
	t := theme.CurrentTheme()
	bgColor := t.BackgroundPanel()
	textColor := t.Text()
	textMutedColor := t.TextMuted()

	s.renameInput = textinput.New()
	s.renameInput.SetValue(currentTitle)
	s.renameInput.Focus()
	s.renameInput.CharLimit = 100
	s.renameInput.SetWidth(layout.Current.Container.Width - 20)

	s.renameInput.Styles.Blurred.Placeholder = styles.NewStyle().
		Foreground(textMutedColor).
		Background(bgColor).
		Lipgloss()
	s.renameInput.Styles.Blurred.Text = styles.NewStyle().
		Foreground(textColor).
		Background(bgColor).
		Lipgloss()
	s.renameInput.Styles.Focused.Placeholder = styles.NewStyle().
		Foreground(textMutedColor).
		Background(bgColor).
		Lipgloss()
	s.renameInput.Styles.Focused.Text = styles.NewStyle().
		Foreground(textColor).
		Background(bgColor).
		Lipgloss()
	s.renameInput.Styles.Focused.Prompt = styles.NewStyle().
		Background(bgColor).
		Lipgloss()
}

func (s *sessionDialog) updateListItems() {
	_, currentIdx := s.list.GetSelectedItem()

	var items []sessionItem
	for i, sess := range s.sessions {
		item := sessionItem{
			title:              sess.Title,
			isDeleteConfirming: s.deleteConfirmation == i,
			isCurrentSession:   s.app.Session != nil && s.app.Session.ID == sess.ID,
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

// ReopenSessionModalMsg is emitted when the session modal should be reopened
type ReopenSessionModalMsg struct{}

func (s *sessionDialog) Close() tea.Cmd {
	if s.renameMode {
		// If in rename mode, exit rename mode and return a command to reopen the modal
		s.renameMode = false
		s.modal.SetTitle("Switch Session")
		s.updateListItems()

		// Return a command that will reopen the session modal
		return func() tea.Msg {
			return ReopenSessionModalMsg{}
		}
	}
	// Normal close behavior
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
			isCurrentSession:   app.Session != nil && app.Session.ID == sess.ID,
		})
	}

	listComponent := list.NewListComponent(
		list.WithItems(items),
		list.WithMaxVisibleHeight[sessionItem](10),
		list.WithFallbackMessage[sessionItem]("No sessions available"),
		list.WithAlphaNumericKeys[sessionItem](true),
		list.WithRenderFunc(
			func(item sessionItem, selected bool, width int, baseStyle styles.Style) string {
				return item.Render(selected, width, false, baseStyle)
			},
		),
		list.WithSelectableFunc(func(item sessionItem) bool {
			return true
		}),
	)
	listComponent.SetMaxWidth(layout.Current.Container.Width - 12)

	return &sessionDialog{
		sessions:           filteredSessions,
		list:               listComponent,
		app:                app,
		deleteConfirmation: -1,
		renameMode:         false,
		renameIndex:        -1,
		modal: modal.New(
			modal.WithTitle("Switch Session"),
			modal.WithMaxWidth(layout.Current.Container.Width-8),
		),
	}
}
