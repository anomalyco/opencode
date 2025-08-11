package tui

import (
	"strings"
	"testing"

	"github.com/sst/opencode/internal/commands"
)

// TestExactCommandMatchingLogic tests the core logic we added to the TUI
// for detecting exact command matches in the completion dialog
func TestExactCommandMatchingLogic(t *testing.T) {
	// Create the command registry as it would be in the real app
	commandRegistry := commands.CommandRegistry{
		commands.AppExitCommand: commands.Command{
			Name:        commands.AppExitCommand,
			Description: "exit the app",
			Trigger:     []string{"exit", "quit", "q"},
		},
		commands.AppHelpCommand: commands.Command{
			Name:        commands.AppHelpCommand,
			Description: "show help",
			Trigger:     []string{"help"},
		},
	}

	testCases := []struct {
		name        string
		typedText   string
		expectMatch bool
		expectedCmd commands.CommandName
	}{
		{
			name:        "exact quit match",
			typedText:   "/quit",
			expectMatch: true,
			expectedCmd: commands.AppExitCommand,
		},
		{
			name:        "exact exit match",
			typedText:   "/exit",
			expectMatch: true,
			expectedCmd: commands.AppExitCommand,
		},
		{
			name:        "exact q match",
			typedText:   "/q",
			expectMatch: true,
			expectedCmd: commands.AppExitCommand,
		},
		{
			name:        "exact help match",
			typedText:   "/help",
			expectMatch: true,
			expectedCmd: commands.AppHelpCommand,
		},
		{
			name:        "partial quit no match",
			typedText:   "/qui",
			expectMatch: false,
		},
		{
			name:        "partial help no match",
			typedText:   "/hel",
			expectMatch: false,
		},
		{
			name:        "non-command text no match",
			typedText:   "/unknown",
			expectMatch: false,
		},
		{
			name:        "text without slash no match",
			typedText:   "quit",
			expectMatch: false,
		},
		{
			name:        "empty text no match",
			typedText:   "",
			expectMatch: false,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// This is the exact logic we added to the TUI for handling completion dialog
			var foundCommand *commands.Command

			if strings.HasPrefix(tc.typedText, "/") {
				commandName := strings.TrimSpace(strings.TrimPrefix(tc.typedText, "/"))

				// Check if this exactly matches a command trigger
				for _, command := range commandRegistry {
					if command.MatchesTrigger(commandName) {
						foundCommand = &command
						break
					}
				}
			}

			if tc.expectMatch {
				if foundCommand == nil {
					t.Fatalf("Expected to find command for '%s', but got none", tc.typedText)
				}
				if foundCommand.Name != tc.expectedCmd {
					t.Fatalf("Expected command '%s', but got '%s'", tc.expectedCmd, foundCommand.Name)
				}
			} else {
				if foundCommand != nil {
					t.Fatalf("Expected no command match for '%s', but found '%s'", tc.typedText, foundCommand.Name)
				}
			}
		})
	}
}

// TestQuitCommandTriggers specifically tests the quit command triggers
func TestQuitCommandTriggers(t *testing.T) {
	exitCommand := commands.Command{
		Name:        commands.AppExitCommand,
		Description: "exit the app",
		Trigger:     []string{"exit", "quit", "q"},
	}

	validTriggers := []string{"exit", "quit", "q"}
	invalidTriggers := []string{"qui", "ex", "EXIT", "QUIT", "Q", "help", ""}

	t.Run("valid triggers", func(t *testing.T) {
		for _, trigger := range validTriggers {
			if !exitCommand.MatchesTrigger(trigger) {
				t.Errorf("Expected trigger '%s' to match exit command", trigger)
			}
		}
	})

	t.Run("invalid triggers", func(t *testing.T) {
		for _, trigger := range invalidTriggers {
			if exitCommand.MatchesTrigger(trigger) {
				t.Errorf("Expected trigger '%s' to NOT match exit command", trigger)
			}
		}
	})
}

// TestCompletionDialogBehavior tests the specific behavior change we implemented
func TestCompletionDialogBehavior(t *testing.T) {
	// Test that demonstrates the fix: exact commands should bypass completion dialog
	testCases := []struct {
		input                string
		completionDialogOpen bool
		shouldBypass         bool
		description          string
	}{
		{
			input:                "/quit",
			completionDialogOpen: true,
			shouldBypass:         true,
			description:          "exact quit command should bypass completion dialog",
		},
		{
			input:                "/qui",
			completionDialogOpen: true,
			shouldBypass:         false,
			description:          "partial command should use completion dialog",
		},
		{
			input:                "/help",
			completionDialogOpen: true,
			shouldBypass:         true,
			description:          "exact help command should bypass completion dialog",
		},
		{
			input:                "/hel",
			completionDialogOpen: true,
			shouldBypass:         false,
			description:          "partial help should use completion dialog",
		},
		{
			input:                "regular text",
			completionDialogOpen: true,
			shouldBypass:         false,
			description:          "non-command text should use completion dialog",
		},
	}

	commandRegistry := commands.CommandRegistry{
		commands.AppExitCommand: commands.Command{
			Name:        commands.AppExitCommand,
			Description: "exit the app",
			Trigger:     []string{"exit", "quit", "q"},
		},
		commands.AppHelpCommand: commands.Command{
			Name:        commands.AppHelpCommand,
			Description: "show help",
			Trigger:     []string{"help"},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.description, func(t *testing.T) {
			if !tc.completionDialogOpen {
				// If completion dialog isn't open, bypass logic doesn't apply
				return
			}

			// Simulate the logic from our TUI fix
			shouldBypass := false
			typedText := strings.TrimSpace(tc.input)

			if strings.HasPrefix(typedText, "/") {
				commandName := strings.TrimSpace(strings.TrimPrefix(typedText, "/"))

				// Check if this exactly matches a command trigger
				for _, command := range commandRegistry {
					if command.MatchesTrigger(commandName) {
						shouldBypass = true
						break
					}
				}
			}

			if shouldBypass != tc.shouldBypass {
				t.Errorf("For input '%s': expected shouldBypass=%v, got %v",
					tc.input, tc.shouldBypass, shouldBypass)
			}
		})
	}
}
