
# Tech Spec: Export Conversation to Editor

## 1. Overview

This document outlines the technical design for a feature that allows users to export their conversation history to their default editor as a read-only markdown file. This feature is designed to be lightweight and integrate seamlessly with the existing TUI, without requiring significant architectural changes.

## 2. Architecture

The feature will be implemented within the existing TUI architecture, leveraging the current command handling and editor integration patterns. The core logic will reside in the `packages/tui` module, with no changes to the backend or session management.

### Data Flow

1.  User executes the `/history` command in the TUI.
2.  The TUI's command handler for `/history` is invoked.
3.  The handler fetches the complete conversation history from the `app.App` instance.
4.  The conversation is formatted into a markdown string.
5.  A temporary markdown file is created on the local filesystem.
6.  The formatted string is written to the temporary file.
7.  The user's default editor (from `$EDITOR`) is opened with the temporary file.
8.  The temporary file is not read back into the application, ensuring it's effectively read-only.

## 3. Implementation Details

### 3.1. Command Definition

A new command will be added to `packages/tui/internal/commands/command.go`.

-   **Command Name:** `ConversationExportCommand`
-   **Trigger:** `/history`
-   **Description:** "Open conversation history in editor"

```go
// In packages/tui/internal/commands/command.go

const (
    // ... existing commands
    ConversationExportCommand CommandName = "conversation_export"
)

// ...

func LoadFromConfig(config *opencode.Config) CommandRegistry {
    defaults := []Command{
        // ... existing commands
        {
            Name:        ConversationExportCommand,
            Description: "Open conversation history in editor",
            Trigger:     []string{"history"},
        },
    }
    // ...
}
```

### 3.2. Command Handler

The command handler will be implemented in `packages/tui/internal/tui/tui.go` within the `executeCommand` function.

```go
// In packages/tui/internal/tui/tui.go

func (a appModel) executeCommand(command commands.Command) (tea.Model, tea.Cmd) {
    // ...
    switch command.Name {
    // ... existing cases
    case commands.ConversationExportCommand:
        if a.app.Session.ID == "" {
            return a, toast.NewErrorToast("No active session to export.")
        }

        // 1. Fetch conversation history
        messages, err := a.app.ListMessages(context.Background(), a.app.Session.ID)
        if err != nil {
            slog.Error("Failed to list messages for export", "error", err)
            return a, toast.NewErrorToast("Failed to export conversation.")
        }

        // 2. Format to Markdown
        var markdownContent strings.Builder
        for _, msg := range messages {
            // Format each message (see section 3.3)
        }

        // 3. Create and write to temp file
        editor := os.Getenv("EDITOR")
        if editor == "" {
            return a, toast.NewErrorToast("No EDITOR set, can't open editor")
        }

        tmpfile, err := os.CreateTemp("", "conversation-*.md")
        if err != nil {
            // ... error handling
        }
        defer os.Remove(tmpfile.Name()) // Clean up the file afterwards

        _, err = tmpfile.WriteString(markdownContent.String())
        if err != nil {
            // ... error handling
        }
        tmpfile.Close()

        // 4. Open in editor
        c := exec.Command(editor, tmpfile.Name())
        c.Stdin = os.Stdin
        c.Stdout = os.Stdout
        c.Stderr = os.Stderr
        return a, tea.ExecProcess(c, func(err error) tea.Msg {
            if err != nil {
                slog.Error("Failed to open editor for conversation", "error", err)
            }
            return nil // No message needed on editor close
        })
    }
    // ...
}
```

### 3.3. Markdown Formatting

The conversation will be formatted into a markdown string. Each message will be clearly delineated with metadata.

**Example Format:**

```markdown
# Conversation History

---

**User** (*2025-07-15 10:30:00*)

> What is the capital of France?

---

**Assistant** (*2025-07-15 10:30:05*)

> The capital of France is Paris.

---
```

A helper function will be created to format each message type (`UserMessage`, `AssistantMessage`, etc.) into the desired markdown structure. This function will handle timestamps, roles, and message content.

### 3.4. Error Handling

-   **No Active Session:** If there is no active session, a toast notification will inform the user.
-   **$EDITOR Not Set:** If the `EDITOR` environment variable is not set, a toast notification will be shown.
-   **File I/O Errors:** Errors creating or writing to the temporary file will be logged and a toast notification will be shown.
-   **Editor Command Errors:** Errors launching the editor will be logged.

## 4. Testing Strategy

-   **Unit Tests:**
    -   Test the markdown formatting function to ensure it correctly formats different message types.
    -   Test the `ConversationExportCommand` handler logic to verify it calls the correct services and handles errors.
-   **Manual Testing:**
    -   Execute the `/history` command in the TUI.
    -   Verify the editor opens with the correctly formatted conversation history.
    -   Verify the feature handles cases with no active session or no `$EDITOR` set.
    -   Confirm that editing and saving the file in the editor does not affect the application state.

## 5. Dependencies

-   No new external dependencies are required.
-   This feature depends on the existing `app.App` for session data and the `os/exec` package for launching the editor.

## 6. Risks

-   **Platform Compatibility:** The `os/exec` command for opening the editor might behave differently across different operating systems. The current implementation in `EditorOpenCommand` is a good baseline.
-   **Large Conversations:** Very large conversations could consume significant memory when formatting the markdown string. Given the context of a TUI application, this is a low risk.
