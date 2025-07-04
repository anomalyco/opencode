package commands

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/sst/opencode-sdk-go"
)

type (
	ExecuteCommandMsg  Command
	ExecuteCommandsMsg []Command
	CommandExecutedMsg Command
)

type Keybinding struct {
	RequiresLeader bool
	Key            string
}

func (k Keybinding) Matches(msg tea.KeyPressMsg, leader bool) bool {
	key := k.Key
	key = strings.TrimSpace(key)
	return key == msg.String() && (k.RequiresLeader == leader)
}

type (
	CommandName string
	Command     struct {
		Name        CommandName
		Description string
		Keybindings []Keybinding
		Trigger     string
	}
)

func (c Command) Keys() []string {
	var keys []string
	for _, k := range c.Keybindings {
		keys = append(keys, k.Key)
	}
	return keys
}

type CommandRegistry map[CommandName]Command

func (r CommandRegistry) Sorted() []Command {
	var commands []Command
	for _, command := range r {
		commands = append(commands, command)
	}
	slices.SortFunc(commands, func(a, b Command) int {
		if a.Name == AppExitCommand {
			return 1
		}
		if b.Name == AppExitCommand {
			return -1
		}
		return strings.Compare(string(a.Name), string(b.Name))
	})
	return commands
}

func (r CommandRegistry) Matches(msg tea.KeyPressMsg, leader bool) []Command {
	var matched []Command
	for _, command := range r.Sorted() {
		if command.Matches(msg, leader) {
			matched = append(matched, command)
		}
	}
	return matched
}

const (
	AppHelpCommand              CommandName = "app_help"
	EditorOpenCommand           CommandName = "editor_open"
	SessionNewCommand           CommandName = "session_new"
	SessionListCommand          CommandName = "session_list"
	SessionShareCommand         CommandName = "session_share"
	SessionInterruptCommand     CommandName = "session_interrupt"
	SessionCompactCommand       CommandName = "session_compact"
	ToolDetailsCommand          CommandName = "tool_details"
	ModelListCommand            CommandName = "model_list"
	ThemeListCommand            CommandName = "theme_list"
	ProjectInitCommand          CommandName = "project_init"
	InputClearCommand           CommandName = "input_clear"
	InputPasteCommand           CommandName = "input_paste"
	InputSubmitCommand          CommandName = "input_submit"
	InputNewlineCommand         CommandName = "input_newline"
	HistoryPreviousCommand      CommandName = "history_previous"
	HistoryNextCommand          CommandName = "history_next"
	MessagesPageUpCommand       CommandName = "messages_page_up"
	MessagesPageDownCommand     CommandName = "messages_page_down"
	MessagesHalfPageUpCommand   CommandName = "messages_half_page_up"
	MessagesHalfPageDownCommand CommandName = "messages_half_page_down"
	MessagesPreviousCommand     CommandName = "messages_previous"
	MessagesNextCommand         CommandName = "messages_next"
	MessagesFirstCommand        CommandName = "messages_first"
	MessagesLastCommand         CommandName = "messages_last"
	AppExitCommand              CommandName = "app_exit"
)

var defaults = []Command{
	{
		Name:        AppHelpCommand,
		Description: "show help",
		Keybindings: parseBindings("<leader>h"),
		Trigger:     "help",
	},
	{
		Name:        EditorOpenCommand,
		Description: "open editor",
		Keybindings: parseBindings("<leader>e"),
		Trigger:     "editor",
	},
	{
		Name:        SessionNewCommand,
		Description: "new session",
		Keybindings: parseBindings("<leader>n"),
		Trigger:     "new",
	},
	{
		Name:        SessionListCommand,
		Description: "list sessions",
		Keybindings: parseBindings("<leader>l"),
		Trigger:     "sessions",
	},
	{
		Name:        SessionShareCommand,
		Description: "share session",
		Keybindings: parseBindings("<leader>s"),
		Trigger:     "share",
	},
	{
		Name:        SessionInterruptCommand,
		Description: "interrupt session",
		Keybindings: parseBindings("esc"),
	},
	{
		Name:        SessionCompactCommand,
		Description: "compact the session",
		Keybindings: parseBindings("<leader>c"),
		Trigger:     "compact",
	},
	{
		Name:        ToolDetailsCommand,
		Description: "toggle tool details",
		Keybindings: parseBindings("<leader>d"),
		Trigger:     "details",
	},
	{
		Name:        ModelListCommand,
		Description: "list models",
		Keybindings: parseBindings("<leader>m"),
		Trigger:     "models",
	},
	{
		Name:        ThemeListCommand,
		Description: "list themes",
		Keybindings: parseBindings("<leader>t"),
		Trigger:     "themes",
	},
	{
		Name:        ProjectInitCommand,
		Description: "create/update AGENTS.md",
		Keybindings: parseBindings("<leader>i"),
		Trigger:     "init",
	},
	{
		Name:        InputClearCommand,
		Description: "clear input",
		Keybindings: parseBindings("ctrl+c"),
	},
	{
		Name:        InputPasteCommand,
		Description: "paste content",
		Keybindings: parseBindings("ctrl+v"),
	},
	{
		Name:        InputSubmitCommand,
		Description: "submit message",
		Keybindings: parseBindings("enter"),
	},
	{
		Name:        InputNewlineCommand,
		Description: "insert newline",
		Keybindings: parseBindings("shift+enter", "ctrl+j"),
	},
	// {
	// 	Name:        HistoryPreviousCommand,
	// 	Description: "previous prompt",
	// 	Keybindings: parseBindings("up"),
	// },
	// {
	// 	Name:        HistoryNextCommand,
	// 	Description: "next prompt",
	// 	Keybindings: parseBindings("down"),
	// },
	{
		Name:        MessagesPageUpCommand,
		Description: "page up",
		Keybindings: parseBindings("pgup"),
	},
	{
		Name:        MessagesPageDownCommand,
		Description: "page down",
		Keybindings: parseBindings("pgdown"),
	},
	{
		Name:        MessagesHalfPageUpCommand,
		Description: "half page up",
		Keybindings: parseBindings("ctrl+alt+u"),
	},
	{
		Name:        MessagesHalfPageDownCommand,
		Description: "half page down",
		Keybindings: parseBindings("ctrl+alt+d"),
	},
	{
		Name:        MessagesPreviousCommand,
		Description: "previous message",
		Keybindings: parseBindings("ctrl+alt+k"),
	},
	{
		Name:        MessagesNextCommand,
		Description: "next message",
		Keybindings: parseBindings("ctrl+alt+j"),
	},
	{
		Name:        MessagesFirstCommand,
		Description: "first message",
		Keybindings: parseBindings("ctrl+g"),
	},
	{
		Name:        MessagesLastCommand,
		Description: "last message",
		Keybindings: parseBindings("ctrl+alt+g"),
	},
	{
		Name:        AppExitCommand,
		Description: "exit the app",
		Keybindings: parseBindings("ctrl+c", "<leader>q"),
		Trigger:     "exit",
	},
}

func (k Command) Matches(msg tea.KeyPressMsg, leader bool) bool {
	for _, binding := range k.Keybindings {
		if binding.Matches(msg, leader) {
			return true
		}
	}
	return false
}

func parseBindings(bindings ...string) []Keybinding {
	var parsedBindings []Keybinding
	for _, binding := range bindings {
		for p := range strings.SplitSeq(binding, ",") {
			requireLeader := strings.HasPrefix(p, "<leader>")
			keybinding := strings.ReplaceAll(p, "<leader>", "")
			keybinding = strings.TrimSpace(keybinding)
			parsedBindings = append(parsedBindings, Keybinding{
				RequiresLeader: requireLeader,
				Key:            keybinding,
			})
		}
	}
	return parsedBindings
}

// IsBuiltinCommand checks if a command name matches any of the built-in command triggers
func IsBuiltinCommand(commandName string) bool {
	for _, command := range defaults {
		if command.Trigger == commandName {
			return true
		}
	}
	return false
}

// IsValidCustomCommand checks if a custom command exists in the filesystem
func IsValidCustomCommand(commandName string, configPath string) bool {
	// Convert colon notation to file path
	filePath := strings.ReplaceAll(commandName, ":", string(filepath.Separator)) + ".md"

	// Try project-level commands first ($PWD/.opencode/commands)
	if cwd, err := os.Getwd(); err == nil {
		projectCommandsDir := filepath.Join(cwd, ".opencode", "commands")
		projectCommandFile := filepath.Join(projectCommandsDir, filePath)
		if _, err := os.Stat(projectCommandFile); err == nil {
			return true
		}
	}

	// Try global commands (~/.config/opencode/commands)
	globalCommandsDir := filepath.Join(configPath, "commands")
	globalCommandFile := filepath.Join(globalCommandsDir, filePath)
	if _, err := os.Stat(globalCommandFile); err == nil {
		return true
	}

	return false
}

// IsValidCustomCommandWithClient checks if a custom command exists via server or filesystem
func IsValidCustomCommandWithClient(commandName string, configPath string, client *CommandsClient) bool {
	// Try server first if client is available
	if client != nil {
		ctx := context.Background()
		exists, err := client.CustomCommandExists(ctx, commandName)
		if err == nil {
			return exists
		}
	}

	// Fallback to local filesystem check
	return IsValidCustomCommand(commandName, configPath)
}

func LoadFromConfig(config *opencode.Config) CommandRegistry {
	registry := make(CommandRegistry)
	keybinds := map[string]string{}
	marshalled, _ := json.Marshal(config.Keybinds)
	json.Unmarshal(marshalled, &keybinds)
	for _, command := range defaults {
		if keybind, ok := keybinds[string(command.Name)]; ok && keybind != "" {
			command.Keybindings = parseBindings(keybind)
		}
		registry[command.Name] = command
	}
	return registry
}
