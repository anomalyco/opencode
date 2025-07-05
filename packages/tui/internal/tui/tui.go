package tui

import (
	"context"
	"log/slog"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/v2/key"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"

	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/commands"
	"github.com/sst/opencode/internal/completions"
	"github.com/sst/opencode/internal/components/chat"
	cmdcomp "github.com/sst/opencode/internal/components/commands"
	"github.com/sst/opencode/internal/components/dialog"
	"github.com/sst/opencode/internal/components/fileviewer"
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

// InterruptKeyState tracks the state of interrupt key presses for debouncing
type InterruptKeyState int

const (
	InterruptKeyIdle InterruptKeyState = iota
	InterruptKeyFirstPress
)

const interruptDebounceTimeout = 1 * time.Second
const fileViewerFullWidthCutoff = 160

type appModel struct {
	width, height        int
	app                  *app.App
	modal                layout.Modal
	status               status.StatusComponent
	editor               chat.EditorComponent
	messages             chat.MessagesComponent
	completions          dialog.CompletionDialog
	commandProvider      dialog.CompletionProvider
	fileProvider         dialog.CompletionProvider
	showCompletionDialog bool
	fileCompletionActive bool
	leaderBinding        *key.Binding
	isLeaderSequence     bool
	toastManager         *toast.ToastManager
	interruptKeyState    InterruptKeyState
	lastScroll           time.Time
	messagesRight        bool
	fileViewer           fileviewer.Model
	lastMouse            tea.Mouse
	fileViewerStart      int
	fileViewerEnd        int
	fileViewerHit        bool
}

func (a appModel) Init() tea.Cmd {
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
	cmds = append(cmds, a.fileViewer.Init())

	// Check if we should show the init dialog
	cmds = append(cmds, func() tea.Msg {
		shouldShow := a.app.Info.Git && a.app.Info.Time.Initialized > 0
		return dialog.ShowInitDialogMsg{Show: shouldShow}
	})

	return tea.Batch(cmds...)
}

var BUGGED_SCROLL_KEYS = map[string]bool{
	"0": true,
	"1": true,
	"2": true,
	"3": true,
	"4": true,
	"5": true,
	"6": true,
	"7": true,
	"8": true,
	"9": true,
	"M": true,
	"m": true,
	"[": true,
	";": true,
	"<": true,
}

func isScrollRelatedInput(keyString string) bool {
	if len(keyString) == 0 {
		return false
	}

	for _, char := range keyString {
		charStr := string(char)
		if !BUGGED_SCROLL_KEYS[charStr] {
			return false
		}
	}

	if len(keyString) > 3 &&
		(keyString[len(keyString)-1] == 'M' || keyString[len(keyString)-1] == 'm') {
		return true
	}

	return len(keyString) > 1
}

func (a appModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.KeyPressMsg:
		keyString := msg.String()

		if time.Since(a.lastScroll) < time.Millisecond*100 && (BUGGED_SCROLL_KEYS[keyString] || isScrollRelatedInput(keyString)) {
			return a, nil
		}

		// 1. Handle active modal
		if a.modal != nil {
			switch keyString {
			// Escape always closes current modal
			case "esc":
				cmd := a.modal.Close()
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
		if a.isLeaderSequence {
			matches := a.app.Commands.Matches(msg, a.isLeaderSequence)
			a.isLeaderSequence = false
			if len(matches) > 0 {
				return a, util.CmdHandler(commands.ExecuteCommandsMsg(matches))
			}
		}

		// 3. Handle completions trigger
		if keyString == "/" &&
			!a.showCompletionDialog &&
			a.editor.Value() == "" {
			a.showCompletionDialog = true
			a.fileCompletionActive = false

			updated, cmd := a.editor.Update(msg)
			a.editor = updated.(chat.EditorComponent)
			cmds = append(cmds, cmd)

			// Set command provider for command completion
			a.completions = dialog.NewCompletionDialogComponent(a.commandProvider)
			updated, cmd = a.completions.Update(msg)
			a.completions = updated.(dialog.CompletionDialog)
			cmds = append(cmds, cmd)

			return a, tea.Sequence(cmds...)
		}

		// Handle file completions trigger
		if keyString == "@" &&
			!a.showCompletionDialog {
			a.showCompletionDialog = true
			a.fileCompletionActive = true

			updated, cmd := a.editor.Update(msg)
			a.editor = updated.(chat.EditorComponent)
			cmds = append(cmds, cmd)

			// Set file provider for file completion
			a.completions = dialog.NewCompletionDialogComponent(a.fileProvider)
			updated, cmd = a.completions.Update(msg)
			a.completions = updated.(dialog.CompletionDialog)
			cmds = append(cmds, cmd)

			return a, tea.Sequence(cmds...)
		}

		if a.showCompletionDialog {
			switch keyString {
			case "tab", "enter", "esc", "ctrl+c", "up", "down":
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
			!a.isLeaderSequence &&
			key.Matches(msg, *a.leaderBinding) {
			a.isLeaderSequence = true
			return a, nil
		}

		// 6. Handle interrupt key debounce for session interrupt
		interruptCommand := a.app.Commands[commands.SessionInterruptCommand]
		if interruptCommand.Matches(msg, a.isLeaderSequence) && a.app.IsBusy() {
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

		// 7. Check again for commands that don't require leader (excluding interrupt when busy)
		matches := a.app.Commands.Matches(msg, a.isLeaderSequence)
		if len(matches) > 0 {
			// Skip interrupt key if we're in debounce mode and app is busy
			if interruptCommand.Matches(msg, a.isLeaderSequence) && a.app.IsBusy() && a.interruptKeyState != InterruptKeyIdle {
				return a, nil
			}
			return a, util.CmdHandler(commands.ExecuteCommandsMsg(matches))
		}

		// 7. Fallback to editor. This is for other characters
		// like backspace, tab, etc.
		updatedEditor, cmd := a.editor.Update(msg)
		a.editor = updatedEditor.(chat.EditorComponent)
		return a, cmd
	case tea.MouseWheelMsg:
		a.lastScroll = time.Now()
		if a.modal != nil {
			return a, nil
		}

		var cmd tea.Cmd
		if a.fileViewerHit {
			a.fileViewer, cmd = a.fileViewer.Update(msg)
			cmds = append(cmds, cmd)
		} else {
			updated, cmd := a.messages.Update(msg)
			a.messages = updated.(chat.MessagesComponent)
			cmds = append(cmds, cmd)
		}

		return a, tea.Batch(cmds...)
	case tea.MouseMotionMsg:
		a.lastMouse = msg.Mouse()
		a.fileViewerHit = a.fileViewer.HasFile() &&
			a.lastMouse.X > a.fileViewerStart &&
			a.lastMouse.X < a.fileViewerEnd
	case tea.MouseClickMsg:
		a.lastMouse = msg.Mouse()
		a.fileViewerHit = a.fileViewer.HasFile() &&
			a.lastMouse.X > a.fileViewerStart &&
			a.lastMouse.X < a.fileViewerEnd
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
	case app.SendMsg:
		a.showCompletionDialog = false
		a.app, cmd = a.app.SendChatMessage(context.Background(), msg.Text, msg.Attachments)
		cmds = append(cmds, cmd)
	case dialog.CompletionDialogCloseMsg:
		a.showCompletionDialog = false
		a.fileCompletionActive = false
	case opencode.EventListResponseEventInstallationUpdated:
		return a, toast.NewSuccessToast(
			"opencode updated to "+msg.Properties.Version+", restart to apply.",
			toast.WithTitle("New version installed"),
		)
	case opencode.EventListResponseEventSessionDeleted:
		if a.app.Session != nil && msg.Properties.Info.ID == a.app.Session.ID {
			a.app.Session = &opencode.Session{}
			a.app.Messages = []opencode.Message{}
		}
		return a, toast.NewSuccessToast("Session deleted successfully")
	case opencode.EventListResponseEventSessionUpdated:
		if msg.Properties.Info.ID == a.app.Session.ID {
			a.app.Session = &msg.Properties.Info
		}
	case opencode.EventListResponseEventMessageUpdated:
		if msg.Properties.Info.Metadata.SessionID == a.app.Session.ID {
			exists := false
			optimisticReplaced := false

			// First check if this is replacing an optimistic message
			if msg.Properties.Info.Role == opencode.MessageRoleUser {
				// Look for optimistic messages to replace
				for i, m := range a.app.Messages {
					if strings.HasPrefix(m.ID, "optimistic-") && m.Role == opencode.MessageRoleUser {
						// Replace the optimistic message with the real one
						a.app.Messages[i] = msg.Properties.Info
						exists = true
						optimisticReplaced = true
						break
					}
				}
			}

			// If not replacing optimistic, check for existing message with same ID
			if !optimisticReplaced {
				for i, m := range a.app.Messages {
					if m.ID == msg.Properties.Info.ID {
						a.app.Messages[i] = msg.Properties.Info
						exists = true
						break
					}
				}
			}

			if !exists {
				a.app.Messages = append(a.app.Messages, msg.Properties.Info)
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
	case opencode.EventListResponseEventFileWatcherUpdated:
		if a.fileViewer.HasFile() {
			if a.fileViewer.Filename() == msg.Properties.File {
				return a.openFile(msg.Properties.File)
			}
		}
	case tea.WindowSizeMsg:
		msg.Height -= 2 // Make space for the status bar
		a.width, a.height = msg.Width, msg.Height
		container := min(a.width, 84)
		if a.fileViewer.HasFile() {
			if a.width < fileViewerFullWidthCutoff {
				container = a.width
			} else {
				container = min(min(a.width, max(a.width/2, 50)), 84)
			}
		}
		layout.Current = &layout.LayoutInfo{
			Viewport: layout.Dimensions{
				Width:  a.width,
				Height: a.height,
			},
			Container: layout.Dimensions{
				Width: container,
			},
		}
		mainWidth := layout.Current.Container.Width
		a.messages.SetWidth(mainWidth - 4)

		sideWidth := a.width - mainWidth
		if a.width < fileViewerFullWidthCutoff {
			sideWidth = a.width
		}
		a.fileViewerStart = mainWidth
		a.fileViewerEnd = a.fileViewerStart + sideWidth
		if a.messagesRight {
			a.fileViewerStart = 0
			a.fileViewerEnd = sideWidth
		}
		a.fileViewer, cmd = a.fileViewer.SetSize(sideWidth, layout.Current.Viewport.Height)
		cmds = append(cmds, cmd)
	case app.SessionSelectedMsg:
		messages, err := a.app.ListMessages(context.Background(), msg.ID)
		if err != nil {
			slog.Error("Failed to list messages", "error", err)
			return a, toast.NewErrorToast("Failed to open session")
		}
		a.app.Session = msg
		a.app.Messages = messages
		return a, util.CmdHandler(app.SessionLoadedMsg{})
	case app.ModelSelectedMsg:
		a.app.Provider = &msg.Provider
		a.app.Model = &msg.Model
		a.app.State.Provider = msg.Provider.ID
		a.app.State.Model = msg.Model.ID
		a.app.State.UpdateModelUsage(msg.Provider.ID, msg.Model.ID)
		a.app.SaveState()
	case dialog.ThemeSelectedMsg:
		a.app.State.Theme = msg.ThemeName
		a.app.SaveState()
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
	case dialog.FindSelectedMsg:
		return a.openFile(msg.FilePath)
	}

	s, cmd := a.status.Update(msg)
	cmds = append(cmds, cmd)
	a.status = s.(status.StatusComponent)

	u, cmd := a.editor.Update(msg)
	a.editor = u.(chat.EditorComponent)
	cmds = append(cmds, cmd)

	u, cmd = a.messages.Update(msg)
	a.messages = u.(chat.MessagesComponent)
	cmds = append(cmds, cmd)

	if a.modal != nil {
		u, cmd := a.modal.Update(msg)
		a.modal = u.(layout.Modal)
		cmds = append(cmds, cmd)
	}

	if a.showCompletionDialog {
		u, cmd := a.completions.Update(msg)
		a.completions = u.(dialog.CompletionDialog)
		cmds = append(cmds, cmd)
	}

	fv, cmd := a.fileViewer.Update(msg)
	a.fileViewer = fv
	cmds = append(cmds, cmd)

	return a, tea.Batch(cmds...)
}

func (a appModel) View() string {
	t := theme.CurrentTheme()

	var mainLayout string
	mainWidth := layout.Current.Container.Width - 4
	if a.app.Session.ID == "" {
		mainLayout = a.home(mainWidth)
	} else {
		mainLayout = a.chat(mainWidth)
	}
	mainLayout = styles.NewStyle().
		Background(t.Background()).
		Padding(0, 2).
		Render(mainLayout)

	mainHeight := lipgloss.Height(mainLayout)

	if a.fileViewer.HasFile() {
		file := a.fileViewer.View()
		baseStyle := styles.NewStyle().Background(t.BackgroundPanel())
		sidePanel := baseStyle.Height(mainHeight).Render(file)
		if a.width >= fileViewerFullWidthCutoff {
			if a.messagesRight {
				mainLayout = lipgloss.JoinHorizontal(
					lipgloss.Top,
					sidePanel,
					mainLayout,
				)
			} else {
				mainLayout = lipgloss.JoinHorizontal(
					lipgloss.Top,
					mainLayout,
					sidePanel,
				)
			}
		} else {
			mainLayout = sidePanel
		}
	} else {
		mainLayout = lipgloss.PlaceHorizontal(
			a.width,
			lipgloss.Center,
			mainLayout,
			styles.WhitespaceStyle(t.Background()),
		)
	}

	mainStyle := styles.NewStyle().Background(t.Background())
	mainLayout = mainStyle.Render(mainLayout)

	if a.modal != nil {
		mainLayout = a.modal.Render(mainLayout)
	}
	mainLayout = a.toastManager.RenderOverlay(mainLayout)

	if theme.CurrentThemeUsesAnsiColors() {
		mainLayout = util.ConvertRGBToAnsi16Colors(mainLayout)
	}
	return mainLayout + "\n" + a.status.View()
}

func (a appModel) openFile(filepath string) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd
	response, err := a.app.Client.File.Read(
		context.Background(),
		opencode.FileReadParams{
			Path: opencode.F(filepath),
		},
	)
	if err != nil {
		slog.Error("Failed to read file", "error", err)
		return a, toast.NewErrorToast("Failed to read file")
	}
	a.fileViewer, cmd = a.fileViewer.SetFile(
		filepath,
		response.Content,
		response.Type == "patch",
	)
	return a, cmd
}

func (a appModel) home(width int) string {
	t := theme.CurrentTheme()
	baseStyle := styles.NewStyle().Background(t.Background())
	base := baseStyle.Render
	muted := styles.NewStyle().Foreground(t.TextMuted()).Background(t.Background()).Render

	open := `
█▀▀█ █▀▀█ █▀▀ █▀▀▄ 
█░░█ █░░█ █▀▀ █░░█ 
▀▀▀▀ █▀▀▀ ▀▀▀ ▀  ▀ `
	code := `
█▀▀ █▀▀█ █▀▀▄ █▀▀
█░░ █░░█ █░░█ █▀▀
▀▀▀ ▀▀▀▀ ▀▀▀  ▀▀▀`

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
		width,
		lipgloss.Center,
		logoAndVersion,
		styles.WhitespaceStyle(t.Background()),
	)
	commandsView := cmdcomp.New(
		a.app,
		cmdcomp.WithBackground(t.Background()),
		cmdcomp.WithLimit(6),
	)
	cmds := lipgloss.PlaceHorizontal(
		width,
		lipgloss.Center,
		commandsView.View(),
		styles.WhitespaceStyle(t.Background()),
	)

	lines := []string{}
	lines = append(lines, "")
	lines = append(lines, "")
	lines = append(lines, logoAndVersion)
	lines = append(lines, "")
	lines = append(lines, "")
	// lines = append(lines, base("cwd ")+muted(cwd))
	// lines = append(lines, base("config ")+muted(config))
	// lines = append(lines, "")
	lines = append(lines, cmds)
	lines = append(lines, "")
	lines = append(lines, "")

	mainHeight := lipgloss.Height(strings.Join(lines, "\n"))

	editorWidth := min(width, 80)
	editorView := a.editor.View(editorWidth)
	editorView = lipgloss.PlaceHorizontal(
		width,
		lipgloss.Center,
		editorView,
		styles.WhitespaceStyle(t.Background()),
	)
	lines = append(lines, editorView)

	editorLines := a.editor.Lines()

	mainLayout := lipgloss.Place(
		width,
		a.height,
		lipgloss.Center,
		lipgloss.Center,
		baseStyle.Render(strings.Join(lines, "\n")),
		styles.WhitespaceStyle(t.Background()),
	)

	editorX := (width - editorWidth) / 2
	editorY := (a.height / 2) + (mainHeight / 2) - 2

	if editorLines > 1 {
		mainLayout = layout.PlaceOverlay(
			editorX,
			editorY,
			a.editor.Content(editorWidth),
			mainLayout,
		)
	}

	if a.showCompletionDialog {
		a.completions.SetWidth(editorWidth)
		overlay := a.completions.View()
		overlayHeight := lipgloss.Height(overlay)

		mainLayout = layout.PlaceOverlay(
			editorX,
			editorY-overlayHeight+1,
			overlay,
			mainLayout,
		)
	}

	return mainLayout
}

func (a appModel) chat(width int) string {
	editorView := a.editor.View(width)
	lines := a.editor.Lines()
	messagesView := a.messages.View(width, a.height-5)

	editorWidth := lipgloss.Width(editorView)
	editorHeight := max(lines, 5)

	mainLayout := messagesView + "\n" + editorView
	editorX := (a.width - editorWidth) / 2

	if lines > 1 {
		editorY := a.height - editorHeight
		mainLayout = layout.PlaceOverlay(
			editorX,
			editorY,
			a.editor.Content(width),
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

	return mainLayout
}

func (a appModel) executeCommand(command commands.Command) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd
	cmds := []tea.Cmd{
		util.CmdHandler(commands.CommandExecutedMsg(command)),
	}
	switch command.Name {
	case commands.AppHelpCommand:
		helpDialog := dialog.NewHelpDialog(a.app)
		a.modal = helpDialog
	case commands.EditorOpenCommand:
		if a.app.IsBusy() {
			// status.Warn("Agent is working, please wait...")
			return a, nil
		}
		editor := os.Getenv("EDITOR")
		if editor == "" {
			return a, toast.NewErrorToast("No EDITOR set, can't open editor")
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
		c := exec.Command(editor, tmpfile.Name()) //nolint:gosec
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
			return app.SendMsg{
				Text: string(content),
			}
		})
		cmds = append(cmds, cmd)
	case commands.SessionNewCommand:
		if a.app.Session.ID == "" {
			return a, nil
		}
		a.app.Session = &opencode.Session{}
		a.app.Messages = []opencode.Message{}
		cmds = append(cmds, util.CmdHandler(app.SessionClearedMsg{}))
	case commands.SessionListCommand:
		sessionDialog := dialog.NewSessionDialog(a.app)
		a.modal = sessionDialog
	case commands.SessionShareCommand:
		if a.app.Session.ID == "" {
			return a, nil
		}
		response, err := a.app.Client.Session.Share(context.Background(), a.app.Session.ID)
		if err != nil {
			slog.Error("Failed to share session", "error", err)
			return a, toast.NewErrorToast("Failed to share session")
		}
		shareUrl := response.Share.URL
		cmds = append(cmds, tea.SetClipboard(shareUrl))
		cmds = append(cmds, toast.NewSuccessToast("Share URL copied to clipboard!"))
	case commands.SessionUnshareCommand:
		if a.app.Session.ID == "" {
			return a, nil
		}
		_, err := a.app.Client.Session.Unshare(context.Background(), a.app.Session.ID)
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
	case commands.ToolDetailsCommand:
		message := "Tool details are now visible"
		if a.messages.ToolDetailsVisible() {
			message = "Tool details are now hidden"
		}
		cmds = append(cmds, util.CmdHandler(chat.ToggleToolDetailsMsg{}))
		cmds = append(cmds, toast.NewInfoToast(message))
	case commands.ModelListCommand:
		modelDialog := dialog.NewModelDialog(a.app)
		a.modal = modelDialog
	case commands.ThemeListCommand:
		themeDialog := dialog.NewThemeDialog()
		a.modal = themeDialog
	case commands.FileListCommand:
		a.editor.Blur()
		provider := completions.NewFileAndFolderContextGroup(a.app)
		findDialog := dialog.NewFindDialog(provider)
		findDialog.SetWidth(layout.Current.Container.Width - 8)
		a.modal = findDialog
	case commands.FileCloseCommand:
		a.fileViewer, cmd = a.fileViewer.Clear()
		cmds = append(cmds, cmd)
	case commands.FileDiffToggleCommand:
		a.fileViewer, cmd = a.fileViewer.ToggleDiff()
		a.app.State.SplitDiff = a.fileViewer.DiffStyle() == fileviewer.DiffStyleSplit
		a.app.SaveState()
		cmds = append(cmds, cmd)
	case commands.FileSearchCommand:
		return a, nil
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
		updated, cmd := a.messages.First()
		a.messages = updated.(chat.MessagesComponent)
		cmds = append(cmds, cmd)
	case commands.MessagesLastCommand:
		updated, cmd := a.messages.Last()
		a.messages = updated.(chat.MessagesComponent)
		cmds = append(cmds, cmd)
	case commands.MessagesPageUpCommand:
		if a.fileViewer.HasFile() {
			a.fileViewer, cmd = a.fileViewer.PageUp()
			cmds = append(cmds, cmd)
		} else {
			updated, cmd := a.messages.PageUp()
			a.messages = updated.(chat.MessagesComponent)
			cmds = append(cmds, cmd)
		}
	case commands.MessagesPageDownCommand:
		if a.fileViewer.HasFile() {
			a.fileViewer, cmd = a.fileViewer.PageDown()
			cmds = append(cmds, cmd)
		} else {
			updated, cmd := a.messages.PageDown()
			a.messages = updated.(chat.MessagesComponent)
			cmds = append(cmds, cmd)
		}
	case commands.MessagesHalfPageUpCommand:
		if a.fileViewer.HasFile() {
			a.fileViewer, cmd = a.fileViewer.HalfPageUp()
			cmds = append(cmds, cmd)
		} else {
			updated, cmd := a.messages.HalfPageUp()
			a.messages = updated.(chat.MessagesComponent)
			cmds = append(cmds, cmd)
		}
	case commands.MessagesHalfPageDownCommand:
		if a.fileViewer.HasFile() {
			a.fileViewer, cmd = a.fileViewer.HalfPageDown()
			cmds = append(cmds, cmd)
		} else {
			updated, cmd := a.messages.HalfPageDown()
			a.messages = updated.(chat.MessagesComponent)
			cmds = append(cmds, cmd)
		}
	case commands.MessagesPreviousCommand:
		updated, cmd := a.messages.Previous()
		a.messages = updated.(chat.MessagesComponent)
		cmds = append(cmds, cmd)
	case commands.MessagesNextCommand:
		updated, cmd := a.messages.Next()
		a.messages = updated.(chat.MessagesComponent)
		cmds = append(cmds, cmd)
	case commands.MessagesLayoutToggleCommand:
		a.messagesRight = !a.messagesRight
		a.app.State.MessagesRight = a.messagesRight
		a.app.SaveState()
	case commands.MessagesCopyCommand:
		selected := a.messages.Selected()
		if selected != "" {
			cmd = tea.SetClipboard(selected)
			cmds = append(cmds, cmd)
			cmd = toast.NewSuccessToast("Message copied to clipboard")
			cmds = append(cmds, cmd)
		}
	case commands.MessagesRevertCommand:
	case commands.AppExitCommand:
		return a, tea.Quit
	}
	return a, tea.Batch(cmds...)
}

func NewModel(app *app.App) tea.Model {
	commandProvider := completions.NewCommandCompletionProvider(app)
	fileProvider := completions.NewFileAndFolderContextGroup(app)

	messages := chat.NewMessagesComponent(app)
	editor := chat.NewEditorComponent(app)
	completions := dialog.NewCompletionDialogComponent(commandProvider)

	var leaderBinding *key.Binding
	if app.Config.Keybinds.Leader != "" {
		binding := key.NewBinding(key.WithKeys(app.Config.Keybinds.Leader))
		leaderBinding = &binding
	}

	model := &appModel{
		status:               status.NewStatusCmp(app),
		app:                  app,
		editor:               editor,
		messages:             messages,
		completions:          completions,
		commandProvider:      commandProvider,
		fileProvider:         fileProvider,
		leaderBinding:        leaderBinding,
		isLeaderSequence:     false,
		showCompletionDialog: false,
		fileCompletionActive: false,
		toastManager:         toast.NewToastManager(),
		interruptKeyState:    InterruptKeyIdle,
		fileViewer:           fileviewer.New(app),
		messagesRight:        app.State.MessagesRight,
	}

	return model
}
