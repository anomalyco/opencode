# Feature: Export Conversation to Editor for Easy Selection

## Overview & Goals

Users want a fast, lightweight way to select and copy text from the entire conversation history in the opencode TUI. The solution should open the conversation in the user’s editor, formatted in markdown, including message metadata and clear distinctions between user, assistant, and system messages. This feature is for convenience and should not require significant architectural changes or support editing/saving back to the conversation.

## User Stories

### 1. As a user, I want to open the entire conversation history in my editor so that I can easily select and copy any part of the conversation.

**Acceptance Criteria:**

- A command is available in the TUI to open the conversation history in the user’s default editor.
- The entire conversation history is included, not just the visible portion.
- The conversation is formatted in markdown, with:
  - Clear visual distinction between user, assistant, and system messages (e.g., headings, blockquotes, or code blocks).
  - Metadata (timestamps, message types) included for each message.
- The file is opened as read-only or, if edited, changes are not saved back to the conversation.
- The feature does not require significant changes to the existing architecture.

### 2. As a user, I want the exported conversation to be easy to read and navigate in my editor.

**Acceptance Criteria:**

- Each message is clearly separated and labeled.
- Markdown formatting is used to improve readability (e.g., bold for usernames, italics for timestamps, blockquotes for messages).
- The formatting is consistent throughout the file.

### 3. As a user, I want to access this feature in a way that is consistent with opencode’s existing TUI command patterns.

**Acceptance Criteria:**

- The command to trigger this feature follows opencode’s conventions for similar actions (e.g., `/editor`).
- The command is discoverable and documented in the help system.
- The command name and usage are consistent with other TUI commands (e.g., `/conversation`, `/history`, or a flag to `/editor` if that is the established pattern).

## Success Metrics

- Users can open the conversation in their editor with a single command.
- Users report that the markdown formatting is clear and helpful for selection/copying.
- No user reports of accidental edits being saved back to the conversation.
- The feature is adopted and used by at least 20% of active TUI users within the first month.

## Out of Scope

- Editing and saving changes back to the conversation.
- Exporting only a portion or a filtered view of the conversation.
- Exporting in formats other than markdown.
- Any changes to the underlying conversation storage or architecture.

---

## Next Steps

- Review opencode’s TUI command patterns to determine the best command name and integration point.
- Design markdown formatting for message types and metadata.
- Implement and test the feature for usability and reliability.

---

If you have preferences for the command name or want to see example markdown formatting, let me know! Otherwise, I recommend reviewing the `/editor` and related command patterns to finalize the user-facing interface.
