package chat

import (
	"encoding/base64"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/charmbracelet/bubbles/v2/spinner"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/google/uuid"
	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/attachment"
	"github.com/sst/opencode/internal/clipboard"
	"github.com/sst/opencode/internal/commands"
	"github.com/sst/opencode/internal/components/dialog"
	"github.com/sst/opencode/internal/components/textarea"
	"github.com/sst/opencode/internal/components/toast"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
)

type EditorComponent interface {
	tea.Model
	tea.ViewModel
	Content() string
	Cursor() *tea.Cursor
	Lines() int
	Value() string
	Length() int
	Focused() bool
	Focus() (tea.Model, tea.Cmd)
	Blur()
	Submit() (tea.Model, tea.Cmd)
	SubmitBash() (tea.Model, tea.Cmd)
	Clear() (tea.Model, tea.Cmd)
	Paste() (tea.Model, tea.Cmd)
	Newline() (tea.Model, tea.Cmd)
	SetValue(value string)
	SetValueWithAttachments(value string)
	SetInterruptKeyInDebounce(inDebounce bool)
	SetExitKeyInDebounce(inDebounce bool)
	RestoreFromHistory(index int)
}

type editorComponent struct {
	app                    *app.App
	width                  int
	textarea               textarea.Model
	spinner                spinner.Model
	interruptKeyInDebounce bool
	exitKeyInDebounce      bool
	historyIndex           int    // -1 means current (not in history)
	currentText            string // Store current text when navigating history
	pasteCounter           int
	reverted               bool
}

func (m *editorComponent) Init() tea.Cmd {
	return tea.Batch(m.textarea.Focus(), m.spinner.Tick, tea.EnableReportFocus)
}

func (m *editorComponent) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd
	var cmd tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width - 4
		return m, nil
	case spinner.TickMsg:
		m.spinner, cmd = m.spinner.Update(msg)
		return m, cmd
	case tea.KeyPressMsg:
		// Handle up/down arrows and ctrl+p/ctrl+n for history navigation
		switch msg.String() {
		case "up", "ctrl+p":
			// Only navigate history if cursor is at the first line and column (for arrow keys)
			// or allow ctrl+p from anywhere
			if (msg.String() == "ctrl+p" || (m.textarea.Line() == 0 && m.textarea.CursorColumn() == 0)) && len(m.app.State.MessageHistory) > 0 {
				if m.historyIndex == -1 {
					// Save current text before entering history
					m.currentText = m.textarea.Value()
					m.textarea.MoveToBegin()
				}
				// Move up in history (older messages)
				if m.historyIndex < len(m.app.State.MessageHistory)-1 {
					m.historyIndex++
					m.RestoreFromHistory(m.historyIndex)
					m.textarea.MoveToBegin()
				}
				return m, nil
			}
		case "down", "ctrl+n":
			// Only navigate history if cursor is at the last line and we're in history navigation (for arrow keys)
			// or allow ctrl+n from anywhere if we're in history navigation
			if (msg.String() == "ctrl+n" || m.textarea.IsCursorAtEnd()) && m.historyIndex > -1 {
				// Move down in history (newer messages)
				m.historyIndex--
				if m.historyIndex == -1 {
					// Restore current text
					m.textarea.Reset()
					m.textarea.SetValue(m.currentText)
					m.currentText = ""
				} else {
					m.RestoreFromHistory(m.historyIndex)
					m.textarea.MoveToEnd()
				}
				return m, nil
			} else if m.historyIndex > -1 && msg.String() == "down" {
				m.textarea.MoveToEnd()
				return m, nil
			}
		}
		// Reset history navigation on any other input
		if m.historyIndex != -1 {
			m.historyIndex = -1
			m.currentText = ""
		}
		// Maximize editor responsiveness for printable characters
		if msg.Text != "" {
			m.reverted = false
			m.textarea, cmd = m.textarea.Update(msg)
			cmds = append(cmds, cmd)
			return m, tea.Batch(cmds...)
		}
	case app.MessageRevertedMsg:
		if msg.Session.ID == m.app.Session.ID {
			switch msg.Message.Info.(type) {
			case opencode.UserMessage:
				prompt, err := msg.Message.ToPrompt()
				if err != nil {
					return m, toast.NewErrorToast("Failed to revert message")
				}
				m.RestoreFromPrompt(*prompt)
				m.textarea.MoveToEnd()
				m.reverted = true
				return m, nil
			}
		}
	case app.SessionUnrevertedMsg:
		if msg.Session.ID == m.app.Session.ID {
			if m.reverted {
				updated, cmd := m.Clear()
				m = updated.(*editorComponent)
				return m, cmd
			}
			return m, nil
		}
	case tea.PasteMsg:
		text := string(msg)

		if filePath := strings.TrimSpace(strings.TrimPrefix(text, "@")); strings.HasPrefix(text, "@") && filePath != "" {
			statPath := filePath
			if !filepath.IsAbs(filePath) {
				statPath = filepath.Join(util.CwdPath, filePath)
			}
			if _, err := os.Stat(statPath); err == nil {
				attachment := m.createAttachmentFromPath(filePath)
				if attachment != nil {
					m.textarea.InsertAttachment(attachment)
					m.textarea.InsertString(" ")
					return m, nil
				}
			}
		}

		text = strings.ReplaceAll(text, "\\", "")
		text, err := strconv.Unquote(`"` + text + `"`)
		if err != nil {
			slog.Error("Failed to unquote text", "error", err)
			text := string(msg)
			if m.shouldSummarizePastedText(text) {
				m.handleLongPaste(text)
			} else {
				m.textarea.InsertRunesFromUserInput([]rune(msg))
			}
			return m, nil
		}
		if _, err := os.Stat(text); err != nil {
			slog.Error("Failed to paste file", "error", err)
			text := string(msg)
			if m.shouldSummarizePastedText(text) {
				m.handleLongPaste(text)
			} else {
				m.textarea.InsertRunesFromUserInput([]rune(msg))
			}
			return m, nil
		}

		filePath := text

		attachment := m.createAttachmentFromFile(filePath)
		if attachment == nil {
			if m.shouldSummarizePastedText(text) {
				m.handleLongPaste(text)
			} else {
				m.textarea.InsertRunesFromUserInput([]rune(msg))
			}
			return m, nil
		}

		m.textarea.InsertAttachment(attachment)
		m.textarea.InsertString(" ")
	case tea.ClipboardMsg:
		text := string(msg)
		// Check if the pasted text is long and should be summarized
		if m.shouldSummarizePastedText(text) {
			m.handleLongPaste(text)
		} else {
			m.textarea.InsertRunesFromUserInput([]rune(text))
		}
	case dialog.ThemeSelectedMsg:
		m.textarea = updateTextareaStyles(m.textarea)
		m.spinner = createSpinner()
		return m, tea.Batch(m.textarea.Focus(), m.spinner.Tick)
	case dialog.CompletionSelectedMsg:
		switch msg.Item.ProviderID {
		case "commands":
			command := msg.Item.RawData.(commands.Command)
			if command.Custom {
				m.SetValue("/" + command.PrimaryTrigger() + " ")
				return m, nil
			}

			updated, cmd := m.Clear()
			m = updated.(*editorComponent)
			cmds = append(cmds, cmd)

			commandName := strings.TrimPrefix(msg.Item.Value, "/")
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
			attachment := m.createAttachmentFromPath(filePath)
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
			attachment := &attachment.Attachment{
				ID:        uuid.NewString(),
				Type:      "symbol",
				Display:   "@" + lastPart,
				URL:       msg.Item.Value,
				Filename:  lastPart,
				MediaType: "text/plain",
				Source: &attachment.SymbolSource{
					Path: symbol.Location.Uri,
					Name: symbol.Name,
					Kind: int(symbol.Kind),
					Range: attachment.SymbolRange{
						Start: attachment.Position{
							Line: int(symbol.Location.Range.Start.Line),
							Char: int(symbol.Location.Range.Start.Character),
						},
						End: attachment.Position{
							Line: int(symbol.Location.Range.End.Line),
							Char: int(symbol.Location.Range.End.Character),
						},
					},
				},
			}
			m.textarea.InsertAttachment(attachment)
			m.textarea.InsertString(" ")
			return m, nil
		case "agents":
			atIndex := m.textarea.LastRuneIndex('@')
			if atIndex == -1 {
				// Should not happen, but as a fallback, just insert.
				m.textarea.InsertString(msg.Item.Value + " ")
				return m, nil
			}

			cursorCol := m.textarea.CursorColumn()
			m.textarea.ReplaceRange(atIndex, cursorCol, "")

			name := msg.Item.Value
			attachment := &attachment.Attachment{
				ID:      uuid.NewString(),
				Type:    "agent",
				Display: "@" + name,
				Source: &attachment.AgentSource{
					Name: name,
				},
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

func (m *editorComponent) Content() string {
	width := m.width
	if m.app.Session.ID == "" {
		width = min(width, 80)
	}

	t := theme.CurrentTheme()
	base := styles.NewStyle().Foreground(t.Text()).Background(t.Background()).Render
	muted := styles.NewStyle().Foreground(t.TextMuted()).Background(t.Background()).Render

	promptStyle := styles.NewStyle().Foreground(t.Primary()).
		Padding(0, 0, 0, 1).
		Bold(true)
	prompt := promptStyle.Render(">")
	borderForeground := t.Border()
	if m.app.IsLeaderSequence {
		borderForeground = t.Accent()
	}
	if m.app.IsBashMode {
		borderForeground = t.Secondary()
		prompt = promptStyle.Render("!")
	}

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
		status := "working"
		if m.app.IsCompacting() {
			status = "compacting"
		}
		if m.app.CurrentPermission.ID != "" {
			status = "waiting for permission"
		}
		if m.interruptKeyInDebounce && m.app.CurrentPermission.ID == "" {
			hint = muted(
				status,
			) + m.spinner.View() + muted(
				"  ",
			) + base(
				keyText+" again",
			) + muted(
				" interrupt",
			)
		} else {
			hint = muted(status) + m.spinner.View()
			if m.app.CurrentPermission.ID == "" {
				hint += muted("  ") + base(keyText) + muted(" interrupt")
			}
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

func (m *editorComponent) Cursor() *tea.Cursor {
	return m.textarea.Cursor()
}

func (m *editorComponent) View() string {
	width := m.width
	if m.app.Session.ID == "" {
		width = min(width, 80)
	}

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

	switch value {
	case "exit", "quit", "q", ":q":
		return m, tea.Quit
	}

	if len(value) > 0 && value[len(value)-1] == '\\' {
		// If the last character is a backslash, remove it and add a newline
		backslashCol := m.textarea.CurrentRowLength() - 1
		m.textarea.ReplaceRange(backslashCol, backslashCol+1, "")
		m.textarea.InsertString("\n")
		return m, nil
	}

	var cmds []tea.Cmd
	if strings.HasPrefix(value, "/") {
		// Expand attachments in the value to get actual content
		expandedValue := value
		attachments := m.textarea.GetAttachments()
		for _, att := range attachments {
			if att.Type == "text" && att.Source != nil {
				if textSource, ok := att.Source.(*attachment.TextSource); ok {
					expandedValue = strings.Replace(expandedValue, att.Display, textSource.Value, 1)
				}
			}
		}

		expandedValue = expandedValue[1:] // Remove the "/"
		commandName := strings.Split(expandedValue, " ")[0]
		command := m.app.Commands[commands.CommandName(commandName)]
		if command.Custom {
			args := ""
			if strings.HasPrefix(expandedValue, command.PrimaryTrigger()+" ") {
				args = strings.TrimPrefix(expandedValue, command.PrimaryTrigger()+" ")
			}
			cmds = append(
				cmds,
				util.CmdHandler(app.SendCommand{Command: string(command.Name), Args: args}),
			)

			updated, cmd := m.Clear()
			m = updated.(*editorComponent)
			cmds = append(cmds, cmd)

			return m, tea.Batch(cmds...)
		}
	}

	attachments := m.textarea.GetAttachments()

	prompt := app.Prompt{Text: value, Attachments: attachments}
	m.app.State.AddPromptToHistory(prompt)
	cmds = append(cmds, m.app.SaveState())

	updated, cmd := m.Clear()
	m = updated.(*editorComponent)
	cmds = append(cmds, cmd)

	cmds = append(cmds, util.CmdHandler(app.SendPrompt(prompt)))
	return m, tea.Batch(cmds...)
}

func (m *editorComponent) SubmitBash() (tea.Model, tea.Cmd) {
	command := m.textarea.Value()
	var cmds []tea.Cmd
	updated, cmd := m.Clear()
	m = updated.(*editorComponent)
	cmds = append(cmds, cmd)
	cmds = append(cmds, util.CmdHandler(app.SendShell{Command: command}))
	return m, tea.Batch(cmds...)
}

func (m *editorComponent) Clear() (tea.Model, tea.Cmd) {
	m.textarea.Reset()
	m.historyIndex = -1
	m.currentText = ""
	m.pasteCounter = 0
	return m, nil
}

func (m *editorComponent) Paste() (tea.Model, tea.Cmd) {
	imageBytes := clipboard.Read(clipboard.FmtImage)
	if imageBytes != nil {
		attachmentCount := len(m.textarea.GetAttachments())
		attachmentIndex := attachmentCount + 1
		base64EncodedFile := base64.StdEncoding.EncodeToString(imageBytes)
		attachment := &attachment.Attachment{
			ID:        uuid.NewString(),
			Type:      "file",
			MediaType: "image/png",
			Display:   fmt.Sprintf("[Image #%d]", attachmentIndex),
			Filename:  fmt.Sprintf("image-%d.png", attachmentIndex),
			URL:       fmt.Sprintf("data:image/png;base64,%s", base64EncodedFile),
			Source: &attachment.FileSource{
				Path: fmt.Sprintf("image-%d.png", attachmentIndex),
				Mime: "image/png",
				Data: imageBytes,
			},
		}
		m.textarea.InsertAttachment(attachment)
		m.textarea.InsertString(" ")
		return m, nil
	}

	textBytes := clipboard.Read(clipboard.FmtText)
	if textBytes != nil {
		text := string(textBytes)
		// Check if the pasted text is long and should be summarized
		if m.shouldSummarizePastedText(text) {
			m.handleLongPaste(text)
		} else {
			m.textarea.InsertRunesFromUserInput([]rune(text))
		}
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

func (m *editorComponent) SetValueWithAttachments(value string) {
	m.textarea.Reset()

	i := 0
	for i < len(value) {
		r, size := utf8.DecodeRuneInString(value[i:])
		// Check if filepath and add attachment
		if r == '@' {
			start := i + size
			end := start
			for end < len(value) {
				nextR, nextSize := utf8.DecodeRuneInString(value[end:])
				if nextR == ' ' || nextR == '\t' || nextR == '\n' || nextR == '\r' {
					break
				}
				end += nextSize
			}
			if end > start {
				filePath := value[start:end]
				slog.Debug("test", "filePath", filePath)
				if _, err := os.Stat(filepath.Join(util.CwdPath, filePath)); err == nil {
					slog.Debug("test", "found", true)
					attachment := m.createAttachmentFromFile(filePath)
					if attachment != nil {
						m.textarea.InsertAttachment(attachment)
						i = end
						continue
					}
				}
			}
		}

		// Not a valid file path, insert the character normally
		m.textarea.InsertRune(r)
		i += size
	}
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

// shouldSummarizePastedText determines if pasted text should be summarized
func (m *editorComponent) shouldSummarizePastedText(text string) bool {
	if m.app.IsBashMode {
		return false
	}

	if m.app.Config != nil && m.app.Config.Experimental.DisablePasteSummary {
		return false
	}

	lines := strings.Split(text, "\n")
	lineCount := len(lines)
	charCount := len(text)

	// Consider text long if it has more than 3 lines or more than 150 characters
	return lineCount > 3 || charCount > 150
}

// handleLongPaste handles long pasted text by creating a summary attachment
func (m *editorComponent) handleLongPaste(text string) {
	lines := strings.Split(text, "\n")
	lineCount := len(lines)

	// Increment paste counter
	m.pasteCounter++

	// Create attachment with full text as base64 encoded data
	fileBytes := []byte(text)
	base64EncodedText := base64.StdEncoding.EncodeToString(fileBytes)
	url := fmt.Sprintf("data:text/plain;base64,%s", base64EncodedText)

	fileName := fmt.Sprintf("pasted-text-%d.txt", m.pasteCounter)
	displayText := fmt.Sprintf("[pasted #%d %d+ lines]", m.pasteCounter, lineCount)

	attachment := &attachment.Attachment{
		ID:        uuid.NewString(),
		Type:      "text",
		MediaType: "text/plain",
		Display:   displayText,
		URL:       url,
		Filename:  fileName,
		Source: &attachment.TextSource{
			Value: text,
		},
	}

	m.textarea.InsertAttachment(attachment)
	m.textarea.InsertString(" ")
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
	ta.VirtualCursor = false
	ta = updateTextareaStyles(ta)

	m := &editorComponent{
		app:                    app,
		textarea:               ta,
		spinner:                s,
		interruptKeyInDebounce: false,
		historyIndex:           -1,
		pasteCounter:           0,
	}

	return m
}

func (m *editorComponent) RestoreFromPrompt(prompt app.Prompt) {
	m.textarea.Reset()
	m.textarea.SetValue(prompt.Text)

	// Sort attachments by start index in reverse order (process from end to beginning)
	// This prevents index shifting issues
	attachmentsCopy := make([]*attachment.Attachment, len(prompt.Attachments))
	copy(attachmentsCopy, prompt.Attachments)

	for i := 0; i < len(attachmentsCopy)-1; i++ {
		for j := i + 1; j < len(attachmentsCopy); j++ {
			if attachmentsCopy[i].StartIndex < attachmentsCopy[j].StartIndex {
				attachmentsCopy[i], attachmentsCopy[j] = attachmentsCopy[j], attachmentsCopy[i]
			}
		}
	}

	for _, att := range attachmentsCopy {
		m.textarea.SetCursorColumn(att.StartIndex)
		m.textarea.ReplaceRange(att.StartIndex, att.EndIndex, "")
		m.textarea.InsertAttachment(att)
	}
}

// RestoreFromHistory restores a message from history at the given index
func (m *editorComponent) RestoreFromHistory(index int) {
	if index < 0 || index >= len(m.app.State.MessageHistory) {
		return
	}
	entry := m.app.State.MessageHistory[index]
	m.RestoreFromPrompt(entry)
}

func getMediaTypeFromExtension(ext string) string {
	switch strings.ToLower(ext) {
	case ".jpg":
		return "image/jpeg"
	case ".png", ".jpeg", ".gif", ".webp":
		return "image/" + ext[1:]
	case ".pdf":
		return "application/pdf"
	default:
		return "text/plain"
	}
}

func (m *editorComponent) createAttachmentFromFile(filePath string) *attachment.Attachment {
	ext := strings.ToLower(filepath.Ext(filePath))
	mediaType := getMediaTypeFromExtension(ext)
	absolutePath := filePath
	if !filepath.IsAbs(filePath) {
		absolutePath = filepath.Join(util.CwdPath, filePath)
	}

	// For text files, create a simple file reference
	if mediaType == "text/plain" {
		return &attachment.Attachment{
			ID:        uuid.NewString(),
			Type:      "file",
			Display:   "@" + filePath,
			URL:       fmt.Sprintf("file://%s", absolutePath),
			Filename:  filePath,
			MediaType: mediaType,
			Source: &attachment.FileSource{
				Path: absolutePath,
				Mime: mediaType,
			},
		}
	}

	// For binary files (images, PDFs), read and encode
	fileBytes, err := os.ReadFile(filePath)
	if err != nil {
		slog.Error("Failed to read file", "error", err)
		return nil
	}

	base64EncodedFile := base64.StdEncoding.EncodeToString(fileBytes)
	url := fmt.Sprintf("data:%s;base64,%s", mediaType, base64EncodedFile)
	attachmentCount := len(m.textarea.GetAttachments())
	attachmentIndex := attachmentCount + 1
	label := "File"
	if strings.HasPrefix(mediaType, "image/") {
		label = "Image"
	}
	return &attachment.Attachment{
		ID:        uuid.NewString(),
		Type:      "file",
		MediaType: mediaType,
		Display:   fmt.Sprintf("[%s #%d]", label, attachmentIndex),
		URL:       url,
		Filename:  filePath,
		Source: &attachment.FileSource{
			Path: absolutePath,
			Mime: mediaType,
			Data: fileBytes,
		},
	}
}

func (m *editorComponent) createAttachmentFromPath(filePath string) *attachment.Attachment {
	extension := filepath.Ext(filePath)
	mediaType := getMediaTypeFromExtension(extension)
	absolutePath := filePath
	if !filepath.IsAbs(filePath) {
		absolutePath = filepath.Join(util.CwdPath, filePath)
	}
	return &attachment.Attachment{
		ID:        uuid.NewString(),
		Type:      "file",
		Display:   "@" + filePath,
		URL:       fmt.Sprintf("file://%s", absolutePath),
		Filename:  filePath,
		MediaType: mediaType,
		Source: &attachment.FileSource{
			Path: absolutePath,
			Mime: mediaType,
		},
	}
}
