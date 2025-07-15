package chat

import (
	"encoding/base64"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/charmbracelet/bubbles/v2/spinner"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/google/uuid"
	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/clipboard"
	"github.com/sst/opencode/internal/commands"
	"github.com/sst/opencode/internal/components/dialog"
	"github.com/sst/opencode/internal/components/textarea"
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
}

type editorComponent struct {
	app                    *app.App
	textarea               textarea.Model
	spinner                spinner.Model
	interruptKeyInDebounce bool
	exitKeyInDebounce      bool
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
	case tea.PasteMsg:
		text := string(msg)
		text = strings.ReplaceAll(text, "\\", "")
		text, err := strconv.Unquote(`"` + text + `"`)
		if err != nil {
			slog.Error("Failed to unquote text", "error", err)
			m.textarea.InsertRunesFromUserInput([]rune(msg))
			return m, nil
		}
		if _, err := os.Stat(text); err != nil {
			slog.Error("Failed to paste file", "error", err)
			m.textarea.InsertRunesFromUserInput([]rune(msg))
			return m, nil
		}

		filePath := text
		ext := strings.ToLower(filepath.Ext(filePath))

		mediaType := ""
		switch ext {
		case ".jpg":
			mediaType = "image/jpeg"
		case ".png", ".jpeg", ".gif", ".webp":
			mediaType = "image/" + ext[1:]
		case ".pdf":
			mediaType = "application/pdf"
		default:
			attachment := &textarea.Attachment{
				ID:        uuid.NewString(),
				Display:   "@" + filePath,
				URL:       fmt.Sprintf("file://./%s", filePath),
				Filename:  filePath,
				MediaType: "text/plain",
			}
			m.textarea.InsertAttachment(attachment)
			m.textarea.InsertString(" ")
			return m, nil
		}

		fileBytes, err := os.ReadFile(filePath)
		if err != nil {
			slog.Error("Failed to read file", "error", err)
			m.textarea.InsertRunesFromUserInput([]rune(msg))
			return m, nil
		}
		base64EncodedFile := base64.StdEncoding.EncodeToString(fileBytes)
		url := fmt.Sprintf("data:%s;base64,%s", mediaType, base64EncodedFile)
		attachmentCount := len(m.textarea.GetAttachments())
		attachmentIndex := attachmentCount + 1
		label := "File"
		if strings.HasPrefix(mediaType, "image/") {
			label = "Image"
		}

		attachment := &textarea.Attachment{
			ID:        uuid.NewString(),
			MediaType: mediaType,
			Display:   fmt.Sprintf("[%s #%d]", label, attachmentIndex),
			URL:       url,
			Filename:  filePath,
		}
		m.textarea.InsertAttachment(attachment)
		m.textarea.InsertString(" ")
	case tea.ClipboardMsg:
		text := string(msg)
		m.textarea.InsertRunesFromUserInput([]rune(text))
	case dialog.ThemeSelectedMsg:
		m.textarea = updateTextareaStyles(m.textarea)
		m.spinner = createSpinner()
		return m, tea.Batch(m.spinner.Tick, m.textarea.Focus())
	case dialog.CompletionSelectedMsg:
		switch msg.Item.ProviderID {
		case "commands":
			commandName := strings.TrimPrefix(msg.Item.Value, "/")
			updated, cmd := m.Clear()
			m = updated.(*editorComponent)
			cmds = append(cmds, cmd)
			cmds = append(cmds, util.CmdHandler(commands.ExecuteCommandMsg(m.app.Commands[commands.CommandName(commandName)])))
			return m, tea.Batch(cmds...)
		case "files":
			atIndex := m.textarea.LastRuneIndex('@')
			if atIndex == -1 {
				// Should not happen, but as a fallback, just insert.
				m.textarea.InsertString(msg.Item.Value + " ")
				return m, nil
			}

			// The range to replace is from the '@' up to the current cursor position.
			// Replace the search term (e.g., "@search") with an empty string first.
			cursorCol := m.textarea.CursorColumn()
			m.textarea.ReplaceRange(atIndex, cursorCol, "")

			// Now, insert the attachment at the position where the '@' was.
			// The cursor is now at `atIndex` after the replacement.
			filePath := msg.Item.Value
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
				URL:       fmt.Sprintf("file://./%s", url.PathEscape(filePath)),
				Filename:  filePath,
				MediaType: mediaType,
			}
			m.textarea.InsertAttachment(attachment)
			m.textarea.InsertString(" ")
			return m, nil
		case "symbols":
			atIndex := m.textarea.LastRuneIndex('@')
			if atIndex == -1 {
				// Should not happen, but as a fallback, just insert.
				m.textarea.InsertString(msg.Item.Value + " ")
				return m, nil
			}

			cursorCol := m.textarea.CursorColumn()
			m.textarea.ReplaceRange(atIndex, cursorCol, "")

			symbol := msg.Item.RawData.(opencode.Symbol)
			parts := strings.Split(symbol.Name, ".")
			lastPart := parts[len(parts)-1]
			attachment := &textarea.Attachment{
				ID:        uuid.NewString(),
				Display:   "@" + lastPart,
				URL:       msg.Item.Value,
				Filename:  lastPart,
				MediaType: "text/plain",
			}
			m.textarea.InsertAttachment(attachment)
			m.textarea.InsertString(" ")
			return m, nil
		default:
			slog.Debug("Unknown provider", "provider", msg.Item.ProviderID)
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

	hint := base(m.getSubmitKeyText()) + muted(" send   ")
	if m.exitKeyInDebounce {
		keyText := m.getExitKeyText()
		hint = base(keyText+" again") + muted(" to exit")
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

func (m *editorComponent) Length() int {
	return m.textarea.Length()
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
	m.textarea.Reset()
	return m, nil
}

func (m *editorComponent) Paste() (tea.Model, tea.Cmd) {
	imageBytes := clipboard.Read(clipboard.FmtImage)
	if imageBytes != nil {
		attachmentCount := len(m.textarea.GetAttachments())
		attachmentIndex := attachmentCount + 1
		base64EncodedFile := base64.StdEncoding.EncodeToString(imageBytes)
		attachment := &textarea.Attachment{
			ID:        uuid.NewString(),
			MediaType: "image/png",
			Display:   fmt.Sprintf("[Image #%d]", attachmentIndex),
			Filename:  fmt.Sprintf("image-%d.png", attachmentIndex),
			URL:       fmt.Sprintf("data:image/png;base64,%s", base64EncodedFile),
		}
		m.textarea.InsertAttachment(attachment)
		m.textarea.InsertString(" ")
		return m, nil
	}

	textBytes := clipboard.Read(clipboard.FmtText)
	if textBytes != nil {
		m.textarea.InsertRunesFromUserInput([]rune(string(textBytes)))
		return m, nil
	}

	// fallback to reading the clipboard using OSC52
	return m, tea.ReadClipboard
}

func (m *editorComponent) Newline() (tea.Model, tea.Cmd) {
	m.textarea.Newline()
	return m, nil
}

func (m *editorComponent) SetInterruptKeyInDebounce(inDebounce bool) {
	m.interruptKeyInDebounce = inDebounce
}

func (m *editorComponent) SetValue(value string) {
	m.textarea.SetValue(value)
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

	ta := textarea.New()
	ta.Prompt = " "
	ta.ShowLineNumbers = false
	ta.CharLimit = -1
	ta = updateTextareaStyles(ta)

	m := &editorComponent{
		app:                    app,
		textarea:               ta,
		spinner:                s,
		interruptKeyInDebounce: false,
	}

	return m
}
