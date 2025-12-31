# Manual Testing Guide for Intent System

This guide helps reviewers test the Intent abstraction in the TUI.

> **Note**: This file will be removed before merging.

## Prerequisites

```bash
# Install dependencies
bun install

# Build all packages
bun run build
```

## Quick Test: Unit Tests

```bash
bun test packages/opencode/test/intent/intent.test.ts
```

Expected: 8 tests passing.

---

## TUI Testing

### Start the TUI

```bash
bun run dev
# Or directly:
bun packages/opencode/src/cli/cmd/index.ts
```

### Test 1: Confirm Intent

Have the agent trigger a confirmation dialog by asking it to use a dangerous operation or by directly testing:

**Prompt the agent:**
```
Use a tool that asks me for confirmation before proceeding
```

**Expected behavior:**
1. A dialog appears with title and message
2. Two buttons: "Yes" / "No" (or custom labels)
3. Left/Right arrows switch between buttons
4. Enter confirms the highlighted option
5. Escape cancels

**Keyboard shortcuts:**
- `←` / `→` — Navigate between buttons
- `Enter` — Confirm selection
- `Escape` — Cancel dialog

---

### Test 2: Select Intent

**Prompt the agent:**
```
Ask me to choose a programming language from: TypeScript, Python, Go, Rust
```

**Expected behavior:**
1. A dialog appears with title and options list
2. One option highlighted at a time
3. Up/Down arrows navigate
4. Enter selects the highlighted option

**Keyboard shortcuts:**
- `↑` / `↓` — Navigate options
- `Enter` — Select option
- `Escape` — Cancel

---

### Test 3: Multiselect Intent

**Prompt the agent:**
```
Ask me to select multiple features to enable from: logging, caching, metrics, auth
```

**Expected behavior:**
1. A dialog appears with checkboxes
2. Space toggles selection on current item
3. Multiple items can be selected
4. Enter submits all selected items

**Keyboard shortcuts:**
- `↑` / `↓` — Navigate options
- `Space` — Toggle selection
- `Enter` — Submit selected items
- `Escape` — Cancel

---

### Test 4: Form Intent

**Prompt the agent:**
```
Ask me for my name, email, and preferred language (select from TypeScript, Python, or Other with a text field)
```

**Expected behavior:**
1. A dialog with multiple fields appears
2. Tab moves between fields
3. For select fields: arrows change selection
4. For text fields: typing works as expected
5. Conditional field (e.g., "Other" text input) appears only when relevant option selected
6. Ctrl+Enter submits the form

**Keyboard shortcuts:**
- `Tab` — Next field
- `Shift+Tab` — Previous field
- `↑` / `↓` — For select fields within form
- `Ctrl+Enter` — Submit form
- `Escape` — Cancel

---

### Test 5: Toast Intent

**Prompt the agent:**
```
Show me a success notification saying "Build completed!"
```

**Expected behavior:**
1. A toast notification appears (non-blocking)
2. The toast auto-dismisses after duration (default 5s)
3. The agent continues immediately (doesn't wait for user)

---

### Test 6: Cancel Behavior

For any blocking intent (confirm, select, multiselect, form):

1. Press `Escape` while dialog is open
2. **Expected**: Dialog closes, agent receives cancellation
3. Agent should handle gracefully (not crash, report cancelled)

---

### Test 7: Timeout Behavior

This requires modifying test code or using a plugin with timeout:

```typescript
// In a tool, request with timeout
const response = await Intent.confirm({
  sessionID,
  messageID,
  title: "Quick decision",
  message: "You have 10 seconds",
  timeout: 10000, // 10 seconds
})
```

**Expected**: After 10 seconds without response, the intent times out and throws `IntentTimeoutError`.

---

## API Testing

### List Pending Intents

While a dialog is open (before responding):

```bash
curl http://localhost:3000/intent
```

**Expected**: JSON array with the pending intent info.

### Respond to Intent via API

```bash
# Get intent ID from the list endpoint
curl -X POST http://localhost:3000/session/{sessionID}/intent/{intentID} \
  -H "Content-Type: application/json" \
  -d '{"type": "submit", "data": {"selected": "typescript"}}'
```

**Expected**: Dialog closes, agent receives the response.

---

## Plugin Testing

To test the plugin UIHelpers, create a test plugin:

```typescript
// test-plugin.ts
import type { Plugin } from "@opencode-ai/plugin"

export default (async ({ ui }) => {
  return {
    tool: {
      test_intent: {
        description: "Test the intent system",
        parameters: z.object({ type: z.enum(["confirm", "select", "form"]) }),
        async execute({ parameters, sessionID, messageID }) {
          if (!ui) {
            return { output: "UI not available" }
          }

          if (parameters.type === "confirm") {
            const result = await ui.confirm(
              { sessionID, messageID },
              { title: "Test", message: "Confirm?", variant: "warning" }
            )
            return { output: `Confirmed: ${result}` }
          }

          if (parameters.type === "select") {
            const result = await ui.select(
              { sessionID, messageID },
              {
                title: "Pick one",
                options: [
                  { value: "a", label: "Option A" },
                  { value: "b", label: "Option B" },
                ],
              }
            )
            return { output: `Selected: ${result}` }
          }

          if (parameters.type === "form") {
            const result = await ui.form(
              { sessionID, messageID },
              {
                title: "Enter details",
                fields: [
                  { type: "text", id: "name", label: "Name" },
                  {
                    type: "select",
                    id: "color",
                    label: "Favorite color",
                    options: [
                      { value: "red", label: "Red" },
                      { value: "blue", label: "Blue" },
                    ],
                  },
                ],
              }
            )
            return { output: `Form data: ${JSON.stringify(result)}` }
          }

          return { output: "Unknown type" }
        },
      },
    },
  }
}) satisfies Plugin
```

---

## Common Issues

### Dialog doesn't appear

1. Check that `app.tsx` is subscribed to `Intent.Event.Updated`
2. Check console for errors
3. Verify the intent was created (check `/intent` endpoint)

### Keyboard navigation not working

1. Ensure dialog has focus
2. Check for conflicting key bindings in TUI

### Form conditional fields not showing

1. Verify the `condition` object has correct `field` and `equals` values
2. The field ID in `condition.field` must match another field's `id`

### Toast not disappearing

1. Check the `duration` value (0 = persistent)
2. Verify toast component has auto-dismiss logic

---

## Test Matrix

| Intent Type | Create | Cancel | Submit | Timeout | Keyboard Nav |
|-------------|--------|--------|--------|---------|--------------|
| confirm | ☐ | ☐ | ☐ | ☐ | ☐ |
| select | ☐ | ☐ | ☐ | ☐ | ☐ |
| multiselect | ☐ | ☐ | ☐ | ☐ | ☐ |
| form | ☐ | ☐ | ☐ | ☐ | ☐ |
| toast | ☐ | N/A | N/A | N/A | N/A |

Check each box as you verify functionality.
