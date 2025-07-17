package chat

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/v2/viewport"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/components/dialog"
	"github.com/sst/opencode/internal/components/toast"
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
	ToolDetailsVisible() bool
	GotoTop() (tea.Model, tea.Cmd)
	GotoBottom() (tea.Model, tea.Cmd)
	CopyLastMessage() (tea.Model, tea.Cmd)
}

type messagesComponent struct {
	width, height   int
	app             *app.App
	header          string
	viewport        viewport.Model
	cache           *PartCache
	rendering       bool
	showToolDetails bool
	tail            bool
	partCount       int
	lineCount       int
}
type renderFinishedMsg struct{}

type ToggleToolDetailsMsg struct{}

func (m *messagesComponent) Init() tea.Cmd {
	return tea.Batch(m.viewport.Init())
}

func (m *messagesComponent) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		effectiveWidth := msg.Width - 4
		// Clear cache on resize since width affects rendering
		if m.width != effectiveWidth {
			m.cache.Clear()
		}
		m.width = effectiveWidth
		m.height = msg.Height - 7
		m.viewport.SetWidth(m.width)
		m.header = m.renderHeader()
		return m, m.Reload()
	case app.SendMsg:
		m.viewport.GotoBottom()
		m.tail = true
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

	case opencode.EventListResponseEventSessionUpdated:
		if msg.Properties.Info.ID == m.app.Session.ID {
			m.header = m.renderHeader()
		}
	case opencode.EventListResponseEventMessageUpdated:
		if msg.Properties.Info.SessionID == m.app.Session.ID {
			m.renderView()
			if m.tail {
				m.viewport.GotoBottom()
			}
		}
	case opencode.EventListResponseEventMessagePartUpdated:
		if msg.Properties.Part.SessionID == m.app.Session.ID {
			m.renderView()
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

func (m *messagesComponent) renderView() {
	measure := util.Measure("messages.renderView")
	defer measure("messageCount", len(m.app.Messages))

	m.header = m.renderHeader()

	t := theme.CurrentTheme()
	blocks := make([]string, 0)
	m.partCount = 0
	m.lineCount = 0

	orphanedToolCalls := make([]opencode.ToolPart, 0)

	width := min(m.width, app.MAX_CONTAINER_WIDTH)
	if m.app.Config.Layout == opencode.LayoutConfigStretch {
		width = m.width
	}

	for _, message := range m.app.Messages {
		var content string
		var cached bool

		switch casted := message.Info.(type) {
		case opencode.UserMessage:
			for partIndex, part := range message.Parts {
				switch part := part.(type) {
				case opencode.TextPart:
					if part.Synthetic {
						continue
					}
					remainingParts := message.Parts[partIndex+1:]
					fileParts := make([]opencode.FilePart, 0)
					for _, part := range remainingParts {
						switch part := part.(type) {
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
							switch filePart.Mime {
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

					key := m.cache.GenerateKey(casted.ID, part.Text, width, files)
					content, cached = m.cache.Get(key)
					if !cached {
						content = renderText(
							m.app,
							message.Info,
							part.Text,
							m.app.Config.Username,
							m.showToolDetails,
							width,
							files,
						)
						content = lipgloss.PlaceHorizontal(
							m.width,
							lipgloss.Center,
							content,
							styles.WhitespaceStyle(t.Background()),
						)
						m.cache.Set(key, content)
					}
					if content != "" {
						m.partCount++
						m.lineCount += lipgloss.Height(content) + 1
						blocks = append(blocks, content)
					}
				}
			}

		case opencode.AssistantMessage:
			hasTextPart := false
			for partIndex, p := range message.Parts {
				switch part := p.(type) {
				case opencode.TextPart:
					hasTextPart = true
					finished := casted.Time.Completed > 0
					remainingParts := message.Parts[partIndex+1:]
					toolCallParts := make([]opencode.ToolPart, 0)

					// sometimes tool calls happen without an assistant message
					// these should be included in this assistant message as well
					if len(orphanedToolCalls) > 0 {
						toolCallParts = append(toolCallParts, orphanedToolCalls...)
						orphanedToolCalls = make([]opencode.ToolPart, 0)
					}

					remaining := true
					for _, part := range remainingParts {
						if !remaining {
							break
						}
						switch part := part.(type) {
						case opencode.TextPart:
							// we only want tool calls associated with the current text part.
							// if we hit another text part, we're done.
							remaining = false
						case opencode.ToolPart:
							toolCallParts = append(toolCallParts, part)
							if part.State.Status != opencode.ToolPartStateStatusCompleted && part.State.Status != opencode.ToolPartStateStatusError {
								// i don't think there's a case where a tool call isn't in result state
								// and the message time is 0, but just in case
								finished = false
							}
						}
					}

					if finished {
						key := m.cache.GenerateKey(casted.ID, part.Text, width, m.showToolDetails)
						content, cached = m.cache.Get(key)
						if !cached {
							content = renderText(
								m.app,
								message.Info,
								part.Text,
								casted.ModelID,
								m.showToolDetails,
								width,
								"",
								toolCallParts...,
							)
							content = lipgloss.PlaceHorizontal(
								m.width,
								lipgloss.Center,
								content,
								styles.WhitespaceStyle(t.Background()),
							)
							m.cache.Set(key, content)
						}
					} else {
						content = renderText(
							m.app,
							message.Info,
							part.Text,
							casted.ModelID,
							m.showToolDetails,
							width,
							"",
							toolCallParts...,
						)
						content = lipgloss.PlaceHorizontal(
							m.width,
							lipgloss.Center,
							content,
							styles.WhitespaceStyle(t.Background()),
						)
					}
					if content != "" {
						m.partCount++
						m.lineCount += lipgloss.Height(content) + 1
						blocks = append(blocks, content)
					}
				case opencode.ToolPart:
					if !m.showToolDetails {
						if !hasTextPart {
							orphanedToolCalls = append(orphanedToolCalls, part)
						}
						continue
					}

					width := width
					if m.app.Config.Layout == opencode.LayoutConfigAuto &&
						part.Tool == "edit" &&
						part.State.Error == "" {
						width = min(m.width, app.EDIT_DIFF_MAX_WIDTH)
					}

					if part.State.Status == opencode.ToolPartStateStatusCompleted || part.State.Status == opencode.ToolPartStateStatusError {
						key := m.cache.GenerateKey(casted.ID,
							part.ID,
							m.showToolDetails,
							width,
						)
						content, cached = m.cache.Get(key)
						if !cached {
							content = renderToolDetails(
								m.app,
								part,
								width,
							)
							content = lipgloss.PlaceHorizontal(
								m.width,
								lipgloss.Center,
								content,
								styles.WhitespaceStyle(t.Background()),
							)
							m.cache.Set(key, content)
						}
					} else {
						// if the tool call isn't finished, don't cache
						content = renderToolDetails(
							m.app,
							part,
							width,
						)
						content = lipgloss.PlaceHorizontal(
							m.width,
							lipgloss.Center,
							content,
							styles.WhitespaceStyle(t.Background()),
						)
					}
					if content != "" {
						m.partCount++
						m.lineCount += lipgloss.Height(content) + 1
						blocks = append(blocks, content)
					}
				}
			}
		}

		error := ""
		if assistant, ok := message.Info.(opencode.AssistantMessage); ok {
			switch err := assistant.Error.AsUnion().(type) {
			case nil:
			case opencode.AssistantMessageErrorMessageOutputLengthError:
				error = "Message output length exceeded"
			case opencode.ProviderAuthError:
				error = err.Data.Message
			case opencode.MessageAbortedError:
				error = "Request was aborted"
			case opencode.UnknownError:
				error = err.Data.Message
			}
		}

		if error != "" {
			error = styles.NewStyle().Width(width - 6).Render(error)
			error = renderContentBlock(
				m.app,
				error,
				width,
				WithBorderColor(t.Error()),
			)
			error = lipgloss.PlaceHorizontal(
				m.width,
				lipgloss.Center,
				error,
				styles.WhitespaceStyle(t.Background()),
			)
			blocks = append(blocks, error)
			m.lineCount += lipgloss.Height(error) + 1
		}
	}

	m.viewport.SetHeight(m.height - lipgloss.Height(m.header))
	m.viewport.SetContent("\n" + strings.Join(blocks, "\n\n"))
}

func (m *messagesComponent) renderHeader() string {
	if m.app.Session.ID == "" {
		return ""
	}

	headerWidth := min(m.width, app.MAX_CONTAINER_WIDTH)
	if m.app.Config.Layout == opencode.LayoutConfigStretch {
		headerWidth = m.width
	}

	t := theme.CurrentTheme()
	base := styles.NewStyle().Foreground(t.Text()).Background(t.Background()).Render
	muted := styles.NewStyle().Foreground(t.TextMuted()).Background(t.Background()).Render
	headerLines := []string{}
	headerLines = append(
		headerLines,
		util.ToMarkdown("# "+m.app.Session.Title, headerWidth-6, t.Background()),
	)

	share := ""
	if m.app.Session.Share.URL != "" {
		share = muted(m.app.Session.Share.URL + "  /unshare")
	} else {
		share = base("/share") + muted(" to create a shareable link")
	}

	sessionInfo := ""
	tokens := float64(0)
	cost := float64(0)
	contextWindow := m.app.Model.Limit.Context

	for _, message := range m.app.Messages {
		if assistant, ok := message.Info.(opencode.AssistantMessage); ok {
			cost += assistant.Cost
			usage := assistant.Tokens
			if usage.Output > 0 {
				if assistant.Summary {
					tokens = usage.Output
					continue
				}
				tokens = (usage.Input +
					usage.Cache.Write +
					usage.Cache.Read +
					usage.Output +
					usage.Reasoning)
			}
		}
	}

	// Check if current model is a subscription model (cost is 0 for both input and output)
	isSubscriptionModel := m.app.Model != nil &&
		m.app.Model.Cost.Input == 0 && m.app.Model.Cost.Output == 0

	sessionInfo = styles.NewStyle().
		Foreground(t.TextMuted()).
		Background(t.Background()).
		Render(formatTokensAndCost(tokens, contextWindow, cost, isSubscriptionModel))

	background := t.Background()

	var items []layout.FlexItem
	justify := layout.JustifyEnd

	if m.app.Config.Share != opencode.ConfigShareDisabled {
		items = append(items, layout.FlexItem{View: share})
		justify = layout.JustifySpaceBetween
	}

	items = append(items, layout.FlexItem{View: sessionInfo})

	headerRow := layout.Render(
		layout.FlexOptions{
			Background: &background,
			Direction:  layout.Row,
			Justify:    justify,
			Align:      layout.AlignStretch,
			Width:      headerWidth - 6,
		},
		items...,
	)

	headerLines = append(headerLines, headerRow)

	header := strings.Join(headerLines, "\n")
	header = styles.NewStyle().
		Background(t.Background()).
		Width(headerWidth).
		PaddingLeft(2).
		PaddingRight(2).
		BorderLeft(true).
		BorderRight(true).
		BorderBackground(t.Background()).
		BorderForeground(t.BackgroundElement()).
		BorderStyle(lipgloss.ThickBorder()).
		Render(header)
	header = lipgloss.PlaceHorizontal(
		m.width,
		lipgloss.Center,
		header,
		styles.WhitespaceStyle(t.Background()),
	)

	return "\n" + header + "\n"
}

func formatTokensAndCost(
	tokens float64,
	contextWindow float64,
	cost float64,
	isSubscriptionModel bool,
) string {
	// Format tokens in human-readable format (e.g., 110K, 1.2M)
	var formattedTokens string
	switch {
	case tokens >= 1_000_000:
		formattedTokens = fmt.Sprintf("%.1fM", float64(tokens)/1_000_000)
	case tokens >= 1_000:
		formattedTokens = fmt.Sprintf("%.1fK", float64(tokens)/1_000)
	default:
		formattedTokens = fmt.Sprintf("%d", int(tokens))
	}

	// Remove .0 suffix if present
	if strings.HasSuffix(formattedTokens, ".0K") {
		formattedTokens = strings.Replace(formattedTokens, ".0K", "K", 1)
	}
	if strings.HasSuffix(formattedTokens, ".0M") {
		formattedTokens = strings.Replace(formattedTokens, ".0M", "M", 1)
	}

	percentage := 0.0
	if contextWindow > 0 {
		percentage = (float64(tokens) / float64(contextWindow)) * 100
	}

	if isSubscriptionModel {
		return fmt.Sprintf(
			"%s/%d%%",
			formattedTokens,
			int(percentage),
		)
	}

	formattedCost := fmt.Sprintf("$%.2f", cost)
	return fmt.Sprintf(
		"%s/%d%% (%s)",
		formattedTokens,
		int(percentage),
		formattedCost,
	)
}

func (m *messagesComponent) View() string {
	t := theme.CurrentTheme()
	if m.rendering {
		return lipgloss.Place(
			m.width,
			m.height,
			lipgloss.Center,
			lipgloss.Center,
			styles.NewStyle().Background(t.Background()).Render(""),
			styles.WhitespaceStyle(t.Background()),
		)
	}

	return styles.NewStyle().
		Background(t.Background()).
		Render(m.header + "\n" + m.viewport.View())
}

func (m *messagesComponent) Reload() tea.Cmd {
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

func (m *messagesComponent) ToolDetailsVisible() bool {
	return m.showToolDetails
}

func (m *messagesComponent) GotoTop() (tea.Model, tea.Cmd) {
	m.viewport.GotoTop()
	return m, nil
}

func (m *messagesComponent) GotoBottom() (tea.Model, tea.Cmd) {
	m.viewport.GotoBottom()
	return m, nil
}

func (m *messagesComponent) CopyLastMessage() (tea.Model, tea.Cmd) {
	if len(m.app.Messages) == 0 {
		return m, nil
	}
	lastMessage := m.app.Messages[len(m.app.Messages)-1]
	var lastTextPart *opencode.TextPart
	for _, part := range lastMessage.Parts {
		if p, ok := part.(opencode.TextPart); ok {
			lastTextPart = &p
		}
	}
	if lastTextPart == nil {
		return m, nil
	}
	var cmds []tea.Cmd
	cmds = append(cmds, m.app.SetClipboard(lastTextPart.Text))
	cmds = append(cmds, toast.NewSuccessToast("Message copied to clipboard"))
	return m, tea.Batch(cmds...)
}

func NewMessagesComponent(app *app.App) MessagesComponent {
	vp := viewport.New()
	vp.KeyMap = viewport.KeyMap{}
	vp.MouseWheelDelta = 4

	return &messagesComponent{
		app:             app,
		viewport:        vp,
		showToolDetails: true,
		cache:           NewPartCache(),
		tail:            true,
	}
}
