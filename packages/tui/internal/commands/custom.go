package commands

import (
	"context"
	"fmt"
	"strings"
	"sync"

	opencode "github.com/sst/opencode-sdk-go"
)

type CustomCommand struct {
	Name         string `json:"name"`
	Description  string `json:"description"`
	ArgumentHint string `json:"argumentHint"`
	Scope        string `json:"scope"` // "project" or "user"
	Namespace    string `json:"namespace"`
}

type CustomCommandHandler struct {
	client   *opencode.Client
	commands []CustomCommand
	mu       sync.RWMutex
}

func NewCustomCommandHandler(client *opencode.Client) *CustomCommandHandler {
	return &CustomCommandHandler{
		client: client,
	}
}

func (h *CustomCommandHandler) LoadCommands(ctx context.Context) error {
	// Call the /command endpoint
	var result struct {
		Commands []CustomCommand `json:"commands"`
	}

	err := h.client.Get(ctx, "/command", nil, &result)
	if err != nil {
		return fmt.Errorf("failed to load custom commands: %w", err)
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	h.commands = result.Commands

	return nil
}

func (h *CustomCommandHandler) GetCommands() []CustomCommand {
	h.mu.RLock()
	defer h.mu.RUnlock()

	return append([]CustomCommand{}, h.commands...)
}

func (h *CustomCommandHandler) Execute(
	ctx context.Context,
	name string,
	args string,
	sessionID string,
	messageID string,
) error {
	body := map[string]interface{}{
		"name":      name,
		"arguments": args,
		"sessionId": sessionID,
		"messageId": messageID,
	}

	var result struct {
		Success bool   `json:"success"`
		Output  string `json:"output"`
		Error   string `json:"error"`
	}

	err := h.client.Post(ctx, "/command/execute", body, &result)
	if err != nil {
		return fmt.Errorf("failed to execute command: %w", err)
	}

	if !result.Success {
		return fmt.Errorf("command execution failed: %s", result.Error)
	}

	return nil
}

// Convert custom commands to registry commands
func (h *CustomCommandHandler) ToRegistryCommands() []Command {
	commands := h.GetCommands()
	result := make([]Command, 0, len(commands))

	for _, cmd := range commands {
		// Format description with scope indicator
		description := cmd.Description
		if description == "" {
			description = fmt.Sprintf("Custom %s command", cmd.Name)
		}
		description = fmt.Sprintf("%s (%s)", description, cmd.Scope)

		// Build trigger list
		triggers := []string{cmd.Name}

		result = append(result, Command{
			Name:        CommandName(fmt.Sprintf("custom_%s", strings.ReplaceAll(cmd.Name, ":", "_"))),
			Description: description,
			Trigger:     triggers,
		})
	}

	return result
}

// Check if a command is custom
func IsCustomCommand(name CommandName) bool {
	return strings.HasPrefix(string(name), "custom_")
}

// Get the original custom command name from a CommandName
func GetCustomCommandName(name CommandName) string {
	if !IsCustomCommand(name) {
		return ""
	}
	// Remove "custom_" prefix and replace underscores back to colons
	customName := strings.TrimPrefix(string(name), "custom_")
	return strings.ReplaceAll(customName, "_", ":")
}
