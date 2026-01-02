# Plan: Add AskUserQuestion Tool to OpenCode

directory: /tmp/opencode-investigation

## Overview

Add Claude Code's `AskUserQuestion` tool to opencode, enabling Claude to ask users structured questions with options during conversations. The UI and behavior must exactly match Claude Code's implementation.

## Interview Summary

| Decision | Answer |
|----------|--------|
| Contribution target | Upstream PR via fork (github.com/cs50victor/opencode) |
| Blocking behavior | Yes, like permissions - user must answer before Claude continues |
| Multi-question layout | Sequential wizard with horizontal tab bar showing progress |
| Multi-select interaction | Number keys (1-4) to toggle options |
| "Other" option | Always present as last option, reveals text input when selected |
| Schema validation | Match Claude Code exactly |
| Provider scope | Claude only |
| Testing | Match existing opencode patterns |

## UI Requirements (from Claude Code screenshots)

```
┌─────────────────────────────────────────────────────────────────┐
│ ← ☑ Question 1  ☑ Question 2  ☐ Question 3  ✓ Submit  →        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ How should multiple questions (1-4) be presented in the TUI?   │
│                                                                 │
│   1. Sequential wizard                                          │
│      One question at a time, next/back navigation               │
│                                                                 │
│   2. All at once                                                │
│      Show all questions in a scrollable list                    │
│                                                                 │
│ ❯ 3. Accordion                                                  │
│      Expandable sections, one active at a time                  │
│                                                                 │
│   4. Other...                                                   │
│      [text input appears here when selected]                    │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ Enter to select · Tab/Arrow keys to navigate · Esc to cancel    │
└─────────────────────────────────────────────────────────────────┘
```

Final review screen shows all answers before submit.

## Architecture

Mirrors the existing `PermissionNext` pattern:

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ AskUserTool  │────▶│ AskUserNext  │────▶│   Server     │
│  (execute)   │     │  (ask/reply) │     │  (endpoints) │
└──────────────┘     └──────────────┘     └──────────────┘
                            │                     │
                            ▼                     ▼
                     ┌──────────────┐     ┌──────────────┐
                     │  Bus Events  │────▶│  TUI Sync    │
                     │ asked/replied│     │  Context     │
                     └──────────────┘     └──────────────┘
                                                 │
                                                 ▼
                                          ┌──────────────┐
                                          │ Questionnaire│
                                          │  Component   │
                                          └──────────────┘
```

## Implementation Steps

### Phase 1: Backend Core

**1.1 Create AskUser state management**
- File: `packages/opencode/src/askuser/index.ts` (new)
- Mirror `PermissionNext` pattern from `packages/opencode/src/permission/next.ts`
- Define schemas: `AskUserRequest`, `AskUserReply`
- Implement `ask()` - publishes event, awaits response
- Implement `reply()` - resolves pending request

**1.2 Create AskUserQuestion tool**
- File: `packages/opencode/src/tool/askuser.ts` (new)
- Schema matching Claude Code:
```typescript
parameters: z.object({
  questions: z.array(z.object({
    question: z.string(),
    header: z.string().max(12),
    options: z.array(z.object({
      label: z.string(),
      description: z.string(),
    })).min(2).max(4),
    multiSelect: z.boolean(),
  })).min(1).max(4),
})
```
- Execute blocks until user responds via `AskUserNext.ask()`

**1.3 Register tool**
- File: `packages/opencode/src/tool/registry.ts`
- Add to tool registry (Claude provider only)

### Phase 2: Server & SDK

**2.1 Add server endpoints**
- File: `packages/opencode/src/server/server.ts`
- `POST /askuser/:requestID/reply` - submit user response
- `GET /askuser` - list pending requests (for sync)

**2.2 Add bus events**
- File: `packages/opencode/src/bus/bus-event.ts` (if not auto-generated)
- `askuser.asked` - emitted when tool calls ask()
- `askuser.replied` - emitted when user submits

**2.3 Update SDK types**
- Files in `packages/sdk/js/src/v2/gen/`
- Add `AskUserRequest`, event types
- Add `sdk.client.askuser.reply()` method
- May be auto-generated from OpenAPI spec

### Phase 3: TUI Components

**3.1 Update sync context**
- File: `packages/opencode/src/cli/cmd/tui/context/sync.ts`
- Track pending askuser requests: `sync.data.askuser[sessionID]`

**3.2 Create Questionnaire component**
- File: `packages/opencode/src/cli/cmd/tui/routes/session/askuser.tsx` (new)
- Components:
  - `QuestionnairePrompt` - main container
  - `QuestionTabs` - horizontal progress bar
  - `QuestionView` - single question with options
  - `OptionList` - numbered options with descriptions
  - `OtherInput` - conditional text input
  - `ReviewScreen` - summary before submit

**3.3 Wire into session view**
- File: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
- Add `<Match when={props.part.tool === "askuserquestion"}>` in `ToolPart`
- Show questionnaire when tool state is "running"
- Show summary when "completed"

### Phase 4: Keyboard Navigation

**4.1 Navigation handlers**
- Tab/Arrow: move between questions (horizontal tabs)
- Up/Down: navigate options within question
- Number keys (1-4): select/toggle option directly
- Enter: confirm selection, advance to next question
- Esc: cancel (with confirmation?)
- On last question, Enter shows review screen
- On review screen, Enter submits all answers

**4.2 Multi-select mode**
- Number keys toggle selection state
- Visual checkboxes instead of radio buttons
- Enter confirms and advances (not toggles)

### Phase 5: Testing

Match existing opencode patterns - check `packages/opencode/src/**/*.test.ts`:

**5.1 Unit tests**
- `askuser/index.test.ts` - state management
- `tool/askuser.test.ts` - tool execution

**5.2 Integration tests**
- Server endpoint tests
- Event flow tests

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `packages/opencode/src/askuser/index.ts` | Create | State management (ask/reply) |
| `packages/opencode/src/tool/askuser.ts` | Create | Tool definition |
| `packages/opencode/src/tool/registry.ts` | Modify | Register tool |
| `packages/opencode/src/server/server.ts` | Modify | Add endpoints |
| `packages/opencode/src/cli/cmd/tui/routes/session/askuser.tsx` | Create | TUI components |
| `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` | Modify | Wire tool renderer |
| `packages/opencode/src/cli/cmd/tui/context/sync.ts` | Modify | Track pending requests |
| `packages/sdk/js/src/v2/gen/*.ts` | Modify | SDK types (may be generated) |

## Reference Files

Study these existing implementations:
- `packages/opencode/src/permission/next.ts` - async request/reply pattern
- `packages/opencode/src/cli/cmd/tui/routes/session/permission.tsx` - interactive prompt UI
- `packages/opencode/src/tool/todo.ts` - tool with UI state

## Open Questions

None - all requirements clarified during interview.

## Next Steps

1. Clone fork locally: `git clone https://github.com/cs50victor/opencode`
2. Set up development environment
3. Implement Phase 1 (backend core)
4. Test tool execution manually
5. Implement Phases 2-4 incrementally
6. Add tests matching existing patterns
7. Submit PR to sst/opencode
