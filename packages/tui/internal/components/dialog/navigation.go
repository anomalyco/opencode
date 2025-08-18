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

// NavigationDialog interface for the session navigation dialog
type NavigationDialog interface {
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

// navigationItem represents a user message in the navigation list
type navigationItem struct {
	messageID string
	content   string
	timestamp time.Time
	index     int // Index in the full message list
	toolCount int // Number of tools used in this message
}

func (n navigationItem) Render(
	selected bool,
	width int,
	isFirstInViewport bool,
	baseStyle styles.Style,
) string {
	t := theme.CurrentTheme()
	infoStyle := baseStyle.Background(t.BackgroundPanel()).Foreground(t.Info()).Render
	textStyle := baseStyle.Background(t.BackgroundPanel()).Foreground(t.Text()).Render

	// Format timestamp - only apply color when not selected
	var timeStr string
	var timeVisualLen int
	if selected {
		timeStr = n.timestamp.Format("15:04") + " "
		timeVisualLen = lipgloss.Width(timeStr)
	} else {
		timeStr = infoStyle(n.timestamp.Format("15:04") + " ")
		timeVisualLen = lipgloss.Width(timeStr)
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
	// Reserve space for: timestamp + space + toolInfo + padding + some buffer
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

func (n navigationItem) Selectable() bool {
	return true
}

type navigationDialog struct {
	width  int
	height int
	modal  *modal.Modal
	list   list.List[navigationItem]
	app    *app.App
}

func (n *navigationDialog) Init() tea.Cmd {
	return nil
}

func (n *navigationDialog) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
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
			n.list = listModel.(list.List[navigationItem])

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
	n.list = listModel.(list.List[navigationItem])
	return n, cmd
}

func (n *navigationDialog) Render(background string) string {
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

func (n *navigationDialog) Close() tea.Cmd {
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

// NewNavigationDialog creates a new session navigation dialog
func NewNavigationDialog(app *app.App) NavigationDialog {
	var items []navigationItem

	// Filter to only user messages and extract relevant info
	for i, message := range app.Messages {
		if userMsg, ok := message.Info.(opencode.UserMessage); ok {
			preview := extractMessagePreview(message.Parts)
			toolCount := countToolsInResponse(app.Messages, i)

			items = append(items, navigationItem{
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
		list.WithMaxVisibleHeight[navigationItem](12),
		list.WithFallbackMessage[navigationItem]("No user messages in this session"),
		list.WithAlphaNumericKeys[navigationItem](true),
		list.WithRenderFunc(
			func(item navigationItem, selected bool, width int, baseStyle styles.Style) string {
				return item.Render(selected, width, false, baseStyle)
			},
		),
		list.WithSelectableFunc(func(item navigationItem) bool {
			return true
		}),
	)
	listComponent.SetMaxWidth(layout.Current.Container.Width - 12)

	return &navigationDialog{
		list: listComponent,
		app:  app,
		modal: modal.New(
			modal.WithTitle("Jump to Message"),
			modal.WithMaxWidth(layout.Current.Container.Width-8),
		),
	}
}
