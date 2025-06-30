package chat

import (
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/v2/spinner"
	"github.com/charmbracelet/bubbles/v2/viewport"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/components/commands"
	"github.com/sst/opencode/internal/components/dialog"
	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
)

type MessagesComponent interface {
	tea.Model
	tea.ViewModel
	PageUp() (tea.Model, tea.Cmd)
	PageDown() (tea.Model, tea.Cmd)
	HalfPageUp() (tea.Model, tea.Cmd)
	HalfPageDown() (tea.Model, tea.Cmd)
	First() (tea.Model, tea.Cmd)
	Last() (tea.Model, tea.Cmd)
	// Previous() (tea.Model, tea.Cmd)
	// Next() (tea.Model, tea.Cmd)
	ToolDetailsVisible() bool
}

type messagesComponent struct {
	width, height   int
	app             *app.App
	viewport        viewport.Model
	spinner         spinner.Model
	attachments     viewport.Model
	commands        commands.CommandsComponent
	cache           *MessageCache
	rendering       bool
	showToolDetails bool
	tail            bool
}
type renderFinishedMsg struct{}
type ToggleToolDetailsMsg struct{}

func (m *messagesComponent) Init() tea.Cmd {
	return tea.Batch(m.viewport.Init(), m.spinner.Tick, m.commands.Init())
}

func (m *messagesComponent) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd
	switch msg.(type) {
	case app.SendMsg:
		m.viewport.GotoBottom()
		m.tail = true
		return m, nil
	case app.OptimisticMessageAddedMsg:
		m.renderView()
		if m.tail {
			m.viewport.GotoBottom()
		}
		return m, nil
	case dialog.ThemeSelectedMsg:
		m.cache.Clear()
		return m, m.Reload()
	case ToggleToolDetailsMsg:
		m.showToolDetails = !m.showToolDetails
		return m, m.Reload()
	case app.SessionSelectedMsg:
		m.cache.Clear()
		m.tail = true
		return m, m.Reload()
	case app.SessionClearedMsg:
		m.cache.Clear()
		cmd := m.Reload()
		return m, cmd
	case renderFinishedMsg:
		m.rendering = false
		if m.tail {
			m.viewport.GotoBottom()
		}
	case opencode.EventListResponseEventSessionUpdated, opencode.EventListResponseEventMessageUpdated:
		m.renderView()
		if m.tail {
			m.viewport.GotoBottom()
		}
	}

	viewport, cmd := m.viewport.Update(msg)
	m.viewport = viewport
	m.tail = m.viewport.AtBottom()
	cmds = append(cmds, cmd)

	spinner, cmd := m.spinner.Update(msg)
	m.spinner = spinner
	cmds = append(cmds, cmd)

	updated, cmd := m.commands.Update(msg)
	m.commands = updated.(commands.CommandsComponent)
	cmds = append(cmds, cmd)

	return m, tea.Batch(cmds...)
}

func (m *messagesComponent) renderView() {
	if m.width == 0 {
		return
	}

	measure := util.Measure("messages.renderView")
	defer measure("messageCount", len(m.app.Messages))

	t := theme.CurrentTheme()
	blocks := make([]string, 0)

	align := lipgloss.Center
	width := layout.Current.Container.Width

	for _, message := range m.app.Messages {
		var content string
		var cached bool

		switch message.Role {
		case opencode.MessageRoleUser:
			for _, part := range message.Parts {
				switch part := part.AsUnion().(type) {
				case opencode.TextPart:
					key := m.cache.GenerateKey(message.ID, part.Text, layout.Current.Viewport.Width)
					content, cached = m.cache.Get(key)
					if !cached {
						content = renderText(
							message,
							part.Text,
							m.app.Info.User,
							m.showToolDetails,
							width,
							align,
						)
						m.cache.Set(key, content)
					}
					if content != "" {
						blocks = append(blocks, content)
					}
				}
			}

		case opencode.MessageRoleAssistant:
			for i, p := range message.Parts {
				switch part := p.AsUnion().(type) {
				case opencode.TextPart:
					finished := message.Metadata.Time.Completed > 0
					remainingParts := message.Parts[i+1:]
					toolCallParts := make([]opencode.ToolInvocationPart, 0)
					for _, part := range remainingParts {
						switch part := part.AsUnion().(type) {
						case opencode.TextPart:
							// we only want tool calls associated with the current text part.
							// if we hit another text part, we're done.
							break
						case opencode.ToolInvocationPart:
							toolCallParts = append(toolCallParts, part)
							if part.ToolInvocation.State != "result" {
								// i don't think there's a case where a tool call isn't in result state
								// and the message time is 0, but just in case
								finished = false
							}
						}
					}

					if finished {
						key := m.cache.GenerateKey(message.ID, p.Text, layout.Current.Viewport.Width, m.showToolDetails)
						content, cached = m.cache.Get(key)
						if !cached {
							content = renderText(
								message,
								p.Text,
								message.Metadata.Assistant.ModelID,
								m.showToolDetails,
								width,
								align,
								toolCallParts...,
							)
							m.cache.Set(key, content)
						}
					} else {
						content = renderText(
							message,
							p.Text,
							message.Metadata.Assistant.ModelID,
							m.showToolDetails,
							width,
							align,
							toolCallParts...,
						)
					}
					if content != "" {
						blocks = append(blocks, content)
					}
				case opencode.ToolInvocationPart:
					if !m.showToolDetails {
						continue
					}

					if part.ToolInvocation.State == "result" {
						key := m.cache.GenerateKey(message.ID,
							part.ToolInvocation.ToolCallID,
							m.showToolDetails,
							layout.Current.Viewport.Width,
						)
						content, cached = m.cache.Get(key)
						if !cached {
							content = renderToolDetails(
								part,
								message.Metadata,
								width,
								align,
							)
							m.cache.Set(key, content)
						}
					} else {
						// if the tool call isn't finished, don't cache
						content = renderToolDetails(
							part,
							message.Metadata,
							width,
							align,
						)
					}
					if content != "" {
						blocks = append(blocks, content)
					}
				}
			}

		}

		error := ""
		switch err := message.Metadata.Error.AsUnion().(type) {
		case nil:
		case opencode.MessageMetadataErrorMessageOutputLengthError:
			error = "Message output length exceeded"
		case opencode.ProviderAuthError:
			error = err.Data.Message
		case opencode.UnknownError:
			error = err.Data.Message
		}

		if error != "" {
			error = renderContentBlock(
				error,
				width,
				align,
				WithBorderColor(t.Error()),
			)
			blocks = append(blocks, error)
		}
	}

	centered := []string{}
	for _, block := range blocks {
		centered = append(centered, lipgloss.PlaceHorizontal(
			m.width,
			lipgloss.Center,
			block+"\n",
			styles.WhitespaceStyle(t.Background()),
		))
	}

	m.viewport.SetHeight(m.height - lipgloss.Height(m.header()))
	m.viewport.SetContent("\n" + strings.Join(centered, "\n") + "\n")
}

func (m *messagesComponent) header() string {
	if m.app.Session.ID == "" {
		return ""
	}

	t := theme.CurrentTheme()
	width := layout.Current.Container.Width
	base := styles.NewStyle().Foreground(t.Text()).Background(t.Background()).Render
	muted := styles.NewStyle().Foreground(t.TextMuted()).Background(t.Background()).Render
	headerLines := []string{}
	headerLines = append(headerLines, toMarkdown("# "+m.app.Session.Title, width-6, t.Background()))
	if m.app.Session.Share.URL != "" {
		headerLines = append(headerLines, muted(m.app.Session.Share.URL))
	} else {
		headerLines = append(headerLines, base("/share")+muted(" to create a shareable link"))
	}
	header := strings.Join(headerLines, "\n")

	header = styles.NewStyle().
		Background(t.Background()).
		Width(width).
		PaddingLeft(2).
		PaddingRight(2).
		BorderLeft(true).
		BorderRight(true).
		BorderBackground(t.Background()).
		BorderForeground(t.BackgroundElement()).
		BorderStyle(lipgloss.ThickBorder()).
		Render(header)

	return "\n" + header + "\n"
}

func (m *messagesComponent) View() string {
	if len(m.app.Messages) == 0 {
		return m.home()
	}
	if m.rendering {
		return lipgloss.Place(
			m.width,
			m.height,
			lipgloss.Center,
			lipgloss.Center,
			"Loading session...",
		)
	}
	t := theme.CurrentTheme()
	return lipgloss.JoinVertical(
		lipgloss.Left,
		lipgloss.PlaceHorizontal(
			m.width,
			lipgloss.Center,
			m.header(),
			styles.WhitespaceStyle(t.Background()),
		),
		m.viewport.View(),
	)
}

func (m *messagesComponent) home() string {
	t := theme.CurrentTheme()
	baseStyle := styles.NewStyle().Background(t.Background())
	base := baseStyle.Render
	muted := styles.NewStyle().Foreground(t.TextMuted()).Background(t.Background()).Render

	open := `
█▀▀█ █▀▀█ █▀▀ █▀▀▄ 
█░░█ █░░█ █▀▀ █░░█ 
▀▀▀▀ █▀▀▀ ▀▀▀ ▀  ▀ `
	code := `
█▀▀ █▀▀█ █▀▀▄ █▀▀
█░░ █░░█ █░░█ █▀▀
▀▀▀ ▀▀▀▀ ▀▀▀  ▀▀▀`

	logo := lipgloss.JoinHorizontal(
		lipgloss.Top,
		muted(open),
		base(code),
	)
	// cwd := app.Info.Path.Cwd
	// config := app.Info.Path.Config

	versionStyle := styles.NewStyle().
		Foreground(t.TextMuted()).
		Background(t.Background()).
		Width(lipgloss.Width(logo)).
		Align(lipgloss.Right)
	version := versionStyle.Render(m.app.Version)

	logoAndVersion := strings.Join([]string{logo, version}, "\n")
	logoAndVersion = lipgloss.PlaceHorizontal(
		m.width,
		lipgloss.Center,
		logoAndVersion,
		styles.WhitespaceStyle(t.Background()),
	)
	m.commands.SetBackgroundColor(t.Background())
	commands := lipgloss.PlaceHorizontal(
		m.width,
		lipgloss.Center,
		m.commands.View(),
		styles.WhitespaceStyle(t.Background()),
	)

	lines := []string{}
	lines = append(lines, logoAndVersion)
	lines = append(lines, "")
	lines = append(lines, "")
	// lines = append(lines, base("cwd ")+muted(cwd))
	// lines = append(lines, base("config ")+muted(config))
	// lines = append(lines, "")
	lines = append(lines, commands)

	return lipgloss.Place(
		m.width,
		m.height,
		lipgloss.Center,
		lipgloss.Center,
		baseStyle.Render(strings.Join(lines, "\n")),
		styles.WhitespaceStyle(t.Background()),
	)
}

func (m *messagesComponent) SetSize(width, height int) tea.Cmd {
	if m.width == width && m.height == height {
		return nil
	}
	// Clear cache on resize since width affects rendering
	if m.width != width {
		m.cache.Clear()
	}
	m.width = width
	m.height = height
	m.viewport.SetWidth(width)
	m.viewport.SetHeight(height - lipgloss.Height(m.header()))
	m.attachments.SetWidth(width + 40)
	m.attachments.SetHeight(3)
	m.commands.SetSize(width, height)
	m.renderView()
	return nil
}

func (m *messagesComponent) GetSize() (int, int) {
	return m.width, m.height
}

func (m *messagesComponent) Reload() tea.Cmd {
	m.rendering = true
	return func() tea.Msg {
		m.renderView()
		return renderFinishedMsg{}
	}
}

func (m *messagesComponent) PageUp() (tea.Model, tea.Cmd) {
	m.viewport.ViewUp()
	return m, nil
}

func (m *messagesComponent) PageDown() (tea.Model, tea.Cmd) {
	m.viewport.ViewDown()
	return m, nil
}

func (m *messagesComponent) HalfPageUp() (tea.Model, tea.Cmd) {
	m.viewport.HalfViewUp()
	return m, nil
}

func (m *messagesComponent) HalfPageDown() (tea.Model, tea.Cmd) {
	m.viewport.HalfViewDown()
	return m, nil
}

func (m *messagesComponent) First() (tea.Model, tea.Cmd) {
	m.viewport.GotoTop()
	m.tail = false
	return m, nil
}

func (m *messagesComponent) Last() (tea.Model, tea.Cmd) {
	m.viewport.GotoBottom()
	m.tail = true
	return m, nil
}

func (m *messagesComponent) ToolDetailsVisible() bool {
	return m.showToolDetails
}

func NewMessagesComponent(app *app.App) MessagesComponent {
	customSpinner := spinner.Spinner{
		Frames: []string{" ", "┃", "┃"},
		FPS:    time.Second / 3,
	}
	s := spinner.New(spinner.WithSpinner(customSpinner))

	vp := viewport.New()
	attachments := viewport.New()
	vp.KeyMap = viewport.KeyMap{}

	t := theme.CurrentTheme()
	commandsView := commands.New(
		app,
		commands.WithBackground(t.Background()),
		commands.WithLimit(6),
	)

	return &messagesComponent{
		app:             app,
		viewport:        vp,
		spinner:         s,
		attachments:     attachments,
		commands:        commandsView,
		showToolDetails: true,
		cache:           NewMessageCache(),
		tail:            true,
	}
}
