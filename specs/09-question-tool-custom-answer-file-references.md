# File references in “Type your own answer” (tool `question`)

## What changed

In the TUI (planning mode), when the `question` tool shows the **“Type your own answer”** option, you can now insert file references like `@path/to/file` using the same autocomplete behavior as the main prompt input.

This fixes the case where the custom answer input couldn’t (or couldn’t easily) reference files during the question flow.

## How to test / use

1. Start the TUI and enter a flow that triggers the `question` tool (e.g., planning mode).
2. Select **“Type your own answer”** to focus the textarea.
3. Type `@` and start writing a path (e.g., `@README.md`).
4. Use autocomplete:
   - `tab`: selects the highlighted autocomplete item
   - `esc`: closes autocomplete
5. To submit the custom answer:
   - press `enter` again (with autocomplete closed) to confirm/advance, as before.

## Implementation location

- `question` tool UI (TUI): `packages/opencode/src/cli/cmd/tui/routes/session/question.tsx`
