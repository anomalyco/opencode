# Universal Prompt History: Implementation Tasks

This document breaks down the [Technical Specification](tech-spec.md) into a detailed, actionable to-do list for an engineering agent.

## Task 1: Create the `HistoryStore` Component

**Goal:** Implement the core logic for managing persistent prompt history.

- [x] **1.1: Create the `history` package and file**
  - [x] Create a new directory: `packages/tui/internal/history`
  - [x] Create a new file within it: `history.go`

- [x] **1.2: Define Data Structures**
  - [x] In `history.go`, define the `Attachment` struct: `type Attachment struct { Type string `json:"type"`; Path string `json:"path"` }`
  - [x] Define the `HistoryEntry` struct: `type HistoryEntry struct { Prompt string `json:"prompt"`; Attachments []Attachment `json:"attachments"`; Timestamp time.Time `json:"timestamp"` }`
  - [x] Define the `HistoryFile` struct for the top-level JSON object: `type HistoryFile struct { Version int `json:"version"`; Entries []HistoryEntry `json:"entries"` }`

- [x] **1.3: Implement the `HistoryStore` struct**
  - [x] Define the `HistoryStore` struct: `type HistoryStore struct { entries []HistoryEntry; filePath string; maxEntries int; mu sync.Mutex }` (include `sync.Mutex` for thread safety).

- [x] **1.4: Implement `NewHistoryStore` function**
  - [x] Create `func NewHistoryStore(filePath string, maxEntries int) (*HistoryStore, error)`.
  - [x] Inside, initialize the `HistoryStore` struct.
  - [x] Call a `load()` method to populate the history from disk.
  - [x] Return the new store instance.

- [x] **1.5: Implement `load()` method**
  - [x] Create `func (s *HistoryStore) load() error`.
  - [x] This method should be un-exported (lowercase `l`).
  - [x] Lock the mutex: `s.mu.Lock()` and defer unlock `s.mu.Unlock()`.
  - [x] Read the file at `s.filePath`.
  - [x] If the file doesn't exist, do nothing and return `nil`.
  - [x] If it exists, unmarshal the JSON into a `HistoryFile` struct.
  - [x] Populate `s.entries` with the loaded entries.
  - [x] Handle potential JSON parsing errors gracefully.

- [x] **1.6: Implement `save()` method**
  - [x] Create `func (s *HistoryStore) save() error`.
  - [x] This method should be un-exported (lowercase `s`).
  - [x] Lock the mutex: `s.mu.Lock()` and defer unlock `s.mu.Unlock()`.
  - [x] Create a `HistoryFile` struct with the current version and `s.entries`.
  - [x] Marshal the struct to JSON with indentation for readability.
  - [x] Write the JSON data to `s.filePath`, creating the directory if it doesn't exist.

- [x] **1.7: Implement `Add()` method**
  - [x] Create `func (s *HistoryStore) Add(entry HistoryEntry)`.
  - [x] Append the new entry to `s.entries`.
  - [x] If `len(s.entries) > s.maxEntries`, truncate the slice to keep only the newest `s.maxEntries` items.
  - [x] Call `s.save()` to persist the changes.

- [x] **1.8: Implement `Clear()` method**
  - [x] Create `func (s *HistoryStore) Clear() error`.
  - [x] Clear the `s.entries` slice.
  - [x] Call `s.save()` to write the empty state to disk.
  - [x] As a safeguard, also attempt to `os.Remove(s.filePath)` and ignore any "not found" errors.

- [x] **1.9: Implement `Entries()` method**
  - [x] Create `func (s *HistoryStore) Entries() []HistoryEntry`.
  - [x] This method will return a copy of the `s.entries` slice to prevent direct modification from outside the store.

## Task 2: Integrate `HistoryStore` into the Application

**Goal:** Replace the old in-memory history with the new persistent store.

- [x] **2.1: Update `config.go`**
  - [x] In `packages/tui/internal/config/config.go`, add a `History` struct to the `Config`.
  - [x] Add `MaxEntries int `json:"maxEntries,omitempty"`` to the `History` struct.
  - [x] Set a default value of `100` for `MaxEntries` in the default config.

- [x] **2.2: Update `app.go`**
  - [x] In `packages/tui/internal/app/app.go`, remove the `PromptHistory []string` and `PromptHistoryIndex int` fields from the `App` struct.
  - [x] Add a new field: `HistoryStore *history.HistoryStore`.

- [x] **2.3: Update `app.New()` constructor**
  - [x] In `app.New()`, get the user's config directory using `os.UserConfigDir()`.
  - [x] Construct the full path to `history.json` (e.g., `filepath.Join(configDir, "opencode", "history.json")`).
  - [x] Get `maxEntries` from the app config.
  - [x] Call `history.NewHistoryStore()` to initialize the store.
  - [x] Assign the new store to `a.HistoryStore`.
  - [x] Handle any errors during initialization.

## Task 3: Update UI Components

**Goal:** Connect the user interface to the new history store for navigation and submission.

- [x] **3.1: Update `chat/editor.go` for prompt submission**
  - [x] In the prompt submission logic (likely in the `Update` method), when a message is sent:
  - [x] Create a new `history.HistoryEntry`.
  - [x] Set the `Prompt` field to the submitted text.
  - [x] **(Stretch Goal)** Parse the text for `@file` references and populate the `Attachments` slice.
  - [x] Set the `Timestamp` to `time.Now()`.
  - [x] Call `m.app.HistoryStore.Add(entry)`.

- [x] **3.2: Update `textarea.go` for history navigation**
  - [x] In `packages/tui/internal/components/textarea/textarea.go`, modify `SetHistory` to accept `[]history.HistoryEntry`.
  - [x] Update the `history` field in the `Model` to be of type `[]history.HistoryEntry`.
  - [x] In `navigateHistoryUp` and `navigateHistoryDown`, when setting the value with `m.SetValue`, use the `Prompt` field from the `history` entry (e.g., `m.history[m.historyIndex].Prompt`).

- [x] **3.3: Connect `editor.go` to `textarea.go`**
  - [x] In `chat/editor.go`, where the textarea is initialized or updated, call `m.textarea.SetHistory(m.app.HistoryStore.Entries())` to populate the textarea's history.

- [x] **3.4: Implement `/clear-history` command**
  - [x] In `chat/editor.go` (or wherever commands are handled), add a new command: `/clear-history`.
  - [x] When triggered, it should call `m.app.HistoryStore.Clear()`.
  - [x] After clearing, it should also call `m.textarea.SetHistory(m.app.HistoryStore.Entries())` to update the UI with the now-empty history.
  - [x] Display a confirmation message to the user (e.g., "Prompt history cleared.").

## Task 4: Testing

**Goal:** Ensure the new feature is reliable and bug-free.

- [x] **4.1: Create `history_test.go`**
  - [x] Create a new test file: `packages/tui/internal/history/history_test.go`.
  - [x] Write a unit test for `TestHistoryStore_Add` to verify entries are added correctly.
  - [x] Write a unit test for `TestHistoryStore_Truncation` to ensure the history doesn't grow past `maxEntries`.
  - [x] Write a unit test for `TestHistoryStore_Persistence` that adds entries, creates a new store instance from the same file, and verifies the entries were loaded correctly.
  - [x] Write a unit test for `TestHistoryStore_Clear` to confirm the file is emptied/deleted and the in-memory store is cleared.

- [x] **4.2: Update UI Integration Tests**
  - [x] In `packages/tui/internal/components/textarea/textarea_test.go`, update existing history navigation tests to work with the new data structures.
  - [ ] Add a new integration test to simulate a user typing `/clear-history` and verify the history is subsequently empty.
