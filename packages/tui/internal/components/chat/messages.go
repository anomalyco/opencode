package chat

import (
	"fmt"
	"log/slog"
	"strings"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/cache"
	"github.com/sst/opencode/internal/components/toast"
	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
	"github.com/sst/opencode/internal/viewport"
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
	loading         bool
	showToolDetails bool
	rendering       bool
	dirty           bool
	tail            bool
	partCount       int
	lineCount       int
	slidingWindow   *SlidingWindowRenderer
	messageBroker   *MessageBroker
}

type ToggleToolDetailsMsg struct{}

func (m *messagesComponent) Init() tea.Cmd {
	return tea.Batch(m.viewport.Init())
}

func (m *messagesComponent) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		width := msg.Width
		height := msg.Height
		m.width = width
		m.height = height
		tail := m.viewport.AtBottom()
		m.viewport.SetWidth(width)
		m.viewport.SetHeight(height)
		if tail {
			m.viewport.GotoBottom()
		}
		cmds = append(cmds, m.renderView())
	case ToggleToolDetailsMsg:
		m.showToolDetails = !m.showToolDetails
		m.slidingWindow.ClearCache() // Clear cache when toggling tool details
		cmds = append(cmds, m.renderView())
	case renderCompleteMsg:
		m.partCount = msg.partCount
		m.lineCount = msg.lineCount
		m.rendering = false
		m.loading = false
		m.tail = m.viewport.AtBottom()
		m.viewport = msg.viewport
		if m.tail {
			m.viewport.GotoBottom()
		}
		if m.dirty {
			cmds = append(cmds, m.renderView())
		}
	}

	m.tail = m.viewport.AtBottom()
	viewport, cmd := m.viewport.Update(msg)
	m.viewport = viewport
	cmds = append(cmds, cmd)

	return m, tea.Batch(cmds...)
}

type renderCompleteMsg struct {
	viewport  viewport.Model
	partCount int
	lineCount int
}

func (m *messagesComponent) renderView() tea.Cmd {
	m.header = m.renderHeader()

	if m.rendering {
		slog.Debug("pending render, skipping")
		m.dirty = true
		return func() tea.Msg {
			return nil
		}
	}
	m.dirty = false
	m.rendering = true

	viewport := m.viewport

	return func() tea.Msg {
		measure := util.Measure("messages.renderView")
		defer measure()

		// Update sliding window viewport height
		m.slidingWindow.SetViewportHeight(m.height - lipgloss.Height(m.header))
		
		// Update message index
		m.slidingWindow.UpdateIndex(m.messageBroker, m.width)
		
		// Get visible content using sliding window
		content, totalHeight := m.slidingWindow.GetVisibleContent(
			m.messageBroker,
			viewport.YOffset,
			m.width,
			m.showToolDetails,
		)
		
		// Set content and height
		viewport.SetHeight(m.height - lipgloss.Height(m.header))
		viewport.SetContent(content)
		
		// Count parts for display (approximate based on visible messages)
		partCount := len(m.app.Messages) // Simple approximation
		lineCount := totalHeight

		return renderCompleteMsg{
			viewport:  viewport,
			partCount: partCount,
			lineCount: lineCount,
		}
	}
}

func (m *messagesComponent) renderHeader() string {
	if m.app.Session.ID == "" {
		return ""
	}

	headerWidth := m.width

	t := theme.CurrentTheme()
	base := styles.NewStyle().Foreground(t.Text()).Background(t.Background()).Render
	muted := styles.NewStyle().Foreground(t.TextMuted()).Background(t.Background()).Render

	sessionInfo := ""
	tokens := float64(0)
	cost := float64(0)
	contextWindow := m.app.Model.Limit.Context

	// Calculate stats from message broker
	messageCount := m.messageBroker.GetMessageCount()
	batchSize := 100
	for start := 0; start < messageCount; start += batchSize {
		end := min(start+batchSize, messageCount)
		messages := m.messageBroker.GetMessages(start, end)
		
		for _, message := range messages {
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
	}

	// Check if current model is a subscription model (cost is 0 for both input and output)
	isSubscriptionModel := m.app.Model != nil &&
		m.app.Model.Cost.Input == 0 && m.app.Model.Cost.Output == 0

	sessionInfo = styles.NewStyle().
		Foreground(t.TextMuted()).
		Background(t.Background()).
		Render(formatTokensAndCost(tokens, contextWindow, cost, isSubscriptionModel))

	shareEnabled := m.app.Config.Share != opencode.ConfigShareDisabled
	headerText := util.ToMarkdown("# "+m.app.Session.Title, headerWidth-len(sessionInfo), t.Background())

	var items []layout.FlexItem
	if shareEnabled {
		share := base("/share") + muted(" to create a shareable link")
		if m.app.Session.Share.URL != "" {
			share = muted(m.app.Session.Share.URL + "  /unshare")
		}
		items = []layout.FlexItem{{View: share}, {View: sessionInfo}}
	} else {
		items = []layout.FlexItem{{View: headerText}, {View: sessionInfo}}
	}

	background := t.Background()
	headerRow := layout.Render(
		layout.FlexOptions{
			Background: &background,
			Direction:  layout.Row,
			Justify:    layout.JustifySpaceBetween,
			Align:      layout.AlignStretch,
			Width:      headerWidth - 6,
		},
		items...,
	)

	var headerLines []string
	if shareEnabled {
		headerLines = []string{headerText, headerRow}
	} else {
		headerLines = []string{headerRow}
	}

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
	if m.loading {
		return lipgloss.Place(
			m.width,
			m.height,
			lipgloss.Center,
			lipgloss.Center,
			styles.NewStyle().Background(t.Background()).Render(""),
			styles.WhitespaceStyle(t.Background()),
		)
	}

	measure := util.Measure("messages.View")
	viewport := m.viewport.View()
	measure()
	return styles.NewStyle().
		Background(t.Background()).
		Render(m.header + "\n" + viewport)
}

func (m *messagesComponent) Reload() tea.Cmd {
	return m.renderView()
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
	messageCount := m.messageBroker.GetMessageCount()
	if messageCount == 0 {
		return m, nil
	}
	lastMessage, ok := m.messageBroker.GetMessage(messageCount - 1)
	if !ok {
		return m, nil
	}
	var lastTextPart *opencode.TextPart
	switch lastMessage.Info.(type) {
	case opencode.AssistantMessage:
		for _, part := range lastMessage.Parts {
			if textPart, ok := part.(opencode.TextPart); ok {
				lastTextPart = &textPart
			}
		}
	}
	if lastTextPart == nil {
		return m, nil
	}
	cmds := []tea.Cmd{}
	cmds = append(cmds, m.app.SetClipboard(lastTextPart.Text))
	cmds = append(cmds, toast.NewSuccessToast("Message copied to clipboard"))
	return m, tea.Batch(cmds...)
}

func NewMessagesComponent(app *app.App) MessagesComponent {
	vp := viewport.New()
	vp.KeyMap = viewport.KeyMap{}
	vp.MouseWheelDelta = 4

	partCache := NewPartCache()
	// Create global cache with 500MB limit
	globalCache := cache.NewMemoryBoundedCache(500)
	// Create message broker with 100MB cache for message data
	messageBroker := NewMessageBroker(app, 100)
	
	return &messagesComponent{
		app:             app,
		viewport:        vp,
		showToolDetails: true,
		cache:           partCache,
		tail:            true,
		slidingWindow:   NewSlidingWindowRenderer(partCache, globalCache),
		messageBroker:   messageBroker,
	}
}