package dialog

import (
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/sst/opencode/internal/app"
	commandsComponent "github.com/sst/opencode/internal/components/commands"
	"github.com/sst/opencode/internal/components/modal"
	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/theme"
)

type helpDialog struct {
	width             int
	height            int
	modal             *modal.Modal
	app               *app.App
	commandsComponent commandsComponent.CommandsComponent
}

func (h *helpDialog) Init() tea.Cmd {
	return h.commandsComponent.Init()
}

func (h *helpDialog) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		h.width = msg.Width
		h.height = msg.Height
		h.commandsComponent.SetSize(msg.Width, msg.Height)
	}
	
	_, cmd := h.commandsComponent.Update(msg)
	return h, cmd
}

func (h *helpDialog) View() string {
	t := theme.CurrentTheme()
	h.commandsComponent.SetBackgroundColor(t.BackgroundElement())
	return h.commandsComponent.View()
}

func (h *helpDialog) Render(background string) string {
	return h.modal.Render(h.View(), background)
}

func (h *helpDialog) Close() tea.Cmd {
	return nil
}

type HelpDialog interface {
	layout.Modal
}

func NewHelpDialog(app *app.App) HelpDialog {
	return &helpDialog{
		app:               app,
		commandsComponent: commandsComponent.New(app, commandsComponent.WithBackground(theme.CurrentTheme().BackgroundElement())),
		modal:             modal.New(modal.WithTitle("Help")),
	}
}
