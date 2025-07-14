package completions

import (
	"context"
	"fmt"
	"log/slog"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/charmbracelet/lipgloss/v2"
	"github.com/lithammer/fuzzysearch/fuzzy"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/commands"
	"github.com/sst/opencode/internal/components/dialog"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
)

type CustomCommandFile struct {
	Name        string `json:"name"`
	Filename    string `json:"filename"`
	Content     string `json:"content"`
	Description string `json:"description"`
}

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

func (c *CommandCompletionProvider) getCommandCompletionItem(
	cmd commands.Command,
	space int,
	t theme.Theme,
) dialog.CompletionItemI {
	spacer := strings.Repeat(" ", space)
	title := "  /" + cmd.PrimaryTrigger() + styles.NewStyle().
		Foreground(t.TextMuted()).
		Render(spacer+cmd.Description)
	value := string(cmd.Name)
	return dialog.NewCompletionItem(dialog.CompletionItem{
		Title:      title,
		Value:      value,
		ProviderID: c.GetId(),
	}, dialog.WithBackgroundColor(t.BackgroundElement()))
}

func getCustomCommandCompletionItem(cmd CustomCommandFile, space int, t theme.Theme) dialog.CompletionItemI {
	spacer := strings.Repeat(" ", space)
	description := cmd.Description
	if description == "" {
		description = "custom command"
	}
	title := "  /" + cmd.Name + styles.NewStyle().Foreground(t.TextMuted()).Render(spacer+description)
	value := "/" + cmd.Name
	return dialog.NewCompletionItem(dialog.CompletionItem{
		Title: title,
		Value: value,
	})
}

func (c *CommandCompletionProvider) getCustomCommands() ([]CustomCommandFile, error) {
	// Get commands from server endpoint
	ctx := context.Background()
	serverCommands, err := c.app.CommandsClient.ListCustomCommands(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get commands from server: %w", err)
	}

	slog.Debug("Server commands:" + strconv.Itoa(len(serverCommands)))

	// Convert server commands to local format
	var commands []CustomCommandFile
	for _, cmd := range serverCommands {
		description := ""
		if cmd.Description != nil {
			description = *cmd.Description
		}
		commands = append(commands, CustomCommandFile{
			Name:        cmd.Name,
			Description: description,
			Filename:    filepath.Base(cmd.FilePath),
			Content:     cmd.Content,
		})
	}

	// Sort commands alphabetically
	sort.Slice(commands, func(i, j int) bool {
		return commands[i].Name < commands[j].Name
	})

	return commands, nil
}

func (c *CommandCompletionProvider) GetChildEntries(
	query string,
) ([]dialog.CompletionItemI, error) {
	t := theme.CurrentTheme()
	commands := c.app.Commands

	// Get custom commands
	customCommands, err := c.getCustomCommands()
	if err != nil {
		// If server is not available, return only built-in commands
		customCommands = []CustomCommandFile{}
	}

	// Calculate spacing for alignment
	space := 1
	for _, cmd := range c.app.Commands {
		if cmd.HasTrigger() && lipgloss.Width(cmd.PrimaryTrigger()) > space {
			space = lipgloss.Width(cmd.PrimaryTrigger())
		}
	}
	for _, cmd := range customCommands {
		if lipgloss.Width(cmd.Name) > space {
			space = lipgloss.Width(cmd.Name)
		}
	}
	space += 2

	sorted := commands.Sorted()
	if query == "" {
		// If no query, return all commands (built-in + custom)
		items := []dialog.CompletionItemI{}

		// Add built-in commands
		for _, cmd := range sorted {
			if !cmd.HasTrigger() {
				continue
			}
			cmdSpace := space - lipgloss.Width(cmd.PrimaryTrigger())
			items = append(items, c.getCommandCompletionItem(cmd, cmdSpace, t))
		}

		// Add custom commands
		for _, cmd := range customCommands {
			cmdSpace := space - lipgloss.Width(cmd.Name)
			items = append(items, getCustomCommandCompletionItem(cmd, cmdSpace, t))
		}

		return items, nil
	}

	// Use fuzzy matching for commands
	var commandNames []string
	commandMap := make(map[string]dialog.CompletionItemI)

	// Add built-in commands
	for _, cmd := range sorted {
		if !cmd.HasTrigger() {
			continue
		}

		cmdSpace := space - lipgloss.Width(cmd.PrimaryTrigger())
		for _, trigger := range cmd.Trigger {
			commandNames = append(commandNames, trigger)
			commandMap[trigger] = c.getCommandCompletionItem(cmd, cmdSpace, t)
		}
	}

	// Add custom commands
	for _, cmd := range customCommands {
		cmdSpace := space - lipgloss.Width(cmd.Name)
		commandNames = append(commandNames, cmd.Name)
		commandMap[cmd.Name] = getCustomCommandCompletionItem(cmd, cmdSpace, t)
	}

	// Find fuzzy matches
	matches := fuzzy.RankFindFold(query, commandNames)

	// Sort by score (best matches first)
	sort.Sort(matches)

	// Convert matches to completion items, deduplicating by command name
	items := []dialog.CompletionItemI{}
	seen := make(map[string]bool)
	for _, match := range matches {
		if item, ok := commandMap[match.Target]; ok {
			// Use the command's value (name) as the deduplication key
			if !seen[item.GetValue()] {
				seen[item.GetValue()] = true
				items = append(items, item)
			}
		}
	}
	return items, nil
}
