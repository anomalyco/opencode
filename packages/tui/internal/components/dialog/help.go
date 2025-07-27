package dialog

import (
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/sst/opencode/internal/app"
	commandsComponent "github.com/sst/opencode/internal/components/commands"
	"github.com/sst/opencode/internal/components/modal"
	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/viewport"
)

type helpDialog struct {
	width             int
	height            int
	modal             *modal.Modal
	app               *app.App
	commandsComponent commandsComponent.CommandsComponent
	viewport          viewport.Model
}

func (h *helpDialog) Init() tea.Cmd {
	return h.viewport.Init()
}

func (h *helpDialog) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		h.width = msg.Width
		h.height = msg.Height
		// Set viewport size with some padding for the modal, but cap at reasonable width
		maxWidth := min(80, msg.Width-8)
		h.viewport = viewport.New(viewport.WithWidth(maxWidth-4), viewport.WithHeight(msg.Height-6))
		h.commandsComponent.SetSize(maxWidth-4, msg.Height-6)
	}

	// Update viewport content
	h.viewport.SetContent(h.commandsComponent.View())

	// Update viewport
	var vpCmd tea.Cmd
	h.viewport, vpCmd = h.viewport.Update(msg)
	cmds = append(cmds, vpCmd)

	return h, tea.Batch(cmds...)
}

func (h *helpDialog) View() string {
	t := theme.CurrentTheme()
	h.commandsComponent.SetBackgroundColor(t.BackgroundPanel())
	return h.viewport.View()
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
	vp := viewport.New(viewport.WithHeight(12))
	return &helpDialog{
		app: app,
		commandsComponent: commandsComponent.New(app,
			commandsComponent.WithBackground(theme.CurrentTheme().BackgroundPanel()),
			commandsComponent.WithShowAll(true),
			commandsComponent.WithKeybinds(true),
		),
		modal:    modal.New(modal.WithTitle("Help"), modal.WithMaxWidth(80)),
		viewport: vp,
	}
}
