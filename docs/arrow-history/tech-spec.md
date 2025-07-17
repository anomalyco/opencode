# Tech Spec: Universal Prompt History

## 1. Overview

This document outlines the technical design for a universal prompt history feature, as specified in the [PRD](prd.md). The goal is to implement a persistent, user-specific prompt history that works across all projects and includes support for file attachments.

The existing in-memory history mechanism will be replaced with a robust, file-based storage system.

## 2. Architecture

The new history feature will be built around a central `HistoryStore` component responsible for reading from and writing to a persistent history file. This store will be managed at the application level and accessed by the chat input component.

### Data Flow

1.  **On Prompt Submission:** The chat input component will add the submitted prompt (including any attachments) to the `HistoryStore`.
2.  **On Arrow Key Press:** The chat input component will request the previous/next prompt from the `HistoryStore`.
3.  **On Startup:** The `HistoryStore` will load the history from a file on disk.
4.  **On `/clear-history`:** The `HistoryStore` will clear its in-memory cache and delete the history file.

### File Storage

-   **Location:** The history will be stored in a user-specific configuration directory. A new file, `history.json`, will be created at `~/.config/opencode/history.json`.
-   **Format:** The history will be stored as a JSON array of history entries.

## 3. Data Models

A new data structure will be introduced to represent a history entry, including attachments.

```json
{
  "version": 1,
  "entries": [
    {
      "prompt": "What is the content of @file1.txt and @file2.ts?",
      "attachments": [
        {
          "type": "file",
          "path": "/path/to/file1.txt"
        },
        {
          "type": "file",
          "path": "/path/to/file2.ts"
        }
      ],
      "timestamp": "2025-07-16T10:00:00Z"
    }
  ]
}
```

-   `version`: Schema version for future migrations.
-   `prompt`: The raw text of the prompt.
-   `attachments`: An array of file attachments, storing their absolute paths.
-   `timestamp`: ISO 8601 timestamp of when the prompt was submitted.

## 4. Component Structure

### `history.go` (New)

A new file `packages/tui/internal/history/history.go` will be created to encapsulate all history-related logic.

-   **`HistoryStore` struct:**
    -   `entries`: `[]HistoryEntry` - In-memory cache of the history.
    -   `filePath`: `string` - Path to the `history.json` file.
    -   `maxEntries`: `int` - Maximum number of entries to store.
-   **`NewHistoryStore()`:** Initializes the store, loads history from disk, and enforces `maxEntries`.
-   **`Add(entry HistoryEntry)`:** Adds a new entry, saves to disk, and truncates old entries if the limit is exceeded.
-   **`Get(index int)`:** Retrieves a history entry by index.
-   **`Clear()`:** Clears the in-memory cache and deletes the history file.
-   **`Load()`:** Loads history from the JSON file.
-   **`Save()`:** Saves the current history to the JSON file.

### `app.go` (Modification)

-   The existing `PromptHistory` and `PromptHistoryIndex` fields will be removed.
-   A new field `HistoryStore *history.HistoryStore` will be added.
-   `New()` will be updated to initialize the `HistoryStore`.

### `editor.go` (Modification)

-   The logic for handling up/down arrow keys will be updated to use the `HistoryStore`.
-   When a prompt is submitted, it will be added to the `HistoryStore`.
-   The `/clear-history` command will be implemented to call `HistoryStore.Clear()`.

## 5. Implementation Guide

### Step 1: Create `history.go`

1.  Create the new file `packages/tui/internal/history/history.go`.
2.  Define the `HistoryEntry` and `HistoryFile` structs for JSON serialization.
3.  Implement the `HistoryStore` struct and its methods (`NewHistoryStore`, `Add`, `Get`, `Clear`, `Load`, `Save`).
4.  Ensure file I/O is robust, with proper error handling and file locking to prevent corruption.

### Step 2: Integrate `HistoryStore` into `app.go`

1.  Remove `PromptHistory` and `PromptHistoryIndex` from the `App` struct.
2.  Add the `HistoryStore` field.
3.  In `New()`, determine the user's config directory and initialize the `HistoryStore`.

### Step 3: Update `editor.go`

1.  Modify the `Update` function to handle key presses for history navigation.
2.  Instead of accessing the old `PromptHistory` slice, call `app.HistoryStore.Get()`.
3.  On prompt submission, create a `HistoryEntry` (including parsing attachments from the prompt text) and call `app.HistoryStore.Add()`.
4.  Implement the `/clear-history` command by adding a new case in the command handling logic that calls `app.HistoryStore.Clear()`.

### Step 4: Configuration

1.  Add a new configuration option in `config.go` for `history.maxEntries`, with a default value of 100.
2.  The `HistoryStore` should read this value from the application config.

## 6. Testing Strategy

-   **Unit Tests:**
    -   Create `history_test.go` to test the `HistoryStore` logic (add, clear, load, save, truncation).
    -   Test edge cases like an empty history file, corrupted JSON, and file permission errors.
-   **Integration Tests:**
    -   Update tests in `textarea_test.go` to verify that arrow key navigation correctly cycles through the persistent history.
    -   Add a test for the `/clear-history` command.
    -   Verify that attachments are correctly restored in the prompt input.

## 7. Deployment Considerations

-   **Migration:** Since there is no previous persistent history, no data migration is needed. The feature will start with an empty history.
-   **Backwards Compatibility:** This change is not backwards compatible with the old in-memory history, which is acceptable as the old history was ephemeral.

## 8. Risks and Dependencies

-   **File I/O:** Concurrent access to the history file could be a risk. Basic file locking should be implemented in the `Save` method to mitigate this.
-   **Cross-Platform Compatibility:** The user config directory path needs to be resolved correctly on Windows, macOS, and Linux. Use a library like `os.UserConfigDir()` to handle this.
-   **Dependencies:** No new external dependencies are required.
