package chat

import (
	"strings"

	"github.com/charmbracelet/bubbles/v2/viewport"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/components/dialog"
	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
)

type MessagesComponent interface {
	tea.Model
	View(width, height int) string
	SetWidth(width int) tea.Cmd
	PageUp() (tea.Model, tea.Cmd)
	PageDown() (tea.Model, tea.Cmd)
	HalfPageUp() (tea.Model, tea.Cmd)
	HalfPageDown() (tea.Model, tea.Cmd)
	First() (tea.Model, tea.Cmd)
	Last() (tea.Model, tea.Cmd)
	Previous() (tea.Model, tea.Cmd)
	Next() (tea.Model, tea.Cmd)
	ToolDetailsVisible() bool
	Selected() string
}

type messagesComponent struct {
	width           int
	app             *app.App
	viewport        viewport.Model
	cache           *MessageCache
	rendering       bool
	showToolDetails bool
	tail            bool
	partCount       int
	lineCount       int
	selectedPart    int
	selectedText    string
}
type renderFinishedMsg struct{}
type selectedMessagePartChangedMsg struct {
	part int
}

type ToggleToolDetailsMsg struct{}

func (m *messagesComponent) Init() tea.Cmd {
	return tea.Batch(m.viewport.Init())
}

func (m *messagesComponent) Selected() string {
	return m.selectedText
}

func (m *messagesComponent) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd
	switch msg := msg.(type) {
	case app.SendMsg:
		m.viewport.GotoBottom()
		m.tail = true
		m.selectedPart = -1
		return m, nil
	case app.OptimisticMessageAddedMsg:
		m.tail = true
		m.rendering = true
		return m, m.Reload()
	case dialog.ThemeSelectedMsg:
		m.cache.Clear()
		m.rendering = true
		return m, m.Reload()
	case ToggleToolDetailsMsg:
		m.showToolDetails = !m.showToolDetails
		m.rendering = true
		return m, m.Reload()
	case app.SessionLoadedMsg, app.SessionClearedMsg:
		m.cache.Clear()
		m.tail = true
		m.rendering = true
		return m, m.Reload()
	case renderFinishedMsg:
		m.rendering = false
		if m.tail {
			m.viewport.GotoBottom()
		}
	case selectedMessagePartChangedMsg:
		return m, m.Reload()
	case opencode.EventListResponseEventSessionUpdated:
		if msg.Properties.Info.ID == m.app.Session.ID {
			m.renderView(m.width)
			if m.tail {
				m.viewport.GotoBottom()
			}
		}
	case opencode.EventListResponseEventMessageUpdated:
		if msg.Properties.Info.Metadata.SessionID == m.app.Session.ID {
			m.renderView(m.width)
			if m.tail {
				m.viewport.GotoBottom()
			}
		}
	}

	viewport, cmd := m.viewport.Update(msg)
	m.viewport = viewport
	m.tail = m.viewport.AtBottom()
	cmds = append(cmds, cmd)

	return m, tea.Batch(cmds...)
}

func (m *messagesComponent) renderView(width int) {
	measure := util.Measure("messages.renderView")
	defer measure("messageCount", len(m.app.Messages))

	t := theme.CurrentTheme()
	blocks := make([]string, 0)
	m.partCount = 0
	m.lineCount = 0

	orphanedToolCalls := make([]opencode.ToolInvocationPart, 0)

	for _, message := range m.app.Messages {
		var content string
		var cached bool

		switch message.Role {
		case opencode.MessageRoleUser:
		userLoop:
			for partIndex, part := range message.Parts {
				switch part := part.AsUnion().(type) {
				case opencode.TextPart:
					remainingParts := message.Parts[partIndex+1:]
					fileParts := make([]opencode.FilePart, 0)
					for _, part := range remainingParts {
						switch part := part.AsUnion().(type) {
						case opencode.FilePart:
							fileParts = append(fileParts, part)
						}
					}
					flexItems := []layout.FlexItem{}
					if len(fileParts) > 0 {
						fileStyle := styles.NewStyle().Background(t.BackgroundElement()).Foreground(t.TextMuted()).Padding(0, 1)
						mediaTypeStyle := styles.NewStyle().Background(t.Secondary()).Foreground(t.BackgroundPanel()).Padding(0, 1)
						for _, filePart := range fileParts {
							mediaType := ""
							switch filePart.MediaType {
							case "text/plain":
								mediaType = "txt"
							case "image/png", "image/jpeg", "image/gif", "image/webp":
								mediaType = "img"
								mediaTypeStyle = mediaTypeStyle.Background(t.Accent())
							case "application/pdf":
								mediaType = "pdf"
								mediaTypeStyle = mediaTypeStyle.Background(t.Primary())
							}
							flexItems = append(flexItems, layout.FlexItem{
								View: mediaTypeStyle.Render(mediaType) + fileStyle.Render(filePart.Filename),
							})
						}
					}
					bgColor := t.BackgroundPanel()
					files := layout.Render(
						layout.FlexOptions{
							Background: &bgColor,
							Width:      width - 6,
							Direction:  layout.Column,
						},
						flexItems...,
					)

					key := m.cache.GenerateKey(message.ID, part.Text, width, m.selectedPart == m.partCount, files)
					content, cached = m.cache.Get(key)
					if !cached {
						content = renderText(
							m.app,
							message,
							part.Text,
							m.app.Info.User,
							m.showToolDetails,
							m.partCount == m.selectedPart,
							width,
							files,
						)
						m.cache.Set(key, content)
					}
					if content != "" {
						m = m.updateSelected(content, part.Text)
						blocks = append(blocks, content)
					}
					// Only render the first text part
					break userLoop
				}
			}

		case opencode.MessageRoleAssistant:
			hasTextPart := false
			for partIndex, p := range message.Parts {
				switch part := p.AsUnion().(type) {
				case opencode.TextPart:
					hasTextPart = true
					finished := message.Metadata.Time.Completed > 0
					remainingParts := message.Parts[partIndex+1:]
					toolCallParts := make([]opencode.ToolInvocationPart, 0)

					// sometimes tool calls happen without an assistant message
					// these should be included in this assistant message as well
					if len(orphanedToolCalls) > 0 {
						toolCallParts = append(toolCallParts, orphanedToolCalls...)
						orphanedToolCalls = make([]opencode.ToolInvocationPart, 0)
					}

					remaining := true
					for _, part := range remainingParts {
						if !remaining {
							break
						}
						switch part := part.AsUnion().(type) {
						case opencode.TextPart:
							// we only want tool calls associated with the current text part.
							// if we hit another text part, we're done.
							remaining = false
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
						key := m.cache.GenerateKey(message.ID, p.Text, width, m.showToolDetails, m.selectedPart == m.partCount)
						content, cached = m.cache.Get(key)
						if !cached {
							content = renderText(
								m.app,
								message,
								p.Text,
								message.Metadata.Assistant.ModelID,
								m.showToolDetails,
								m.partCount == m.selectedPart,
								width,
								"",
								toolCallParts...,
							)
							m.cache.Set(key, content)
						}
					} else {
						content = renderText(
							m.app,
							message,
							p.Text,
							message.Metadata.Assistant.ModelID,
							m.showToolDetails,
							m.partCount == m.selectedPart,
							width,
							"",
							toolCallParts...,
						)
					}
					if content != "" {
						m = m.updateSelected(content, p.Text)
						blocks = append(blocks, content)
					}
				case opencode.ToolInvocationPart:
					if !m.showToolDetails {
						if !hasTextPart {
							orphanedToolCalls = append(orphanedToolCalls, part)
						}
						continue
					}

					if part.ToolInvocation.State == "result" {
						key := m.cache.GenerateKey(message.ID,
							part.ToolInvocation.ToolCallID,
							m.showToolDetails,
							width,
							m.partCount == m.selectedPart,
						)
						content, cached = m.cache.Get(key)
						if !cached {
							content = renderToolDetails(
								m.app,
								part,
								message.Metadata,
								m.partCount == m.selectedPart,
								width,
							)
							m.cache.Set(key, content)
						}
					} else {
						// if the tool call isn't finished, don't cache
						content = renderToolDetails(
							m.app,
							part,
							message.Metadata,
							m.partCount == m.selectedPart,
							width,
						)
					}
					if content != "" {
						m = m.updateSelected(content, "")
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
				m.app,
				error,
				false,
				width,
				WithBorderColor(t.Error()),
			)
			blocks = append(blocks, error)
			m.lineCount += lipgloss.Height(error) + 1
		}
	}

	m.viewport.SetContent("\n" + strings.Join(blocks, "\n\n"))
	if m.selectedPart == m.partCount {
		m.viewport.GotoBottom()
	}

}

func (m *messagesComponent) updateSelected(content string, selectedText string) *messagesComponent {
	if m.selectedPart == m.partCount {
		m.viewport.SetYOffset(m.lineCount - (m.viewport.Height() / 2) + 4)
		m.selectedText = selectedText
	}
	m.partCount++
	m.lineCount += lipgloss.Height(content) + 1
	return m
}

func (m *messagesComponent) header(width int) string {
	if m.app.Session.ID == "" {
		return ""
	}

	t := theme.CurrentTheme()
	base := styles.NewStyle().Foreground(t.Text()).Background(t.Background()).Render
	muted := styles.NewStyle().Foreground(t.TextMuted()).Background(t.Background()).Render
	headerLines := []string{}
	headerLines = append(
		headerLines,
		util.ToMarkdown("# "+m.app.Session.Title, width-6, t.Background()),
	)
	if m.app.Session.Share.URL != "" {
		headerLines = append(headerLines, muted(m.app.Session.Share.URL+"  /unshare"))
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

func (m *messagesComponent) View(width, height int) string {
	t := theme.CurrentTheme()
	if m.rendering {
		return lipgloss.Place(
			width,
			height,
			lipgloss.Center,
			lipgloss.Center,
			styles.NewStyle().Background(t.Background()).Render(""),
			styles.WhitespaceStyle(t.Background()),
		)
	}
	header := m.header(width)
	m.viewport.SetWidth(width)
	m.viewport.SetHeight(height - lipgloss.Height(header))

	return styles.NewStyle().
		Background(t.Background()).
		Render(header + "\n" + m.viewport.View())
}

func (m *messagesComponent) SetWidth(width int) tea.Cmd {
	if m.width == width {
		return nil
	}
	// Clear cache on resize since width affects rendering
	if m.width != width {
		m.cache.Clear()
	}
	m.width = width
	m.viewport.SetWidth(width)
	m.renderView(width)
	return nil
}

func (m *messagesComponent) Reload() tea.Cmd {
	return func() tea.Msg {
		m.renderView(m.width)
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

func (m *messagesComponent) Previous() (tea.Model, tea.Cmd) {
	m.tail = false
	if m.selectedPart < 0 {
		m.selectedPart = m.partCount
	}
	m.selectedPart--
	if m.selectedPart < 0 {
		m.selectedPart = 0
	}
	return m, util.CmdHandler(selectedMessagePartChangedMsg{
		part: m.selectedPart,
	})
}

func (m *messagesComponent) Next() (tea.Model, tea.Cmd) {
	m.tail = false
	m.selectedPart++
	if m.selectedPart >= m.partCount {
		m.selectedPart = m.partCount
	}
	return m, util.CmdHandler(selectedMessagePartChangedMsg{
		part: m.selectedPart,
	})
}

func (m *messagesComponent) First() (tea.Model, tea.Cmd) {
	m.selectedPart = 0
	m.tail = false
	return m, util.CmdHandler(selectedMessagePartChangedMsg{
		part: m.selectedPart,
	})
}

func (m *messagesComponent) Last() (tea.Model, tea.Cmd) {
	m.selectedPart = m.partCount - 1
	m.tail = true
	return m, util.CmdHandler(selectedMessagePartChangedMsg{
		part: m.selectedPart,
	})
}

func (m *messagesComponent) ToolDetailsVisible() bool {
	return m.showToolDetails
}

func NewMessagesComponent(app *app.App) MessagesComponent {
	vp := viewport.New()
	vp.KeyMap = viewport.KeyMap{}

	return &messagesComponent{
		app:             app,
		viewport:        vp,
		showToolDetails: true,
		cache:           NewMessageCache(),
		tail:            true,
		selectedPart:    -1,
	}
}
