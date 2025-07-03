package completions

import (
	"sort"
	"strings"

	"github.com/charmbracelet/lipgloss/v2"
	"github.com/lithammer/fuzzysearch/fuzzy"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/commands"
	"github.com/sst/opencode/internal/components/dialog"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
)

type CommandCompletionProvider struct {
	app *app.App
}

func NewCommandCompletionProvider(app *app.App) dialog.CompletionProvider {
	return &CommandCompletionProvider{app: app}
}

func (c *CommandCompletionProvider) GetId() string {
	return "commands"
}

func (c *CommandCompletionProvider) GetEmptyMessage() string {
	return "no matching commands"
}

func getCommandCompletionItem(cmd commands.Command, space int, t theme.Theme) dialog.CompletionItemI {
	spacer := strings.Repeat(" ", space)
	title := "  /" + cmd.Trigger + styles.NewStyle().Foreground(t.TextMuted()).Render(spacer+cmd.Description)
	value := string(cmd.Name)
	return dialog.NewCompletionItem(dialog.CompletionItem{
		Title: title,
		Value: value,
	})
}

func (c *CommandCompletionProvider) GetChildEntries(query string) ([]dialog.CompletionItemI, error) {
	t := theme.CurrentTheme()
	commands := c.app.Commands

	space := 1
	for _, cmd := range c.app.Commands {
		if lipgloss.Width(cmd.Trigger) > space {
			space = lipgloss.Width(cmd.Trigger)
		}
	}
	space += 2

	sorted := commands.Sorted()
	if query == "" {
		// If no query, return all commands
		items := []dialog.CompletionItemI{}
		for _, cmd := range sorted {
			if cmd.Trigger == "" {
				continue
			}
			space := space - lipgloss.Width(cmd.Trigger)
			items = append(items, getCommandCompletionItem(cmd, space, t))
		}
		return items, nil
	}

	// Use fuzzy matching for commands
	var commandNames []string
	commandMap := make(map[string]dialog.CompletionItemI)

	for _, cmd := range sorted {
		if cmd.Trigger == "" {
			continue
		}
		space := space - lipgloss.Width(cmd.Trigger)
		commandNames = append(commandNames, cmd.Trigger)
		commandMap[cmd.Trigger] = getCommandCompletionItem(cmd, space, t)
	}

	// Find fuzzy matches
	matches := fuzzy.RankFind(query, commandNames)

	// Sort by score (best matches first)
	sort.Sort(matches)

	// Convert matches to completion items
	items := []dialog.CompletionItemI{}
	for _, match := range matches {
		if item, ok := commandMap[match.Target]; ok {
			items = append(items, item)
		}
	}
	return items, nil
}
