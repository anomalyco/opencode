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
		Trigger     []string
	}
)

func (c Command) Keys() []string {
	var keys []string
	for _, k := range c.Keybindings {
		keys = append(keys, k.Key)
	}
	return keys
}

func (c Command) HasTrigger() bool {
	return len(c.Trigger) > 0
}

func (c Command) PrimaryTrigger() string {
	if len(c.Trigger) > 0 {
		return c.Trigger[0]
	}
	return ""
}

func (c Command) MatchesTrigger(trigger string) bool {
	return slices.Contains(c.Trigger, trigger)
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
	SwitchModeCommand           CommandName = "switch_mode"
	EditorOpenCommand           CommandName = "editor_open"
	SessionNewCommand           CommandName = "session_new"
	SessionListCommand          CommandName = "session_list"
	SessionShareCommand         CommandName = "session_share"
	SessionUnshareCommand       CommandName = "session_unshare"
	SessionInterruptCommand     CommandName = "session_interrupt"
	SessionCompactCommand       CommandName = "session_compact"
	ToolDetailsCommand          CommandName = "tool_details"
	ModelListCommand            CommandName = "model_list"
	ThemeListCommand            CommandName = "theme_list"
	FileListCommand             CommandName = "file_list"
	FileCloseCommand            CommandName = "file_close"
	FileSearchCommand           CommandName = "file_search"
	FileDiffToggleCommand       CommandName = "file_diff_toggle"
	ProjectInitCommand          CommandName = "project_init"
	InputClearCommand           CommandName = "input_clear"
	InputPasteCommand           CommandName = "input_paste"
	InputSubmitCommand          CommandName = "input_submit"
	InputNewlineCommand         CommandName = "input_newline"
	MessagesPageUpCommand       CommandName = "messages_page_up"
	MessagesPageDownCommand     CommandName = "messages_page_down"
	MessagesHalfPageUpCommand   CommandName = "messages_half_page_up"
	MessagesHalfPageDownCommand CommandName = "messages_half_page_down"
	MessagesPreviousCommand     CommandName = "messages_previous"
	MessagesNextCommand         CommandName = "messages_next"
	MessagesFirstCommand        CommandName = "messages_first"
	MessagesLastCommand         CommandName = "messages_last"
	MessagesLayoutToggleCommand CommandName = "messages_layout_toggle"
	MessagesCopyCommand         CommandName = "messages_copy"
	MessagesRevertCommand       CommandName = "messages_revert"
	AppExitCommand              CommandName = "app_exit"
)

var defaults = []Command{
	{
		Name:        AppHelpCommand,
		Description: "show help",
		Keybindings: parseBindings("<leader>h"),
		Trigger:     []string{"help"},
	},
	{
		Name:        SwitchModeCommand,
		Description: "switch mode",
		Keybindings: parseBindings("tab"),
	},
	{
		Name:        EditorOpenCommand,
		Description: "open editor",
		Keybindings: parseBindings("<leader>e"),
		Trigger:     []string{"editor"},
	},
	{
		Name:        SessionNewCommand,
		Description: "new session",
		Keybindings: parseBindings("<leader>n"),
		Trigger:     []string{"new", "clear"},
	},
	{
		Name:        SessionListCommand,
		Description: "list sessions",
		Keybindings: parseBindings("<leader>l"),
		Trigger:     []string{"sessions", "resume", "continue"},
	},
	{
		Name:        SessionShareCommand,
		Description: "share session",
		Keybindings: parseBindings("<leader>s"),
		Trigger:     []string{"share"},
	},
	{
		Name:        SessionUnshareCommand,
		Description: "unshare session",
		Keybindings: parseBindings("<leader>u"),
		Trigger:     []string{"unshare"},
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
		Trigger:     []string{"compact", "summarize"},
	},
	{
		Name:        ToolDetailsCommand,
		Description: "toggle tool details",
		Keybindings: parseBindings("<leader>d"),
		Trigger:     []string{"details"},
	},
	{
		Name:        ModelListCommand,
		Description: "list models",
		Keybindings: parseBindings("<leader>m"),
		Trigger:     []string{"models"},
	},
	{
		Name:        ThemeListCommand,
		Description: "list themes",
		Keybindings: parseBindings("<leader>t"),
		Trigger:     []string{"themes"},
	},
	{
		Name:        FileListCommand,
		Description: "list files",
		Keybindings: parseBindings("<leader>f"),
		Trigger:     []string{"files"},
	},
	{
		Name:        FileCloseCommand,
		Description: "close file",
		Keybindings: parseBindings("esc"),
	},
	{
		Name:        FileSearchCommand,
		Description: "search file",
		Keybindings: parseBindings("<leader>/"),
	},
	{
		Name:        FileDiffToggleCommand,
		Description: "split/unified diff",
		Keybindings: parseBindings("<leader>v"),
	},
	{
		Name:        ProjectInitCommand,
		Description: "create/update AGENTS.md",
		Keybindings: parseBindings("<leader>i"),
		Trigger:     []string{"init"},
	},
	{
		Name:        InputClearCommand,
		Description: "clear input",
		Keybindings: parseBindings("ctrl+c"),
	},
	{
		Name:        InputPasteCommand,
		Description: "paste content",
		Keybindings: parseBindings("ctrl+v", "super+v"),
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
		Keybindings: parseBindings("ctrl+up"),
	},
	{
		Name:        MessagesNextCommand,
		Description: "next message",
		Keybindings: parseBindings("ctrl+down"),
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
		Name:        MessagesLayoutToggleCommand,
		Description: "toggle layout",
		Keybindings: parseBindings("<leader>p"),
	},
	{
		Name:        MessagesCopyCommand,
		Description: "copy message",
		Keybindings: parseBindings("<leader>y"),
	},
	{
		Name:        MessagesRevertCommand,
		Description: "revert message",
		Keybindings: parseBindings("<leader>r"),
	},
	{
		Name:        AppExitCommand,
		Description: "exit the app",
		Keybindings: parseBindings("ctrl+c", "<leader>q"),
		Trigger:     []string{"exit", "quit"},
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
		if slices.Contains(command.Trigger, commandName) {
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

// IsValidCustomCommandWithClient checks if a custom command exists via server
func IsValidCustomCommandWithClient(commandName string, configPath string, client *CommandsClient) bool {
	// Use server endpoint if client is available
	if client != nil {
		ctx := context.Background()
		exists, err := client.CustomCommandExists(ctx, commandName)
		if err == nil {
			return exists
		}
	}

	// Return false if server is not available or returns an error
	return false
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
