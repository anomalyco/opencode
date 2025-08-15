package dialog

import (
	"fmt"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
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

// TimelineDialog interface for the session timeline dialog
type TimelineDialog interface {
	layout.Modal
}

// ScrollToMessageMsg is sent when a message should be scrolled to
type ScrollToMessageMsg struct {
	MessageID string
}

// RestoreToMessageMsg is sent when conversation should be restored to a specific message
type RestoreToMessageMsg struct {
	MessageID string
	Index     int
}

// timelineItem represents a user message in the timeline list
type timelineItem struct {
	messageID string
	content   string
	timestamp time.Time
	index     int // Index in the full message list
	toolCount int // Number of tools used in this message
}

func (n timelineItem) Render(
	selected bool,
	width int,
	isFirstInViewport bool,
	baseStyle styles.Style,
	isCurrent bool,
) string {
	t := theme.CurrentTheme()
	infoStyle := baseStyle.Background(t.BackgroundPanel()).Foreground(t.Info()).Render
	textStyle := baseStyle.Background(t.BackgroundPanel()).Foreground(t.Text()).Render

	// Add dot after timestamp if this is the current message - only apply color when not selected
	var dot string
	var dotVisualLen int
	if isCurrent {
		if selected {
			dot = "● "
		} else {
			dot = lipgloss.NewStyle().Foreground(t.Success()).Render("● ")
		}
		dotVisualLen = 2 // "● " is 2 characters wide
	}

	// Format timestamp - only apply color when not selected
	var timeStr string
	var timeVisualLen int
	if selected {
		timeStr = n.timestamp.Format("15:04") + " " + dot
		timeVisualLen = lipgloss.Width(n.timestamp.Format("15:04")+" ") + dotVisualLen
	} else {
		timeStr = infoStyle(n.timestamp.Format("15:04")+" ") + dot
		timeVisualLen = lipgloss.Width(n.timestamp.Format("15:04")+" ") + dotVisualLen
	}

	// Tool count display (fixed width for alignment) - only apply color when not selected
	toolInfo := ""
	toolInfoVisualLen := 0
	if n.toolCount > 0 {
		toolInfoText := fmt.Sprintf("(%d tools)", n.toolCount)
		if selected {
			toolInfo = toolInfoText
		} else {
			toolInfo = infoStyle(toolInfoText)
		}
		toolInfoVisualLen = lipgloss.Width(toolInfo)
	}

	// Calculate available space for content
	// Reserve space for: timestamp + dot + space + toolInfo + padding + some buffer
	reservedSpace := timeVisualLen + 1 + toolInfoVisualLen + 4
	contentWidth := max(width-reservedSpace, 8)

	truncatedContent := truncate.StringWithTail(
		strings.Split(n.content, "\n")[0],
		uint(contentWidth),
		"...",
	)

	// Apply normal text color to content for non-selected items
	var styledContent string
	if selected {
		styledContent = truncatedContent
	} else {
		styledContent = textStyle(truncatedContent)
	}

	// Create the line with proper spacing - content left-aligned, tools right-aligned
	var text string
	text = timeStr + styledContent
	if toolInfo != "" {
		bgColor := t.BackgroundPanel()
		if selected {
			bgColor = t.Primary()
		}
		text = layout.Render(
			layout.FlexOptions{
				Background: &bgColor,
				Direction:  layout.Row,
				Justify:    layout.JustifySpaceBetween,
				Align:      layout.AlignStretch,
				Width:      width - 2,
			},
			layout.FlexItem{
				View: text,
			},
			layout.FlexItem{
				View: toolInfo,
			},
		)
	}

	var itemStyle styles.Style
	if selected {
		itemStyle = baseStyle.
			Background(t.Primary()).
			Foreground(t.BackgroundElement()).
			Width(width).
			PaddingLeft(1)
	} else {
		itemStyle = baseStyle.PaddingLeft(1)
	}

	return itemStyle.Render(text)
}

func (n timelineItem) Selectable() bool {
	return true
}

type timelineDialog struct {
	width  int
	height int
	modal  *modal.Modal
	list   list.List[timelineItem]
	app    *app.App
}

func (n *timelineDialog) Init() tea.Cmd {
	return nil
}

func (n *timelineDialog) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		n.width = msg.Width
		n.height = msg.Height
		n.list.SetMaxWidth(layout.Current.Container.Width - 12)
	case tea.KeyPressMsg:
		switch msg.String() {
		case "up", "down":
			// Handle navigation and immediately scroll to selected message
			var cmd tea.Cmd
			listModel, cmd := n.list.Update(msg)
			n.list = listModel.(list.List[timelineItem])

			// Get the newly selected item and scroll to it immediately
			if item, idx := n.list.GetSelectedItem(); idx >= 0 {
				return n, tea.Sequence(
					cmd,
					util.CmdHandler(ScrollToMessageMsg{MessageID: item.messageID}),
				)
			}
			return n, cmd
		case "r":
			// Restore conversation to selected message
			if item, idx := n.list.GetSelectedItem(); idx >= 0 {
				return n, tea.Sequence(
					util.CmdHandler(RestoreToMessageMsg{MessageID: item.messageID, Index: item.index}),
					util.CmdHandler(modal.CloseModalMsg{}),
				)
			}
		case "enter":
			// Keep Enter functionality for closing the modal
			if _, idx := n.list.GetSelectedItem(); idx >= 0 {
				return n, util.CmdHandler(modal.CloseModalMsg{})
			}
		}
	}

	var cmd tea.Cmd
	listModel, cmd := n.list.Update(msg)
	n.list = listModel.(list.List[timelineItem])
	return n, cmd
}

func (n *timelineDialog) Render(background string) string {
	listView := n.list.View()

	t := theme.CurrentTheme()
	keyStyle := styles.NewStyle().
		Foreground(t.Text()).
		Background(t.BackgroundPanel()).
		Bold(true).
		Render
	mutedStyle := styles.NewStyle().Foreground(t.TextMuted()).Background(t.BackgroundPanel()).Render

	helpText := keyStyle(
		"↑/↓",
	) + mutedStyle(
		" jump   ",
	) + keyStyle(
		"r",
	) + mutedStyle(
		" restore",
	)

	bgColor := t.BackgroundPanel()
	helpView := styles.NewStyle().
		Background(bgColor).
		Width(layout.Current.Container.Width - 14).
		PaddingLeft(1).
		PaddingTop(1).
		Render(helpText)

	content := strings.Join([]string{listView, helpView}, "\n")

	return n.modal.Render(content, background)
}

func (n *timelineDialog) Close() tea.Cmd {
	return nil
}

// extractMessagePreview extracts a preview from message parts
func extractMessagePreview(parts []opencode.PartUnion) string {
	for _, part := range parts {
		switch casted := part.(type) {
		case opencode.TextPart:
			text := strings.TrimSpace(casted.Text)
			if text != "" {
				return text
			}
		}
	}
	return "No text content"
}

// countToolsInResponse counts tools in the assistant's response to a user message
func countToolsInResponse(messages []app.Message, userMessageIndex int) int {
	count := 0
	// Look at subsequent messages to find the assistant's response
	for i := userMessageIndex + 1; i < len(messages); i++ {
		message := messages[i]
		// If we hit another user message, stop looking
		if _, isUser := message.Info.(opencode.UserMessage); isUser {
			break
		}
		// Count tools in this assistant message
		for _, part := range message.Parts {
			switch part.(type) {
			case opencode.ToolPart:
				count++
			}
		}
	}
	return count
}

// NewTimelineDialog creates a new session timeline dialog
func NewTimelineDialog(app *app.App) TimelineDialog { // renamed from NewNavigationDialog
	var items []timelineItem

	// Filter to only user messages and extract relevant info
	for i, message := range app.Messages {
		if userMsg, ok := message.Info.(opencode.UserMessage); ok {
			preview := extractMessagePreview(message.Parts)
			toolCount := countToolsInResponse(app.Messages, i)

			items = append(items, timelineItem{
				messageID: userMsg.ID,
				content:   preview,
				timestamp: time.UnixMilli(int64(userMsg.Time.Created)),
				index:     i,
				toolCount: toolCount,
			})
		}
	}

	listComponent := list.NewListComponent(
		list.WithItems(items),
		list.WithMaxVisibleHeight[timelineItem](12),
		list.WithFallbackMessage[timelineItem]("No user messages in this session"),
		list.WithAlphaNumericKeys[timelineItem](true),
		list.WithRenderFunc(
			func(item timelineItem, selected bool, width int, baseStyle styles.Style) string {
				// Determine if this item is the current message for the session
				isCurrent := false
				if app.Session.Revert.MessageID != "" {
					// When reverted, Session.Revert.MessageID contains the NEXT user message ID
					// So we need to find the previous user message to highlight the correct one
					for i, navItem := range items {
						if navItem.messageID == app.Session.Revert.MessageID && i > 0 {
							// Found the next message, so the previous one is current
							isCurrent = item.messageID == items[i-1].messageID
							break
						}
					}
				} else if len(app.Messages) > 0 {
					// If not reverted, highlight the last user message
					lastUserMsgID := ""
					for i := len(app.Messages) - 1; i >= 0; i-- {
						if userMsg, ok := app.Messages[i].Info.(opencode.UserMessage); ok {
							lastUserMsgID = userMsg.ID
							break
						}
					}
					isCurrent = item.messageID == lastUserMsgID
				}
				// Only show the dot if undo/redo/restore is available
				showDot := app.Session.Revert.MessageID != ""
				return item.Render(selected, width, false, baseStyle, isCurrent && showDot)
			},
		),
		list.WithSelectableFunc(func(item timelineItem) bool {
			return true
		}),
	)
	listComponent.SetMaxWidth(layout.Current.Container.Width - 12)

	return &timelineDialog{
		list: listComponent,
		app:  app,
		modal: modal.New(
			modal.WithTitle("Session Timeline"),
			modal.WithMaxWidth(layout.Current.Container.Width-8),
		),
	}
}
