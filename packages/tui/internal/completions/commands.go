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

	var commandNames []string
	commandMap := make(map[string]CompletionSuggestion)

	for _, cmd := range sorted {
		if !cmd.HasTrigger() {
			continue
		}
		space := space - lipgloss.Width(cmd.PrimaryTrigger())
		for _, trigger := range cmd.Trigger {
			commandNames = append(commandNames, trigger)
			commandMap[trigger] = c.getCommandCompletionItem(cmd, space)
		}
	}

	matches := fuzzy.RankFindFold(query, commandNames)

	// Custom sort to prioritize exact matches
	sort.Slice(matches, func(i, j int) bool {
		// Check for exact match (case-insensitive)
		iExact := strings.EqualFold(matches[i].Target, query)
		jExact := strings.EqualFold(matches[j].Target, query)

		// Exact matches come first
		if iExact && !jExact {
			return true
		}
		if !iExact && jExact {
			return false
		}

		// Check for prefix match (case-insensitive)
		iPrefix := strings.HasPrefix(strings.ToLower(matches[i].Target), strings.ToLower(query))
		jPrefix := strings.HasPrefix(strings.ToLower(matches[j].Target), strings.ToLower(query))

		// Prefix matches come before fuzzy matches
		if iPrefix && !jPrefix {
			return true
		}
		if !iPrefix && jPrefix {
			return false
		}

		// Otherwise, sort by fuzzy match score (lower distance is better)
		if matches[i].Distance != matches[j].Distance {
			return matches[i].Distance < matches[j].Distance
		}

		// If distances are equal, sort by original index (stable sort)
		return matches[i].OriginalIndex < matches[j].OriginalIndex
	})

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
