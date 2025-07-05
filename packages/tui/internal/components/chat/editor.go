package chat

import (
	"fmt"
	"log/slog"
	"path/filepath"
	"strings"

	"github.com/charmbracelet/bubbles/v2/spinner"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/google/uuid"
	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/commands"
	"github.com/sst/opencode/internal/components/dialog"
	"github.com/sst/opencode/internal/components/textarea"
	"github.com/sst/opencode/internal/image"
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

type editorComponent struct {
	app                    *app.App
	textarea               textarea.Model
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
		switch msg.ProviderID {
		case "commands":
			commandName := strings.TrimPrefix(msg.CompletionValue, "/")
			updated, cmd := m.Clear()
			m = updated.(*editorComponent)
			cmds = append(cmds, cmd)
			cmds = append(cmds, util.CmdHandler(commands.ExecuteCommandMsg(m.app.Commands[commands.CommandName(commandName)])))
			return m, tea.Batch(cmds...)
		case "files":
			atIndex := m.textarea.LastRuneIndex('@')
			if atIndex == -1 {
				// Should not happen, but as a fallback, just insert.
				m.textarea.InsertString(msg.CompletionValue + " ")
				return m, nil
			}

			// The range to replace is from the '@' up to the current cursor position.
			// Replace the search term (e.g., "@search") with an empty string first.
			cursorCol := m.textarea.CursorColumn()
			m.textarea.ReplaceRange(atIndex, cursorCol, "")

			// Now, insert the attachment at the position where the '@' was.
			// The cursor is now at `atIndex` after the replacement.
			filePath := msg.CompletionValue
			extension := filepath.Ext(filePath)
			mediaType := ""
			switch extension {
			case ".jpg":
				mediaType = "image/jpeg"
			case ".png", ".jpeg", ".gif", ".webp":
				mediaType = "image/" + extension[1:]
			case ".pdf":
				mediaType = "application/pdf"
			default:
				mediaType = "text/plain"
			}
			attachment := &textarea.Attachment{
				ID:        uuid.NewString(),
				Display:   "@" + filePath,
				URL:       fmt.Sprintf("file://./%s", filePath),
				Filename:  filePath,
				MediaType: mediaType,
			}
			m.textarea.InsertAttachment(attachment)
			m.textarea.InsertString(" ")
			return m, nil
		default:
			existingValue := m.textarea.Value()
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
	t := theme.CurrentTheme()
	base := styles.NewStyle().Foreground(t.Text()).Background(t.Background()).Render
	muted := styles.NewStyle().Foreground(t.TextMuted()).Background(t.Background()).Render
	promptStyle := styles.NewStyle().Foreground(t.Primary()).
		Padding(0, 0, 0, 1).
		Bold(true)
	prompt := promptStyle.Render(">")

	m.textarea.SetWidth(width - 6)
	textarea := lipgloss.JoinHorizontal(
		lipgloss.Top,
		prompt,
		m.textarea.View(),
	)
	textarea = styles.NewStyle().
		Background(t.BackgroundElement()).
		Width(width).
		PaddingTop(1).
		PaddingBottom(1).
		BorderStyle(lipgloss.ThickBorder()).
		BorderForeground(t.Border()).
		BorderBackground(t.Background()).
		BorderLeft(true).
		BorderRight(true).
		Render(textarea)

	hint := base(m.getSubmitKeyText()) + muted(" send   ")
	if m.app.IsBusy() {
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
	}

	model := ""
	if m.app.Model != nil {
		model = muted(m.app.Provider.Name) + base(" "+m.app.Model.Name)
	}

	space := width - 2 - lipgloss.Width(model) - lipgloss.Width(hint)
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
	return m.textarea.Focused()
}

func (m *editorComponent) Focus() (tea.Model, tea.Cmd) {
	return m, m.textarea.Focus()
}

func (m *editorComponent) Blur() {
	m.textarea.Blur()
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
		m.textarea.ReplaceRange(len(value)-1, len(value), "")
		m.textarea.InsertString("\n")
		return m, nil
	}

	var cmds []tea.Cmd

	attachments := m.textarea.GetAttachments()
	fileParts := make([]opencode.FilePartParam, 0)
	for _, attachment := range attachments {
		fileParts = append(fileParts, opencode.FilePartParam{
			Type:      opencode.F(opencode.FilePartTypeFile),
			MediaType: opencode.F(attachment.MediaType),
			URL:       opencode.F(attachment.URL),
			Filename:  opencode.F(attachment.Filename),
		})
	}

	updated, cmd := m.Clear()
	m = updated.(*editorComponent)
	cmds = append(cmds, cmd)

	cmds = append(cmds, util.CmdHandler(app.SendMsg{Text: value, Attachments: fileParts}))
	return m, tea.Batch(cmds...)
}

func (m *editorComponent) Clear() (tea.Model, tea.Cmd) {
	m.textarea.Reset()
	return m, nil
}

func (m *editorComponent) Paste() (tea.Model, tea.Cmd) {
	_, text, err := image.GetImageFromClipboard()
	if err != nil {
		slog.Error(err.Error())
		return m, nil
	}
	// if len(imageBytes) != 0 {
	// 	attachmentName := fmt.Sprintf("clipboard-image-%d", len(m.attachments))
	// 	attachment := app.Attachment{
	// 		FilePath: attachmentName,
	// 		FileName: attachmentName,
	// 		Content:  imageBytes,
	// 		MimeType: "image/png",
	// 	}
	// 	m.attachments = append(m.attachments, attachment)
	// } else {
	m.textarea.InsertString(text)
	// }
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

	ta.Prompt = " "
	ta.ShowLineNumbers = false
	ta.CharLimit = -1

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
