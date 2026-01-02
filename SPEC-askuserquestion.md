# SPEC: AskUserQuestion Tool for OpenCode

## Summary

Add Claude Code's `AskUserQuestion` tool to opencode, enabling Claude to ask users structured questions with selectable options during conversations. The implementation must exactly match Claude Code's UI and behavior.

## Requirements

### Functional Requirements

1. **Tool Schema** - Match Claude Code exactly:
   - 1-4 questions per invocation
   - Each question has: `question` (string), `header` (max 12 chars), `options` (2-4 items), `multiSelect` (boolean)
   - Each option has: `label` (string), `description` (string)
   - Always include implicit "Other" option for free-text input

2. **Blocking Behavior** - Tool execution blocks until user responds (like permission prompts)

3. **Provider Scope** - Claude only (not available for other LLM providers)

### UI Requirements

```
┌─────────────────────────────────────────────────────────────────┐
│ ← [x] Q1 Header  [x] Q2 Header  [ ] Q3 Header  [v] Submit  →   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Question text goes here?                                        │
│                                                                 │
│   1. Option label                                               │
│      Option description                                         │
│                                                                 │
│   2. Option label                                               │
│      Option description                                         │
│                                                                 │
│ > 3. Option label                                               │
│      Option description                                         │
│                                                                 │
│   4. Other...                                                   │
│      [text input when selected]                                 │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ Enter to select · Tab/Arrow keys to navigate · Esc to cancel    │
└─────────────────────────────────────────────────────────────────┘
```

### Keyboard Navigation

| Key | Action |
|-----|--------|
| Tab/Left/Right | Navigate between question tabs |
| Up/Down | Navigate options within question |
| 1-4 | Select option directly (toggle in multi-select mode) |
| Enter | Confirm selection, advance to next question |
| Esc | Cancel questionnaire |

### Flow

1. Question tabs shown horizontally at top with progress checkmarks
2. User answers questions sequentially (one at a time)
3. Enter confirms answer and advances to next question
4. After last question, review screen shows all answers
5. Final Enter submits all answers to tool

### Multi-select Mode

- Number keys toggle selection state (not single-select)
- Visual checkboxes instead of radio buttons
- Enter confirms current selections and advances

### "Other" Option

- Always present as last numbered option
- When selected, reveals text input field inline
- User types custom response, Enter confirms

## Architecture

Mirror the existing `PermissionNext` pattern:

```
AskUserTool.execute()
    |
    v
AskUserNext.ask() -----> Bus.publish("askuser.asked")
    |                            |
    | (awaits)                   v
    |                    TUI receives event
    |                            |
    |                    QuestionnairePrompt renders
    |                            |
    |                    User interacts
    |                            |
    v                            v
AskUserNext.reply() <--- sdk.client.askuser.reply()
    |
    v
Tool returns with user responses
```

## Files to Create

| File | Purpose |
|------|---------|
| `packages/opencode/src/askuser/index.ts` | State management (ask/reply pattern) |
| `packages/opencode/src/tool/askuser.ts` | Tool definition and schema |
| `packages/opencode/src/cli/cmd/tui/routes/session/askuser.tsx` | TUI questionnaire components |

## Files to Modify

| File | Changes |
|------|---------|
| `packages/opencode/src/tool/registry.ts` | Register AskUserQuestion tool |
| `packages/opencode/src/server/server.ts` | Add `/askuser/:id/reply` endpoint |
| `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` | Wire tool renderer |
| `packages/opencode/src/cli/cmd/tui/context/sync.ts` | Track pending requests |

## Reference Implementations

Study these files for patterns:
- `packages/opencode/src/permission/next.ts` - async request/reply
- `packages/opencode/src/cli/cmd/tui/routes/session/permission.tsx` - interactive prompt UI
- `packages/opencode/src/tool/todo.ts` - tool with UI state

## Testing

Match existing opencode test patterns:
- Unit tests for state management
- Unit tests for tool execution
- Integration tests for server endpoints
- Integration tests for event flow

## Implementation Phases

### Phase 1: Backend Core
- Create `askuser/index.ts` with ask/reply state management
- Create `tool/askuser.ts` with tool definition
- Register in tool registry

### Phase 2: Server & SDK
- Add server endpoints for reply submission
- Add bus events (askuser.asked, askuser.replied)
- Update SDK types

### Phase 3: TUI Components
- Create questionnaire components
- Wire into session view
- Update sync context

### Phase 4: Keyboard Navigation
- Implement all keyboard handlers
- Multi-select toggle behavior
- "Other" text input handling

### Phase 5: Testing
- Add tests matching existing patterns
