package chat

import (
	"encoding/base64"
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/v2/spinner"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/google/uuid"
	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/clipboard"
	"github.com/sst/opencode/internal/commands"
	"github.com/sst/opencode/internal/components/textarea"
	"github.com/sst/opencode/internal/components/vim"
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
	Length() int
	Focused() bool
	Focus() (tea.Model, tea.Cmd)
	Blur()
	Submit() (tea.Model, tea.Cmd)
	Clear() (tea.Model, tea.Cmd)
	Paste() (tea.Model, tea.Cmd)
	Newline() (tea.Model, tea.Cmd)
	SetValue(value string)
	SetInterruptKeyInDebounce(inDebounce bool)
	SetExitKeyInDebounce(inDebounce bool)
	ToggleVimMode()
}

type editorComponent struct {
	app                    *app.App
	textAreaFactory        *vim.TextAreaFactory
	spinner                spinner.Model
	interruptKeyInDebounce bool
	exitKeyInDebounce      bool
}

func (m *editorComponent) Init() tea.Cmd {
	return tea.Batch(m.textAreaFactory.Current().Focus(), m.spinner.Tick, tea.EnableReportFocus)
}

// Update method is now in editor_update.go

func (m *editorComponent) Content(width int) string {
	t := theme.CurrentTheme()
	base := styles.NewStyle().Foreground(t.Text()).Background(t.Background()).Render
	muted := styles.NewStyle().Foreground(t.TextMuted()).Background(t.Background()).Render
	promptStyle := styles.NewStyle().Foreground(t.Primary()).
		Padding(0, 0, 0, 1).
		Bold(true)
	prompt := promptStyle.Render(">")

	// Get current text area and set width
	currentTextArea := m.textAreaFactory.Current()
	currentTextArea.SetWidth(width - 6)
	
	textarea := lipgloss.JoinHorizontal(
		lipgloss.Top,
		prompt,
		currentTextArea.View(),
	)
	borderForeground := t.Border()
	if m.app.IsLeaderSequence {
		borderForeground = t.Accent()
	}
	textarea = styles.NewStyle().
		Background(t.BackgroundElement()).
		Width(width).
		PaddingTop(1).
		PaddingBottom(1).
		BorderStyle(lipgloss.ThickBorder()).
		BorderForeground(borderForeground).
		BorderBackground(t.Background()).
		BorderLeft(true).
		BorderRight(true).
		Render(textarea)

	// Build hint text
	hint := base(m.getSubmitKeyText()) + muted(" send")
	
	// Add Vim mode indicator after "enter send" if enabled
	if m.textAreaFactory.IsVimMode() {
		// Always show current vim mode
		modeStr := m.textAreaFactory.GetVimModeString()
		if modeStr == "" {
			modeStr = "VIM"
		}
		
		// Build mode indicator
		modeIndicator := base("[" + modeStr + "]")
		
		// Add status info in parentheses after mode
		vimStatusLine := m.textAreaFactory.GetVimStatusLine()
		if vimStatusLine != "" {
			// For visual modes, GetVimStatusLine includes selection info
			// For normal mode, it shows pending operators/counts
			if modeStr == "VISUAL" || modeStr == "V-LINE" {
				// Visual mode shows selection size
				modeIndicator += base(" (" + vimStatusLine + ")")
			} else if modeStr == "NORMAL" {
				// Normal mode shows pending operators/counts
				modeIndicator += base(" (" + vimStatusLine + ")")
			}
		}
		
		hint += muted("  ") + modeIndicator
	}
	if m.exitKeyInDebounce {
		keyText := m.getExitKeyText()
		hint = base(keyText+" again") + muted(" to exit")
		// Add vim mode indicator if in vim mode
		if m.textAreaFactory.IsVimMode() {
			modeStr := m.textAreaFactory.GetVimModeString()
			if modeStr == "" {
				modeStr = "VIM"
			}
			hint += muted("  ") + base("[" + modeStr + "]")
		}
	} else if m.app.IsBusy() {
		keyText := m.getInterruptKeyText()
		if m.interruptKeyInDebounce {
			hint = muted(
				"working",
			) + m.spinner.View() + muted(
				"  ",
			) + base(
				keyText+" again",
			) + muted(
				" interrupt",
			)
		} else {
			hint = muted("working") + m.spinner.View() + muted("  ") + base(keyText) + muted(" interrupt")
		}
		// Add vim mode indicator if in vim mode
		if m.textAreaFactory.IsVimMode() {
			modeStr := m.textAreaFactory.GetVimModeString()
			if modeStr == "" {
				modeStr = "VIM"
			}
			hint += muted("  ") + base("[" + modeStr + "]")
		}
	}

	model := ""
	if m.app.Model != nil {
		model = muted(m.app.Provider.Name) + base(" "+m.app.Model.Name)
	}

	space := width - 2 - lipgloss.Width(model) - lipgloss.Width(hint)
	if space < 0 {
		space = 0
	}
	spacer := styles.NewStyle().Background(t.Background()).Width(space).Render("")

	info := hint + spacer + model
	info = styles.NewStyle().Background(t.Background()).Padding(0, 1).Render(info)

	content := strings.Join([]string{"", textarea, info}, "\n")
	return content
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
	return m.textAreaFactory.Current().Focused()
}

func (m *editorComponent) Focus() (tea.Model, tea.Cmd) {
	return m, m.textAreaFactory.Current().Focus()
}

func (m *editorComponent) Blur() {
	m.textAreaFactory.Current().Blur()
}

func (m *editorComponent) Lines() int {
	return m.textAreaFactory.Current().LineCount()
}

func (m *editorComponent) Value() string {
	return m.textAreaFactory.Current().Value()
}

func (m *editorComponent) Length() int {
	return m.textAreaFactory.Current().Length()
}

func (m *editorComponent) Submit() (tea.Model, tea.Cmd) {
	value := strings.TrimSpace(m.Value())
	if value == "" {
		return m, nil
	}
	if len(value) > 0 && value[len(value)-1] == '\\' {
		// If the last character is a backslash, remove it and add a newline
		currentTextArea := m.textAreaFactory.Current()
		currentTextArea.ReplaceRange(len(value)-1, len(value), "")
		currentTextArea.InsertString("\n")
		return m, nil
	}

	var cmds []tea.Cmd

	attachments := m.textAreaFactory.Current().GetAttachments()
	fileParts := make([]opencode.FilePartParam, 0)
	for _, attachment := range attachments {
		fileParts = append(fileParts, opencode.FilePartParam{
			Type:     opencode.F(opencode.FilePartTypeFile),
			Mime:     opencode.F(attachment.MediaType),
			URL:      opencode.F(attachment.URL),
			Filename: opencode.F(attachment.Filename),
		})
	}

	updated, cmd := m.Clear()
	m = updated.(*editorComponent)
	cmds = append(cmds, cmd)

	cmds = append(cmds, util.CmdHandler(app.SendMsg{Text: value, Attachments: fileParts}))
	return m, tea.Batch(cmds...)
}

func (m *editorComponent) Clear() (tea.Model, tea.Cmd) {
	m.textAreaFactory.Current().Reset()
	return m, nil
}

func (m *editorComponent) Paste() (tea.Model, tea.Cmd) {
	imageBytes := clipboard.Read(clipboard.FmtImage)
	if imageBytes != nil {
		currentTextArea := m.textAreaFactory.Current()
		attachmentCount := len(currentTextArea.GetAttachments())
		attachmentIndex := attachmentCount + 1
		base64EncodedFile := base64.StdEncoding.EncodeToString(imageBytes)
		attachment := &textarea.Attachment{
			ID:        uuid.NewString(),
			MediaType: "image/png",
			Display:   fmt.Sprintf("[Image #%d]", attachmentIndex),
			Filename:  fmt.Sprintf("image-%d.png", attachmentIndex),
			URL:       fmt.Sprintf("data:image/png;base64,%s", base64EncodedFile),
		}
		currentTextArea.InsertAttachment(attachment)
		currentTextArea.InsertString(" ")
		return m, nil
	}

	textBytes := clipboard.Read(clipboard.FmtText)
	if textBytes != nil {
		m.textAreaFactory.Current().InsertRunesFromUserInput([]rune(string(textBytes)))
		return m, nil
	}

	// fallback to reading the clipboard using OSC52
	return m, tea.ReadClipboard
}

func (m *editorComponent) Newline() (tea.Model, tea.Cmd) {
	m.textAreaFactory.Current().Newline()
	return m, nil
}

func (m *editorComponent) SetInterruptKeyInDebounce(inDebounce bool) {
	m.interruptKeyInDebounce = inDebounce
}

func (m *editorComponent) SetValue(value string) {
	m.textAreaFactory.Current().SetValue(value)
}

func (m *editorComponent) SetExitKeyInDebounce(inDebounce bool) {
	m.exitKeyInDebounce = inDebounce
}

func (m *editorComponent) getInterruptKeyText() string {
	return m.app.Commands[commands.SessionInterruptCommand].Keys()[0]
}

func (m *editorComponent) getSubmitKeyText() string {
	return m.app.Commands[commands.InputSubmitCommand].Keys()[0]
}

func (m *editorComponent) getExitKeyText() string {
	return m.app.Commands[commands.AppExitCommand].Keys()[0]
}

func (m *editorComponent) ToggleVimMode() {
	m.textAreaFactory.ToggleVimMode()
}

func updateTextareaStyles(ta textarea.Model) textarea.Model {
	t := theme.CurrentTheme()
	bgColor := t.BackgroundElement()
	textColor := t.Text()
	textMutedColor := t.TextMuted()

	ta.Styles.Blurred.Base = styles.NewStyle().Foreground(textColor).Background(bgColor).Lipgloss()
	ta.Styles.Blurred.CursorLine = styles.NewStyle().Background(bgColor).Lipgloss()
	ta.Styles.Blurred.Placeholder = styles.NewStyle().
		Foreground(textMutedColor).
		Background(bgColor).
		Lipgloss()
	ta.Styles.Blurred.Text = styles.NewStyle().Foreground(textColor).Background(bgColor).Lipgloss()
	ta.Styles.Focused.Base = styles.NewStyle().Foreground(textColor).Background(bgColor).Lipgloss()
	ta.Styles.Focused.CursorLine = styles.NewStyle().Background(bgColor).Lipgloss()
	ta.Styles.Focused.Placeholder = styles.NewStyle().
		Foreground(textMutedColor).
		Background(bgColor).
		Lipgloss()
	ta.Styles.Focused.Text = styles.NewStyle().Foreground(textColor).Background(bgColor).Lipgloss()
	ta.Styles.Attachment = styles.NewStyle().
		Foreground(t.Secondary()).
		Background(bgColor).
		Lipgloss()
	ta.Styles.SelectedAttachment = styles.NewStyle().
		Foreground(t.Text()).
		Background(t.Secondary()).
		Lipgloss()
	ta.Styles.Cursor.Color = t.Primary()
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
	
	// Create text area factory
	factory := vim.NewTextAreaFactory(app)
	
	// Apply styles
	factory.UpdateStyles(updateTextareaStyles)

	m := &editorComponent{
		app:                    app,
		textAreaFactory:        factory,
		spinner:                s,
		interruptKeyInDebounce: false,
	}

	return m
}
