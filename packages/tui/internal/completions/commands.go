package completions

import (
	"bufio"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
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

func (c *CommandCompletionProvider) GetEntry() dialog.CompletionItemI {
	return dialog.NewCompletionItem(dialog.CompletionItem{
		Title: "Commands",
		Value: "commands",
	})
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

func getCustomCommandCompletionItem(cmd CustomCommandFile, space int, t theme.Theme) dialog.CompletionItemI {
	spacer := strings.Repeat(" ", space)
	description := cmd.Description
	if description == "" {
		description = "custom command"
	}
	title := "  /" + cmd.Name + styles.NewStyle().Foreground(t.TextMuted()).Render(spacer+description)
	value := "custom:" + cmd.Name
	return dialog.NewCompletionItem(dialog.CompletionItem{
		Title: title,
		Value: value,
	})
}

// parseMarkdownMetadata extracts description from markdown frontmatter or first heading
func parseMarkdownMetadata(filePath string) string {
	file, err := os.Open(filePath)
	if err != nil {
		return ""
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)

	// Check for YAML frontmatter
	if scanner.Scan() {
		firstLine := strings.TrimSpace(scanner.Text())
		if firstLine == "---" {
			// Parse YAML frontmatter
			descriptionRegex := regexp.MustCompile(`(?i)^description:\s*(.+)$`)
			for scanner.Scan() {
				line := strings.TrimSpace(scanner.Text())
				if line == "---" {
					break
				}
				if matches := descriptionRegex.FindStringSubmatch(line); len(matches) > 1 {
					return strings.Trim(matches[1], `"'`)
				}
			}
		} else {
			// Check if first line is a heading and use it as description
			if strings.HasPrefix(firstLine, "#") {
				return strings.TrimSpace(strings.TrimLeft(firstLine, "#"))
			}
		}
	}

	// If no frontmatter, look for first heading
	file.Seek(0, 0)
	scanner = bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(line, "#") {
			return strings.TrimSpace(strings.TrimLeft(line, "#"))
		}
		// Stop at first non-empty, non-comment line
		if line != "" && !strings.HasPrefix(line, "<!--") {
			break
		}
	}

	return ""
}

func (c *CommandCompletionProvider) getCustomCommands() ([]CustomCommandFile, error) {
	commandsDir := filepath.Join(c.app.Info.Path.Config, "commands")

	var commands []CustomCommandFile

	err := filepath.WalkDir(commandsDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			// If the commands directory doesn't exist, just return empty list
			if strings.Contains(err.Error(), "no such file or directory") {
				return nil
			}
			return err
		}

		if d.IsDir() {
			return nil
		}

		if !strings.HasSuffix(d.Name(), ".md") {
			return nil
		}

		name := strings.TrimSuffix(d.Name(), ".md")
		description := parseMarkdownMetadata(path)
		commands = append(commands, CustomCommandFile{
			Name:        name,
			Filename:    d.Name(),
			Content:     "", // We don't need content for completion
			Description: description,
		})

		return nil
	})

	if err != nil {
		return nil, err
	}

	// Sort commands alphabetically
	sort.Slice(commands, func(i, j int) bool {
		return commands[i].Name < commands[j].Name
	})

	return commands, nil
}

func (c *CommandCompletionProvider) GetChildEntries(query string) ([]dialog.CompletionItemI, error) {
	t := theme.CurrentTheme()
	commands := c.app.Commands

	// Get custom commands
	customCommands, err := c.getCustomCommands()
	if err != nil {
		// Log error but continue with built-in commands
		customCommands = []CustomCommandFile{}
	}

	// Calculate spacing for alignment
	space := 1
	for _, cmd := range c.app.Commands {
		if lipgloss.Width(cmd.Trigger) > space {
			space = lipgloss.Width(cmd.Trigger)
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
			if cmd.Trigger == "" {
				continue
			}
			cmdSpace := space - lipgloss.Width(cmd.Trigger)
			items = append(items, getCommandCompletionItem(cmd, cmdSpace, t))
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
		if cmd.Trigger == "" {
			continue
		}
		cmdSpace := space - lipgloss.Width(cmd.Trigger)
		commandNames = append(commandNames, cmd.Trigger)
		commandMap[cmd.Trigger] = getCommandCompletionItem(cmd, cmdSpace, t)
	}

	// Add custom commands
	for _, cmd := range customCommands {
		cmdSpace := space - lipgloss.Width(cmd.Name)
		commandNames = append(commandNames, cmd.Name)
		commandMap[cmd.Name] = getCustomCommandCompletionItem(cmd, cmdSpace, t)
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
