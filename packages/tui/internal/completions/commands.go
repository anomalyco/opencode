package completions

import (
	"fmt"
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
	items := []dialog.CompletionItemI{}
	commandNames := []string{}
	commandMap := make(map[string]dialog.CompletionItemI)

	// Add regular commands
	for _, cmd := range sorted {
		if cmd.Trigger == "" {
			continue
		}
		spaceDiff := space - lipgloss.Width(cmd.Trigger)
		item := getCommandCompletionItem(cmd, spaceDiff, t)
		commandNames = append(commandNames, cmd.Trigger)
		commandMap[cmd.Trigger] = item
		
		if query == "" {
			items = append(items, item)
		}
	}

	// Add hotkey quick switches
	if c.app.State.ProviderHotkeys != nil && len(c.app.State.ProviderHotkeys) > 0 {
		// Collect unique hotkey numbers to avoid duplicates
		hotkeyNumbers := make(map[int]bool)
		for _, hotkeyNum := range c.app.State.ProviderHotkeys {
			hotkeyNumbers[hotkeyNum] = true
		}
		
		// Create completion items for each unique hotkey
		for hotkeyNum := range hotkeyNumbers {
			hotkeyTrigger := fmt.Sprintf("%d", hotkeyNum)
			spaceDiff := space - lipgloss.Width(hotkeyTrigger)
			spacer := strings.Repeat(" ", spaceDiff)
			title := "  /" + hotkeyTrigger + styles.NewStyle().Foreground(t.TextMuted()).Render(spacer+"quick switch provider")
			
			item := dialog.NewCompletionItem(dialog.CompletionItem{
				Title: title,
				Value: "provider_quick_switch_" + hotkeyTrigger, // Unique value
			})
			
			commandNames = append(commandNames, hotkeyTrigger)
			commandMap[hotkeyTrigger] = item
			
			if query == "" {
				items = append(items, item)
			}
		}
	}

	if query == "" {
		return items, nil
	}

	// Use fuzzy matching for commands and hotkeys
	matches := fuzzy.RankFind(query, commandNames)

	// Sort by score (best matches first)
	sort.Sort(matches)

	// Convert matches to completion items
	filteredItems := []dialog.CompletionItemI{}
	for _, match := range matches {
		if item, ok := commandMap[match.Target]; ok {
			filteredItems = append(filteredItems, item)
		}
	}
	
	// Also check if query is a direct hotkey match (exact match for numbers)
	if item, ok := commandMap[query]; ok {
		// Check if it's already in the results
		found := false
		for _, existing := range filteredItems {
			if existing.GetValue() == item.GetValue() {
				found = true
				break
			}
		}
		if !found {
			// Add it at the beginning since it's an exact match
			filteredItems = append([]dialog.CompletionItemI{item}, filteredItems...)
		}
	}
	
	// If no matches found and query is all digits, check if any hotkeys exist
	if len(filteredItems) == 0 {
		allDigits := true
		for _, r := range query {
			if r < '0' || r > '9' {
				allDigits = false
				break
			}
		}
		if allDigits && len(query) > 0 && c.app.State.ProviderHotkeys != nil {
			// Check if this number is assigned as a hotkey
			queryNum := 0
			for _, r := range query {
				queryNum = queryNum*10 + int(r-'0')
			}
			
			// See if any provider has this hotkey
			for _, hotkeyNum := range c.app.State.ProviderHotkeys {
				if hotkeyNum == queryNum {
					// Create a completion item for this hotkey
					spaceDiff := space - lipgloss.Width(query)
					spacer := strings.Repeat(" ", spaceDiff)
					title := "  /" + query + styles.NewStyle().Foreground(t.TextMuted()).Render(spacer+"quick switch provider")
					
					item := dialog.NewCompletionItem(dialog.CompletionItem{
						Title: title,
						Value: "provider_quick_switch_" + query,
					})
					
					filteredItems = append(filteredItems, item)
					break
				}
			}
		}
	}
	
	return filteredItems, nil
}
