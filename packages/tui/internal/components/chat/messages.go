package chat

import (
	"log/slog"
	"os"
	"strings"

	"github.com/aymanbagabas/go-osc52/v2"
	"github.com/charmbracelet/bubbles/v2/spinner"
	"github.com/charmbracelet/bubbles/v2/viewport"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
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
	HasSelection() bool
	CopySelection() (tea.Model, tea.Cmd)
	SelectAll() (tea.Model, tea.Cmd)
	Selected() string
}

// TextSelection tracks the current text selection state
type TextSelection struct {
	Active     bool
	StartLine  int // Line number in viewport content
	StartCol   int // Column position in line
	EndLine    int
	EndCol     int
	AnchorLine int // Where selection started (for drag)
	AnchorCol  int
}

type messagesComponent struct {
	app         *app.App
	width       int
	height      int
	viewport    viewport.Model
	attachments viewport.Model
	spinner     spinner.Model

	cache              *MessageCache
	rendering          bool
	showToolDetails    bool
	tail               bool
	scrollbarVisible   bool
	scrollbarThumb     int
	scrollbarHeight    int
	scrollbarDragging  bool
	scrollbarDragStart int
	selection          TextSelection
	rawContent         []string // Store raw text lines for selection
	selectionDragging  bool
	partCount          int
	lineCount          int
	selectedPart       int
	selectedText       string
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

	// Handle mouse events first for scrollbar and selection
	switch msg := msg.(type) {
	case tea.MouseWheelMsg:
		// Let viewport handle scrolling
		m.viewport, _ = m.viewport.Update(msg)
		return m, nil
	case tea.MouseClickMsg:
		slog.Debug("Mouse click in messages",
			"x", msg.X, "y", msg.Y,
			"button", msg.Button)

		// Check scrollbar first
		if m.handleScrollbarClick(msg.X, msg.Y) {
			return m, nil
		}
		// Handle text selection - always handle clicks for now
		m.handleSelectionStart(msg.X, msg.Y)
		return m, nil
	case tea.MouseReleaseMsg:
		m.scrollbarDragging = false
		m.selectionDragging = false
		return m, nil
	case tea.MouseMotionMsg:
		if m.scrollbarDragging {
			m.handleScrollbarDrag(msg.Y)
			return m, nil
		}
		if m.selectionDragging {
			slog.Debug("Mouse motion while selecting",
				"x", msg.X, "y", msg.Y)
			m.handleSelectionDrag(msg.X, msg.Y)
			return m, nil
		}
	}

	switch msg := msg.(type) {
	case tea.KeyPressMsg:
		// Clear selection on Escape
		if msg.String() == "esc" && m.selection.Active {
			m.selection.Active = false
			return m, nil
		}
	case app.SendMsg:
		m.viewport.GotoBottom()
		m.tail = true
		m.selectedPart = -1
		return m, nil
	case app.OptimisticMessageAddedMsg:
		m.renderView(m.width)
		if m.tail {
			m.viewport.GotoBottom()
		}
		return m, nil
	case dialog.ThemeSelectedMsg:
		m.cache.Clear()
		m.rendering = true
		return m, m.Reload()
	case ToggleToolDetailsMsg:
		m.showToolDetails = !m.showToolDetails
		m.rendering = true
		return m, m.Reload()
	case app.SessionLoadedMsg:
		m.cache.Clear()
		m.tail = true
		m.rendering = true
		return m, m.Reload()
	case app.SessionClearedMsg:
		m.cache.Clear()
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

	for _, message := range m.app.Messages {
		var content string
		var cached bool

		switch message.Role {
		case opencode.MessageRoleUser:
			for _, part := range message.Parts {
				switch part := part.AsUnion().(type) {
				case opencode.TextPart:
					key := m.cache.GenerateKey(message.ID, part.Text, width, m.selectedPart == m.partCount)
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
						)
						m.cache.Set(key, content)
					}
					if content != "" {
						if m.selectedPart == m.partCount {
							m.viewport.SetYOffset(m.lineCount - 4)
							m.selectedText = part.Text
						}
						blocks = append(blocks, content)
						m.partCount++
						m.lineCount += lipgloss.Height(content) + 1
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
							toolCallParts...,
						)
					}
					if content != "" {
						if m.selectedPart == m.partCount {
							m.viewport.SetYOffset(m.lineCount - 4)
							m.selectedText = p.Text
						}
						blocks = append(blocks, content)
						m.partCount++
						m.lineCount += lipgloss.Height(content) + 1
					}
				case opencode.ToolInvocationPart:
					if !m.showToolDetails {
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
						if m.selectedPart == m.partCount {
							m.viewport.SetYOffset(m.lineCount - 4)
							m.selectedText = ""
						}
						blocks = append(blocks, content)
						m.partCount++
						m.lineCount += lipgloss.Height(content) + 1
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
	if m.selectedPart == m.partCount-1 {
		m.viewport.GotoBottom()
	}

	// Store raw content for selection - preserve ANSI codes for proper clipboard copying
	m.rawContent = strings.Split("\n"+strings.Join(blocks, "\n\n"), "\n")
}

func (m *messagesComponent) header(width int) string {
	if m.app.Session.ID == "" {
		return ""
	}

	t := theme.CurrentTheme()
	base := styles.NewStyle().Foreground(t.Text()).Background(t.Background()).Render
	muted := styles.NewStyle().Foreground(t.TextMuted()).Background(t.Background()).Render
	headerLines := []string{}
	headerLines = append(headerLines, util.ToMarkdown("# "+m.app.Session.Title, width-6, t.Background()))
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

func (m *messagesComponent) renderScrollbar() string {
	totalLines := m.viewport.TotalLineCount()
	visibleLines := m.viewport.Height()
	scrollOffset := m.viewport.YOffset

	// Don't show scrollbar if content fits
	if totalLines <= visibleLines {
		return ""
	}

	// Calculate scrollbar dimensions
	scrollbarHeight := visibleLines
	thumbHeight := max(1, (visibleLines*scrollbarHeight)/totalLines)
	maxThumbPos := scrollbarHeight - thumbHeight
	thumbPos := (scrollOffset * maxThumbPos) / max(1, totalLines-visibleLines)

	// Build scrollbar using proper styling
	t := theme.CurrentTheme()
	scrollbar := make([]string, scrollbarHeight)

	// Create styles for track and thumb
	trackStyle := styles.NewStyle().
		Foreground(t.BackgroundElement()).
		Background(t.Background())

	thumbStyle := styles.NewStyle().
		Foreground(t.Text()).
		Background(t.Background())

	// Build scrollbar with track and thumb
	for i := 0; i < scrollbarHeight; i++ {
		if i >= thumbPos && i < thumbPos+thumbHeight {
			scrollbar[i] = thumbStyle.Render("█")
		} else {
			scrollbar[i] = trackStyle.Render("│")
		}
	}

	return strings.Join(scrollbar, "\n")
}
func (m *messagesComponent) handleScrollbarClick(x, y int) bool {
	// Check if click is in scrollbar area (rightmost column)
	if x != m.width-1 {
		return false
	}

	// Check if we have a scrollbar
	totalLines := m.viewport.TotalLineCount()
	visibleLines := m.viewport.Height()
	if totalLines <= visibleLines {
		return false
	}

	// Calculate header offset - account for the header in the layout
	headerHeight := lipgloss.Height(m.header(m.width))
	scrollbarY := y - headerHeight

	// Check if click is within scrollbar bounds
	if scrollbarY < 0 || scrollbarY >= visibleLines {
		return false
	}
	// Calculate new scroll position based on click
	scrollbarHeight := visibleLines
	thumbHeight := max(1, (visibleLines*scrollbarHeight)/totalLines)
	maxThumbPos := scrollbarHeight - thumbHeight

	// Check if we clicked on the thumb
	scrollOffset := m.viewport.YOffset
	thumbPos := (scrollOffset * maxThumbPos) / max(1, totalLines-visibleLines)

	if scrollbarY >= thumbPos && scrollbarY < thumbPos+thumbHeight {
		// Start dragging
		m.scrollbarDragging = true
		m.scrollbarDragStart = scrollbarY - thumbPos
		return true
	}

	// Jump to clicked position
	newThumbPos := scrollbarY - thumbHeight/2
	if newThumbPos < 0 {
		newThumbPos = 0
	} else if newThumbPos > maxThumbPos {
		newThumbPos = maxThumbPos
	}

	// Calculate new scroll offset
	newOffset := (newThumbPos * (totalLines - visibleLines)) / max(1, maxThumbPos)
	m.viewport.SetYOffset(newOffset)
	m.tail = m.viewport.AtBottom()

	return true
}

func (m *messagesComponent) handleScrollbarDrag(y int) {
	totalLines := m.viewport.TotalLineCount()
	visibleLines := m.viewport.Height()
	if totalLines <= visibleLines {
		return
	}

	// Calculate header offset - consistent with click handler
	headerHeight := lipgloss.Height(m.header(m.width))
	scrollbarY := y - headerHeight - m.scrollbarDragStart
	// Calculate scrollbar dimensions
	scrollbarHeight := visibleLines
	thumbHeight := max(1, (visibleLines*scrollbarHeight)/totalLines)
	maxThumbPos := scrollbarHeight - thumbHeight

	// Clamp thumb position
	if scrollbarY < 0 {
		scrollbarY = 0
	} else if scrollbarY > maxThumbPos {
		scrollbarY = maxThumbPos
	}

	// Calculate new scroll offset
	newOffset := (scrollbarY * (totalLines - visibleLines)) / max(1, maxThumbPos)
	m.viewport.SetYOffset(newOffset)
	m.tail = m.viewport.AtBottom()
}

func (m *messagesComponent) applyScrollbarOverlay(viewportContent string) string {
	scrollbar := m.renderScrollbar()
	if scrollbar == "" {
		return viewportContent
	}

	// Use OpenCode's overlay system to properly place the scrollbar
	// This ensures no interference with the viewport content
	scrollbarX := m.width - 1 // Position at rightmost column
	scrollbarY := 0           // Start at top of content

	return layout.PlaceOverlay(
		scrollbarX,
		scrollbarY,
		scrollbar,
		viewportContent,
	)
}

func (m *messagesComponent) View(width, height int) string {
	t := theme.CurrentTheme()
	if m.rendering {
		return lipgloss.Place(
			width,
			height,
			lipgloss.Center,
			lipgloss.Center,
			styles.NewStyle().Background(t.Background()).Render("Loading session..."),
			styles.WhitespaceStyle(t.Background()),
		)
	}
	header := m.header(width)
	m.viewport.SetWidth(width)
	m.viewport.SetHeight(height - lipgloss.Height(header))

	// Get the viewport content
	content := m.viewport.View()

	// Apply selection overlay first
	if m.selection.Active {
		slog.Debug("Applying selection overlay",
			"startLine", m.selection.StartLine,
			"endLine", m.selection.EndLine,
			"startCol", m.selection.StartCol,
			"endCol", m.selection.EndCol)
	}
	content = m.applySelectionOverlay(content)

	// Apply scrollbar overlay using OpenCode's overlay system
	content = m.applyScrollbarOverlay(content)

	return styles.NewStyle().
		Background(t.Background()).
		Render(header + "\n" + content)
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

// Selection methods
func (m *messagesComponent) HasSelection() bool {
	return m.selection.Active
}

func (m *messagesComponent) CopySelection() (tea.Model, tea.Cmd) {
	if !m.selection.Active {
		return m, nil
	}

	text := m.getSelectedText()
	if text == "" {
		return m, nil
	}

	// Strip ANSI codes for clean clipboard content
	cleanText := ansi.Strip(text)

	// Clean up formatting - remove excessive spaces and border characters
	cleanText = m.cleanExtractedText(cleanText)

	// Clear selection after copy
	m.selection.Active = false

	return m, func() tea.Msg {
		// Use OSC52 to copy to clipboard
		output := osc52.New(cleanText)
		// Write the sequence directly to stdout
		os.Stdout.WriteString(output.String())

		slog.Debug("Copying to clipboard via OSC52", "length", len(cleanText), "hadANSI", len(text) != len(cleanText))
		return toast.NewSuccessToast("Copied to clipboard")
	}
}

// cleanExtractedText removes excessive spacing and cleans up the text
func (m *messagesComponent) cleanExtractedText(text string) string {
	lines := strings.Split(text, "\n")
	cleaned := make([]string, 0, len(lines))

	// First pass: clean each line
	for _, line := range lines {
		// Remove all border characters and clean up
		cleaned_line := line

		// Remove common border patterns
		borderChars := []string{"┃", "│", "|", "║", "┆", "┊"}
		for _, border := range borderChars {
			// Remove from start
			for strings.HasPrefix(strings.TrimSpace(cleaned_line), border) {
				cleaned_line = strings.TrimSpace(cleaned_line)
				cleaned_line = strings.TrimPrefix(cleaned_line, border)
			}
			// Remove from end
			for strings.HasSuffix(strings.TrimSpace(cleaned_line), border) {
				cleaned_line = strings.TrimSpace(cleaned_line)
				cleaned_line = strings.TrimSuffix(cleaned_line, border)
			}
		}

		// Trim spaces after border removal
		cleaned_line = strings.TrimSpace(cleaned_line)

		// Skip empty lines at the beginning
		if cleaned_line == "" && len(cleaned) == 0 {
			continue
		}

		cleaned = append(cleaned, cleaned_line)
	}

	// Remove trailing empty lines
	for len(cleaned) > 0 && cleaned[len(cleaned)-1] == "" {
		cleaned = cleaned[:len(cleaned)-1]
	}

	// For code blocks or structured text, preserve some indentation
	// but for regular text, just join with spaces for paragraphs
	result := strings.Join(cleaned, "\n")

	// If it looks like a paragraph (no code indicators), format as paragraph
	if !strings.Contains(result, "```") && !strings.Contains(result, "    ") && !strings.Contains(result, "\t") {
		// Check if this looks like regular prose
		isProse := true
		for _, line := range cleaned {
			// If any line starts with special characters, it's probably not prose
			if len(line) > 0 && (line[0] == '-' || line[0] == '*' ||
				strings.HasPrefix(line, "•") || strings.HasPrefix(line, "1.") || strings.HasPrefix(line, "2.")) {
				isProse = false
				break
			}
		}

		if isProse && len(cleaned) > 1 {
			// Join lines into a paragraph, preserving paragraph breaks (double newlines)
			paragraphs := []string{}
			currentParagraph := []string{}

			for _, line := range cleaned {
				if line == "" {
					if len(currentParagraph) > 0 {
						paragraphs = append(paragraphs, strings.Join(currentParagraph, " "))
						currentParagraph = []string{}
					}
				} else {
					currentParagraph = append(currentParagraph, line)
				}
			}

			if len(currentParagraph) > 0 {
				paragraphs = append(paragraphs, strings.Join(currentParagraph, " "))
			}

			result = strings.Join(paragraphs, "\n\n")
		}
	}

	return result
}
func (m *messagesComponent) SelectAll() (tea.Model, tea.Cmd) {
	// Select all content in viewport
	content := m.viewport.View()
	lines := strings.Split(content, "\n")

	if len(lines) > 0 {
		m.selection.Active = true
		m.selection.StartLine = 0
		m.selection.StartCol = 0
		m.selection.EndLine = len(lines) - 1
		lastLine := lines[len(lines)-1]
		m.selection.EndCol = len(ansi.Strip(lastLine))
	}

	return m, nil
}

// Selection helper methods
func (m *messagesComponent) handleSelectionStart(x, y int) {
	// Convert mouse coordinates to viewport position
	headerHeight := lipgloss.Height(m.header(m.width))
	viewportY := y - headerHeight

	if viewportY < 0 || viewportY >= m.viewport.Height() {
		return
	}

	// Account for viewport offset
	line := viewportY + m.viewport.YOffset

	// Get the actual line content to calculate its offset
	adjustedX := m.calculateTextColumn(x, line)

	// Start new selection
	m.selection = TextSelection{
		Active:     true,
		StartLine:  line,
		StartCol:   adjustedX,
		EndLine:    line,
		EndCol:     adjustedX,
		AnchorLine: line,
		AnchorCol:  adjustedX,
	}
	m.selectionDragging = true

	slog.Debug("Selection started",
		"x", x, "y", y,
		"adjustedX", adjustedX,
		"line", line,
		"viewportY", viewportY)
}
func (m *messagesComponent) handleSelectionDrag(x, y int) {
	if !m.selectionDragging {
		return
	}

	// Convert mouse coordinates to viewport position
	headerHeight := lipgloss.Height(m.header(m.width))
	viewportY := y - headerHeight

	if viewportY < 0 {
		// Scroll up if dragging above viewport
		m.viewport.LineUp(1)
		viewportY = 0
	} else if viewportY >= m.viewport.Height() {
		// Scroll down if dragging below viewport
		m.viewport.LineDown(1)
		viewportY = m.viewport.Height() - 1
	}

	// Update selection end position
	line := viewportY + m.viewport.YOffset
	adjustedX := m.calculateTextColumn(x, line)

	m.selection.EndLine = line
	m.selection.EndCol = adjustedX

	// Normalize selection (start should be before end)
	if m.selection.EndLine < m.selection.AnchorLine ||
		(m.selection.EndLine == m.selection.AnchorLine && m.selection.EndCol < m.selection.AnchorCol) {
		// Swap start and end
		m.selection.StartLine = m.selection.EndLine
		m.selection.StartCol = m.selection.EndCol
		m.selection.EndLine = m.selection.AnchorLine
		m.selection.EndCol = m.selection.AnchorCol
	} else {
		m.selection.StartLine = m.selection.AnchorLine
		m.selection.StartCol = m.selection.AnchorCol
	}

	slog.Debug("Selection drag",
		"startLine", m.selection.StartLine,
		"startCol", m.selection.StartCol,
		"endLine", m.selection.EndLine,
		"endCol", m.selection.EndCol)
}

// extractTextRange extracts a substring from text containing ANSI codes,
// preserving the ANSI codes while respecting visual column positions
func extractTextRange(text string, startCol, endCol int) string {
	if startCol < 0 {
		startCol = 0
	}

	var result strings.Builder
	var visualPos int
	inAnsi := false
	ansiCode := strings.Builder{}

	for _, ch := range text {
		if ch == '\x1b' {
			inAnsi = true
			ansiCode.Reset()
			ansiCode.WriteRune(ch)
			continue
		}

		if inAnsi {
			ansiCode.WriteRune(ch)
			if (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') {
				inAnsi = false
				// Include ANSI codes that appear within our range
				if visualPos >= startCol && (endCol == -1 || visualPos < endCol) {
					result.WriteString(ansiCode.String())
				}
			}
			continue
		}

		// Regular character
		if visualPos >= startCol && (endCol == -1 || visualPos < endCol) {
			result.WriteRune(ch)
		}
		visualPos++

		// Stop if we've reached the end
		if endCol != -1 && visualPos >= endCol {
			break
		}
	}

	return result.String()
}

func (m *messagesComponent) getSelectedText() string {
	if !m.selection.Active || len(m.rawContent) == 0 {
		return ""
	}

	var selected strings.Builder
	// Single line selection
	if m.selection.StartLine == m.selection.EndLine {
		if m.selection.StartLine < len(m.rawContent) {
			line := m.rawContent[m.selection.StartLine]

			// Find where actual text starts in the centered line
			stripped := ansi.Strip(line)
			textStart := 0
			for i, ch := range stripped {
				if ch != ' ' {
					textStart = i
					break
				}
			}

			// Adjust column positions to account for centering
			adjustedStartCol := m.selection.StartCol + textStart
			adjustedEndCol := m.selection.EndCol + textStart

			// Extract text with ANSI codes preserved
			extracted := extractTextRange(line, adjustedStartCol, adjustedEndCol)

			if extracted != "" {
				selected.WriteString(extracted)
			}
		}
		return selected.String()
	}
	// Multi-line selection
	for i := m.selection.StartLine; i <= m.selection.EndLine && i < len(m.rawContent); i++ {
		line := m.rawContent[i]

		// Find where actual text starts in the centered line
		stripped := ansi.Strip(line)
		textStart := 0
		for j, ch := range stripped {
			if ch != ' ' {
				textStart = j
				break
			}
		}

		if i == m.selection.StartLine {
			// First line - from start column to end
			adjustedStartCol := m.selection.StartCol + textStart
			extracted := extractTextRange(line, adjustedStartCol, -1)
			selected.WriteString(extracted)
		} else if i == m.selection.EndLine {
			// Last line - from beginning to end column
			if i > m.selection.StartLine {
				selected.WriteString("\n")
			}
			adjustedEndCol := m.selection.EndCol + textStart
			extracted := extractTextRange(line, textStart, adjustedEndCol)
			selected.WriteString(extracted)
		} else {
			// Middle lines - entire line (trim leading spaces)
			selected.WriteString("\n")
			extracted := extractTextRange(line, textStart, -1)
			selected.WriteString(extracted)
		}
	}

	return selected.String()
}

func (m *messagesComponent) calculateTextColumn(screenX, lineIndex int) int {
	// Get the viewport content
	content := m.viewport.View()
	lines := strings.Split(content, "\n")

	// Check if line is within viewport
	viewportLine := lineIndex - m.viewport.YOffset
	if viewportLine < 0 || viewportLine >= len(lines) {
		return 0
	}

	// Get the line and strip ANSI codes to find actual text
	line := lines[viewportLine]
	stripped := ansi.Strip(line)

	// Find where the actual text starts (after leading whitespace)
	textStart := 0
	for i, ch := range stripped {
		if ch != ' ' {
			textStart = i
			break
		}
	}

	// Calculate the column position relative to text start
	col := screenX - textStart
	if col < 0 {
		col = 0
	} else if col > len(stripped)-textStart {
		col = len(stripped) - textStart
	}

	slog.Debug("calculateTextColumn",
		"screenX", screenX,
		"lineIndex", lineIndex,
		"textStart", textStart,
		"col", col,
		"lineLen", len(stripped))

	return col
}

func (m *messagesComponent) highlightLineSection(line string, startCol, endCol int, style styles.Style) string {
	// First, let's strip ANSI codes to understand the actual text positions
	stripped := ansi.Strip(line)

	// If the selection is outside the line bounds, return unchanged
	if startCol >= len(stripped) || endCol <= 0 {
		return line
	}

	// Convert to runes to handle UTF-8 properly
	runes := []rune(stripped)

	// Adjust columns to rune positions
	if startCol > len(runes) {
		startCol = len(runes)
	}
	if endCol > len(runes) {
		endCol = len(runes)
	}

	// Calculate the content boundaries to prevent highlight spillover
	// Find where content actually starts and ends (non-space characters)
	contentStart := 0
	contentEnd := len(runes)

	// Find first non-space character
	for i, ch := range runes {
		if ch != ' ' {
			contentStart = i
			break
		}
	}

	// Find last non-space character
	for i := len(runes) - 1; i >= 0; i-- {
		if runes[i] != ' ' {
			contentEnd = i + 1
			break
		}
	}

	// Constrain highlight to content area
	actualStart := max(startCol, contentStart)
	actualEnd := min(endCol, contentEnd)

	// Build the result using runes
	before := ""
	selected := ""
	after := ""

	if actualStart > 0 {
		before = string(runes[:actualStart])
	}

	if actualEnd > actualStart {
		selected = string(runes[actualStart:actualEnd])
	}

	if actualEnd < len(runes) {
		after = string(runes[actualEnd:])
	}

	// Apply highlighting
	if selected != "" {
		// First reset any existing styles, then apply highlight
		selected = "\x1b[0m" + style.Render(selected) + "\x1b[0m"
	}

	return before + selected + after
}

func (m *messagesComponent) applySelectionOverlay(content string) string {
	if !m.selection.Active {
		return content
	}

	// Apply selection highlighting inline instead of as overlay
	lines := strings.Split(content, "\n")
	t := theme.CurrentTheme()

	// Create highlight style - use a translucent selection color
	// Using a muted background color for better visibility
	highlightStyle := styles.NewStyle().
		Background(t.TextMuted()).
		Foreground(t.Text())

	for i := range lines {
		lineInDoc := i + m.viewport.YOffset

		if lineInDoc >= m.selection.StartLine && lineInDoc <= m.selection.EndLine {
			slog.Debug("Highlighting line",
				"viewportLine", i,
				"docLine", lineInDoc,
				"selStart", m.selection.StartLine,
				"selEnd", m.selection.EndLine)

			line := lines[i]
			stripped := ansi.Strip(line)

			// Find where the actual text starts (after leading whitespace)
			textStart := 0
			if len(stripped) > 0 {
				for j, ch := range stripped {
					if ch != ' ' {
						textStart = j
						break
					}
				}
			}

			// Calculate selection bounds for this line
			var start, end int
			if lineInDoc == m.selection.StartLine && lineInDoc == m.selection.EndLine {
				start = m.selection.StartCol + textStart
				end = m.selection.EndCol + textStart
			} else if lineInDoc == m.selection.StartLine {
				start = m.selection.StartCol + textStart
				end = len(stripped)
			} else if lineInDoc == m.selection.EndLine {
				start = textStart
				end = m.selection.EndCol + textStart
			} else {
				start = textStart
				end = len(stripped)
			}

			// Apply highlighting to the line
			if start < end && start < len(stripped) {
				lines[i] = m.highlightLineSection(line, start, end, highlightStyle)
			} else if len(stripped) == 0 || (len(stripped) > 0 && stripped == strings.Repeat(" ", len(stripped))) {
				// Empty line or line with only spaces - highlight the entire line
				lines[i] = highlightStyle.Render(line)
			}

			slog.Debug("Line highlighting result",
				"line", i,
				"start", start,
				"end", end,
				"strippedLen", len(stripped),
				"applied", start < end && start < len(stripped))
		}
	}

	return strings.Join(lines, "\n")
}
func NewMessagesComponent(app *app.App) MessagesComponent {
	vp := viewport.New()
	attachments := viewport.New()
	// Don't disable the viewport's key bindings - this allows mouse scrolling to work
	// vp.KeyMap = viewport.KeyMap{}

	return &messagesComponent{
		app:             app,
		viewport:        vp,
		attachments:     attachments,
		showToolDetails: true,
		cache:           NewMessageCache(),
		tail:            true,
		selectedPart:    -1,
	}
}
