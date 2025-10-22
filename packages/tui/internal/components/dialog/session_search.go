package dialog

import (
	"context"
	"strings"

	"github.com/charmbracelet/bubbles/v2/textinput"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/muesli/reflow/truncate"
	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/components/list"
	"github.com/sst/opencode/internal/components/modal"
	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
)

// SessionSearchDialog interface for the session search dialog
type SessionSearchDialog interface {
	layout.Modal
}

// sessionSearchItem is a list item for session search results
type sessionSearchItem struct {
	session          opencode.Session
	matchedTitle     string
	matchedContent   string
	isCurrentSession bool
}

func (s sessionSearchItem) Render(
	selected bool,
	width int,
	isFirstInViewport bool,
	baseStyle styles.Style,
) string {
	t := theme.CurrentTheme()

	var text string
	if s.isCurrentSession {
		text = "● " + s.matchedTitle
	} else {
		text = s.matchedTitle
	}

	// Add matched content snippet if available
	if s.matchedContent != "" {
		snippet := truncate.StringWithTail(s.matchedContent, uint(width/2), "...")
		if snippet != "" {
			text += " - " + snippet
		}
	}

	truncatedStr := truncate.StringWithTail(text, uint(width-1), "...")

	var itemStyle styles.Style
	if selected {
		if s.isCurrentSession {
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
		if s.isCurrentSession {
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

func (s sessionSearchItem) Selectable() bool {
	return true
}

type sessionSearchDialog struct {
	width       int
	height      int
	modal       *modal.Modal
	sessions    []opencode.Session
	allSessions []opencode.Session
	list        list.List[sessionSearchItem]
	app         *app.App
	searchInput textinput.Model
	query       string
}

func (s *sessionSearchDialog) Init() tea.Cmd {
	return textinput.Blink
}

func (s *sessionSearchDialog) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		s.width = msg.Width
		s.height = msg.Height
		s.list.SetMaxWidth(layout.Current.Container.Width - 12)
		s.searchInput.SetWidth(layout.Current.Container.Width - 14)
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
		case "n":
			return s, tea.Sequence(
				util.CmdHandler(modal.CloseModalMsg{}),
				util.CmdHandler(app.SessionClearedMsg{}),
			)
		case "esc":
			return s, func() tea.Msg { return SearchCancelledMsg{} }
		}

		// Handle search input
		var cmd tea.Cmd
		s.searchInput, cmd = s.searchInput.Update(msg)
		if cmd != nil {
			cmds = append(cmds, cmd)
		}

		// Update search query and filter sessions
		newQuery := s.searchInput.Value()
		if newQuery != s.query {
			s.query = newQuery
			s.filterSessions()
		}
	}

	// Update list
	var cmd tea.Cmd
	listModel, cmd := s.list.Update(msg)
	s.list = listModel.(list.List[sessionSearchItem])
	if cmd != nil {
		cmds = append(cmds, cmd)
	}

	return s, tea.Batch(cmds...)
}

func (s *sessionSearchDialog) Render(background string) string {
	t := theme.CurrentTheme()

	// Render search input
	searchView := s.searchInput.View()

	// Render list
	listView := s.list.View()

	// Help text
	keyStyle := styles.NewStyle().
		Foreground(t.Text()).
		Background(t.BackgroundPanel()).
		Bold(true).
		Render
	mutedStyle := styles.NewStyle().Foreground(t.TextMuted()).Background(t.BackgroundPanel()).Render

	leftHelp := keyStyle("n") + mutedStyle(" new")
	rightHelp := keyStyle("esc") + mutedStyle(" cancel")

	bgColor := t.BackgroundPanel()
	helpText := layout.Render(layout.FlexOptions{
		Direction:  layout.Row,
		Justify:    layout.JustifySpaceBetween,
		Width:      layout.Current.Container.Width - 14,
		Background: &bgColor,
	}, layout.FlexItem{View: leftHelp}, layout.FlexItem{View: rightHelp})

	helpText = styles.NewStyle().PaddingLeft(1).PaddingTop(1).Render(helpText)

	content := strings.Join([]string{searchView, "", listView, helpText}, "\n")

	return s.modal.Render(content, background)
}

func (s *sessionSearchDialog) filterSessions() {
	query := strings.ToLower(strings.TrimSpace(s.query))

	if query == "" {
		// Show all sessions when query is empty
		s.sessions = s.allSessions
	} else {
		// Filter sessions based on query
		var filteredSessions []opencode.Session
		for _, session := range s.allSessions {
			titleMatch := strings.Contains(strings.ToLower(session.Title), query)
			contentMatch := false

			// You could extend this to search within session content if needed
			// For now, just search in titles

			if titleMatch || contentMatch {
				filteredSessions = append(filteredSessions, session)
			}
		}
		s.sessions = filteredSessions
	}

	// Update list items
	var items []sessionSearchItem
	for _, session := range s.sessions {
		// Highlight matching parts in title
		matchedTitle := session.Title
		if query != "" {
			matchedTitle = s.highlightMatch(session.Title, query)
		}

		item := sessionSearchItem{
			session:          session,
			matchedTitle:     matchedTitle,
			matchedContent:   "", // Could be populated with content snippets
			isCurrentSession: s.app.Session != nil && s.app.Session.ID == session.ID,
		}
		items = append(items, item)
	}
	s.list.SetItems(items)
}

func (s *sessionSearchDialog) highlightMatch(text, query string) string {
	if query == "" {
		return text
	}

	// Simple highlighting - in a real implementation you might want to use
	// terminal escape codes for actual highlighting
	lowerText := strings.ToLower(text)
	lowerQuery := strings.ToLower(query)

	if idx := strings.Index(lowerText, lowerQuery); idx >= 0 {
		// For now, just return the original text
		// In a full implementation, you could add ANSI escape codes for highlighting
		return text
	}

	return text
}

func (s *sessionSearchDialog) Close() tea.Cmd {
	return nil
}

// NewSessionSearchDialog creates a new session search dialog
func NewSessionSearchDialog(app *app.App) SessionSearchDialog {
	sessions, _ := app.ListSessions(context.Background())

	var filteredSessions []opencode.Session
	for _, sess := range sessions {
		if sess.ParentID != "" {
			continue
		}
		filteredSessions = append(filteredSessions, sess)
	}

	// Setup search input
	t := theme.CurrentTheme()
	bgColor := t.BackgroundPanel()
	textColor := t.Text()
	textMutedColor := t.TextMuted()

	ti := textinput.New()
	ti.Placeholder = "Search sessions..."
	ti.Styles.Blurred.Placeholder = styles.NewStyle().
		Foreground(textMutedColor).
		Background(bgColor).
		Lipgloss()
	ti.Styles.Blurred.Text = styles.NewStyle().
		Foreground(textColor).
		Background(bgColor).
		Lipgloss()
	ti.Styles.Focused.Placeholder = styles.NewStyle().
		Foreground(textMutedColor).
		Background(bgColor).
		Lipgloss()
	ti.Styles.Focused.Text = styles.NewStyle().
		Foreground(textColor).
		Background(bgColor).
		Lipgloss()
	ti.Styles.Focused.Prompt = styles.NewStyle().
		Background(bgColor).
		Lipgloss()
	ti.Styles.Cursor.Color = t.Primary()
	ti.VirtualCursor = true

	ti.Prompt = " "
	ti.CharLimit = -1
	ti.Focus()
	ti.SetWidth(layout.Current.Container.Width - 14)

	// Create initial list items
	var items []sessionSearchItem
	for _, sess := range filteredSessions {
		item := sessionSearchItem{
			session:          sess,
			matchedTitle:     sess.Title,
			matchedContent:   "",
			isCurrentSession: app.Session != nil && app.Session.ID == sess.ID,
		}
		items = append(items, item)
	}

	listComponent := list.NewListComponent(
		list.WithItems(items),
		list.WithMaxVisibleHeight[sessionSearchItem](10),
		list.WithFallbackMessage[sessionSearchItem]("No sessions found"),
		list.WithAlphaNumericKeys[sessionSearchItem](true),
		list.WithRenderFunc(
			func(item sessionSearchItem, selected bool, width int, baseStyle styles.Style) string {
				return item.Render(selected, width, false, baseStyle)
			},
		),
		list.WithSelectableFunc(func(item sessionSearchItem) bool {
			return true
		}),
	)
	listComponent.SetMaxWidth(layout.Current.Container.Width - 12)

	return &sessionSearchDialog{
		sessions:    filteredSessions,
		allSessions: filteredSessions,
		list:        listComponent,
		app:         app,
		searchInput: ti,
		query:       "",
		modal: modal.New(
			modal.WithTitle("Search Sessions"),
			modal.WithMaxWidth(layout.Current.Container.Width-8),
		),
	}
}
