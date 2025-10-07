package chat

import (
	"context"
	"fmt"
	"log/slog"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/commands"
	"github.com/sst/opencode/internal/components/dialog"
	"github.com/sst/opencode/internal/components/diff"
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
	ThinkingBlocksVisible() bool
	GotoTop() (tea.Model, tea.Cmd)
	GotoBottom() (tea.Model, tea.Cmd)
	CopyLastMessage() (tea.Model, tea.Cmd)
	UndoLastMessage() (tea.Model, tea.Cmd)
	RedoLastMessage() (tea.Model, tea.Cmd)
	ScrollToMessage(messageID string) (tea.Model, tea.Cmd)
}

type messagesComponent struct {
	width, height      int
	app                *app.App
	header             string
	viewport           viewport.Model
	clipboard          []string
	cache              *PartCache
	loading            bool
	showToolDetails    bool
	showThinkingBlocks bool
	rendering          bool
	dirty              bool
	tail               bool
	partCount          int
	lineCount          int
	selection          *selection
	messagePositions   map[string]int // map message ID to line position
	animating          bool
}

type selection struct {
	startX int
	endX   int
	startY int
	endY   int
}

func (s selection) coords(offset int) *selection {
	// selecting backwards
	if s.startY > s.endY && s.endY >= 0 {
		return &selection{
			startX: max(0, s.endX-1),
			startY: s.endY - offset,
			endX:   s.startX + 1,
			endY:   s.startY - offset,
		}
	}

	// selecting backwards same line
	if s.startY == s.endY && s.startX >= s.endX {
		return &selection{
			startY: s.startY - offset,
			startX: max(0, s.endX-1),
			endY:   s.endY - offset,
			endX:   s.startX + 1,
		}
	}

	return &selection{
		startX: s.startX,
		startY: s.startY - offset,
		endX:   s.endX,
		endY:   s.endY - offset,
	}
}

type ToggleToolDetailsMsg struct{}
type ToggleThinkingBlocksMsg struct{}
type shimmerTickMsg struct{}

func (m *messagesComponent) Init() tea.Cmd {
	return tea.Batch(m.viewport.Init())
}

func (m *messagesComponent) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd
	switch msg := msg.(type) {
	case shimmerTickMsg:
		if !m.app.HasAnimatingWork() {
			m.animating = false
			return m, nil
		}
		return m, tea.Sequence(
			m.renderView(),
			tea.Tick(90*time.Millisecond, func(t time.Time) tea.Msg { return shimmerTickMsg{} }),
		)
	case tea.MouseClickMsg:
		slog.Info("mouse", "x", msg.X, "y", msg.Y, "offset", m.viewport.YOffset)
		y := msg.Y + m.viewport.YOffset
		if y > 0 {
			m.selection = &selection{
				startY: y,
				startX: msg.X,
				endY:   -1,
				endX:   -1,
			}

			slog.Info("mouse selection", "start", fmt.Sprintf("%d,%d", m.selection.startX, m.selection.startY), "end", fmt.Sprintf("%d,%d", m.selection.endX, m.selection.endY))
			return m, m.renderView()
		}

	case tea.MouseMotionMsg:
		if m.selection != nil {
			m.selection = &selection{
				startX: m.selection.startX,
				startY: m.selection.startY,
				endX:   msg.X + 1,
				endY:   msg.Y + m.viewport.YOffset,
			}
			return m, m.renderView()
		}

	case tea.MouseReleaseMsg:
		if m.selection != nil {
			m.selection = nil
			if len(m.clipboard) > 0 {
				content := strings.Join(m.clipboard, "\n")
				m.clipboard = []string{}
				return m, tea.Sequence(
					m.renderView(),
					app.SetClipboard(content),
					toast.NewSuccessToast("Copied to clipboard"),
				)
			}
			return m, m.renderView()
		}
	case tea.WindowSizeMsg:
		effectiveWidth := msg.Width - 4
		// Clear cache on resize since width affects rendering
		if m.width != effectiveWidth {
			m.cache.Clear()
		}
		m.width = effectiveWidth
		m.height = msg.Height - 7
		m.viewport.SetWidth(m.width)
		m.loading = true
		return m, m.renderView()
	case app.SendPrompt:
		m.viewport.GotoBottom()
		m.tail = true
		return m, nil
	case app.SendCommand:
		m.viewport.GotoBottom()
		m.tail = true
		return m, nil
	case dialog.ThemeSelectedMsg:
		m.cache.Clear()
		m.loading = true
		return m, m.renderView()
	case ToggleToolDetailsMsg:
		m.showToolDetails = !m.showToolDetails
		m.app.State.ShowToolDetails = &m.showToolDetails
		return m, tea.Batch(m.renderView(), m.app.SaveState())
	case ToggleThinkingBlocksMsg:
		m.showThinkingBlocks = !m.showThinkingBlocks
		m.app.State.ShowThinkingBlocks = &m.showThinkingBlocks
		return m, tea.Batch(m.renderView(), m.app.SaveState())
	case app.SessionLoadedMsg:
		m.tail = true
		m.loading = true
		return m, m.renderView()
	case app.SessionClearedMsg:
		m.cache.Clear()
		m.tail = true
		m.loading = true
		return m, m.renderView()
	case app.SessionUnrevertedMsg:
		if msg.Session.ID == m.app.Session.ID {
			m.cache.Clear()
			m.tail = true
			return m, m.renderView()
		}
	case app.SessionSelectedMsg:
		currentParent := m.app.Session.ParentID
		if currentParent == "" {
			currentParent = m.app.Session.ID
		}

		targetParent := msg.ParentID
		if targetParent == "" {
			targetParent = msg.ID
		}

		// Clear cache only if switching between different session families
		if currentParent != targetParent {
			m.cache.Clear()
		}

		m.viewport.GotoBottom()
	case app.MessageRevertedMsg:
		if msg.Session.ID == m.app.Session.ID {
			m.cache.Clear()
			m.tail = true
			return m, m.renderView()
		}

	case opencode.EventListResponseEventSessionUpdated:
		if msg.Properties.Info.ID == m.app.Session.ID {
			cmds = append(cmds, m.renderView())
		}
	case opencode.EventListResponseEventMessageUpdated:
		if msg.Properties.Info.SessionID == m.app.Session.ID {
			cmds = append(cmds, m.renderView())
		}
	case opencode.EventListResponseEventSessionError:
		if msg.Properties.SessionID == m.app.Session.ID {
			cmds = append(cmds, m.renderView())
		}
	case opencode.EventListResponseEventMessagePartUpdated:
		if msg.Properties.Part.SessionID == m.app.Session.ID {
			cmds = append(cmds, m.renderView())
		}
	case opencode.EventListResponseEventMessageRemoved:
		if msg.Properties.SessionID == m.app.Session.ID {
			m.cache.Clear()
			cmds = append(cmds, m.renderView())
		}
	case opencode.EventListResponseEventMessagePartRemoved:
		if msg.Properties.SessionID == m.app.Session.ID {
			// Clear the cache when a part is removed to ensure proper re-rendering
			m.cache.Clear()
			cmds = append(cmds, m.renderView())
		}
	case opencode.EventListResponseEventPermissionUpdated:
		m.tail = true
		return m, m.renderView()
	case opencode.EventListResponseEventPermissionReplied:
		m.tail = true
		return m, m.renderView()
	case renderCompleteMsg:
		m.partCount = msg.partCount
		m.lineCount = msg.lineCount
		m.rendering = false
		m.clipboard = msg.clipboard
		m.loading = false
		m.messagePositions = msg.messagePositions
		m.tail = m.viewport.AtBottom()

		// Preserve scroll across reflow
		// if the user was at bottom, keep following; otherwise restore the previous offset.
		wasAtBottom := m.viewport.AtBottom()
		prevYOffset := m.viewport.YOffset
		m.viewport = msg.viewport
		if wasAtBottom {
			m.viewport.GotoBottom()
		} else {
			m.viewport.YOffset = prevYOffset
		}

		m.header = msg.header
		if m.dirty {
			cmds = append(cmds, m.renderView())
		}

		// Start shimmer ticks if any assistant/tool is in-flight
		if !m.animating && m.app.HasAnimatingWork() {
			m.animating = true
			cmds = append(cmds, tea.Tick(90*time.Millisecond, func(t time.Time) tea.Msg { return shimmerTickMsg{} }))
		}
	}

	m.tail = m.viewport.AtBottom()
	viewport, cmd := m.viewport.Update(msg)
	m.viewport = viewport
	cmds = append(cmds, cmd)

	return m, tea.Batch(cmds...)
}

type renderCompleteMsg struct {
	viewport         viewport.Model
	clipboard        []string
	header           string
	partCount        int
	lineCount        int
	messagePositions map[string]int
}

func (m *messagesComponent) renderView() tea.Cmd {
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
	tail := m.tail

	return func() tea.Msg {
		header := m.renderHeader()
		measure := util.Measure("messages.renderView")
		defer measure()

		t := theme.CurrentTheme()
		blocks := make([]string, 0)
		partCount := 0
		lineCount := 0
		messagePositions := make(map[string]int) // Track message ID to line position

		orphanedToolCalls := make([]opencode.ToolPart, 0)

		width := m.width // always use full width

		// Find the last streaming ReasoningPart to only shimmer that one
		lastStreamingReasoningID := ""
		if m.showThinkingBlocks {
			for mi := len(m.app.Messages) - 1; mi >= 0 && lastStreamingReasoningID == ""; mi-- {
				if _, ok := m.app.Messages[mi].Info.(opencode.AssistantMessage); !ok {
					continue
				}
				parts := m.app.Messages[mi].Parts
				for pi := len(parts) - 1; pi >= 0; pi-- {
					if rp, ok := parts[pi].(opencode.ReasoningPart); ok {
						if strings.TrimSpace(rp.Text) != "" && rp.Time.End == 0 {
							lastStreamingReasoningID = rp.ID
							break
						}
					}
				}
			}
		}

		reverted := false
		revertedMessageCount := 0
		revertedToolCount := 0
		lastAssistantMessage := "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"
		for _, msg := range slices.Backward(m.app.Messages) {
			if assistant, ok := msg.Info.(opencode.AssistantMessage); ok {
				if assistant.Time.Completed > 0 {
					break
				}
				lastAssistantMessage = assistant.ID
				break
			}
		}
		for _, message := range m.app.Messages {
			var content string
			var cached bool
			error := ""

			switch casted := message.Info.(type) {
			case opencode.UserMessage:
				// Track the position of this user message
				messagePositions[casted.ID] = lineCount

				if casted.ID == m.app.Session.Revert.MessageID {
					reverted = true
					revertedMessageCount = 1
					revertedToolCount = 0
					continue
				}
				if reverted {
					revertedMessageCount++
					continue
				}

				for partIndex, part := range message.Parts {
					switch part := part.(type) {
					case opencode.TextPart:
						if part.Synthetic {
							continue
						}
						if part.Text == "" {
							continue
						}
						remainingParts := message.Parts[partIndex+1:]
						fileParts := make([]opencode.FilePart, 0)
						agentParts := make([]opencode.AgentPart, 0)
						for _, part := range remainingParts {
							switch part := part.(type) {
							case opencode.FilePart:
								if part.Source.Text.Start >= 0 && part.Source.Text.End >= part.Source.Text.Start {
									fileParts = append(fileParts, part)
								}
							case opencode.AgentPart:
								if part.Source.Start >= 0 && part.Source.End >= part.Source.Start {
									agentParts = append(agentParts, part)
								}
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

						author := m.app.Config.Username
						isQueued := casted.ID > lastAssistantMessage
						key := m.cache.GenerateKey(casted.ID, part.Text, width, files, author, isQueued)
						content, cached = m.cache.Get(key)
						if !cached {
							content = renderText(
								m.app,
								message.Info,
								part.Text,
								author,
								m.showToolDetails,
								width,
								files,
								false,
								isQueued,
								false,
								fileParts,
								agentParts,
							)
							m.cache.Set(key, content)
						}
						if content != "" {
							partCount++
							lineCount += lipgloss.Height(content) + 1
							blocks = append(blocks, content)
						}
					}
				}

			case opencode.AssistantMessage:
				if casted.ID == m.app.Session.Revert.MessageID {
					reverted = true
					revertedMessageCount = 1
					revertedToolCount = 0
				}
				hasTextPart := false
				hasContent := false
				for partIndex, p := range message.Parts {
					switch part := p.(type) {
					case opencode.TextPart:
						if reverted {
							continue
						}
						if strings.TrimSpace(part.Text) == "" {
							continue
						}
						hasTextPart = true
						finished := part.Time.End > 0
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
							key := m.cache.GenerateKey(casted.ID, part.Text, width, m.showToolDetails, toolCallParts)
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
									false,
									false,
									false,
									[]opencode.FilePart{},
									[]opencode.AgentPart{},
									toolCallParts...,
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
								false,
								false,
								false,
								[]opencode.FilePart{},
								[]opencode.AgentPart{},
								toolCallParts...,
							)
						}
						if content != "" {
							partCount++
							lineCount += lipgloss.Height(content) + 1
							blocks = append(blocks, content)
							hasContent = true
						}
					case opencode.ToolPart:
						if reverted {
							revertedToolCount++
							continue
						}

						permission := opencode.Permission{}
						if m.app.CurrentPermission.CallID == part.CallID {
							permission = m.app.CurrentPermission
						}

						if !m.showToolDetails && permission.ID == "" {
							if !hasTextPart {
								orphanedToolCalls = append(orphanedToolCalls, part)
							}
							continue
						}

						if part.State.Status == opencode.ToolPartStateStatusCompleted || part.State.Status == opencode.ToolPartStateStatusError {
							key := m.cache.GenerateKey(casted.ID,
								part.ID,
								m.showToolDetails,
								width,
								permission.ID,
							)
							content, cached = m.cache.Get(key)
							if !cached {
								content = renderToolDetails(
									m.app,
									part,
									permission,
									width,
								)
								m.cache.Set(key, content)
							}
						} else {
							// if the tool call isn't finished, don't cache
							content = renderToolDetails(
								m.app,
								part,
								permission,
								width,
							)
						}
						if content != "" {
							partCount++
							lineCount += lipgloss.Height(content) + 1
							blocks = append(blocks, content)
							hasContent = true
						}
					case opencode.ReasoningPart:
						if reverted {
							continue
						}
						if !m.showThinkingBlocks {
							continue
						}
						if part.Text != "" {
							text := part.Text
							shimmer := part.Time.End == 0 && part.ID == lastStreamingReasoningID
							content = renderText(
								m.app,
								message.Info,
								text,
								casted.ModelID,
								m.showToolDetails,
								width,
								"",
								true,
								false,
								shimmer,
								[]opencode.FilePart{},
								[]opencode.AgentPart{},
							)
							partCount++
							lineCount += lipgloss.Height(content) + 1
							blocks = append(blocks, content)
							hasContent = true
						}
					}
				}

				switch err := casted.Error.AsUnion().(type) {
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

				if !hasContent && error == "" && !reverted && casted.Time.Completed == 0 {
					content = renderText(
						m.app,
						message.Info,
						"Generating...",
						casted.ModelID,
						m.showToolDetails,
						width,
						"",
						false,
						false,
						false,
						[]opencode.FilePart{},
						[]opencode.AgentPart{},
					)
					partCount++
					lineCount += lipgloss.Height(content) + 1
					blocks = append(blocks, content)
				}
			}

			if error != "" && !reverted {
				error = styles.NewStyle().Width(width - 6).Render(error)
				error = renderContentBlock(
					m.app,
					error,
					width,
					WithBorderColor(t.Error()),
				)
				blocks = append(blocks, error)
				lineCount += lipgloss.Height(error) + 1
			}
		}

		if revertedMessageCount > 0 || revertedToolCount > 0 {
			messagePlural := ""
			toolPlural := ""
			if revertedMessageCount != 1 {
				messagePlural = "s"
			}
			if revertedToolCount != 1 {
				toolPlural = "s"
			}
			revertedStyle := styles.NewStyle().
				Background(t.BackgroundPanel()).
				Foreground(t.TextMuted())

			content := revertedStyle.Render(fmt.Sprintf(
				"%d message%s reverted, %d tool call%s reverted",
				revertedMessageCount,
				messagePlural,
				revertedToolCount,
				toolPlural,
			))
			hintStyle := styles.NewStyle().Background(t.BackgroundPanel()).Foreground(t.Text())
			hint := hintStyle.Render(m.app.Keybind(commands.MessagesRedoCommand))
			hint += revertedStyle.Render(" (or /redo) to restore")

			content += "\n" + hint
			if m.app.Session.Revert.Diff != "" {
				t := theme.CurrentTheme()
				s := styles.NewStyle().Background(t.BackgroundPanel())
				green := s.Foreground(t.Success()).Render
				red := s.Foreground(t.Error()).Render
				content += "\n"
				stats, err := diff.ParseStats(m.app.Session.Revert.Diff)
				if err != nil {
					slog.Error("Failed to parse diff stats", "error", err)
				} else {
					var files []string
					for file := range stats {
						files = append(files, file)
					}
					sort.Strings(files)

					for _, file := range files {
						fileStats := stats[file]
						display := file
						if fileStats.Added > 0 {
							display += green(" +" + strconv.Itoa(int(fileStats.Added)))
						}
						if fileStats.Removed > 0 {
							display += red(" -" + strconv.Itoa(int(fileStats.Removed)))
						}
						content += "\n" + display
					}
				}
			}

			content = styles.NewStyle().
				Background(t.BackgroundPanel()).
				Width(width - 6).
				Render(content)
			content = renderContentBlock(
				m.app,
				content,
				width,
				WithBorderColor(t.BackgroundPanel()),
			)
			blocks = append(blocks, content)
		}

		if m.app.CurrentPermission.ID != "" &&
			m.app.CurrentPermission.SessionID != m.app.Session.ID {
			response, err := m.app.Client.Session.Message(
				context.Background(),
				m.app.CurrentPermission.SessionID,
				m.app.CurrentPermission.MessageID,
				opencode.SessionMessageParams{},
			)
			if err != nil || response == nil {
				slog.Error("Failed to get message from child session", "error", err)
			} else {
				for _, part := range response.Parts {
					if part.CallID == m.app.CurrentPermission.CallID {
						if toolPart, ok := part.AsUnion().(opencode.ToolPart); ok {
							content := renderToolDetails(
								m.app,
								toolPart,
								m.app.CurrentPermission,
								width,
							)
							if content != "" {
								partCount++
								lineCount += lipgloss.Height(content) + 1
								blocks = append(blocks, content)
							}
						}
					}
				}
			}
		}

		final := []string{}
		clipboard := []string{}
		var selection *selection
		if m.selection != nil {
			selection = m.selection.coords(lipgloss.Height(header) + 1)
		}
		for _, block := range blocks {
			lines := strings.Split(block, "\n")
			for index, line := range lines {
				if selection == nil || index == 0 || index == len(lines)-1 {
					final = append(final, line)
					continue
				}
				y := len(final)
				if y >= selection.startY && y <= selection.endY {
					left := 3
					if y == selection.startY {
						left = selection.startX - 2
					}
					left = max(3, left)

					width := ansi.StringWidth(line)
					right := width - 1
					if y == selection.endY {
						right = min(selection.endX-2, right)
					}

					prefix := ansi.Cut(line, 0, left)
					middle := strings.TrimRight(ansi.Strip(ansi.Cut(line, left, right)), " ")
					suffix := ansi.Cut(line, left+ansi.StringWidth(middle), width)
					clipboard = append(clipboard, middle)
					line = prefix + styles.NewStyle().
						Background(t.Accent()).
						Foreground(t.BackgroundPanel()).
						Render(ansi.Strip(middle)) +
						suffix
				}
				final = append(final, line)
			}
			y := len(final)
			if selection != nil && y >= selection.startY && y < selection.endY {
				clipboard = append(clipboard, "")
			}
			final = append(final, "")
		}
		content := "\n" + strings.Join(final, "\n")
		viewport.SetHeight(m.height - lipgloss.Height(header))
		viewport.SetContent(content)
		if tail {
			viewport.GotoBottom()
		}

		return renderCompleteMsg{
			header:           header,
			clipboard:        clipboard,
			viewport:         viewport,
			partCount:        partCount,
			lineCount:        lineCount,
			messagePositions: messagePositions,
		}
	}
}

func (m *messagesComponent) renderHeader() string {
	if m.app.Session.ID == "" {
		return ""
	}

	headerWidth := m.width

	t := theme.CurrentTheme()
	bgColor := t.Background()
	borderColor := t.BackgroundElement()

	isChildSession := m.app.Session.ParentID != ""
	if isChildSession {
		bgColor = t.BackgroundElement()
		borderColor = t.Accent()
	}

	base := styles.NewStyle().Foreground(t.Text()).Background(bgColor).Render
	muted := styles.NewStyle().Foreground(t.TextMuted()).Background(bgColor).Render

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
					usage.Cache.Read +
					usage.Cache.Write +
					usage.Output +
					usage.Reasoning)
			}
		}
	}

	// Check if current model is a subscription model (cost is 0 for both input and output)
	isSubscriptionModel := m.app.Model != nil &&
		m.app.Model.Cost.Input == 0 && m.app.Model.Cost.Output == 0

	sessionInfoText := formatTokensAndCost(tokens, contextWindow, cost, isSubscriptionModel)
	sessionInfo = styles.NewStyle().
		Foreground(t.TextMuted()).
		Background(bgColor).
		Render(sessionInfoText)

	shareEnabled := m.app.Config.Share != opencode.ConfigShareDisabled

	navHint := ""
	if isChildSession {
		navHint = base(" "+m.app.Keybind(commands.SessionChildCycleReverseCommand)) + muted(" back")
	}

	headerTextWidth := headerWidth
	if isChildSession {
		headerTextWidth -= lipgloss.Width(navHint)
	} else if !shareEnabled {
		headerTextWidth -= lipgloss.Width(sessionInfoText)
	}
	headerText := util.ToMarkdown(
		"# "+m.app.Session.Title,
		headerTextWidth,
		bgColor,
	)
	if isChildSession {
		headerText = layout.Render(
			layout.FlexOptions{
				Background: &bgColor,
				Direction:  layout.Row,
				Justify:    layout.JustifySpaceBetween,
				Align:      layout.AlignStretch,
				Width:      headerTextWidth,
			},
			layout.FlexItem{
				View: headerText,
			},
			layout.FlexItem{
				View: navHint,
			},
		)
	}

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

	headerRow := layout.Render(
		layout.FlexOptions{
			Background: &bgColor,
			Direction:  layout.Row,
			Justify:    layout.JustifySpaceBetween,
			Align:      layout.AlignStretch,
			Width:      headerWidth - 6,
		},
		items...,
	)

	headerLines := []string{headerRow}
	if shareEnabled {
		headerLines = []string{headerText, headerRow}
	}

	header := strings.Join(headerLines, "\n")
	header = styles.NewStyle().
		Background(bgColor).
		Width(headerWidth).
		PaddingLeft(2).
		PaddingRight(2).
		BorderLeft(true).
		BorderRight(true).
		BorderBackground(t.Background()).
		BorderForeground(borderColor).
		BorderStyle(lipgloss.ThickBorder()).
		Render(header)

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
		" %s/%d%% (%s)",
		formattedTokens,
		int(percentage),
		formattedCost,
	)
}

func (m *messagesComponent) View() string {
	t := theme.CurrentTheme()
	bgColor := t.Background()

	if m.loading {
		return lipgloss.Place(
			m.width,
			m.height,
			lipgloss.Center,
			lipgloss.Center,
			styles.NewStyle().Background(bgColor).Render(""),
			styles.WhitespaceStyle(bgColor),
		)
	}

	viewport := m.viewport.View()
	return styles.NewStyle().
		Background(bgColor).
		Render(m.header + "\n" + viewport)
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

func (m *messagesComponent) ThinkingBlocksVisible() bool {
	return m.showThinkingBlocks
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
	cmds = append(cmds, app.SetClipboard(lastTextPart.Text))
	cmds = append(cmds, toast.NewSuccessToast("Message copied to clipboard"))
	return m, tea.Batch(cmds...)
}

func (m *messagesComponent) UndoLastMessage() (tea.Model, tea.Cmd) {
	after := float64(0)
	var revertedMessage app.Message
	reversedMessages := []app.Message{}
	for i := len(m.app.Messages) - 1; i >= 0; i-- {
		reversedMessages = append(reversedMessages, m.app.Messages[i])
		switch casted := m.app.Messages[i].Info.(type) {
		case opencode.UserMessage:
			if casted.ID == m.app.Session.Revert.MessageID {
				after = casted.Time.Created
			}
		case opencode.AssistantMessage:
			if casted.ID == m.app.Session.Revert.MessageID {
				after = casted.Time.Created
			}
		}
		if m.app.Session.Revert.PartID != "" {
			for _, part := range m.app.Messages[i].Parts {
				switch casted := part.(type) {
				case opencode.TextPart:
					if casted.ID == m.app.Session.Revert.PartID {
						after = casted.Time.Start
					}
				case opencode.ToolPart:
					// TODO: handle tool parts
				}
			}
		}
	}

	messageID := ""
	for _, msg := range reversedMessages {
		switch casted := msg.Info.(type) {
		case opencode.UserMessage:
			if after > 0 && casted.Time.Created >= after {
				continue
			}
			messageID = casted.ID
			revertedMessage = msg
		}
		if messageID != "" {
			break
		}
	}

	if messageID == "" {
		return m, nil
	}

	return m, func() tea.Msg {
		response, err := m.app.Client.Session.Revert(
			context.Background(),
			m.app.Session.ID,
			opencode.SessionRevertParams{
				MessageID: opencode.F(messageID),
			},
		)
		if err != nil {
			slog.Error("Failed to undo message", "error", err)
			return toast.NewErrorToast("Failed to undo message")()
		}
		if response == nil {
			return toast.NewErrorToast("Failed to undo message")()
		}
		return app.MessageRevertedMsg{Session: *response, Message: revertedMessage}
	}
}

func (m *messagesComponent) RedoLastMessage() (tea.Model, tea.Cmd) {
	// Check if there's a revert state to redo from
	if m.app.Session.Revert.MessageID == "" {
		return m, func() tea.Msg {
			return toast.NewErrorToast("Nothing to redo")
		}
	}

	before := float64(0)
	var revertedMessage app.Message
	for _, message := range m.app.Messages {
		switch casted := message.Info.(type) {
		case opencode.UserMessage:
			if casted.ID == m.app.Session.Revert.MessageID {
				before = casted.Time.Created
			}
		case opencode.AssistantMessage:
			if casted.ID == m.app.Session.Revert.MessageID {
				before = casted.Time.Created
			}
		}
		if m.app.Session.Revert.PartID != "" {
			for _, part := range message.Parts {
				switch casted := part.(type) {
				case opencode.TextPart:
					if casted.ID == m.app.Session.Revert.PartID {
						before = casted.Time.Start
					}
				case opencode.ToolPart:
					// TODO: handle tool parts
				}
			}
		}
	}

	messageID := ""
	for _, msg := range m.app.Messages {
		switch casted := msg.Info.(type) {
		case opencode.UserMessage:
			if casted.Time.Created <= before {
				continue
			}
			messageID = casted.ID
			revertedMessage = msg
		}
		if messageID != "" {
			break
		}
	}

	if messageID == "" {
		return m, func() tea.Msg {
			// unrevert back to original state
			response, err := m.app.Client.Session.Unrevert(
				context.Background(),
				m.app.Session.ID,
				opencode.SessionUnrevertParams{},
			)
			if err != nil {
				slog.Error("Failed to unrevert session", "error", err)
				return toast.NewErrorToast("Failed to redo message")()
			}
			if response == nil {
				return toast.NewErrorToast("Failed to redo message")()
			}
			return app.SessionUnrevertedMsg{Session: *response}
		}
	}

	return m, func() tea.Msg {
		// calling revert on a "later" message is like a redo
		response, err := m.app.Client.Session.Revert(
			context.Background(),
			m.app.Session.ID,
			opencode.SessionRevertParams{
				MessageID: opencode.F(messageID),
			},
		)
		if err != nil {
			slog.Error("Failed to redo message", "error", err)
			return toast.NewErrorToast("Failed to redo message")()
		}
		if response == nil {
			return toast.NewErrorToast("Failed to redo message")()
		}
		return app.MessageRevertedMsg{Session: *response, Message: revertedMessage}
	}
}

func (m *messagesComponent) ScrollToMessage(messageID string) (tea.Model, tea.Cmd) {
	if m.messagePositions == nil {
		return m, nil
	}

	if position, exists := m.messagePositions[messageID]; exists {
		m.viewport.SetYOffset(position)
		m.tail = false // Stop auto-scrolling to bottom when manually navigating
	}
	return m, nil
}

func NewMessagesComponent(app *app.App) MessagesComponent {
	vp := viewport.New()
	vp.KeyMap = viewport.KeyMap{}

	if app.ScrollSpeed > 0 {
		vp.MouseWheelDelta = app.ScrollSpeed
	} else {
		vp.MouseWheelDelta = 2
	}

	// Default to showing tool details, hidden thinking blocks
	showToolDetails := true
	if app.State.ShowToolDetails != nil {
		showToolDetails = *app.State.ShowToolDetails
	}

	showThinkingBlocks := false
	if app.State.ShowThinkingBlocks != nil {
		showThinkingBlocks = *app.State.ShowThinkingBlocks
	}

	return &messagesComponent{
		app:                app,
		viewport:           vp,
		showToolDetails:    showToolDetails,
		showThinkingBlocks: showThinkingBlocks,
		cache:              NewPartCache(),
		tail:               true,
		messagePositions:   make(map[string]int),
	}
}
