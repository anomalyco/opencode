# feat: Add Intent abstraction for server→client UI interactions

## Summary

This PR introduces a generic **Intent abstraction** that enables the server (tools, plugins, core) to request user input through the TUI. It provides composable UI primitives (form, confirm, select, multiselect, toast) following the existing Permission system's event-based pattern.

**Closes**: #6330 (partial — progress intent deferred)  
**Related**: #5147, #5148, #5958, #5563

## Motivation

Currently, there's no standardized way for tools or plugins to request user input during execution. PRs #5958 and #5563 implemented `askuserquestion` but were TUI-only and tightly coupled. This abstraction:

1. **Enables plugins to request UI input** via the new `ui` helpers on `PluginInput`
2. **Provides composable primitives** that can be combined (e.g., multiselect with "Other" text field)
3. **Follows existing patterns** — mirrors the Permission system's event-based architecture
4. **SDK support** — full SDK regeneration with `intent.respond()` and `intent.list()` methods

## What's Included vs. Issue #6330

| Intent Type | Issue Proposed | This PR | Notes |
|-------------|----------------|---------|-------|
| `form` | ✅ | ✅ | Multi-field with conditional visibility |
| `confirm` | ✅ | ✅ | Variants: info, warning, danger |
| `select` | ✅ (field only) | ✅ | Added as standalone intent too |
| `multiselect` | ✅ (field only) | ✅ | Added as standalone intent too |
| `toast` | ✅ | ✅ | Non-blocking notification |
| `progress` | ✅ | ❌ **Deferred** | See below |

### Why `progress` is Deferred

The issue proposed a progress intent with:
```typescript
{
  type: "progress",
  title: string,
  message?: string,
  value: number (0-100),
  indeterminate: boolean,
  cancellable: boolean,
}
```

**Deferred because the semantics are unclear:**
- How does the server push updates to a running progress indicator?
- Should it use SSE/WebSocket for live updates?
- What's the lifecycle — does the server call `update()` repeatedly?
- How does cancellation flow back to the server?

This likely needs a separate design discussion. The current intent system is request/response, not streaming.

### Naming Differences from Issue

| Issue #6330 Proposed | This PR | Rationale |
|---------------------|---------|-----------|
| `ui-intent` module | `intent` module | Follows opencode's single-word convention |
| `/session/:id/ui-intent/:id` | `/session/:id/intent/:id` | Shorter, consistent |
| `ui.intent.request` event | `intent.updated` event | Matches Permission pattern |
| `ui.intent.response` event | `intent.replied` event | Matches Permission pattern |

### Additions Beyond Issue

1. **Standalone `select` and `multiselect` intents** — Issue only proposed these as form fields. Added as top-level intents for simpler use cases.

2. **Conditional fields** — `condition: { field, equals }` on TextField enables the "select with Other option" pattern mentioned in the proposal.

3. **`cancelAll(sessionID)`** — Utility to cancel all pending intents when a session ends.

### Scope Limitation: TUI Only

This PR implements TUI renderers only. Desktop and Web clients would need their own implementations of the intent dialog component. The core module and SDK are client-agnostic.

---

## Changes

### Core Intent Module (`packages/opencode/src/intent/`)

**`types.ts`** — Zod schemas for 5 intent types:
- `form` — Multi-field input form with conditional field visibility
- `confirm` — Yes/no dialog with info/warning/danger variants
- `select` — Single-choice selection (2-8 options)
- `multiselect` — Multi-choice selection with optional min/max
- `toast` — Non-blocking notification

**`index.ts`** — State management and public API:
- `Intent.request()` — Create pending intent, returns Promise
- `Intent.respond()` — Submit user response
- `Intent.list()` — List pending intents
- `Intent.cancelAll()` — Cancel all intents for a session
- Convenience helpers: `Intent.form()`, `Intent.confirm()`, `Intent.select()`, `Intent.multiselect()`, `Intent.toast()`
- Bus events: `Intent.Event.Updated`, `Intent.Event.Replied`

### Server Endpoints (`packages/opencode/src/server/server.ts`)

- `POST /session/:sessionID/intent/:intentID` — Submit response to pending intent
- `GET /intent` — List all pending intents

### TUI Integration (`packages/opencode/src/cli/cmd/tui/`)

**`component/dialog-intent.tsx`** — Full dialog component with renderers for all intent types:
- `ConfirmDialog` — Left/right arrow navigation, enter to confirm
- `SelectDialog` — Up/down navigation, enter to select
- `MultiSelectDialog` — Space to toggle, enter to submit
- `FormDialog` — Tab between fields, ctrl+enter to submit

**`app.tsx`** — Event subscription:
- Subscribes to `Intent.Event.Updated`
- Shows `DialogIntent` for blocking intents
- Routes toast intents to existing toast system

### SDK (`packages/sdk/`)

Regenerated with:
- `client.intent.respond()` — Submit intent response
- `client.intent.list()` — List pending intents

### Plugin API (`packages/plugin/src/index.ts`)

Added `UIHelpers` type and `ui` property to `PluginInput`:
```typescript
export type UIHelpers = {
  form(ctx, input): Promise<Record<string, any>>
  confirm(ctx, input): Promise<boolean>
  select(ctx, input): Promise<string | undefined>
  multiselect(ctx, input): Promise<string[]>
  toast(ctx, input): Promise<void>
}

export type PluginInput = {
  // ... existing fields
  ui?: UIHelpers  // Available when running with intent support
}
```

### Plugin Wiring (`packages/opencode/src/plugin/index.ts`)

UIHelpers implementation that wraps Intent module:
```typescript
ui: {
  form: (ctx, input) => Intent.form({ ...ctx, ...input, source: "plugin", plugin: name }),
  // ... other helpers
}
```

---

## Usage Examples

### Plugin requesting user confirmation
```typescript
const plugin: Plugin = async ({ ui }) => ({
  tool: {
    dangerous_operation: {
      description: "Does something dangerous",
      parameters: z.object({ path: z.string() }),
      async execute({ parameters, sessionID, messageID }) {
        if (ui) {
          const confirmed = await ui.confirm(
            { sessionID, messageID },
            {
              title: "Confirm Operation",
              message: `This will modify ${parameters.path}. Continue?`,
              variant: "danger",
            }
          )
          if (!confirmed) return { title: "Cancelled", output: "User cancelled" }
        }
        // proceed with operation...
      },
    },
  },
})
```

### Tool with form input
```typescript
const result = await ui.form(
  { sessionID, messageID },
  {
    title: "Configure Database",
    fields: [
      {
        type: "select",
        id: "type",
        label: "Database Type",
        options: [
          { value: "pg", label: "PostgreSQL" },
          { value: "mysql", label: "MySQL" },
          { value: "other", label: "Other" },
        ],
      },
      {
        type: "text",
        id: "custom_type",
        label: "Specify database",
        condition: { field: "type", equals: "other" },  // Only shown when "Other" selected
      },
    ],
  }
)
// result = { type: "pg" } or { type: "other", custom_type: "cockroachdb" }
```

---

## Testing

### Unit Tests

8 unit tests covering:
- Intent creation and response resolution
- Cancel handling
- All 5 intent types (form, confirm, select, multiselect, toast)
- Event emission
- Session-scoped cancellation

```bash
bun test packages/opencode/test/intent/intent.test.ts
```

### Manual Testing

See `MANUAL_TESTING.md` for step-by-step TUI testing instructions.

---

## Design Decisions

1. **Following Permission pattern** — Uses the same event-based architecture with pending state and promise resolution

2. **Composable primitives** — Form fields use the same schemas as standalone intents, enabling composition

3. **Non-blocking toast** — Toast returns immediately and doesn't create pending state

4. **Session-scoped cleanup** — `cancelAll()` clears all pending intents when session ends

5. **Schema limits** — Options capped at 2-8 items, fields at 1-10 to prevent UI overload

6. **Optional `ui` on PluginInput** — Plugins must check `if (ui)` before using, as it may not be available in all contexts (headless mode, non-TUI clients)

---

## Future Work (Not in this PR)

- `progress` primitive — Needs design for streaming updates
- Desktop/Web client renderers
- Rich text/markdown in messages
- File picker intent
- Date/time picker intent

---

## Checklist

- [x] Types defined with Zod schemas
- [x] State management follows Instance pattern
- [x] Bus events for lifecycle
- [x] Server endpoints added
- [x] TUI dialogs implemented
- [x] Keyboard navigation working
- [x] SDK regenerated
- [x] Plugin API extended
- [x] Unit tests passing
- [x] Manual testing guide included
- [x] Documentation in code comments
