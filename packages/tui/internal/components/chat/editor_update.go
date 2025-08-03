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
	"github.com/google/uuid"
	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/internal/commands"
	"github.com/sst/opencode/internal/components/dialog"
	"github.com/sst/opencode/internal/components/textarea"
	"github.com/sst/opencode/internal/util"
)

// Update is the main update method for the editor component
func (m *editorComponent) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd
	var cmd tea.Cmd

	// Handle spinner updates
	switch msg := msg.(type) {
	case spinner.TickMsg:
		m.spinner, cmd = m.spinner.Update(msg)
		return m, cmd
	}

	// Get current text area
	currentTextArea := m.textAreaFactory.Current()

	// Handle special messages that need preprocessing
	switch msg := msg.(type) {
	case tea.PasteMsg:
		// Handle file paste
		text := string(msg)
		text = strings.ReplaceAll(text, "\\", "")
		text, err := strconv.Unquote(`"` + text + `"`)
		if err != nil {
			slog.Error("Failed to unquote text", "error", err)
			currentTextArea.InsertRunesFromUserInput([]rune(msg))
			return m, nil
		}

		// Check if it's a file path
		if _, err := os.Stat(text); err != nil {
			slog.Error("Failed to paste file", "error", err)
			currentTextArea.InsertRunesFromUserInput([]rune(msg))
			return m, nil
		}

		// Handle file attachment
		return m.handleFileAttachment(text)

	case tea.ClipboardMsg:
		text := string(msg)
		currentTextArea.InsertRunesFromUserInput([]rune(text))
		return m, nil

	case dialog.ThemeSelectedMsg:
		m.textAreaFactory.UpdateStyles(updateTextareaStyles)
		m.spinner = createSpinner()
		return m, tea.Batch(m.spinner.Tick, currentTextArea.Focus())

	case dialog.CompletionSelectedMsg:
		return m.handleCompletionSelected(msg)
	}

	// Delegate all other messages through the factory
	cmd = m.textAreaFactory.Update(msg)
	cmds = append(cmds, cmd)

	return m, tea.Batch(cmds...)
}

// handleFileAttachment processes file attachments
func (m *editorComponent) handleFileAttachment(filePath string) (tea.Model, tea.Cmd) {
	ext := strings.ToLower(filepath.Ext(filePath))
	currentTextArea := m.textAreaFactory.Current()

	mediaType := ""
	switch ext {
	case ".jpg":
		mediaType = "image/jpeg"
	case ".png", ".jpeg", ".gif", ".webp":
		mediaType = "image/" + ext[1:]
	case ".pdf":
		mediaType = "application/pdf"
	default:
		// Plain text file
		attachment := &textarea.Attachment{
			ID:        uuid.NewString(),
			Display:   "@" + filePath,
			URL:       fmt.Sprintf("file://./%s", filePath),
			Filename:  filePath,
			MediaType: "text/plain",
		}
		currentTextArea.SetAttachment(attachment)
		currentTextArea.InsertRunesFromUserInput([]rune(" "))
		return m, nil
	}

	// Read and encode binary files
	fileBytes, err := os.ReadFile(filePath)
	if err != nil {
		slog.Error("Failed to read file", "error", err)
		currentTextArea.InsertRunesFromUserInput([]rune(filePath))
		return m, nil
	}

	base64EncodedFile := base64.StdEncoding.EncodeToString(fileBytes)
	dataURL := fmt.Sprintf("data:%s;base64,%s", mediaType, base64EncodedFile)
	attachmentCount := len(currentTextArea.GetAttachments())
	attachmentIndex := attachmentCount + 1

	label := "File"
	if strings.HasPrefix(mediaType, "image/") {
		label = "Image"
	}

	attachment := &textarea.Attachment{
		ID:        uuid.NewString(),
		MediaType: mediaType,
		Display:   fmt.Sprintf("[%s #%d]", label, attachmentIndex),
		URL:       dataURL,
		Filename:  filePath,
	}

	currentTextArea.SetAttachment(attachment)
	currentTextArea.InsertRunesFromUserInput([]rune(" "))
	return m, nil
}

// handleCompletionSelected processes completion selections
func (m *editorComponent) handleCompletionSelected(msg dialog.CompletionSelectedMsg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg.Item.GetProviderID() {
	case "commands":
		// Handle command completion
		commandName := strings.TrimPrefix(msg.Item.GetValue(), "/")
		updated, cmd := m.Clear()
		m = updated.(*editorComponent)
		cmds = append(cmds, cmd)
		cmds = append(cmds, util.CmdHandler(commands.ExecuteCommandMsg(m.app.Commands[commands.CommandName(commandName)])))
		return m, tea.Batch(cmds...)

	case "files":
		// Handle file completion
		return m.handleFileCompletion(msg.Item.GetValue())

	case "symbols":
		// Handle symbol completion
		symbol := msg.Item.GetRaw().(opencode.Symbol)
		parts := strings.Split(symbol.Name, ".")
		lastPart := parts[len(parts)-1]

		// Create attachment for symbol
		attachment := &textarea.Attachment{
			ID:        uuid.NewString(),
			Display:   "@" + lastPart,
			URL:       msg.Item.GetValue(),
			Filename:  lastPart,
			MediaType: "text/plain",
		}

		// Replace the @symbol text with attachment
		m.replaceAtMention(attachment)
		return m, nil

	default:
		slog.Debug("Unknown provider", "provider", msg.Item.GetProviderID())
		return m, nil
	}
}

// handleFileCompletion processes file path completions
func (m *editorComponent) handleFileCompletion(filePath string) (tea.Model, tea.Cmd) {
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

	m.replaceAtMention(attachment)
	return m, nil
}

// replaceAtMention replaces @mention text with an attachment
func (m *editorComponent) replaceAtMention(attachment *textarea.Attachment) {
	currentTextArea := m.textAreaFactory.Current()

	// Find the @ symbol position
	// This is a simplified version - the actual textarea has LastRuneIndex method
	// that we'd need to add to the interface

	currentTextArea.SetAttachment(attachment)
	currentTextArea.InsertRunesFromUserInput([]rune(" "))
}
