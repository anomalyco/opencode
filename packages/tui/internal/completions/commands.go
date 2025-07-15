package completions

import (
	"sort"
	"strings"

	"github.com/charmbracelet/lipgloss/v2"
	"github.com/lithammer/fuzzysearch/fuzzy"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/commands"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
)

type CommandCompletionProvider struct {
	app *app.App
}

func NewCommandCompletionProvider(app *app.App) CompletionProvider {
	return &CommandCompletionProvider{app: app}
}

func (c *CommandCompletionProvider) GetId() string {
	return "commands"
}

func (c *CommandCompletionProvider) GetEmptyMessage() string {
	return "no matching commands"
}

func (c *CommandCompletionProvider) getCommandCompletionItem(
	cmd commands.Command,
	space int,
) CompletionSuggestion {
	displayFunc := func(s styles.Style) string {
		t := theme.CurrentTheme()
		spacer := strings.Repeat(" ", space)
		display := "  /" + cmd.PrimaryTrigger() + s.
			Foreground(t.TextMuted()).
			Render(spacer+cmd.Description)
		return display
	}

	value := string(cmd.Name)
	return CompletionSuggestion{
		Display:    displayFunc,
		Value:      value,
		ProviderID: c.GetId(),
		RawData:    cmd,
	}
}

func (c *CommandCompletionProvider) GetChildEntries(
	query string,
) ([]CompletionSuggestion, error) {
	commands := c.app.Commands

	space := 1
	for _, cmd := range c.app.Commands {
		if cmd.HasTrigger() && lipgloss.Width(cmd.PrimaryTrigger()) > space {
			space = lipgloss.Width(cmd.PrimaryTrigger())
		}
	}
	space += 2

	sorted := commands.Sorted()
	if query == "" {
		// If no query, return all commands
		items := []CompletionSuggestion{}
		for _, cmd := range sorted {
			if !cmd.HasTrigger() {
				continue
			}
			space := space - lipgloss.Width(cmd.PrimaryTrigger())
			items = append(items, c.getCommandCompletionItem(cmd, space))
		}
		return items, nil
	}

	// Use fuzzy matching for commands
	var commandNames []string
	commandMap := make(map[string]CompletionSuggestion)

	for _, cmd := range sorted {
		if !cmd.HasTrigger() {
			continue
		}
		space := space - lipgloss.Width(cmd.PrimaryTrigger())
		// Add all triggers as searchable options
		for _, trigger := range cmd.Trigger {
			commandNames = append(commandNames, trigger)
			commandMap[trigger] = c.getCommandCompletionItem(cmd, space)
		}
	}

	// Find fuzzy matches
	matches := fuzzy.RankFindFold(query, commandNames)

	// Sort by score (best matches first)
	sort.Sort(matches)

	// Convert matches to completion items, deduplicating by command name
	items := []CompletionSuggestion{}
	seen := make(map[string]bool)
	for _, match := range matches {
		if item, ok := commandMap[match.Target]; ok {
			// Use the command's value (name) as the deduplication key
			if !seen[item.Value] {
				seen[item.Value] = true
				items = append(items, item)
			}
		}
	}
	return items, nil
}
