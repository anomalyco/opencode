package tui

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"slices"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/v2/key"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"

	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/internal/api"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/commands"
	"github.com/sst/opencode/internal/completions"
	"github.com/sst/opencode/internal/components/chat"
	cmdcomp "github.com/sst/opencode/internal/components/commands"
	"github.com/sst/opencode/internal/components/dialog"
	"github.com/sst/opencode/internal/components/modal"
	"github.com/sst/opencode/internal/components/status"
	"github.com/sst/opencode/internal/components/toast"
	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
)

// InterruptDebounceTimeoutMsg is sent when the interrupt key debounce timeout expires
type InterruptDebounceTimeoutMsg struct{}

// ExitDebounceTimeoutMsg is sent when the exit key debounce timeout expires
type ExitDebounceTimeoutMsg struct{}

// InterruptKeyState tracks the state of interrupt key presses for debouncing
type InterruptKeyState int

// ExitKeyState tracks the state of exit key presses for debouncing
type ExitKeyState int

const (
	InterruptKeyIdle InterruptKeyState = iota
	InterruptKeyFirstPress
)

const (
	ExitKeyIdle ExitKeyState = iota
	ExitKeyFirstPress
)

const interruptDebounceTimeout = 1 * time.Second
const exitDebounceTimeout = 1 * time.Second

type Model struct {
	tea.Model
	tea.CursorModel
	width, height        int
	app                  *app.App
	modal                layout.Modal
	status               status.StatusComponent
	editor               chat.EditorComponent
	messages             chat.MessagesComponent
	completions          dialog.CompletionDialog
	commandProvider      completions.CompletionProvider
	fileProvider         completions.CompletionProvider
	symbolsProvider      completions.CompletionProvider
	agentsProvider       completions.CompletionProvider
	showCompletionDialog bool
	leaderBinding        *key.Binding
	toastManager         *toast.ToastManager
	interruptKeyState    InterruptKeyState
	exitKeyState         ExitKeyState
	messagesRight        bool
}

func (a Model) Init() tea.Cmd {
	var cmds []tea.Cmd
	// https://github.com/charmbracelet/bubbletea/issues/1440
	// https://github.com/sst/opencode/issues/127
	if !util.IsWsl() {
		cmds = append(cmds, tea.RequestBackgroundColor)
	}
	cmds = append(cmds, a.app.InitializeProvider())
	cmds = append(cmds, a.editor.Init())
	cmds = append(cmds, a.messages.Init())
	cmds = append(cmds, a.status.Init())
	cmds = append(cmds, a.completions.Init())
	cmds = append(cmds, a.toastManager.Init())

	return tea.Batch(cmds...)
}

func (a Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.KeyPressMsg:
		keyString := msg.String()

		if a.app.CurrentPermission.ID != "" {
			if keyString == "enter" || keyString == "esc" || keyString == "a" {
				sessionID := a.app.CurrentPermission.SessionID
				permissionID := a.app.CurrentPermission.ID
				a.editor.Focus()
				a.app.Permissions = a.app.Permissions[1:]
				if len(a.app.Permissions) > 0 {
					a.app.CurrentPermission = a.app.Permissions[0]
				} else {
					a.app.CurrentPermission = opencode.Permission{}
				}
				response := opencode.SessionPermissionRespondParamsResponseOnce
				switch keyString {
				case "enter":
					response = opencode.SessionPermissionRespondParamsResponseOnce
				case "a":
					response = opencode.SessionPermissionRespondParamsResponseAlways
				case "esc":
					response = opencode.SessionPermissionRespondParamsResponseReject
				}

				return a, func() tea.Msg {
					resp, err := a.app.Client.Session.Permissions.Respond(
						context.Background(),
						sessionID,
						permissionID,
						opencode.SessionPermissionRespondParams{Response: opencode.F(response)},
					)
					if err != nil {
						slog.Error("Failed to respond to permission request", "error", err)
						return toast.NewErrorToast("Failed to respond to permission request")()
					}
					slog.Debug("Responded to permission request", "response", resp)
					return nil
				}
			}
		}

		if a.app.IsBashMode {
			if keyString == "backspace" && a.editor.Length() == 0 {
				a.app.IsBashMode = false
				return a, nil
			}

			if keyString == "enter" || keyString == "esc" || keyString == "ctrl+c" {
				a.app.IsBashMode = false
				if keyString == "enter" {
					updated, cmd := a.editor.SubmitBash()
					a.editor = updated.(chat.EditorComponent)
					cmds = append(cmds, cmd)
				}
				return a, tea.Batch(cmds...)
			}
		}

		// 1. Handle active modal
		if a.modal != nil {
			switch keyString {
			// Escape closes current modal, but give modal a chance to handle it first
			case "esc":
				// give the modal a chance to handle the esc
				updatedModal, cmd := a.modal.Update(msg)
				a.modal = updatedModal.(layout.Modal)
				if cmd != nil {
					return a, cmd
				}
				cmd = a.modal.Close()
				a.modal = nil
				return a, cmd
			case "ctrl+c":
				// give the modal a chance to handle the ctrl+c
				updatedModal, cmd := a.modal.Update(msg)
				a.modal = updatedModal.(layout.Modal)
				if cmd != nil {
					return a, cmd
				}
				cmd = a.modal.Close()
				a.modal = nil
				return a, cmd
			}

			// Pass all other key presses to the modal
			updatedModal, cmd := a.modal.Update(msg)
			a.modal = updatedModal.(layout.Modal)
			return a, cmd
		}

		// 2. Check for commands that require leader
		if a.app.IsLeaderSequence {
			matches := a.app.Commands.Matches(msg, a.app.IsLeaderSequence)
			a.app.IsLeaderSequence = false
			if len(matches) > 0 {
				return a, util.CmdHandler(commands.ExecuteCommandsMsg(matches))
			}
		}

		// 3. Handle completions trigger
		if keyString == "/" &&
			!a.showCompletionDialog &&
			a.editor.Value() == "" &&
			!a.app.IsBashMode {
			a.showCompletionDialog = true

			updated, cmd := a.editor.Update(msg)
			a.editor = updated.(chat.EditorComponent)
			cmds = append(cmds, cmd)

			// Set command provider for command completion
			a.completions = dialog.NewCompletionDialogComponent("/", a.commandProvider)
			updated, cmd = a.completions.Update(msg)
			a.completions = updated.(dialog.CompletionDialog)
			cmds = append(cmds, cmd)

			return a, tea.Sequence(cmds...)
		}

		// Handle file completions trigger
		if keyString == "@" &&
			!a.showCompletionDialog &&
			!a.app.IsBashMode {
			a.showCompletionDialog = true

			updated, cmd := a.editor.Update(msg)
			a.editor = updated.(chat.EditorComponent)
			cmds = append(cmds, cmd)

			// Set file, symbols, and agents providers for @ completion
			a.completions = dialog.NewCompletionDialogComponent("@", a.agentsProvider, a.fileProvider, a.symbolsProvider)
			updated, cmd = a.completions.Update(msg)
			a.completions = updated.(dialog.CompletionDialog)
			cmds = append(cmds, cmd)

			return a, tea.Sequence(cmds...)
		}

		if keyString == "!" && a.editor.Value() == "" {
			a.app.IsBashMode = true
			return a, nil
		}

		if a.showCompletionDialog {
			switch keyString {
			case "tab", "enter", "esc", "ctrl+c", "up", "down", "ctrl+p", "ctrl+n":
				updated, cmd := a.completions.Update(msg)
				a.completions = updated.(dialog.CompletionDialog)
				cmds = append(cmds, cmd)
				return a, tea.Batch(cmds...)
			}

			updated, cmd := a.editor.Update(msg)
			a.editor = updated.(chat.EditorComponent)
			cmds = append(cmds, cmd)

			updated, cmd = a.completions.Update(msg)
			a.completions = updated.(dialog.CompletionDialog)
			cmds = append(cmds, cmd)

			return a, tea.Batch(cmds...)
		}

		// 4. Maximize editor responsiveness for printable characters
		if msg.Text != "" {
			updated, cmd := a.editor.Update(msg)
			a.editor = updated.(chat.EditorComponent)
			cmds = append(cmds, cmd)
			return a, tea.Batch(cmds...)
		}

		// 5. Check for leader key activation
		if a.leaderBinding != nil &&
			!a.app.IsLeaderSequence &&
			key.Matches(msg, *a.leaderBinding) {
			a.app.IsLeaderSequence = true
			return a, nil
		}

		// 6 Handle input clear command
		inputClearCommand := a.app.Commands[commands.InputClearCommand]
		if inputClearCommand.Matches(msg, a.app.IsLeaderSequence) && a.editor.Length() > 0 {
			return a, util.CmdHandler(commands.ExecuteCommandMsg(inputClearCommand))
		}

		// 7. Handle interrupt key debounce for session interrupt
		interruptCommand := a.app.Commands[commands.SessionInterruptCommand]
		if interruptCommand.Matches(msg, a.app.IsLeaderSequence) && a.app.IsBusy() {
			switch a.interruptKeyState {
			case InterruptKeyIdle:
				// First interrupt key press - start debounce timer
				a.interruptKeyState = InterruptKeyFirstPress
				a.editor.SetInterruptKeyInDebounce(true)
				return a, tea.Tick(interruptDebounceTimeout, func(t time.Time) tea.Msg {
					return InterruptDebounceTimeoutMsg{}
				})
			case InterruptKeyFirstPress:
				// Second interrupt key press within timeout - actually interrupt
				a.interruptKeyState = InterruptKeyIdle
				a.editor.SetInterruptKeyInDebounce(false)
				return a, util.CmdHandler(commands.ExecuteCommandMsg(interruptCommand))
			}
		}

		// 8. Handle exit key debounce for app exit when using non-leader command
		exitCommand := a.app.Commands[commands.AppExitCommand]
		if exitCommand.Matches(msg, a.app.IsLeaderSequence) {
			switch a.exitKeyState {
			case ExitKeyIdle:
				// First exit key press - start debounce timer
				a.exitKeyState = ExitKeyFirstPress
				a.editor.SetExitKeyInDebounce(true)
				return a, tea.Tick(exitDebounceTimeout, func(t time.Time) tea.Msg {
					return ExitDebounceTimeoutMsg{}
				})
			case ExitKeyFirstPress:
				// Second exit key press within timeout - actually exit
				a.exitKeyState = ExitKeyIdle
				a.editor.SetExitKeyInDebounce(false)
				return a, util.CmdHandler(commands.ExecuteCommandMsg(exitCommand))
			}
		}

		// 9. Check again for commands that don't require leader (excluding interrupt when busy and exit when in debounce)
		matches := a.app.Commands.Matches(msg, a.app.IsLeaderSequence)
		if len(matches) > 0 {
			// Skip interrupt key if we're in debounce mode and app is busy
			if interruptCommand.Matches(msg, a.app.IsLeaderSequence) && a.app.IsBusy() && a.interruptKeyState != InterruptKeyIdle {
				return a, nil
			}
			return a, util.CmdHandler(commands.ExecuteCommandsMsg(matches))
		}

		// Fallback: suspend if ctrl+z is pressed and no user keybind matched
		if keyString == "ctrl+z" {
			return a, tea.Suspend
		}

		// 10. Fallback to editor. This is for other characters like backspace, tab, etc.
		updatedEditor, cmd := a.editor.Update(msg)
		a.editor = updatedEditor.(chat.EditorComponent)
		return a, cmd
	case tea.MouseWheelMsg:
		if a.modal != nil {
			u, cmd := a.modal.Update(msg)
			a.modal = u.(layout.Modal)
			cmds = append(cmds, cmd)
			return a, tea.Batch(cmds...)
		}

		updated, cmd := a.messages.Update(msg)
		a.messages = updated.(chat.MessagesComponent)
		cmds = append(cmds, cmd)
		return a, tea.Batch(cmds...)
	case tea.BackgroundColorMsg:
		styles.Terminal = &styles.TerminalInfo{
			Background:       msg.Color,
			BackgroundIsDark: msg.IsDark(),
		}
		slog.Debug("Background color", "color", msg.String(), "isDark", msg.IsDark())
		return a, func() tea.Msg {
			theme.UpdateSystemTheme(
				styles.Terminal.Background,
				styles.Terminal.BackgroundIsDark,
			)
			return dialog.ThemeSelectedMsg{
				ThemeName: theme.CurrentThemeName(),
			}
		}
	case modal.CloseModalMsg:
		a.editor.Focus()
		var cmd tea.Cmd
		if a.modal != nil {
			cmd = a.modal.Close()
		}
		a.modal = nil
		return a, cmd
	case dialog.ReopenSessionModalMsg:
		// Reopen the session modal (used when exiting rename mode)
		sessionDialog := dialog.NewSessionDialog(a.app)
		a.modal = sessionDialog
		return a, nil
	case commands.ExecuteCommandMsg:
		updated, cmd := a.executeCommand(commands.Command(msg))
		return updated, cmd
	case commands.ExecuteCommandsMsg:
		for _, command := range msg {
			updated, cmd := a.executeCommand(command)
			if cmd != nil {
				return updated, cmd
			}
		}
	case error:
		return a, toast.NewErrorToast(msg.Error())
	case app.SendPrompt:
		a.showCompletionDialog = false
		// If we're in a child session, switch back to parent before sending prompt
		if a.app.Session.ParentID != "" {
			parentSession, err := a.app.Client.Session.Get(context.Background(), a.app.Session.ParentID, opencode.SessionGetParams{})
			if err != nil {
				slog.Error("Failed to get parent session", "error", err)
				return a, toast.NewErrorToast("Failed to get parent session")
			}
			a.app.Session = parentSession
			a.app, cmd = a.app.SendPrompt(context.Background(), msg)
			cmds = append(cmds, tea.Sequence(
				util.CmdHandler(app.SessionSelectedMsg(parentSession)),
				cmd,
			))
		} else {
			a.app, cmd = a.app.SendPrompt(context.Background(), msg)
			cmds = append(cmds, cmd)
		}
	case app.SendCommand:
		// If we're in a child session, switch back to parent before sending prompt
		if a.app.Session.ParentID != "" {
			parentSession, err := a.app.Client.Session.Get(context.Background(), a.app.Session.ParentID, opencode.SessionGetParams{})
			if err != nil {
				slog.Error("Failed to get parent session", "error", err)
				return a, toast.NewErrorToast("Failed to get parent session")
			}
			a.app.Session = parentSession
			a.app, cmd = a.app.SendCommand(context.Background(), msg.Command, msg.Args)
			cmds = append(cmds, tea.Sequence(
				util.CmdHandler(app.SessionSelectedMsg(parentSession)),
				cmd,
			))
		} else {
			a.app, cmd = a.app.SendCommand(context.Background(), msg.Command, msg.Args)
			cmds = append(cmds, cmd)
		}
	case app.SendShell:
		// If we're in a child session, switch back to parent before sending prompt
		if a.app.Session.ParentID != "" {
			parentSession, err := a.app.Client.Session.Get(context.Background(), a.app.Session.ParentID, opencode.SessionGetParams{})
			if err != nil {
				slog.Error("Failed to get parent session", "error", err)
				return a, toast.NewErrorToast("Failed to get parent session")
			}
			a.app.Session = parentSession
			a.app, cmd = a.app.SendShell(context.Background(), msg.Command)
			cmds = append(cmds, tea.Sequence(
				util.CmdHandler(app.SessionSelectedMsg(parentSession)),
				cmd,
			))
		} else {
			a.app, cmd = a.app.SendShell(context.Background(), msg.Command)
			cmds = append(cmds, cmd)
		}
	case app.SetEditorContentMsg:
		// Set the editor content without sending
		a.editor.SetValueWithAttachments(msg.Text)
		updated, cmd := a.editor.Focus()
		a.editor = updated.(chat.EditorComponent)
		cmds = append(cmds, cmd)
	case app.SessionClearedMsg:
		a.app.Session = &opencode.Session{}
		a.app.Messages = []app.Message{}
	case dialog.CompletionDialogCloseMsg:
		a.showCompletionDialog = false
	case opencode.EventListResponseEventInstallationUpdated:
		return a, toast.NewSuccessToast(
			"opencode updated to "+msg.Properties.Version+", restart to apply.",
			toast.WithTitle("New version installed"),
		)
		/*
			case opencode.EventListResponseEventIdeInstalled:
				return a, toast.NewSuccessToast(
					"Installed the opencode extension in "+msg.Properties.Ide,
					toast.WithTitle(msg.Properties.Ide+" extension installed"),
				)
		*/
	case opencode.EventListResponseEventSessionDeleted:
		if a.app.Session != nil && msg.Properties.Info.ID == a.app.Session.ID {
			a.app.Session = &opencode.Session{}
			a.app.Messages = []app.Message{}
		}
		return a, toast.NewSuccessToast("Session deleted successfully")
	case opencode.EventListResponseEventSessionUpdated:
		if msg.Properties.Info.ID == a.app.Session.ID {
			a.app.Session = &msg.Properties.Info
		}
	case opencode.EventListResponseEventMessagePartUpdated:
		slog.Debug("message part updated", "message", msg.Properties.Part.MessageID, "part", msg.Properties.Part.ID)
		if msg.Properties.Part.SessionID == a.app.Session.ID {
			messageIndex := slices.IndexFunc(a.app.Messages, func(m app.Message) bool {
				switch casted := m.Info.(type) {
				case opencode.UserMessage:
					return casted.ID == msg.Properties.Part.MessageID
				case opencode.AssistantMessage:
					return casted.ID == msg.Properties.Part.MessageID
				}
				return false
			})
			if messageIndex > -1 {
				message := a.app.Messages[messageIndex]
				partIndex := slices.IndexFunc(message.Parts, func(p opencode.PartUnion) bool {
					switch casted := p.(type) {
					case opencode.TextPart:
						return casted.ID == msg.Properties.Part.ID
					case opencode.ReasoningPart:
						return casted.ID == msg.Properties.Part.ID
					case opencode.FilePart:
						return casted.ID == msg.Properties.Part.ID
					case opencode.ToolPart:
						return casted.ID == msg.Properties.Part.ID
					case opencode.StepStartPart:
						return casted.ID == msg.Properties.Part.ID
					case opencode.StepFinishPart:
						return casted.ID == msg.Properties.Part.ID
					}
					return false
				})
				if partIndex > -1 {
					message.Parts[partIndex] = msg.Properties.Part.AsUnion()
				}
				if partIndex == -1 {
					message.Parts = append(message.Parts, msg.Properties.Part.AsUnion())
				}
				a.app.Messages[messageIndex] = message
			}
		}
	case opencode.EventListResponseEventMessagePartRemoved:
		slog.Debug("message part removed", "session", msg.Properties.SessionID, "message", msg.Properties.MessageID, "part", msg.Properties.PartID)
		if msg.Properties.SessionID == a.app.Session.ID {
			messageIndex := slices.IndexFunc(a.app.Messages, func(m app.Message) bool {
				switch casted := m.Info.(type) {
				case opencode.UserMessage:
					return casted.ID == msg.Properties.MessageID
				case opencode.AssistantMessage:
					return casted.ID == msg.Properties.MessageID
				}
				return false
			})
			if messageIndex > -1 {
				message := a.app.Messages[messageIndex]
				partIndex := slices.IndexFunc(message.Parts, func(p opencode.PartUnion) bool {
					switch casted := p.(type) {
					case opencode.TextPart:
						return casted.ID == msg.Properties.PartID
					case opencode.ReasoningPart:
						return casted.ID == msg.Properties.PartID
					case opencode.FilePart:
						return casted.ID == msg.Properties.PartID
					case opencode.ToolPart:
						return casted.ID == msg.Properties.PartID
					case opencode.StepStartPart:
						return casted.ID == msg.Properties.PartID
					case opencode.StepFinishPart:
						return casted.ID == msg.Properties.PartID
					}
					return false
				})
				if partIndex > -1 {
					// Remove the part at partIndex
					message.Parts = append(message.Parts[:partIndex], message.Parts[partIndex+1:]...)
					a.app.Messages[messageIndex] = message
				}
			}
		}
	case opencode.EventListResponseEventMessageRemoved:
		slog.Debug("message removed", "session", msg.Properties.SessionID, "message", msg.Properties.MessageID)
		if msg.Properties.SessionID == a.app.Session.ID {
			messageIndex := slices.IndexFunc(a.app.Messages, func(m app.Message) bool {
				switch casted := m.Info.(type) {
				case opencode.UserMessage:
					return casted.ID == msg.Properties.MessageID
				case opencode.AssistantMessage:
					return casted.ID == msg.Properties.MessageID
				}
				return false
			})
			if messageIndex > -1 {
				a.app.Messages = append(a.app.Messages[:messageIndex], a.app.Messages[messageIndex+1:]...)
			}
		}
	case opencode.EventListResponseEventMessageUpdated:
		if msg.Properties.Info.SessionID == a.app.Session.ID {
			matchIndex := slices.IndexFunc(a.app.Messages, func(m app.Message) bool {
				switch casted := m.Info.(type) {
				case opencode.UserMessage:
					return casted.ID == msg.Properties.Info.ID
				case opencode.AssistantMessage:
					return casted.ID == msg.Properties.Info.ID
				}
				return false
			})

			if matchIndex > -1 {
				match := a.app.Messages[matchIndex]
				a.app.Messages[matchIndex] = app.Message{
					Info:  msg.Properties.Info.AsUnion(),
					Parts: match.Parts,
				}
			}

			if matchIndex == -1 {
				// Extract the new message ID
				var newMessageID string
				switch casted := msg.Properties.Info.AsUnion().(type) {
				case opencode.UserMessage:
					newMessageID = casted.ID
				case opencode.AssistantMessage:
					newMessageID = casted.ID
				}

				// Find the correct insertion index by scanning backwards
				// Most messages are added to the end, so start from the end
				insertIndex := len(a.app.Messages)
				for i := len(a.app.Messages) - 1; i >= 0; i-- {
					var existingID string
					switch casted := a.app.Messages[i].Info.(type) {
					case opencode.UserMessage:
						existingID = casted.ID
					case opencode.AssistantMessage:
						existingID = casted.ID
					}
					if existingID < newMessageID {
						insertIndex = i + 1
						break
					}
				}

				// Create the new message
				newMessage := app.Message{
					Info:  msg.Properties.Info.AsUnion(),
					Parts: []opencode.PartUnion{},
				}

				// Insert at the correct position
				a.app.Messages = append(a.app.Messages[:insertIndex], append([]app.Message{newMessage}, a.app.Messages[insertIndex:]...)...)
			}
		}
	case opencode.EventListResponseEventPermissionUpdated:
		slog.Debug("permission updated", "session", msg.Properties.SessionID, "permission", msg.Properties.ID)
		a.app.Permissions = append(a.app.Permissions, msg.Properties)
		a.app.CurrentPermission = a.app.Permissions[0]
		a.editor.Blur()
	case opencode.EventListResponseEventPermissionReplied:
		index := slices.IndexFunc(a.app.Permissions, func(p opencode.Permission) bool {
			return p.ID == msg.Properties.PermissionID
		})
		if index > -1 {
			a.app.Permissions = append(a.app.Permissions[:index], a.app.Permissions[index+1:]...)
		}
		if a.app.CurrentPermission.ID == msg.Properties.PermissionID {
			if len(a.app.Permissions) > 0 {
				a.app.CurrentPermission = a.app.Permissions[0]
			} else {
				a.app.CurrentPermission = opencode.Permission{}
			}
		}
	case opencode.EventListResponseEventSessionError:
		switch err := msg.Properties.Error.AsUnion().(type) {
		case nil:
		case opencode.ProviderAuthError:
			slog.Error("Failed to authenticate with provider", "error", err.Data.Message)
			return a, toast.NewErrorToast("Provider error: " + err.Data.Message)
		case opencode.UnknownError:
			slog.Error("Server error", "name", err.Name, "message", err.Data.Message)
			return a, toast.NewErrorToast(err.Data.Message, toast.WithTitle(string(err.Name)))
		}
	case opencode.EventListResponseEventSessionCompacted:
		if msg.Properties.SessionID == a.app.Session.ID {
			return a, toast.NewSuccessToast("Session compacted successfully")
		}
	case tea.WindowSizeMsg:
		msg.Height -= 2 // Make space for the status bar
		a.width, a.height = msg.Width, msg.Height
		container := min(a.width, 86)
		layout.Current = &layout.LayoutInfo{
			Viewport: layout.Dimensions{
				Width:  a.width,
				Height: a.height,
			},
			Container: layout.Dimensions{
				Width: container,
			},
		}
	case app.SessionSelectedMsg:
		updated, cmd := a.messages.Update(msg)
		a.messages = updated.(chat.MessagesComponent)
		cmds = append(cmds, cmd)

		messages, err := a.app.ListMessages(context.Background(), msg.ID)
		if err != nil {
			slog.Error("Failed to list messages", "error", err.Error())
			return a, toast.NewErrorToast("Failed to open session")
		}
		a.app.Session = msg
		a.app.Messages = messages
		cmds = append(cmds, util.CmdHandler(app.SessionLoadedMsg{}))
		return a, tea.Batch(cmds...)
	case app.SessionCreatedMsg:
		a.app.Session = msg.Session
	case dialog.ScrollToMessageMsg:
		updated, cmd := a.messages.ScrollToMessage(msg.MessageID)
		a.messages = updated.(chat.MessagesComponent)
		cmds = append(cmds, cmd)
	case dialog.RestoreToMessageMsg:
		cmd := func() tea.Msg {
			// Find next user message after target
			var nextMessageID string
			for i := msg.Index + 1; i < len(a.app.Messages); i++ {
				if userMsg, ok := a.app.Messages[i].Info.(opencode.UserMessage); ok {
					nextMessageID = userMsg.ID
					break
				}
			}

			var response *opencode.Session
			var err error

			if nextMessageID == "" {
				// Last message - use unrevert to restore full conversation
				response, err = a.app.Client.Session.Unrevert(context.Background(), a.app.Session.ID, opencode.SessionUnrevertParams{})
			} else {
				// Revert to next message to make target the last visible
				response, err = a.app.Client.Session.Revert(context.Background(), a.app.Session.ID,
					opencode.SessionRevertParams{MessageID: opencode.F(nextMessageID)})
			}

			if err != nil || response == nil {
				return toast.NewErrorToast("Failed to restore to message")
			}
			return app.MessageRevertedMsg{Session: *response, Message: app.Message{}}
		}
		cmds = append(cmds, cmd)
	case app.MessageRevertedMsg:
		if msg.Session.ID == a.app.Session.ID {
			a.app.Session = &msg.Session
		}
	case app.ModelSelectedMsg:
		a.app.Provider = &msg.Provider
		a.app.Model = &msg.Model
		a.app.State.AgentModel[a.app.Agent().Name] = app.AgentModel{
			ProviderID: msg.Provider.ID,
			ModelID:    msg.Model.ID,
		}
		a.app.State.UpdateModelUsage(msg.Provider.ID, msg.Model.ID)
		cmds = append(cmds, a.app.SaveState())
	case app.AgentSelectedMsg:
		updated, cmd := a.app.SwitchToAgent(msg.AgentName)
		a.app = updated
		cmds = append(cmds, cmd)
	case dialog.ThemeSelectedMsg:
		a.app.State.Theme = msg.ThemeName
		cmds = append(cmds, a.app.SaveState())
	case toast.ShowToastMsg:
		tm, cmd := a.toastManager.Update(msg)
		a.toastManager = tm
		cmds = append(cmds, cmd)
	case toast.DismissToastMsg:
		tm, cmd := a.toastManager.Update(msg)
		a.toastManager = tm
		cmds = append(cmds, cmd)
	case InterruptDebounceTimeoutMsg:
		// Reset interrupt key state after timeout
		a.interruptKeyState = InterruptKeyIdle
		a.editor.SetInterruptKeyInDebounce(false)
	case ExitDebounceTimeoutMsg:
		// Reset exit key state after timeout
		a.exitKeyState = ExitKeyIdle
		a.editor.SetExitKeyInDebounce(false)
	case tea.PasteMsg, tea.ClipboardMsg:
		// Paste events: prioritize modal if active, otherwise editor
		if a.modal != nil {
			updatedModal, cmd := a.modal.Update(msg)
			a.modal = updatedModal.(layout.Modal)
			return a, cmd
		} else {
			updatedEditor, cmd := a.editor.Update(msg)
			a.editor = updatedEditor.(chat.EditorComponent)
			return a, cmd
		}

	// API
	case api.Request:
		slog.Info("api", "path", msg.Path)
		var response any = true
		switch msg.Path {
		case "/tui/open-help":
			helpDialog := dialog.NewHelpDialog(a.app)
			a.modal = helpDialog
		case "/tui/open-sessions":
			sessionDialog := dialog.NewSessionDialog(a.app)
			a.modal = sessionDialog
		case "/tui/open-timeline":
			navigationDialog := dialog.NewTimelineDialog(a.app)
			a.modal = navigationDialog
		case "/tui/open-themes":
			themeDialog := dialog.NewThemeDialog()
			a.modal = themeDialog
		case "/tui/open-models":
			modelDialog := dialog.NewModelDialog(a.app)
			a.modal = modelDialog
		case "/tui/append-prompt":
			var body struct {
				Text string `json:"text"`
			}
			json.Unmarshal((msg.Body), &body)
			existing := a.editor.Value()
			text := body.Text
			if existing != "" && !strings.HasSuffix(existing, " ") {
				text = " " + text
			}
			a.editor.SetValueWithAttachments(existing + text + " ")
		case "/tui/submit-prompt":
			updated, cmd := a.editor.Submit()
			a.editor = updated.(chat.EditorComponent)
			cmds = append(cmds, cmd)
		case "/tui/clear-prompt":
			updated, cmd := a.editor.Clear()
			a.editor = updated.(chat.EditorComponent)
			cmds = append(cmds, cmd)
		case "/tui/execute-command":
			var body struct {
				Command string `json:"command"`
			}
			json.Unmarshal((msg.Body), &body)
			command := commands.Command{}
			for _, cmd := range a.app.Commands {
				if string(cmd.Name) == body.Command {
					command = cmd
					break
				}
			}
			if command.Name == "" {
				slog.Error("Invalid command passed to /tui/execute-command", "command", body.Command)
				return a, nil
			}
			updated, cmd := a.executeCommand(commands.Command(command))
			a = updated.(Model)
			cmds = append(cmds, cmd)
		case "/tui/show-toast":
			var body struct {
				Title   string `json:"title,omitempty"`
				Message string `json:"message"`
				Variant string `json:"variant"`
			}
			json.Unmarshal((msg.Body), &body)

			var toastCmd tea.Cmd
			switch body.Variant {
			case "info":
				if body.Title != "" {
					toastCmd = toast.NewInfoToast(body.Message, toast.WithTitle(body.Title))
				} else {
					toastCmd = toast.NewInfoToast(body.Message)
				}
			case "success":
				if body.Title != "" {
					toastCmd = toast.NewSuccessToast(body.Message, toast.WithTitle(body.Title))
				} else {
					toastCmd = toast.NewSuccessToast(body.Message)
				}
			case "warning":
				if body.Title != "" {
					toastCmd = toast.NewErrorToast(body.Message, toast.WithTitle(body.Title))
				} else {
					toastCmd = toast.NewErrorToast(body.Message)
				}
			case "error":
				if body.Title != "" {
					toastCmd = toast.NewErrorToast(body.Message, toast.WithTitle(body.Title))
				} else {
					toastCmd = toast.NewErrorToast(body.Message)
				}
			default:
				slog.Error("Invalid toast variant", "variant", body.Variant)
				return a, nil
			}
			cmds = append(cmds, toastCmd)

		default:
			break
		}
		cmds = append(cmds, api.Reply(context.Background(), a.app.Client, response))
	}

	s, cmd := a.status.Update(msg)
	cmds = append(cmds, cmd)
	a.status = s.(status.StatusComponent)

	updatedEditor, cmd := a.editor.Update(msg)
	a.editor = updatedEditor.(chat.EditorComponent)
	cmds = append(cmds, cmd)

	updatedMessages, cmd := a.messages.Update(msg)
	a.messages = updatedMessages.(chat.MessagesComponent)
	cmds = append(cmds, cmd)

	if a.modal != nil {
		updatedModal, cmd := a.modal.Update(msg)
		a.modal = updatedModal.(layout.Modal)
		cmds = append(cmds, cmd)
	}

	if a.showCompletionDialog {
		u, cmd := a.completions.Update(msg)
		a.completions = u.(dialog.CompletionDialog)
		cmds = append(cmds, cmd)
	}

	return a, tea.Batch(cmds...)
}

func (a Model) View() (string, *tea.Cursor) {
	t := theme.CurrentTheme()

	var mainLayout string

	var editorX int
	var editorY int
	if a.app.Session.ID == "" {
		mainLayout, editorX, editorY = a.home()
	} else {
		mainLayout, editorX, editorY = a.chat()
	}
	mainLayout = styles.NewStyle().
		Background(t.Background()).
		Padding(0, 2).
		Render(mainLayout)
	mainLayout = lipgloss.PlaceHorizontal(
		a.width,
		lipgloss.Center,
		mainLayout,
		styles.WhitespaceStyle(t.Background()),
	)

	mainStyle := styles.NewStyle().Background(t.Background())
	mainLayout = mainStyle.Render(mainLayout)

	if a.modal != nil {
		mainLayout = a.modal.Render(mainLayout)
	}
	mainLayout = a.toastManager.RenderOverlay(mainLayout)

	if theme.CurrentThemeUsesAnsiColors() {
		mainLayout = util.ConvertRGBToAnsi16Colors(mainLayout)
	}

	cursor := a.editor.Cursor()
	cursor.Position.X += editorX
	cursor.Position.Y += editorY

	return mainLayout + "\n" + a.status.View(), cursor
}

func (a Model) Cleanup() {
	a.status.Cleanup()
}

func (a Model) home() (string, int, int) {
	t := theme.CurrentTheme()
	effectiveWidth := a.width - 4
	baseStyle := styles.NewStyle().Foreground(t.Text()).Background(t.Background())
	base := baseStyle.Render
	muted := styles.NewStyle().Foreground(t.TextMuted()).Background(t.Background()).Render

	open := `
                    
█▀▀█ █▀▀█ █▀▀█ █▀▀▄ 
█░░█ █░░█ █▀▀▀ █░░█ 
▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀  ▀ `

	code := `
             ▄
█▀▀▀ █▀▀█ █▀▀█ █▀▀█
█░░░ █░░█ █░░█ █▀▀▀
▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀`

	logo := lipgloss.JoinHorizontal(
		lipgloss.Top,
		muted(open),
		base(code),
	)
	// cwd := app.Info.Path.Cwd
	// config := app.Info.Path.Config

	versionStyle := styles.NewStyle().
		Foreground(t.TextMuted()).
		Background(t.Background()).
		Width(lipgloss.Width(logo)).
		Align(lipgloss.Right)
	version := versionStyle.Render(a.app.Version)

	logoAndVersion := strings.Join([]string{logo, version}, "\n")
	logoAndVersion = lipgloss.PlaceHorizontal(
		effectiveWidth,
		lipgloss.Center,
		logoAndVersion,
		styles.WhitespaceStyle(t.Background()),
	)

	// Use limit of 4 for vscode, 6 for others
	limit := 5
	if util.IsVSCode() {
		limit = 3
	}

	showVscode := util.IsVSCode()
	commandsView := cmdcomp.New(
		a.app,
		cmdcomp.WithBackground(t.Background()),
		cmdcomp.WithLimit(limit),
		cmdcomp.WithVscode(showVscode),
	)
	cmds := lipgloss.PlaceHorizontal(
		effectiveWidth,
		lipgloss.Center,
		commandsView.View(),
		styles.WhitespaceStyle(t.Background()),
	)

	lines := []string{}
	lines = append(lines, "")
	lines = append(lines, logoAndVersion)
	lines = append(lines, "")
	lines = append(lines, cmds)
	lines = append(lines, "")
	lines = append(lines, "")

	mainHeight := lipgloss.Height(strings.Join(lines, "\n"))

	editorView := a.editor.View()
	editorWidth := lipgloss.Width(editorView)
	editorView = lipgloss.PlaceHorizontal(
		effectiveWidth,
		lipgloss.Center,
		editorView,
		styles.WhitespaceStyle(t.Background()),
	)
	lines = append(lines, editorView)

	editorLines := a.editor.Lines()

	mainLayout := lipgloss.Place(
		effectiveWidth,
		a.height,
		lipgloss.Center,
		lipgloss.Center,
		baseStyle.Render(strings.Join(lines, "\n")),
		styles.WhitespaceStyle(t.Background()),
	)

	editorX := max(0, (effectiveWidth-editorWidth)/2)
	editorY := (a.height / 2) + (mainHeight / 2) - 3
	editorYDelta := 3

	if editorLines > 1 {
		editorYDelta = 2
		content := a.editor.Content()
		editorHeight := lipgloss.Height(content)

		if editorY+editorHeight > a.height {
			difference := (editorY + editorHeight) - a.height
			editorY -= difference
		}
		mainLayout = layout.PlaceOverlay(
			editorX,
			editorY,
			content,
			mainLayout,
		)
	}

	if a.showCompletionDialog {
		a.completions.SetWidth(editorWidth)
		overlay := a.completions.View()
		overlayHeight := lipgloss.Height(overlay)

		mainLayout = layout.PlaceOverlay(
			editorX,
			editorY-overlayHeight+2,
			overlay,
			mainLayout,
		)
	}

	return mainLayout, editorX + 5, editorY + editorYDelta
}

func (a Model) chat() (string, int, int) {
	effectiveWidth := a.width - 4
	t := theme.CurrentTheme()
	editorView := a.editor.View()
	lines := a.editor.Lines()
	messagesView := a.messages.View()

	editorWidth := lipgloss.Width(editorView)
	editorHeight := max(lines, 5)
	editorView = lipgloss.PlaceHorizontal(
		effectiveWidth,
		lipgloss.Center,
		editorView,
		styles.WhitespaceStyle(t.Background()),
	)

	mainLayout := messagesView + "\n" + editorView
	editorX := max(0, (effectiveWidth-editorWidth)/2)
	editorY := a.height - editorHeight

	if lines > 1 {
		content := a.editor.Content()
		editorHeight := lipgloss.Height(content)
		if editorY+editorHeight > a.height {
			difference := (editorY + editorHeight) - a.height
			editorY -= difference
		}
		mainLayout = layout.PlaceOverlay(
			editorX,
			editorY,
			content,
			mainLayout,
		)
	}

	if a.showCompletionDialog {
		a.completions.SetWidth(editorWidth)
		overlay := a.completions.View()
		overlayHeight := lipgloss.Height(overlay)
		editorY := a.height - editorHeight + 1

		mainLayout = layout.PlaceOverlay(
			editorX,
			editorY-overlayHeight,
			overlay,
			mainLayout,
		)
	}

	return mainLayout, editorX + 5, editorY + 2
}

func (a Model) executeCommand(command commands.Command) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd
	cmds := []tea.Cmd{
		util.CmdHandler(commands.CommandExecutedMsg(command)),
	}
	switch command.Name {
	case commands.AppHelpCommand:
		helpDialog := dialog.NewHelpDialog(a.app)
		a.modal = helpDialog
	case commands.AgentCycleCommand:
		updated, cmd := a.app.SwitchAgent()
		a.app = updated
		cmds = append(cmds, cmd)
	case commands.AgentCycleReverseCommand:
		updated, cmd := a.app.SwitchAgentReverse()
		a.app = updated
		cmds = append(cmds, cmd)
	case commands.EditorOpenCommand:
		if a.app.IsBusy() {
			// status.Warn("Agent is working, please wait...")
			return a, nil
		}
		editor := util.GetEditor()
		if editor == "" {
			return a, toast.NewErrorToast("No editor found. Set EDITOR environment variable (e.g., export EDITOR=vim)")
		}

		value := a.editor.Value()
		updated, cmd := a.editor.Clear()
		a.editor = updated.(chat.EditorComponent)
		cmds = append(cmds, cmd)

		tmpfile, err := os.CreateTemp("", "msg_*.md")
		tmpfile.WriteString(value)
		if err != nil {
			slog.Error("Failed to create temp file", "error", err)
			return a, toast.NewErrorToast("Something went wrong, couldn't open editor")
		}
		tmpfile.Close()
		parts := strings.Fields(editor)
		c := exec.Command(parts[0], append(parts[1:], tmpfile.Name())...) //nolint:gosec
		c.Stdin = os.Stdin
		c.Stdout = os.Stdout
		c.Stderr = os.Stderr
		cmd = tea.ExecProcess(c, func(err error) tea.Msg {
			if err != nil {
				slog.Error("Failed to open editor", "error", err)
				return nil
			}
			content, err := os.ReadFile(tmpfile.Name())
			if err != nil {
				slog.Error("Failed to read file", "error", err)
				return nil
			}
			if len(content) == 0 {
				slog.Warn("Message is empty")
				return nil
			}
			os.Remove(tmpfile.Name())
			return app.SetEditorContentMsg{
				Text: string(content),
			}
		})
		cmds = append(cmds, cmd)
	case commands.SessionNewCommand:
		if a.app.Session.ID == "" {
			return a, nil
		}
		cmds = append(cmds, util.CmdHandler(app.SessionClearedMsg{}))

	case commands.SessionListCommand:
		sessionDialog := dialog.NewSessionDialog(a.app)
		a.modal = sessionDialog
	case commands.SessionTimelineCommand:
		if a.app.Session.ID == "" {
			return a, toast.NewErrorToast("No active session")
		}
		navigationDialog := dialog.NewTimelineDialog(a.app)
		a.modal = navigationDialog
	case commands.SessionShareCommand:
		if a.app.Session.ID == "" {
			return a, nil
		}
		response, err := a.app.Client.Session.Share(
			context.Background(),
			a.app.Session.ID,
			opencode.SessionShareParams{},
		)
		if err != nil {
			slog.Error("Failed to share session", "error", err)
			return a, toast.NewErrorToast("Failed to share session")
		}
		shareUrl := response.Share.URL
		cmds = append(cmds, app.SetClipboard(shareUrl))
		cmds = append(cmds, toast.NewSuccessToast("Share URL copied to clipboard!"))
	case commands.SessionUnshareCommand:
		if a.app.Session.ID == "" {
			return a, nil
		}
		_, err := a.app.Client.Session.Unshare(
			context.Background(),
			a.app.Session.ID,
			opencode.SessionUnshareParams{},
		)
		if err != nil {
			slog.Error("Failed to unshare session", "error", err)
			return a, toast.NewErrorToast("Failed to unshare session")
		}
		a.app.Session.Share.URL = ""
		cmds = append(cmds, toast.NewSuccessToast("Session unshared successfully"))
	case commands.SessionInterruptCommand:
		if a.app.Session.ID == "" {
			return a, nil
		}
		a.app.Cancel(context.Background(), a.app.Session.ID)
		return a, nil
	case commands.SessionCompactCommand:
		if a.app.Session.ID == "" {
			return a, nil
		}
		// TODO: block until compaction is complete
		a.app.CompactSession(context.Background())
	case commands.SessionChildCycleCommand:
		if a.app.Session.ID == "" {
			return a, nil
		}
		cmds = append(cmds, func() tea.Msg {
			parentSessionID := a.app.Session.ID
			var parentSession *opencode.Session
			if a.app.Session.ParentID != "" {
				parentSessionID = a.app.Session.ParentID
				session, err := a.app.Client.Session.Get(
					context.Background(),
					parentSessionID,
					opencode.SessionGetParams{},
				)
				if err != nil {
					slog.Error("Failed to get parent session", "error", err)
					return toast.NewErrorToast("Failed to get parent session")
				}
				parentSession = session
			} else {
				parentSession = a.app.Session
			}

			children, err := a.app.Client.Session.Children(
				context.Background(),
				parentSessionID,
				opencode.SessionChildrenParams{},
			)
			if err != nil {
				slog.Error("Failed to get session children", "error", err)
				return toast.NewErrorToast("Failed to get session children")
			}

			// Reverse sort the children (newest first)
			slices.Reverse(*children)

			// Create combined array: [parent, child1, child2, ...]
			sessions := []*opencode.Session{parentSession}
			for i := range *children {
				sessions = append(sessions, &(*children)[i])
			}

			if len(sessions) == 1 {
				return toast.NewInfoToast("No child sessions available")
			}

			// Find current session index in combined array
			currentIndex := -1
			for i, session := range sessions {
				if session.ID == a.app.Session.ID {
					currentIndex = i
					break
				}
			}

			// If session not found, default to parent (shouldn't happen)
			if currentIndex == -1 {
				currentIndex = 0
			}

			// Cycle to next session (parent or child)
			nextIndex := (currentIndex + 1) % len(sessions)
			nextSession := sessions[nextIndex]

			return app.SessionSelectedMsg(nextSession)
		})
	case commands.SessionChildCycleReverseCommand:
		if a.app.Session.ID == "" {
			return a, nil
		}
		cmds = append(cmds, func() tea.Msg {
			parentSessionID := a.app.Session.ID
			var parentSession *opencode.Session
			if a.app.Session.ParentID != "" {
				parentSessionID = a.app.Session.ParentID
				session, err := a.app.Client.Session.Get(
					context.Background(),
					parentSessionID,
					opencode.SessionGetParams{},
				)
				if err != nil {
					slog.Error("Failed to get parent session", "error", err)
					return toast.NewErrorToast("Failed to get parent session")
				}
				parentSession = session
			} else {
				parentSession = a.app.Session
			}

			children, err := a.app.Client.Session.Children(
				context.Background(),
				parentSessionID,
				opencode.SessionChildrenParams{},
			)
			if err != nil {
				slog.Error("Failed to get session children", "error", err)
				return toast.NewErrorToast("Failed to get session children")
			}

			// Reverse sort the children (newest first)
			slices.Reverse(*children)

			// Create combined array: [parent, child1, child2, ...]
			sessions := []*opencode.Session{parentSession}
			for i := range *children {
				sessions = append(sessions, &(*children)[i])
			}

			if len(sessions) == 1 {
				return toast.NewInfoToast("No child sessions available")
			}

			// Find current session index in combined array
			currentIndex := -1
			for i, session := range sessions {
				if session.ID == a.app.Session.ID {
					currentIndex = i
					break
				}
			}

			// If session not found, default to parent (shouldn't happen)
			if currentIndex == -1 {
				currentIndex = 0
			}

			// Cycle to previous session (parent or child)
			nextIndex := (currentIndex - 1 + len(sessions)) % len(sessions)
			nextSession := sessions[nextIndex]

			return app.SessionSelectedMsg(nextSession)
		})
	case commands.SessionExportCommand:
		if a.app.Session.ID == "" {
			return a, toast.NewErrorToast("No active session to export.")
		}

		// Use current conversation history
		messages := a.app.Messages
		if len(messages) == 0 {
			return a, toast.NewInfoToast("No messages to export.")
		}

		// Format to Markdown
		markdownContent := formatConversationToMarkdown(messages)

		editor := util.GetEditor()
		if editor == "" {
			return a, toast.NewErrorToast("No editor found. Set EDITOR environment variable (e.g., export EDITOR=vim)")
		}

		// Create and write to temp file
		tmpfile, err := os.CreateTemp("", "conversation-*.md")
		if err != nil {
			slog.Error("Failed to create temp file", "error", err)
			return a, toast.NewErrorToast("Failed to create temporary file.")
		}

		_, err = tmpfile.WriteString(markdownContent)
		if err != nil {
			slog.Error("Failed to write to temp file", "error", err)
			tmpfile.Close()
			os.Remove(tmpfile.Name())
			return a, toast.NewErrorToast("Failed to write conversation to file.")
		}
		tmpfile.Close()

		// Open in editor
		parts := strings.Fields(editor)
		c := exec.Command(parts[0], append(parts[1:], tmpfile.Name())...) //nolint:gosec
		c.Stdin = os.Stdin
		c.Stdout = os.Stdout
		c.Stderr = os.Stderr
		cmd = tea.ExecProcess(c, func(err error) tea.Msg {
			if err != nil {
				slog.Error("Failed to open editor for conversation", "error", err)
			}
			// Clean up the file after editor closes
			os.Remove(tmpfile.Name())
			return nil
		})
		cmds = append(cmds, cmd)
	case commands.ToolDetailsCommand:
		message := "Tool details are now visible"
		if a.messages.ToolDetailsVisible() {
			message = "Tool details are now hidden"
		}
		cmds = append(cmds, util.CmdHandler(chat.ToggleToolDetailsMsg{}))
		cmds = append(cmds, toast.NewInfoToast(message))
	case commands.ThinkingBlocksCommand:
		message := "Thinking blocks are now visible"
		if a.messages.ThinkingBlocksVisible() {
			message = "Thinking blocks are now hidden"
		}
		cmds = append(cmds, util.CmdHandler(chat.ToggleThinkingBlocksMsg{}))
		cmds = append(cmds, toast.NewInfoToast(message))
	case commands.ModelListCommand:
		modelDialog := dialog.NewModelDialog(a.app)
		a.modal = modelDialog

	case commands.AgentListCommand:
		agentDialog := dialog.NewAgentDialog(a.app)
		a.modal = agentDialog
	case commands.ModelCycleRecentCommand:
		slog.Debug("ModelCycleRecentCommand triggered")
		updated, cmd := a.app.CycleRecentModel()
		a.app = updated
		cmds = append(cmds, cmd)
	case commands.ModelCycleRecentReverseCommand:
		updated, cmd := a.app.CycleRecentModelReverse()
		a.app = updated
		cmds = append(cmds, cmd)
	case commands.ThemeListCommand:
		themeDialog := dialog.NewThemeDialog()
		a.modal = themeDialog
	case commands.ProjectInitCommand:
		cmds = append(cmds, a.app.InitializeProject(context.Background()))
	case commands.InputClearCommand:
		if a.editor.Value() == "" {
			return a, nil
		}
		updated, cmd := a.editor.Clear()
		a.editor = updated.(chat.EditorComponent)
		cmds = append(cmds, cmd)
	case commands.InputPasteCommand:
		updated, cmd := a.editor.Paste()
		a.editor = updated.(chat.EditorComponent)
		cmds = append(cmds, cmd)
	case commands.InputSubmitCommand:
		updated, cmd := a.editor.Submit()
		a.editor = updated.(chat.EditorComponent)
		cmds = append(cmds, cmd)
	case commands.InputNewlineCommand:
		updated, cmd := a.editor.Newline()
		a.editor = updated.(chat.EditorComponent)
		cmds = append(cmds, cmd)
	case commands.MessagesFirstCommand:
		updated, cmd := a.messages.GotoTop()
		a.messages = updated.(chat.MessagesComponent)
		cmds = append(cmds, cmd)
	case commands.MessagesLastCommand:
		updated, cmd := a.messages.GotoBottom()
		a.messages = updated.(chat.MessagesComponent)
		cmds = append(cmds, cmd)
	case commands.MessagesPageUpCommand:
		updated, cmd := a.messages.PageUp()
		a.messages = updated.(chat.MessagesComponent)
		cmds = append(cmds, cmd)
	case commands.MessagesPageDownCommand:
		updated, cmd := a.messages.PageDown()
		a.messages = updated.(chat.MessagesComponent)
		cmds = append(cmds, cmd)
	case commands.MessagesHalfPageUpCommand:
		updated, cmd := a.messages.HalfPageUp()
		a.messages = updated.(chat.MessagesComponent)
		cmds = append(cmds, cmd)
	case commands.MessagesHalfPageDownCommand:
		updated, cmd := a.messages.HalfPageDown()
		a.messages = updated.(chat.MessagesComponent)
		cmds = append(cmds, cmd)
	case commands.MessagesCopyCommand:
		updated, cmd := a.messages.CopyLastMessage()
		a.messages = updated.(chat.MessagesComponent)
		cmds = append(cmds, cmd)
	case commands.MessagesUndoCommand:
		updated, cmd := a.messages.UndoLastMessage()
		a.messages = updated.(chat.MessagesComponent)
		cmds = append(cmds, cmd)
	case commands.MessagesRedoCommand:
		updated, cmd := a.messages.RedoLastMessage()
		a.messages = updated.(chat.MessagesComponent)
		cmds = append(cmds, cmd)
	case commands.AppExitCommand:
		return a, tea.Quit
	}
	return a, tea.Batch(cmds...)
}

func NewModel(app *app.App) tea.Model {
	commandProvider := completions.NewCommandCompletionProvider(app)
	fileProvider := completions.NewFileContextGroup(app)
	symbolsProvider := completions.NewSymbolsContextGroup(app)
	agentsProvider := completions.NewAgentsContextGroup(app)

	messages := chat.NewMessagesComponent(app)
	editor := chat.NewEditorComponent(app)
	completions := dialog.NewCompletionDialogComponent("/", commandProvider)

	var leaderBinding *key.Binding
	if app.Config.Keybinds.Leader != "" {
		binding := key.NewBinding(key.WithKeys(app.Config.Keybinds.Leader))
		leaderBinding = &binding
	}

	model := &Model{
		status:               status.NewStatusCmp(app),
		app:                  app,
		editor:               editor,
		messages:             messages,
		completions:          completions,
		commandProvider:      commandProvider,
		fileProvider:         fileProvider,
		symbolsProvider:      symbolsProvider,
		agentsProvider:       agentsProvider,
		leaderBinding:        leaderBinding,
		showCompletionDialog: false,
		toastManager:         toast.NewToastManager(),
		interruptKeyState:    InterruptKeyIdle,
		exitKeyState:         ExitKeyIdle,
	}

	return model
}

func formatConversationToMarkdown(messages []app.Message) string {
	var builder strings.Builder

	builder.WriteString("# Conversation History\n\n")

	for _, msg := range messages {
		builder.WriteString("---\n\n")

		var role string
		var timestamp time.Time

		switch info := msg.Info.(type) {
		case opencode.UserMessage:
			role = "User"
			timestamp = time.UnixMilli(int64(info.Time.Created))
		case opencode.AssistantMessage:
			role = "Assistant"
			timestamp = time.UnixMilli(int64(info.Time.Created))
		default:
			continue
		}

		builder.WriteString(
			fmt.Sprintf("**%s** (*%s*)\n\n", role, timestamp.Format("2006-01-02 15:04:05")),
		)

		for _, part := range msg.Parts {
			switch p := part.(type) {
			case opencode.TextPart:
				builder.WriteString(p.Text + "\n\n")
			case opencode.FilePart:
				builder.WriteString(fmt.Sprintf("[File: %s]\n\n", p.Filename))
			case opencode.ToolPart:
				builder.WriteString(fmt.Sprintf("[Tool: %s]\n\n", p.Tool))
			}
		}
	}

	return builder.String()
}
