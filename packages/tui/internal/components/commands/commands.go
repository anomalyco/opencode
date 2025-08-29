package commands

import (
	"fmt"
	"runtime"
	"strings"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/charmbracelet/lipgloss/v2/compat"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/commands"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
)

type CommandsComponent interface {
	tea.ViewModel
	SetSize(width, height int) tea.Cmd
	SetBackgroundColor(color compat.AdaptiveColor)
}

type commandsComponent struct {
	app           *app.App
	width, height int
	showKeybinds  bool
	showAll       bool
	showVscode    bool
	background    *compat.AdaptiveColor
	limit         *int
}

func (c *commandsComponent) SetSize(width, height int) tea.Cmd {
	c.width = width
	c.height = height
	return nil
}

func (c *commandsComponent) SetBackgroundColor(color compat.AdaptiveColor) {
	c.background = &color
}

func (c *commandsComponent) View() string {
	t := theme.CurrentTheme()

	triggerStyle := styles.NewStyle().Foreground(t.Primary()).Bold(true)
	descriptionStyle := styles.NewStyle().Foreground(t.Text())
	keybindStyle := styles.NewStyle().Foreground(t.TextMuted())

	if c.background != nil {
		triggerStyle = triggerStyle.Background(*c.background)
		descriptionStyle = descriptionStyle.Background(*c.background)
		keybindStyle = keybindStyle.Background(*c.background)
	}

	var commandsToShow []commands.Command
	var triggeredCommands []commands.Command
	var untriggeredCommands []commands.Command

	for _, cmd := range c.app.Commands.Sorted() {
		if c.showAll || cmd.HasTrigger() {
			if cmd.HasTrigger() {
				triggeredCommands = append(triggeredCommands, cmd)
			} else if c.showAll {
				untriggeredCommands = append(untriggeredCommands, cmd)
			}
		}
	}

	// Combine triggered commands first, then untriggered
	commandsToShow = append(commandsToShow, triggeredCommands...)
	commandsToShow = append(commandsToShow, untriggeredCommands...)

	if c.limit != nil && len(commandsToShow) > *c.limit {
		commandsToShow = commandsToShow[:*c.limit]
	}

	if c.showVscode {
		ctrlKey := "ctrl"
		if runtime.GOOS == "darwin" {
			ctrlKey = "cmd"
		}
		commandsToShow = append(commandsToShow,
			// empty line
			// commands.Command{
			// 	Name:        "",
			// 	Description: "",
			// },
			commands.Command{
				Name:        commands.CommandName(util.Ide()),
				Description: "open opencode",
				Keybindings: []commands.Keybinding{
					{Key: ctrlKey + "+esc", RequiresLeader: false},
				},
			},
			commands.Command{
				Name:        commands.CommandName(util.Ide()),
				Description: "reference file",
				Keybindings: []commands.Keybinding{
					{Key: ctrlKey + "+opt+k", RequiresLeader: false},
				},
			},
		)
	}

	if len(commandsToShow) == 0 {
		muted := styles.NewStyle().Foreground(theme.CurrentTheme().TextMuted())
		if c.showAll {
			return muted.Render("No commands available")
		}
		return muted.Render("No commands with triggers available")
	}

	// Calculate column widths
	maxTriggerWidth := 0
	maxDescriptionWidth := 0
	maxKeybindWidth := 0

	// Prepare command data
	type commandRow struct {
		trigger     string
		description string
		keybinds    string
	}

	rows := make([]commandRow, 0, len(commandsToShow))

	for _, cmd := range commandsToShow {
		trigger := ""
		if cmd.HasTrigger() {
			trigger = "/" + cmd.PrimaryTrigger()
		} else {
			trigger = string(cmd.Name)
		}
		description := cmd.Description

		// Format keybindings
		var keybindStrs []string
		if c.showKeybinds {
			for _, kb := range cmd.Keybindings {
				if kb.RequiresLeader {
					keybindStrs = append(keybindStrs, c.app.Config.Keybinds.Leader+" "+kb.Key)
				} else {
					keybindStrs = append(keybindStrs, kb.Key)
				}
			}
		}
		keybinds := strings.Join(keybindStrs, ", ")

		rows = append(rows, commandRow{
			trigger:     trigger,
			description: description,
			keybinds:    keybinds,
		})

		// Update max widths
		if len(trigger) > maxTriggerWidth {
			maxTriggerWidth = len(trigger)
		}
		if len(description) > maxDescriptionWidth {
			maxDescriptionWidth = len(description)
		}
		if len(keybinds) > maxKeybindWidth {
			maxKeybindWidth = len(keybinds)
		}
	}

	// Add padding between columns
	columnPadding := 3

	// Build the output
	var output strings.Builder

	maxWidth := 0
	for _, row := range rows {
		// Pad each column to align properly
		trigger := fmt.Sprintf("%-*s", maxTriggerWidth, row.trigger)
		description := fmt.Sprintf("%-*s", maxDescriptionWidth, row.description)

		// Apply styles and combine
		line := triggerStyle.Render(trigger) +
			triggerStyle.Render(strings.Repeat(" ", columnPadding)) +
			descriptionStyle.Render(description)

		if c.showKeybinds && row.keybinds != "" {
			line += keybindStyle.Render(strings.Repeat(" ", columnPadding)) +
				keybindStyle.Render(row.keybinds)
		}

		output.WriteString(line + "\n")
		maxWidth = max(maxWidth, lipgloss.Width(line))
	}

	// Remove trailing newline
	result := strings.TrimSuffix(output.String(), "\n")
	if c.background != nil {
		result = styles.NewStyle().Background(*c.background).Width(maxWidth).Render(result)
	}

	return result
}

type Option func(*commandsComponent)

func WithKeybinds(show bool) Option {
	return func(c *commandsComponent) {
		c.showKeybinds = show
	}
}

func WithBackground(background compat.AdaptiveColor) Option {
	return func(c *commandsComponent) {
		c.background = &background
	}
}

func WithLimit(limit int) Option {
	return func(c *commandsComponent) {
		c.limit = &limit
	}
}

func WithShowAll(showAll bool) Option {
	return func(c *commandsComponent) {
		c.showAll = showAll
	}
}

func WithVscode(showVscode bool) Option {
	return func(c *commandsComponent) {
		c.showVscode = showVscode
	}
}

func New(app *app.App, opts ...Option) CommandsComponent {
	c := &commandsComponent{
		app:          app,
		background:   nil,
		showKeybinds: true,
		showAll:      false,
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}
