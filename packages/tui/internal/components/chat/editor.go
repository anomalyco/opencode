package chat

import (
	"fmt"
	"log/slog"
	"strings"

	"github.com/charmbracelet/bubbles/v2/spinner"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/commands"
	"github.com/sst/opencode/internal/components/dialog"
	"github.com/sst/opencode/internal/components/textarea"
	"github.com/sst/opencode/internal/image"
	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
)

type EditorComponent interface {
	tea.Model
	View(width int) string
	Content(width int) string
	Lines() int
	Value() string
	Focused() bool
	Focus() (tea.Model, tea.Cmd)
	Blur()
	Submit() (tea.Model, tea.Cmd)
	Clear() (tea.Model, tea.Cmd)
	Paste() (tea.Model, tea.Cmd)
	Newline() (tea.Model, tea.Cmd)
	SetInterruptKeyInDebounce(inDebounce bool)
}

type ScrollbarState struct {
	// Visual state
	visible bool
	x, y    int // Position in editor coordinates
	width   int // Hit zone width (3 chars for tolerance)
	height  int // Total scrollbar height

	// Thumb state
	thumbY      int // Current thumb position
	thumbHeight int // Thumb size

	// Interaction state
	hovering          bool
	dragging          bool
	dragStartY        int // Mouse Y when drag started
	dragStartThumb    int // Thumb position when drag started
	dragStartScroll   int // Scroll offset when drag started
	dragOffsetInThumb int // Where in the thumb we clicked (0 to thumbHeight-1)
}

type editorComponent struct {
	app                    *app.App
	width                  int
	height                 int
	textarea               textarea.Model
	attachments            []app.Attachment
	spinner                spinner.Model
	interruptKeyInDebounce bool
	scrollbar              ScrollbarState
}

func (m *editorComponent) Init() tea.Cmd {
	return tea.Batch(m.textarea.Focus(), m.spinner.Tick, tea.EnableReportFocus)
}

func (m *editorComponent) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd
	var cmd tea.Cmd

	switch msg := msg.(type) {
	case spinner.TickMsg:
		m.spinner, cmd = m.spinner.Update(msg)
		return m, cmd
	case tea.MouseClickMsg, tea.MouseMotionMsg, tea.MouseReleaseMsg, tea.MouseWheelMsg:
		switch evt := msg.(type) {
		case tea.MouseClickMsg:
			// Always update scrollbar state before checking clicks
			m.updateScrollbarState()

			// Log all clicks near scrollbar for debugging
			if m.scrollbar.visible && evt.X >= m.scrollbar.x-3 && evt.X <= m.scrollbar.x+2 {
				// The actual clickable bottom is height-1 due to parent bounds check
				actualBottom := m.scrollbar.y + m.scrollbar.height - 2
				slog.Debug("Click near scrollbar",
					"x", evt.X,
					"y", evt.Y,
					"scrollbarX", m.scrollbar.x,
					"scrollbarY", m.scrollbar.y,
					"scrollbarHeight", m.scrollbar.height,
					"visualRange", fmt.Sprintf("y=%d to y=%d", m.scrollbar.y, m.scrollbar.y+m.scrollbar.height-1),
					"clickableRange", fmt.Sprintf("y=%d to y=%d", m.scrollbar.y, actualBottom),
					"isOnScrollbar", m.isClickOnScrollbar(evt.X, evt.Y),
					"atBottom", evt.Y == actualBottom,
					"editorWidth", m.width,
					"textareaWidth", m.textarea.Width())
			}

			// Check if click is on scrollbar
			if m.scrollbar.visible && m.isClickOnScrollbar(evt.X, evt.Y) {
				slog.Debug("Scrollbar click detected",
					"x", evt.X,
					"y", evt.Y,
					"scrollbarX", m.scrollbar.x,
					"thumbY", m.scrollbar.thumbY,
					"thumbHeight", m.scrollbar.thumbHeight)

				// Handle scrollbar click
				m.handleScrollbarClick(evt.Y)
				return m, nil
			}
			// Not on scrollbar, pass to textarea
			// The prompt is ">" with 1 char padding = 2 chars total
			// Plus we have a left border = 3 chars total
			evt.X -= 3 // prompt (">") + padding + left border
			evt.Y -= 2 // Adjust for top padding and one more line offset

			// Ensure coordinates are not negative
			if evt.X < 0 {
				slog.Debug("Click X coordinate went negative",
					"originalX", evt.X+3,
					"adjustedX", evt.X)
				evt.X = 0
			}
			if evt.Y < 0 {
				slog.Debug("Click Y coordinate went negative",
					"originalY", evt.Y+1, "adjustedY", evt.Y)
				evt.Y = 0
			}

			slog.Debug("Passing click to textarea",
				"originalX", evt.X+3,
				"originalY", evt.Y+2, "adjustedX", evt.X,
				"adjustedY", evt.Y)
			m.textarea, cmd = m.textarea.Update(evt)

		case tea.MouseMotionMsg:
			// Handle scrollbar dragging
			if m.scrollbar.dragging {
				slog.Debug("Mouse motion while dragging", "y", evt.Y)
				m.handleScrollbarDrag(evt.Y)
				return m, nil
			}

			// Not dragging, pass to textarea
			evt.X -= 3 // prompt (">") + padding + left border
			evt.Y -= 2 // Adjust for top padding and one more line offset

			// Ensure coordinates are not negative
			if evt.X < 0 {
				evt.X = 0
			}
			if evt.Y < 0 {
				evt.Y = 0
			}

			m.textarea, cmd = m.textarea.Update(evt)

		case tea.MouseReleaseMsg:
			// Stop dragging if active
			if m.scrollbar.dragging {
				slog.Debug("Stopped dragging scrollbar")
				m.scrollbar.dragging = false
				// Lock scroll position to prevent snap-back
				m.textarea.SetScrollLocked(true)
				// Re-enable cursor when dragging stops
				m.textarea.SetScrollbarActive(false)
				return m, nil
			}

			// Pass to textarea
			m.textarea, cmd = m.textarea.Update(evt)

		case tea.MouseWheelMsg:
			// Just pass through - no coordinate adjustment needed
			m.textarea, cmd = m.textarea.Update(evt)
		}
		return m, cmd
	case tea.KeyPressMsg:
		// Maximize editor responsiveness for printable characters
		if msg.Text != "" {
			m.textarea, cmd = m.textarea.Update(msg)
			cmds = append(cmds, cmd)
			return m, tea.Batch(cmds...)
		}
	case dialog.ThemeSelectedMsg:
		m.textarea = createTextArea(&m.textarea)
		m.spinner = createSpinner()
		return m, tea.Batch(m.spinner.Tick, m.textarea.Focus())
	case dialog.CompletionSelectedMsg:
		if msg.IsCommand {
			commandName := strings.TrimPrefix(msg.CompletionValue, "/")
			updated, cmd := m.Clear()
			m = updated.(*editorComponent)
			cmds = append(cmds, cmd)
			cmds = append(cmds, util.CmdHandler(commands.ExecuteCommandMsg(m.app.Commands[commands.CommandName(commandName)])))
			return m, tea.Batch(cmds...)
		} else {
			existingValue := m.textarea.Value()

			// Replace the current token (after last space)
			lastSpaceIndex := strings.LastIndex(existingValue, " ")
			if lastSpaceIndex == -1 {
				m.textarea.SetValue(msg.CompletionValue + " ")
			} else {
				modifiedValue := existingValue[:lastSpaceIndex+1] + msg.CompletionValue
				m.textarea.SetValue(modifiedValue + " ")
			}
			return m, nil
		}
	}

	m.spinner, cmd = m.spinner.Update(msg)
	cmds = append(cmds, cmd)

	m.textarea, cmd = m.textarea.Update(msg)
	cmds = append(cmds, cmd)

	return m, tea.Batch(cmds...)
}

func (m *editorComponent) Content(width int) string {
	// Update scrollbar state before rendering
	m.updateScrollbarState()

	t := theme.CurrentTheme()
	base := styles.NewStyle().Foreground(t.Text()).Background(t.Background()).Render
	muted := styles.NewStyle().Foreground(t.TextMuted()).Background(t.Background()).Render
	promptStyle := styles.NewStyle().Foreground(t.Primary()).
		Padding(0, 0, 0, 1).
		Bold(true)
	prompt := promptStyle.Render(">")

	m.textarea.SetWidth(width - 6)
	textareaView := m.textarea.View()

	// Create the content with prompt
	content := lipgloss.JoinHorizontal(
		lipgloss.Top,
		prompt,
		textareaView,
	)

	// Always render without top/bottom borders for clean look
	textarea := styles.NewStyle().
		Background(t.BackgroundElement()).
		Width(width).
		PaddingTop(1).
		PaddingBottom(1).
		BorderStyle(lipgloss.ThickBorder()).
		BorderForeground(t.Border()).
		BorderBackground(t.Background()).
		BorderLeft(true).
		BorderRight(true).
		BorderTop(false).
		BorderBottom(false).
		Render(content)

	// Apply scrollbar overlay if needed
	if m.hasScrollbar() {
		scrollbar := m.renderScrollbar()
		if scrollbar != "" {
			// Apply scrollbar as overlay on the right edge, inside the border
			lines := strings.Split(textarea, "\n")
			scrollbarLines := strings.Split(scrollbar, "\n")

			// With ThickBorder and padding:
			// Line 0: Top border (┏━━━┓)
			// Line 1: Padding (empty line)
			// Lines 2 to n-2: Content lines
			// Line n-1: Padding (empty line)
			// Line n: Bottom border (┗━━━┛)

			// Without top/bottom borders:
			// Line 0: Padding (empty line)
			// Lines 1 to n-1: Content lines
			// Line n: Padding (empty line)

			startLine := 1            // After top padding
			endLine := len(lines) - 1 // Before bottom padding

			// Debug logging removed - too frequent during rendering
			for i := 0; i < len(scrollbarLines) && startLine+i < endLine; i++ {
				lineIdx := startLine + i
				// Apply scrollbar overlay at the right edge, just inside the border
				lines[lineIdx] = layout.PlaceOverlay(m.width-2, 0, scrollbarLines[i], lines[lineIdx])
			}

			textarea = strings.Join(lines, "\n")
		}
	}

	hint := base(m.getSubmitKeyText()) + muted(" send   ")
	if m.app.IsBusy() {
		keyText := m.getInterruptKeyText()
		if m.interruptKeyInDebounce {
			hint = muted("working") + m.spinner.View() + muted("  ") + base(keyText+" again") + muted(" interrupt")
		} else {
			hint = muted("working") + m.spinner.View() + muted("  ") + base(keyText) + muted(" interrupt")
		}
	}

	model := ""
	if m.app.Model != nil {
		model = muted(m.app.Provider.Name) + base(" "+m.app.Model.Name)
	}

	space := width - 2 - lipgloss.Width(model) - lipgloss.Width(hint)
	spacer := styles.NewStyle().Background(t.Background()).Width(space).Render("")

	info := hint + spacer + model
	info = styles.NewStyle().Background(t.Background()).Padding(0, 1).Render(info)

	result := strings.Join([]string{"", textarea, info}, "\n")
	return result
}

func (m *editorComponent) View(width int) string {
	if m.Lines() > 1 {
		return lipgloss.Place(
			width,
			5,
			lipgloss.Center,
			lipgloss.Center,
			"",
			styles.WhitespaceStyle(theme.CurrentTheme().Background()),
		)
	}
	return m.Content(width)
}

func (m *editorComponent) Focused() bool {
	return m.textarea.Focused()
}

func (m *editorComponent) Focus() (tea.Model, tea.Cmd) {
	return m, m.textarea.Focus()
}

func (m *editorComponent) Blur() {
	m.textarea.Blur()
}

func (m *editorComponent) GetSize() (width, height int) {
	return m.width, m.height
}

func (m *editorComponent) SetSize(width, height int) tea.Cmd {
	m.width = width
	m.height = height
	// Also update textarea width to account for prompt and borders
	// When scrollbar is shown, we have one less border character
	borderAdjust := 6 // 3 for prompt, 2 for borders, 1 for padding
	if m.hasScrollbar() {
		borderAdjust = 5 // One less for missing right border
	}
	m.textarea.SetWidth(width - borderAdjust)
	return nil
}
func (m *editorComponent) Lines() int {
	// If MaxHeight is set, grow naturally up to MaxHeight, then stay fixed
	if m.textarea.MaxHeight > 0 {
		contentLines := m.textarea.LineCount()
		if contentLines <= m.textarea.MaxHeight {
			return contentLines
		} else {
			return m.textarea.MaxHeight
		}
	}
	return m.textarea.LineCount()
}

func (m *editorComponent) hasScrollbar() bool {
	return m.textarea.LineCount() > m.textarea.MaxHeight
}

func (m *editorComponent) updateScrollbarState() {
	m.scrollbar.visible = m.hasScrollbar()
	if !m.scrollbar.visible {
		return
	}

	// Calculate scrollbar position and dimensions
	// Scrollbar is at the right edge, inside the border
	m.scrollbar.x = m.width - 2
	m.scrollbar.y = 1     // After top padding
	m.scrollbar.width = 3 // 3 chars wide for hit tolerance
	// Height matches the visible content area (excluding bottom padding)
	m.scrollbar.height = m.textarea.MaxHeight

	// Calculate thumb size and position with better precision
	totalLines := m.textarea.LineCount()
	visibleLines := m.textarea.MaxHeight
	scrollOffset := m.textarea.ScrollOffset()

	// Calculate thumb height as a proportion of visible content
	// Use floating point for smoother calculation
	thumbRatio := float64(visibleLines) / float64(totalLines)
	m.scrollbar.thumbHeight = max(1, int(float64(m.scrollbar.height)*thumbRatio+0.5))

	// Calculate thumb position
	if totalLines > visibleLines {
		// Calculate position as a ratio of scroll progress
		scrollRatio := float64(scrollOffset) / float64(totalLines-visibleLines)
		maxThumbPos := m.scrollbar.height - m.scrollbar.thumbHeight
		m.scrollbar.thumbY = int(float64(maxThumbPos)*scrollRatio + 0.5)
		// Ensure thumb stays within bounds
		m.scrollbar.thumbY = max(0, min(maxThumbPos, m.scrollbar.thumbY))
	} else {
		m.scrollbar.thumbY = 0
	}
}

func (m *editorComponent) isClickOnScrollbar(x, y int) bool {
	// Check if click is within scrollbar hit zone
	// Accept clicks from scrollbar position to the right edge (including border)
	if x < m.scrollbar.x || x > m.scrollbar.x+1 {
		return false
	}

	// Check if click is within scrollbar height
	// The scrollbar goes from y=1 to y=10 (inclusive)
	// So we need to accept y >= 1 && y <= 10
	if y < m.scrollbar.y || y > m.scrollbar.y+m.scrollbar.height-1 {
		return false
	}

	return true
}
func (m *editorComponent) handleScrollbarClick(y int) {
	// Calculate click position relative to scrollbar
	clickY := y - m.scrollbar.y
	// Ensure click is within valid range (with slight tolerance)
	if clickY < -1 || clickY >= m.scrollbar.height+1 {
		slog.Debug("Click outside scrollbar bounds",
			"clickY", clickY,
			"scrollbarHeight", m.scrollbar.height)
		return
	}

	// Clamp clickY to valid range
	clickY = max(0, min(m.scrollbar.height-1, clickY))
	// Check if click is on thumb
	if clickY >= m.scrollbar.thumbY && clickY < m.scrollbar.thumbY+m.scrollbar.thumbHeight {
		// Start dragging - track where in the thumb we clicked
		m.scrollbar.dragging = true
		m.scrollbar.dragStartY = y
		m.scrollbar.dragStartThumb = m.scrollbar.thumbY
		m.scrollbar.dragStartScroll = m.textarea.ScrollOffset()
		m.scrollbar.dragOffsetInThumb = clickY - m.scrollbar.thumbY

		// Hide cursor while dragging
		m.textarea.SetScrollbarActive(true)

		slog.Debug("Started dragging scrollbar",
			"dragStartY", y,
			"dragStartThumb", m.scrollbar.thumbY,
			"dragStartScroll", m.scrollbar.dragStartScroll,
			"dragOffsetInThumb", m.scrollbar.dragOffsetInThumb)
		return
	}
	// Click on track - jump to position (center thumb on click)
	totalLines := m.textarea.LineCount()
	visibleLines := m.textarea.MaxHeight
	maxScroll := max(0, totalLines-visibleLines)

	if maxScroll == 0 {
		return // Nothing to scroll
	}

	// Hide cursor temporarily while scrolling
	m.textarea.SetScrollbarActive(true)

	// Center the thumb on the click position (like messages scrollbar)
	newThumbPos := clickY - m.scrollbar.thumbHeight/2
	maxThumbPos := m.scrollbar.height - m.scrollbar.thumbHeight

	// Clamp thumb position
	if newThumbPos < 0 {
		newThumbPos = 0
	} else if newThumbPos > maxThumbPos {
		newThumbPos = maxThumbPos
	}

	// Calculate scroll offset from thumb position
	newScrollOffset := 0
	if maxThumbPos > 0 {
		newScrollOffset = (newThumbPos * maxScroll) / maxThumbPos
	}

	// Clamp to valid range
	newScrollOffset = max(0, min(maxScroll, newScrollOffset))

	slog.Debug("Jumping to position",
		"clickY", clickY,
		"newThumbPos", newThumbPos,
		"newScrollOffset", newScrollOffset,
		"maxScroll", maxScroll)

	m.textarea.SetScrollOffset(newScrollOffset)

	// Lock scroll position to prevent snap-back
	m.textarea.SetScrollLocked(true)

	// Re-enable cursor after jump
	m.textarea.SetScrollbarActive(false)
}

func (m *editorComponent) handleScrollbarDrag(y int) {
	totalLines := m.textarea.LineCount()
	visibleLines := m.textarea.MaxHeight
	maxScroll := max(0, totalLines-visibleLines)

	if maxScroll == 0 {
		return // Nothing to scroll
	}

	// Calculate where the mouse is relative to the scrollbar
	// Account for where we clicked in the thumb
	scrollbarY := y - m.scrollbar.y - m.scrollbar.dragOffsetInThumb
	// Calculate scrollbar dimensions
	maxThumbPos := m.scrollbar.height - m.scrollbar.thumbHeight

	// Clamp thumb position
	if scrollbarY < 0 {
		scrollbarY = 0
	} else if scrollbarY > maxThumbPos {
		scrollbarY = maxThumbPos
	}

	// Calculate new scroll offset
	newScrollOffset := 0
	if maxThumbPos > 0 {
		newScrollOffset = (scrollbarY * maxScroll) / maxThumbPos
	}

	// Ensure we can reach the extremes
	if scrollbarY == 0 {
		newScrollOffset = 0
	} else if scrollbarY == maxThumbPos {
		newScrollOffset = maxScroll
	}

	slog.Debug("Dragging scrollbar",
		"y", y,
		"scrollbarY", scrollbarY,
		"maxThumbPos", maxThumbPos,
		"newScrollOffset", newScrollOffset,
		"maxScroll", maxScroll)

	m.textarea.SetScrollOffset(newScrollOffset)
}

func (m *editorComponent) renderScrollbar() string {
	if !m.hasScrollbar() {
		return ""
	}

	t := theme.CurrentTheme()

	// Calculate scroll position based on textarea's state
	totalLines := m.textarea.LineCount()
	visibleLines := m.textarea.MaxHeight
	scrollOffset := m.textarea.ScrollOffset()

	// Calculate thumb size and position
	thumbHeight := max(1, (visibleLines*visibleLines)/totalLines)
	maxThumbPos := visibleLines - thumbHeight
	thumbPos := 0
	if totalLines > visibleLines {
		thumbPos = (scrollOffset * maxThumbPos) / (totalLines - visibleLines)
	}

	// Build scrollbar using OpenCode style
	scrollbar := make([]string, visibleLines)

	// Create styles for track and thumb
	trackStyle := lipgloss.NewStyle().
		Foreground(t.BackgroundElement()).
		Background(t.Background())

	thumbStyle := lipgloss.NewStyle().
		Foreground(t.Primary()).
		Background(t.Background())

	// Build scrollbar
	for i := 0; i < visibleLines; i++ {
		if i >= thumbPos && i < thumbPos+thumbHeight {
			// Thumb part - use solid block
			scrollbar[i] = thumbStyle.Render("█")
		} else {
			// Track part - use thin line
			scrollbar[i] = trackStyle.Render("│")
		}
	}
	// Build scrollbar
	for i := 0; i < visibleLines; i++ {
		if i >= thumbPos && i < thumbPos+thumbHeight {
			// Thumb part - use solid block
			scrollbar[i] = thumbStyle.Render("█")
		} else {
			// Track part - use thin line
			scrollbar[i] = trackStyle.Render("│")
		}
	}
	return strings.Join(scrollbar, "\n")
}

func (m *editorComponent) Value() string {
	return m.textarea.Value()
}

func (m *editorComponent) Submit() (tea.Model, tea.Cmd) {
	value := strings.TrimSpace(m.Value())
	if value == "" {
		return m, nil
	}
	if len(value) > 0 && value[len(value)-1] == '\\' {
		// If the last character is a backslash, remove it and add a newline
		m.textarea.SetValue(value[:len(value)-1] + "\n")
		return m, nil
	}

	var cmds []tea.Cmd
	updated, cmd := m.Clear()
	m = updated.(*editorComponent)
	cmds = append(cmds, cmd)

	attachments := m.attachments
	m.attachments = nil

	cmds = append(cmds, util.CmdHandler(app.SendMsg{Text: value, Attachments: attachments}))
	return m, tea.Batch(cmds...)
}

func (m *editorComponent) Clear() (tea.Model, tea.Cmd) {
	m.textarea.Reset()
	return m, nil
}

func (m *editorComponent) Paste() (tea.Model, tea.Cmd) {
	imageBytes, text, err := image.GetImageFromClipboard()
	if err != nil {
		slog.Error(err.Error())
		return m, nil
	}
	if len(imageBytes) != 0 {
		attachmentName := fmt.Sprintf("clipboard-image-%d", len(m.attachments))
		attachment := app.Attachment{FilePath: attachmentName, FileName: attachmentName, Content: imageBytes, MimeType: "image/png"}
		m.attachments = append(m.attachments, attachment)
	} else {
		m.textarea.SetValue(m.textarea.Value() + text)
	}
	return m, nil
}

func (m *editorComponent) Newline() (tea.Model, tea.Cmd) {
	m.textarea.Newline()
	return m, nil
}

func (m *editorComponent) SetInterruptKeyInDebounce(inDebounce bool) {
	m.interruptKeyInDebounce = inDebounce
}

func (m *editorComponent) getInterruptKeyText() string {
	return m.app.Commands[commands.SessionInterruptCommand].Keys()[0]
}

func (m *editorComponent) getSubmitKeyText() string {
	return m.app.Commands[commands.InputSubmitCommand].Keys()[0]
}

func createTextArea(existing *textarea.Model) textarea.Model {
	t := theme.CurrentTheme()
	bgColor := t.BackgroundElement()
	textColor := t.Text()
	textMutedColor := t.TextMuted()

	ta := textarea.New()

	ta.Styles.Blurred.Base = styles.NewStyle().Foreground(textColor).Background(bgColor).Lipgloss()
	ta.Styles.Blurred.CursorLine = styles.NewStyle().Background(bgColor).Lipgloss()
	ta.Styles.Blurred.Placeholder = styles.NewStyle().Foreground(textMutedColor).Background(bgColor).Lipgloss()
	ta.Styles.Blurred.Text = styles.NewStyle().Foreground(textColor).Background(bgColor).Lipgloss()
	ta.Styles.Focused.Base = styles.NewStyle().Foreground(textColor).Background(bgColor).Lipgloss()
	ta.Styles.Focused.CursorLine = styles.NewStyle().Background(bgColor).Lipgloss()
	ta.Styles.Focused.Placeholder = styles.NewStyle().Foreground(textMutedColor).Background(bgColor).Lipgloss()
	ta.Styles.Focused.Text = styles.NewStyle().Foreground(textColor).Background(bgColor).Lipgloss()
	ta.Styles.Cursor.Color = t.Primary()

	ta.Prompt = " "
	ta.ShowLineNumbers = false
	ta.CharLimit = -1

	// Limit height to 10 lines to prevent excessive growth
	ta.MaxHeight = 10

	if existing != nil {
		ta.SetValue(existing.Value())
		// ta.SetWidth(existing.Width())
		ta.SetHeight(existing.Height())
	}

	return ta
}

func createSpinner() spinner.Model {
	t := theme.CurrentTheme()
	return spinner.New(
		spinner.WithSpinner(spinner.Ellipsis),
		spinner.WithStyle(
			styles.NewStyle().
				Background(t.Background()).
				Foreground(t.TextMuted()).
				Width(3).
				Lipgloss(),
		),
	)
}

func NewEditorComponent(app *app.App) EditorComponent {
	s := createSpinner()
	ta := createTextArea(nil)

	return &editorComponent{
		app:                    app,
		textarea:               ta,
		spinner:                s,
		interruptKeyInDebounce: false,
	}
}
