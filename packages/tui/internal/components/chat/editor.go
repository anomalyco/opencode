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
	tea.ViewModel
	layout.Sizeable
	Content() string
	Lines() int
	Value() string
	Focused() bool
	Focus() (tea.Model, tea.Cmd)
	Blur()
	Submit() (tea.Model, tea.Cmd)
	Clear() (tea.Model, tea.Cmd)
	Paste() (tea.Model, tea.Cmd)
	Newline() (tea.Model, tea.Cmd)
	Previous() (tea.Model, tea.Cmd)
	Next() (tea.Model, tea.Cmd)
	SetInterruptKeyInDebounce(inDebounce bool)
}

type editorComponent struct {
	app                    *app.App
	width, height          int
	textarea               textarea.Model
	attachments            []app.Attachment
	history                []string
	historyIndex           int
	currentMessage         string
	spinner                spinner.Model
	interruptKeyInDebounce bool
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

func (m *editorComponent) Content() string {
	t := theme.CurrentTheme()
	base := styles.NewStyle().Foreground(t.Text()).Background(t.Background()).Render
	muted := styles.NewStyle().Foreground(t.TextMuted()).Background(t.Background()).Render
	promptStyle := styles.NewStyle().Foreground(t.Primary()).
		Padding(0, 0, 0, 1).
		Bold(true)
	prompt := promptStyle.Render(">")

	textarea := lipgloss.JoinHorizontal(
		lipgloss.Top,
		prompt,
		m.textarea.View(),
	)
	textarea = styles.NewStyle().
		Background(t.BackgroundElement()).
		Width(m.width).
		PaddingTop(1).
		PaddingBottom(1).
		Render(textarea)

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

	space := m.width - 2 - lipgloss.Width(model) - lipgloss.Width(hint)
	spacer := styles.NewStyle().Background(t.Background()).Width(space).Render("")

	info := hint + spacer + model
	info = styles.NewStyle().Background(t.Background()).Padding(0, 1).Render(info)

	content := strings.Join([]string{"", textarea, info}, "\n")
	return content
}

func (m *editorComponent) View() string {
	if m.Lines() > 1 {
		return ""
	}
	return m.Content()
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
	m.textarea.SetWidth(width - 5) // account for the prompt and padding right
	// m.textarea.SetHeight(height - 4)
	return nil
}

func (m *editorComponent) Lines() int {
	return m.textarea.LineCount()
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

	// Save to history if not empty and not a duplicate of the last entry
	if value != "" {
		if len(m.history) == 0 || m.history[len(m.history)-1] != value {
			m.history = append(m.history, value)
		}
		m.historyIndex = len(m.history)
		m.currentMessage = ""
	}

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

func (m *editorComponent) Previous() (tea.Model, tea.Cmd) {
	currentLine := m.textarea.Line()

	// Only navigate history if we're at the first line
	if currentLine == 0 && len(m.history) > 0 {
		// Save current message if we're just starting to navigate
		if m.historyIndex == len(m.history) {
			m.currentMessage = m.textarea.Value()
		}

		// Go to previous message in history
		if m.historyIndex > 0 {
			m.historyIndex--
			m.textarea.SetValue(m.history[m.historyIndex])
		}
		return m, nil
	}
	return m, nil
}

func (m *editorComponent) Next() (tea.Model, tea.Cmd) {
	currentLine := m.textarea.Line()
	value := m.textarea.Value()
	lines := strings.Split(value, "\n")
	totalLines := len(lines)

	// Only navigate history if we're at the last line
	if currentLine == totalLines-1 {
		if m.historyIndex < len(m.history)-1 {
			// Go to next message in history
			m.historyIndex++
			m.textarea.SetValue(m.history[m.historyIndex])
		} else if m.historyIndex == len(m.history)-1 {
			// Return to the current message being composed
			m.historyIndex = len(m.history)
			m.textarea.SetValue(m.currentMessage)
		}
		return m, nil
	}
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

	if existing != nil {
		ta.SetValue(existing.Value())
		ta.SetWidth(existing.Width())
		ta.SetHeight(existing.Height())
	}

	// ta.Focus()
	return ta
}

func createSpinner() spinner.Model {
	t := theme.CurrentTheme()
	return spinner.New(
		spinner.WithSpinner(spinner.Ellipsis),
		spinner.WithStyle(
			styles.NewStyle().
				Foreground(t.Background()).
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
		history:                []string{},
		historyIndex:           0,
		currentMessage:         "",
		spinner:                s,
		interruptKeyInDebounce: false,
	}
}
