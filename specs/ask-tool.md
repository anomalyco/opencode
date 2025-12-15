# AskUserQuestion Feature Implementation Plan

## Overview

This document outlines the implementation plan for adding an `ask` tool to OpenCode, allowing Claude to ask users questions during a session rather than making assumptions. This is inspired by Claude Code's AskUserQuestion feature but implemented in the "OpenCode way" using dialogs and the existing TUI architecture.

## Feature Summary

The `ask` tool enables Claude to:

- Ask single or multiple questions in one tool call
- Support different question types (select, multi-select, confirm, text)
- Mark recommended options
- Receive user answers with optional comments for additional context

## Design

### Question Types

| Type           | Description                      | UI Component              |
| -------------- | -------------------------------- | ------------------------- |
| `select`       | Single selection from options    | DialogQuestionSelect      |
| `multi-select` | Multiple selections from options | DialogQuestionMultiSelect |
| `confirm`      | Yes/No question                  | DialogQuestionConfirm     |
| `text`         | Free-form text input             | DialogQuestionText        |

### Multi-Question Flow

When multiple questions are asked, users see a list view:

```
┌─────────────────────────────────────────────┐
│ Questions (2/3 answered)                esc │
├─────────────────────────────────────────────┤
│                                             │
│  ● What framework do you prefer?            │
│    → React (Recommended)                    │
│                                             │
│  ● Do you want TypeScript?                  │
│    → Yes                                    │
│    💬 "We already use TS everywhere..."     │
│                                             │
│  ○ Package manager?                         │
│    → (not answered)                         │
│                                             │
├─────────────────────────────────────────────┤
│ enter open  ctrl+enter submit           esc │
└─────────────────────────────────────────────┘
```

Pressing `enter` on a question opens a nested dialog for that question type.

### Single Question Optimization

When only 1 question is asked, skip the list view and open the question dialog directly.

### Nested Dialogs

Questions use nested dialogs:

- Main dialog shows question list
- Selecting a question opens its specific dialog (select, text, etc.)
- ESC returns to list without saving changes
- Comments open another nested dialog layer

### Comments

Any question can have an optional comment added via the `c` key, providing additional context to the answer.

### Keybindings

**In Question List:**
| Key | Action |
|-----|--------|
| `enter` | Open question dialog |
| `ctrl+enter` | Submit all answers |
| `esc` | Cancel entire flow (reject) |
| `up/down` | Navigate questions |

**In Question Dialog (Select/Multi-Select/Confirm):**
| Key | Action |
|-----|--------|
| `enter` | Confirm selection, return to list |
| `space` | Toggle selection (multi-select only) |
| `c` | Add/edit comment |
| `ctrl+enter` | Confirm and submit all answers |
| `esc` | Cancel edit, return to list (no change) |

**In Text Dialog:**
| Key | Action |
|-----|--------|
| `enter` | Submit text, return to list |
| `ctrl+enter` | Submit and submit all answers |
| `esc` | Cancel, return to list |

### Tool Schema

```typescript
parameters: z.object({
  questions: z
    .array(
      z.object({
        id: z.string().describe("Unique identifier for this question"),
        type: z.enum(["select", "multi-select", "confirm", "text"]),
        question: z.string().describe("The question to ask the user"),
        options: z
          .array(
            z.object({
              value: z.string(),
              label: z.string(),
              recommended: z.boolean().optional(),
            }),
          )
          .optional()
          .describe("Options for select/multi-select types"),
        default: z
          .union([z.string(), z.array(z.string()), z.boolean()])
          .optional()
          .describe("Default value shown as hint (not pre-selected)"),
      }),
    )
    .min(1),
})
```

### Response Schema

```typescript
{
  [questionId: string]: {
    value: string | string[] | boolean | null  // null if skipped
    comment?: string  // optional additional context
  }
}
```

### Tool Output (shown in message stream)

After questions are answered, display a summary:

```
? Asked 3 questions
  • Framework: React
    💬 "We already use React in other projects"
  • TypeScript: Yes
  • Package manager: (skipped)
```

### Abort Handling

If the session is aborted while a question is pending, auto-reject the question. The user can ask again if needed.

## Architecture

### File Structure

```
packages/opencode/src/
├── question/
│   └── index.ts                    # Question namespace (state, events, ask/respond)
├── tool/
│   ├── ask.ts                      # AskTool definition
│   └── registry.ts                 # Register AskTool
├── server/
│   └── server.ts                   # Add /question/respond route
└── cli/cmd/tui/
    ├── ui/
    │   ├── dialog.tsx              # Add push() method for nested dialogs
    │   └── dialog-question.tsx     # Question components
    ├── context/
    │   └── sync.tsx                # Add question state
    └── routes/session/
        ├── index.tsx               # Question handling integration
        └── footer.tsx              # Question indicator
```

### Question Namespace (question/index.ts)

Similar pattern to Permission namespace:

```typescript
export namespace Question {
  // Zod schemas
  export const QuestionItem = z.object({
    id: z.string(),
    type: z.enum(["select", "multi-select", "confirm", "text"]),
    question: z.string(),
    options: z.array(z.object({
      value: z.string(),
      label: z.string(),
      recommended: z.boolean().optional(),
    })).optional(),
    default: z.union([z.string(), z.array(z.string()), z.boolean()]).optional(),
  })

  export const Answer = z.object({
    value: z.union([z.string(), z.array(z.string()), z.boolean(), z.null()]),
    comment: z.string().optional(),
  })

  export const Info = z.object({
    id: z.string(),
    sessionID: z.string(),
    messageID: z.string(),
    callID: z.string().optional(),
    questions: z.array(QuestionItem),
    time: z.object({ created: z.number() }),
  })

  // Events
  export const Event = {
    Updated: BusEvent.define("question.updated", Info),
    Replied: BusEvent.define("question.replied", z.object({
      sessionID: z.string(),
      questionID: z.string(),
      answers: z.record(z.string(), Answer),
    })),
  }

  // State management (similar to Permission)
  const state = Instance.state(() => ({
    pending: {} as { [sessionID: string]: { [questionID: string]: PendingQuestion } },
  }), async (state) => {
    // Reject all pending on dispose
  })

  // Core functions
  export async function ask(input: {...}): Promise<Record<string, Answer>>
  export function respond(input: {...}): void

  // Error class
  export class RejectedError extends Error {...}
}
```

### Dialog System Update (dialog.tsx)

Add `push` method for nested dialogs:

```typescript
// Existing
replace(input: JSX.Element, onClose?: () => void) {
  // Clears stack and adds single dialog
}

// New
push(input: JSX.Element, onClose?: () => void) {
  if (store.stack.length === 0) {
    focus = renderer.currentFocusedRenderable
  }
  setStore("stack", [...store.stack, { element: input, onClose }])
}

pop() {
  if (store.stack.length === 0) return
  const current = store.stack.at(-1)
  current?.onClose?.()
  setStore("stack", store.stack.slice(0, -1))
  if (store.stack.length === 0) refocus()
}
```

Update ESC handler to use `pop()` instead of clearing entire stack.

### Sync Context Update (sync.tsx)

Add question state:

```typescript
const [store, setStore] = createStore<{
  // ... existing
  question: {
    [sessionID: string]: Question[]
  }
}>({
  // ... existing
  question: {},
})

// Handle events
case "question.updated": {
  // Add/update question in store
}
case "question.replied": {
  // Remove question from store
}
```

### Server Route (server.ts)

```typescript
.post(
  "/question/respond",
  describeRoute({ description: "Respond to a pending question" }),
  validator("json", z.object({
    sessionID: z.string(),
    questionID: z.string(),
    answers: z.record(z.string(), Question.Answer),
  })),
  async (c) => {
    const body = c.req.valid("json")
    Question.respond(body)
    return c.json({ success: true })
  }
)
```

### SDK Types

Add to SDK v2 types:

```typescript
export type QuestionItem = {
  id: string
  type: "select" | "multi-select" | "confirm" | "text"
  question: string
  options?: { value: string; label: string; recommended?: boolean }[]
  default?: string | string[] | boolean
}

export type QuestionAnswer = {
  value: string | string[] | boolean | null
  comment?: string
}

export type Question = {
  id: string
  sessionID: string
  messageID: string
  callID?: string
  questions: QuestionItem[]
  time: { created: number }
}
```

## Implementation Phases

### Phase 1: Core Infrastructure

| #   | Task                      | File(s)             | Description                                  |
| --- | ------------------------- | ------------------- | -------------------------------------------- |
| 1   | Add push/pop to dialog    | `ui/dialog.tsx`     | Enable nested dialog support                 |
| 2   | Create Question namespace | `question/index.ts` | State, events, ask/respond functions         |
| 3   | Add server routes         | `server/server.ts`  | POST /question/respond endpoint              |
| 4   | Add SDK types             | `packages/sdk/...`  | Question, QuestionItem, QuestionAnswer types |
| 5   | Add sync state            | `context/sync.tsx`  | Question state and event handling            |

### Phase 2: Tool Implementation

| #   | Task           | File(s)            | Description                      |
| --- | -------------- | ------------------ | -------------------------------- |
| 6   | Create AskTool | `tool/ask.ts`      | Tool definition with full schema |
| 7   | Register tool  | `tool/registry.ts` | Add AskTool to built-in tools    |

### Phase 3: TUI Components

| #   | Task                      | File(s)                  | Description                  |
| --- | ------------------------- | ------------------------ | ---------------------------- |
| 8   | DialogQuestion            | `ui/dialog-question.tsx` | Main question list component |
| 9   | DialogQuestionSelect      | `ui/dialog-question.tsx` | Single select dialog         |
| 10  | DialogQuestionMultiSelect | `ui/dialog-question.tsx` | Multi-select with checkboxes |
| 11  | DialogQuestionText        | `ui/dialog-question.tsx` | Text input dialog            |
| 12  | DialogQuestionConfirm     | `ui/dialog-question.tsx` | Yes/No dialog                |
| 13  | DialogQuestionComment     | `ui/dialog-question.tsx` | Comment input overlay        |

### Phase 4: Integration

| #   | Task                | File(s)                     | Description                          |
| --- | ------------------- | --------------------------- | ------------------------------------ |
| 14  | Session integration | `routes/session/index.tsx`  | Auto-open dialog, keyboard handling  |
| 15  | Footer indicator    | `routes/session/footer.tsx` | Show "◉ 1 Question" like permissions |
| 16  | Tool renderer       | `routes/session/index.tsx`  | Show Q&A summary in message stream   |
| 17  | Abort handling      | `question/index.ts`         | Auto-reject on session abort         |
| 18  | Single question opt | `ui/dialog-question.tsx`    | Skip list for single question        |

### Phase 5: Documentation

| #   | Task          | File(s) | Description                        |
| --- | ------------- | ------- | ---------------------------------- |
| 19  | System prompt | TBD     | Document ask tool usage for Claude |

## Component Details

### DialogQuestion (List View)

```typescript
interface DialogQuestionProps {
  question: Question.Info
  onSubmit: (answers: Record<string, Question.Answer>) => void
  onCancel: () => void
}

function DialogQuestion(props: DialogQuestionProps) {
  const [answers, setAnswers] = createStore<Record<string, Question.Answer>>({})
  const dialog = useDialog()

  // Count answered questions
  const answeredCount = () => Object.keys(answers).filter(k => answers[k]?.value !== null).length

  // Open specific question dialog
  function openQuestion(item: Question.QuestionItem) {
    const Component = {
      "select": DialogQuestionSelect,
      "multi-select": DialogQuestionMultiSelect,
      "confirm": DialogQuestionConfirm,
      "text": DialogQuestionText,
    }[item.type]

    dialog.push(() => (
      <Component
        item={item}
        currentAnswer={answers[item.id]}
        onAnswer={(answer) => {
          setAnswers(item.id, answer)
          dialog.pop()
        }}
        onCancel={() => dialog.pop()}
        onSubmitAll={(answer) => {
          setAnswers(item.id, answer)
          props.onSubmit(answers)
        }}
      />
    ))
  }

  // Render list...
}
```

### DialogQuestionSelect

```typescript
interface DialogQuestionSelectProps {
  item: Question.QuestionItem
  currentAnswer?: Question.Answer
  onAnswer: (answer: Question.Answer) => void
  onCancel: () => void
  onSubmitAll: (answer: Question.Answer) => void
}

function DialogQuestionSelect(props: DialogQuestionSelectProps) {
  const dialog = useDialog()
  const [selected, setSelected] = createSignal<string | null>(null)
  const [comment, setComment] = createSignal<string | undefined>(props.currentAnswer?.comment)

  // Sort options: recommended first
  const sortedOptions = () => {
    const opts = props.item.options ?? []
    return [...opts].sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0))
  }

  function openComment() {
    dialog.push(() => (
      <DialogQuestionComment
        value={comment()}
        onSave={(c) => { setComment(c); dialog.pop() }}
        onCancel={() => dialog.pop()}
      />
    ))
  }

  // Handle keyboard: enter, c, ctrl+enter, esc
  // Render options with recommended indicator...
}
```

### DialogQuestionMultiSelect

Similar to DialogQuestionSelect but:

- Uses checkboxes (☑/☐) instead of radio buttons
- `space` toggles selection
- `enter` confirms all selections
- Stores array of selected values

### DialogQuestionConfirm

```typescript
function DialogQuestionConfirm(props: DialogQuestionConfirmProps) {
  const [selected, setSelected] = createSignal<boolean | null>(null)
  const [comment, setComment] = createSignal<string | undefined>()

  // Two options: Yes / No
  // enter confirms, c opens comment, esc cancels
}
```

### DialogQuestionText

```typescript
function DialogQuestionText(props: DialogQuestionTextProps) {
  let textarea: TextareaRenderable

  // Show default as placeholder hint
  // enter submits, esc cancels
  // No separate comment - the text IS the answer
}
```

### DialogQuestionComment

```typescript
function DialogQuestionComment(props: { value?: string; onSave: (comment: string) => void; onCancel: () => void }) {
  // Simple textarea dialog
  // enter saves, esc cancels
}
```

## Tool Renderer

Register a renderer for the ask tool in the session:

```typescript
ToolRegistry.register<typeof AskTool>({
  name: "ask",
  container: "block",
  render(props) {
    const questions = props.metadata.questions ?? []
    const answers = props.metadata.answers ?? {}

    return (
      <>
        <ToolTitle icon="?" fallback="Asking questions...">
          Asked {questions.length} question{questions.length !== 1 ? "s" : ""}
        </ToolTitle>
        <Show when={props.output}>
          <For each={questions}>
            {(q) => {
              const answer = answers[q.id]
              return (
                <box paddingLeft={2}>
                  <text>
                    • {q.question}: {formatAnswer(answer)}
                  </text>
                  <Show when={answer?.comment}>
                    <text fg={theme.textMuted}>
                      💬 "{truncate(answer.comment, 50)}"
                    </text>
                  </Show>
                </box>
              )
            }}
          </For>
        </Show>
      </>
    )
  }
})
```

## Testing Plan

### Manual Testing Scenarios

1. **Single select question** - One question with 4 options, one recommended
2. **Multi-select question** - Select multiple features
3. **Confirm question** - Yes/No with comment
4. **Text question** - Free-form input with default hint
5. **Multiple questions** - 3+ questions of mixed types
6. **Single question optimization** - Verify direct dialog open
7. **Comments** - Add comments to various question types
8. **Skip questions** - Submit without answering all
9. **Cancel flow** - ESC at various levels
10. **Abort session** - Verify auto-reject
11. **Nested dialog navigation** - ESC returns to correct level

### Edge Cases

- Empty options array for select
- Very long question text
- Very long option labels
- Many options (scrolling)
- Many questions (scrolling)
- Unicode in questions/options/comments
- Rapid navigation

## Future Enhancements (Out of Scope)

- Conditional questions (show question B only if A is answered X)
- Question groups/sections
- File picker question type
- Date/time picker question type
- Numeric input with validation
- Saving answer templates
- Question history/recall

## Dependencies

No new external dependencies required. Uses existing:

- Solid.js for reactivity
- OpenTUI for rendering
- Zod for schema validation
- Existing dialog infrastructure

## Risks & Mitigations

| Risk                         | Mitigation                                             |
| ---------------------------- | ------------------------------------------------------ |
| Nested dialogs complex state | Keep state local to DialogQuestion, use solid-js/store |
| ESC key conflicts            | Check stack depth before handling                      |
| Long questions overflow      | Use wrapMode and scrolling                             |
| Focus management in nested   | Leverage existing dialog focus save/restore            |

---

## Appendix: Example Usage

### Tool Call (from Claude)

```json
{
  "name": "ask",
  "parameters": {
    "questions": [
      {
        "id": "framework",
        "type": "select",
        "question": "What frontend framework do you prefer?",
        "options": [
          { "value": "react", "label": "React", "recommended": true },
          { "value": "vue", "label": "Vue" },
          { "value": "svelte", "label": "Svelte" },
          { "value": "angular", "label": "Angular" }
        ]
      },
      {
        "id": "features",
        "type": "multi-select",
        "question": "Which features do you need?",
        "options": [
          { "value": "auth", "label": "Authentication", "recommended": true },
          { "value": "db", "label": "Database" },
          { "value": "api", "label": "REST API" },
          { "value": "graphql", "label": "GraphQL" }
        ]
      },
      {
        "id": "typescript",
        "type": "confirm",
        "question": "Do you want to use TypeScript?",
        "default": true
      },
      {
        "id": "description",
        "type": "text",
        "question": "Briefly describe your project",
        "default": "A web application that..."
      }
    ]
  }
}
```

### Tool Response (to Claude)

```json
{
  "framework": { "value": "react", "comment": "We already use React in other projects" },
  "features": { "value": ["auth", "db", "api"] },
  "typescript": { "value": true },
  "description": { "value": "An e-commerce platform for selling handmade crafts" }
}
```
