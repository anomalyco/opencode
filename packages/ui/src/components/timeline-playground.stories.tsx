// @ts-nocheck
import { createSignal, createMemo, createEffect, on, For, Show, Index, batch } from "solid-js"
import { createStore, produce } from "solid-js/store"
import type {
  Message,
  UserMessage,
  AssistantMessage,
  Part,
  TextPart,
  ReasoningPart,
  ToolPart,
  CompactionPart,
  FilePart,
  AgentPart,
} from "@opencode-ai/sdk/v2"
import { DataProvider } from "../context/data"
import { FileComponentProvider } from "../context/file"
import { SessionTurn } from "./session-turn"

// ---------------------------------------------------------------------------
// ID helpers
// ---------------------------------------------------------------------------
let seq = 0
const uid = () => `pg-${++seq}-${Date.now().toString(36)}`

// ---------------------------------------------------------------------------
// Lorem ipsum content
// ---------------------------------------------------------------------------
const LOREM = [
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
  "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
  "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.",
  "Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
  "Cras justo odio, dapibus ut facilisis in, egestas eget quam. Vestibulum id ligula porta felis euismod semper.",
]

// ---------------------------------------------------------------------------
// User message variants
// ---------------------------------------------------------------------------
const USER_VARIANTS = {
  short: {
    label: "short",
    text: "Fix the bug in the login form",
    parts: [] as Part[],
  },
  medium: {
    label: "medium",
    text: "Can you update the session timeline component to support lazy loading? The current implementation loads everything eagerly which causes jank on large sessions.",
    parts: [] as Part[],
  },
  long: {
    label: "long",
    text: `I need you to refactor the message rendering pipeline. Currently the timeline renders all messages synchronously which blocks first paint. Here's what I want:

1. Implement virtual scrolling for the message list
2. Defer-mount older messages using requestAnimationFrame batching
3. Add content-visibility: auto to each turn container
4. Make sure the scroll-to-bottom behavior still works correctly after these changes

Please also add appropriate CSS containment hints and make sure we don't break the sticky header behavior for the session title.`,
    parts: [] as Part[],
  },
  "with @file": {
    label: "with @file",
    text: "Update @src/components/session-turn.tsx to fix the spacing issue between parts",
    parts: (() => {
      const id = `static-file-${Date.now()}`
      return [
        {
          id,
          type: "file",
          mime: "text/plain",
          filename: "session-turn.tsx",
          url: "src/components/session-turn.tsx",
          source: {
            type: "file",
            path: "src/components/session-turn.tsx",
            text: {
              value: "@src/components/session-turn.tsx",
              start: 7,
              end: 38,
            },
          },
        } as FilePart,
      ]
    })(),
  },
  "with @agent": {
    label: "with @agent",
    text: "Use @explore to find all CSS files related to the timeline, then fix the spacing",
    parts: (() => {
      return [
        {
          id: `static-agent-${Date.now()}`,
          type: "agent",
          name: "explore",
          source: { start: 4, end: 12 },
        } as AgentPart,
      ]
    })(),
  },
  "with image": {
    label: "with image",
    text: "Here's a screenshot of the bug I'm seeing",
    parts: (() => {
      // 1x1 blue pixel PNG as data URI for a realistic attachment
      const pixel =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
      return [
        {
          id: `static-img-${Date.now()}`,
          type: "file",
          mime: "image/png",
          filename: "screenshot.png",
          url: pixel,
        } as FilePart,
      ]
    })(),
  },
  "with file attachment": {
    label: "with file attachment",
    text: "Check this config file for issues",
    parts: (() => {
      return [
        {
          id: `static-attach-${Date.now()}`,
          type: "file",
          mime: "application/json",
          filename: "tsconfig.json",
          url: "data:application/json;base64,e30=",
        } as FilePart,
      ]
    })(),
  },
  "multi attachment": {
    label: "multi attachment",
    text: "Look at these files and the screenshot, then fix the layout",
    parts: (() => {
      const pixel =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
      return [
        {
          id: `static-multi-img-${Date.now()}`,
          type: "file",
          mime: "image/png",
          filename: "layout-bug.png",
          url: pixel,
        } as FilePart,
        {
          id: `static-multi-file-${Date.now()}`,
          type: "file",
          mime: "text/css",
          filename: "session-turn.css",
          url: "data:text/css;base64,LyogZW1wdHkgKi8=",
        } as FilePart,
        {
          id: `static-multi-ref-${Date.now()}`,
          type: "file",
          mime: "text/plain",
          filename: "session-turn.tsx",
          url: "src/components/session-turn.tsx",
          source: {
            type: "file",
            path: "src/components/session-turn.tsx",
            text: { value: "@src/components/session-turn.tsx", start: 0, end: 0 },
          },
        } as FilePart,
      ]
    })(),
  },
} satisfies Record<string, { label: string; text: string; parts: Part[] }>

const MARKDOWN_SAMPLES = {
  headings: `# Heading 1
## Heading 2
### Heading 3
#### Heading 4

Some paragraph text after headings.`,

  lists: `Here's a list of changes:

- First item with some explanation
- Second item that is a bit longer and wraps to the next line when the viewport is narrow
- Third item
  - Nested item A
  - Nested item B

1. Numbered first
2. Numbered second
3. Numbered third`,

  code: `Here's an inline \`variable\` reference and a code block:

\`\`\`typescript
export function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0)
}

export function average(values: number[]) {
  if (values.length === 0) return 0
  return sum(values) / values.length
}
\`\`\`

And some text after the code block.`,

  mixed: `## Implementation Plan

I'll make the following changes:

1. **Update the schema** - Add new fields to the database model
2. **Create the API endpoint** - Handle validation and persistence
3. **Add frontend components** - Build the form and display views

Here's the key change:

\`\`\`typescript
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})
\`\`\`

> Note: This is a breaking change that requires a migration.

The migration will handle existing data by setting \`project_id\` to the default workspace.

---

For more details, see the [documentation](https://example.com/docs).`,

  table: `## Comparison

| Feature | Before | After |
|---------|--------|-------|
| Speed | 120ms | 45ms |
| Memory | 256MB | 128MB |
| Bundle | 1.2MB | 890KB |

The improvements are significant across all metrics.`,

  blockquote: `## Summary

> This is a blockquote that contains important information about the implementation approach.
>
> It spans multiple lines and contains **bold** and \`code\` elements.

The approach above was chosen for its simplicity.`,

  links: `Check out these resources:

- [SolidJS docs](https://solidjs.com)
- [TypeScript handbook](https://www.typescriptlang.org/docs/handbook)
- The API is at \`https://api.example.com/v2\`

You can also visit https://example.com/docs for more info.`,

  images: `## Screenshot

Here's what the output looks like:

![Alt text](https://via.placeholder.com/400x200)

And below is the final result.`,
}

const REASONING_SAMPLES = [
  `**Analyzing the request**

The user wants to add a new feature to the session timeline. I need to understand the existing component structure first.

Let me look at the key files involved:
- \`session-turn.tsx\` handles individual turns
- \`message-part.tsx\` renders different part types
- The data flows through the \`DataProvider\` context`,

  `**Considering approaches**

I could either modify the existing SessionTurn component or create a wrapper. The wrapper approach is cleaner because it doesn't touch the core rendering logic.

The trade-off is that we'd need to pass additional props through, but that's acceptable for this use case.`,

  `**Planning the implementation**

I'll need to:
1. Create the data generators
2. Wire up the context providers
3. Add CSS variable controls
4. Implement the export functionality

This should be straightforward given the existing component architecture.`,
]

const TOOL_SAMPLES = {
  read: {
    tool: "read",
    input: { filePath: "src/components/session-turn.tsx", offset: 1, limit: 50 },
    output: "export function SessionTurn(props) {\n  // component implementation\n  return <div>...</div>\n}",
    title: "Read src/components/session-turn.tsx",
    metadata: {},
  },
  glob: {
    tool: "glob",
    input: { pattern: "**/*.tsx", path: "src/components" },
    output: "src/components/button.tsx\nsrc/components/card.tsx\nsrc/components/session-turn.tsx",
    title: "Found 3 files",
    metadata: {},
  },
  grep: {
    tool: "grep",
    input: { pattern: "SessionTurn", path: "src", include: "*.tsx" },
    output: "src/components/session-turn.tsx:141\nsrc/pages/session/timeline.tsx:987",
    title: "Found 2 matches",
    metadata: {},
  },
  bash: {
    tool: "bash",
    input: { command: "bun test --filter session", description: "Run session tests" },
    output:
      "bun test v1.3.11\n\n✓ session-turn.test.tsx (3 tests) 45ms\n✓ message-part.test.tsx (7 tests) 120ms\n\nTest Suites: 2 passed, 2 total\nTests:       10 passed, 10 total\nTime:        0.89s",
    title: "Run session tests",
    metadata: { command: "bun test --filter session" },
  },
  edit: {
    tool: "edit",
    input: {
      filePath: "src/components/session-turn.tsx",
      oldString: "gap: 12px",
      newString: "gap: 18px",
    },
    output: "File edited successfully",
    title: "Edit src/components/session-turn.tsx",
    metadata: {
      filediff: {
        file: "src/components/session-turn.tsx",
        before: "  gap: 12px;\n  display: flex;",
        after: "  gap: 18px;\n  display: flex;",
        additions: 1,
        deletions: 1,
      },
    },
  },
  write: {
    tool: "write",
    input: {
      filePath: "src/utils/helpers.ts",
      content:
        "export function clamp(value: number, min: number, max: number) {\n  return Math.min(Math.max(value, min), max)\n}\n",
    },
    output: "File written successfully",
    title: "Write src/utils/helpers.ts",
    metadata: {},
  },
  task: {
    tool: "task",
    input: { description: "Explore components", subagent_type: "explore", prompt: "Find all session components" },
    output: "Found 12 session-related components across 3 directories.",
    title: "Agent (Explore)",
    metadata: { sessionId: "sub-session-1" },
  },
  webfetch: {
    tool: "webfetch",
    input: { url: "https://solidjs.com/docs/latest/api" },
    output: "# SolidJS API Reference\n\nCore primitives for building reactive applications...",
    title: "Fetch https://solidjs.com/docs/latest/api",
    metadata: {},
  },
  websearch: {
    tool: "websearch",
    input: { query: "SolidJS createStore performance" },
    output:
      "https://solidjs.com/docs/latest/api#createstore\nhttps://dev.to/solidjs/understanding-solid-reactivity\nhttps://github.com/solidjs/solid/discussions/1234",
    title: "Search: SolidJS createStore performance",
    metadata: {},
  },
  question: {
    tool: "question",
    input: {
      questions: [
        {
          question: "Which approach do you prefer?",
          header: "Approach",
          options: [
            { label: "Wrapper component", description: "Create a new wrapper around SessionTurn" },
            { label: "Direct modification", description: "Modify SessionTurn directly" },
          ],
        },
      ],
    },
    output: "",
    title: "Question",
    metadata: { answers: [["Wrapper component"]] },
  },
  skill: {
    tool: "skill",
    input: { name: "playwriter" },
    output: "Skill loaded successfully",
    title: "playwriter",
    metadata: {},
  },
  todowrite: {
    tool: "todowrite",
    input: {
      todos: [
        { content: "Create data generators", status: "completed", priority: "high" },
        { content: "Build UI controls", status: "in_progress", priority: "high" },
        { content: "Add CSS export", status: "pending", priority: "medium" },
      ],
    },
    output: "",
    title: "Todos",
    metadata: {
      todos: [
        { content: "Create data generators", status: "completed", priority: "high" },
        { content: "Build UI controls", status: "in_progress", priority: "high" },
        { content: "Add CSS export", status: "pending", priority: "medium" },
      ],
    },
  },
}

// ---------------------------------------------------------------------------
// Fake data generators
// ---------------------------------------------------------------------------
const SESSION_ID = "playground-session"
const DEFAULT_SESSION = { id: SESSION_ID, title: "Timeline Playground" }

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function normalize(raw: unknown) {
  if (Array.isArray(raw)) {
    const info = raw.find((row) => record(row) && row.type === "session" && record(row.data))?.data
    if (!record(info) || typeof info.id !== "string") {
      throw new Error("No session found in JSON")
    }

    const part = new Map<string, Part[]>()
    const messages = raw.flatMap((row) => {
      if (!record(row) || !record(row.data)) return []
      if (row.type === "part" && typeof row.data.messageID === "string") {
        const list = part.get(row.data.messageID) ?? []
        list.push(row.data as Part)
        part.set(row.data.messageID, list)
        return []
      }
      if (row.type !== "message" || typeof row.data.id !== "string") return []
      return [{ info: row.data as Message, parts: [] as Part[] }]
    })

    return {
      info,
      messages: messages.map((msg) => ({
        info: msg.info,
        parts: part.get(msg.info.id) ?? [],
      })),
    }
  }

  if (!record(raw) || !record(raw.info) || typeof raw.info.id !== "string" || !Array.isArray(raw.messages)) {
    throw new Error("Expected an `opencode export` JSON file")
  }

  return {
    info: raw.info,
    messages: raw.messages.flatMap((row) => {
      if (!record(row) || !record(row.info) || typeof row.info.id !== "string") return []
      return [{ info: row.info as Message, parts: Array.isArray(row.parts) ? (row.parts as Part[]) : [] }]
    }),
  }
}

function mkUser(text: string, extra: Part[] = [], sessionID = SESSION_ID): { message: UserMessage; parts: Part[] } {
  const id = uid()
  return {
    message: {
      id,
      sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: "code",
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
    } as UserMessage,
    parts: [
      { id: uid(), type: "text", text, time: { created: Date.now() } } as TextPart,
      // Clone extra parts with fresh ids so each user message owns unique part instances
      ...extra.map((p) => ({ ...p, id: uid() })),
    ],
  }
}

function mkAssistant(parentID: string, sessionID = SESSION_ID): AssistantMessage {
  return {
    id: uid(),
    sessionID,
    role: "assistant",
    time: { created: Date.now(), completed: Date.now() + 3000 },
    parentID,
    modelID: "claude-sonnet-4-20250514",
    providerID: "anthropic",
    mode: "default",
    agent: "code",
    path: { cwd: "/project", root: "/project" },
    cost: 0.003,
    tokens: { input: 1200, output: 800, reasoning: 200, cache: { read: 0, write: 0 } },
  } as AssistantMessage
}

function textPart(text: string): TextPart {
  return { id: uid(), type: "text", text, time: { created: Date.now() } } as TextPart
}

function reasoningPart(text: string): ReasoningPart {
  return { id: uid(), type: "reasoning", text, time: { start: Date.now(), end: Date.now() + 500 } } as ReasoningPart
}

function toolPart(sample: (typeof TOOL_SAMPLES)[keyof typeof TOOL_SAMPLES], status = "completed"): ToolPart {
  const base = {
    id: uid(),
    type: "tool" as const,
    callID: uid(),
    tool: sample.tool,
  }
  if (status === "completed") {
    return {
      ...base,
      state: {
        status: "completed",
        input: sample.input,
        output: sample.output,
        title: sample.title,
        metadata: sample.metadata ?? {},
        time: { start: Date.now(), end: Date.now() + 1000 },
      },
    } as ToolPart
  }
  if (status === "running") {
    return {
      ...base,
      state: {
        status: "running",
        input: sample.input,
        title: sample.title,
        metadata: sample.metadata ?? {},
        time: { start: Date.now() },
      },
    } as ToolPart
  }
  return {
    ...base,
    state: { status: "pending", input: sample.input, raw: "" },
  } as ToolPart
}

function compactionPart(): CompactionPart {
  return { id: uid(), type: "compaction", auto: true } as CompactionPart
}

// ---------------------------------------------------------------------------
// CSS Controls definition
// ---------------------------------------------------------------------------

// Source file basenames inside packages/ui/src/components/
const MD = "markdown.css"
const MP = "message-part.css"
const ST = "session-turn.css"

/**
 * Source mapping for a CSS control.
 * - `anchor`: immutable text near the property (comment, selector, etc.) that
 *   won't change when values change — used to locate the right rule block.
 * - `prop`: the CSS property name whose value gets replaced.
 * - `format`: turns the slider number into a CSS value string.
 */
type CSSSource = {
  file: string
  anchor: string
  prop: string
  format: (v: string) => string
}

type CSSControl = {
  key: string
  label: string
  group: string
  type: "range" | "color" | "select"
  initial: string
  selector: string
  property: string
  min?: string
  max?: string
  step?: string
  options?: string[]
  unit?: string
  source?: CSSSource
}

const px = (v: string) => `${v}px`
const pxZero = (v: string) => `${v}px 0`
const pct = (v: string) => `${v}%`

const CSS_CONTROLS: CSSControl[] = [
  // --- Timeline spacing ---
  {
    key: "turn-gap",
    label: "Turn gap",
    group: "Timeline Spacing",
    type: "range",
    initial: "48",
    selector: '[data-slot="session-turn-list"]',
    property: "gap",
    min: "0",
    max: "80",
    step: "1",
    unit: "px",
    source: { file: ST, anchor: '[data-slot="session-turn-list"]', prop: "gap", format: px },
  },
  {
    key: "container-gap",
    label: "Container gap",
    group: "Timeline Spacing",
    type: "range",
    initial: "18",
    selector: '[data-slot="session-turn-message-container"]',
    property: "gap",
    min: "0",
    max: "60",
    step: "1",
    unit: "px",
    source: { file: ST, anchor: '[data-slot="session-turn-message-container"]', prop: "gap", format: px },
  },
  {
    key: "assistant-gap",
    label: "Assistant parts gap",
    group: "Timeline Spacing",
    type: "range",
    initial: "12",
    selector: '[data-slot="session-turn-assistant-content"]',
    property: "gap",
    min: "0",
    max: "40",
    step: "1",
    unit: "px",
    source: { file: ST, anchor: '[data-slot="session-turn-assistant-content"]', prop: "gap", format: px },
  },
  {
    key: "text-part-margin",
    label: "Text part margin-top",
    group: "Timeline Spacing",
    type: "range",
    initial: "24",
    selector: '[data-component="text-part"]',
    property: "margin-top",
    min: "0",
    max: "60",
    step: "1",
    unit: "px",
    source: { file: MP, anchor: '[data-component="text-part"]', prop: "margin-top", format: px },
  },

  // --- Markdown typography ---
  {
    key: "md-font-size",
    label: "Font size",
    group: "Markdown Typography",
    type: "range",
    initial: "14",
    selector: '[data-component="markdown"]',
    property: "font-size",
    min: "10",
    max: "22",
    step: "1",
    unit: "px",
    source: { file: MD, anchor: "/* Reset & Base Typography */", prop: "font-size", format: px },
  },
  {
    key: "md-line-height",
    label: "Line height",
    group: "Markdown Typography",
    type: "range",
    initial: "180",
    selector: '[data-component="markdown"]',
    property: "line-height",
    min: "100",
    max: "300",
    step: "5",
    unit: "%",
    source: { file: MD, anchor: "/* Reset & Base Typography */", prop: "line-height", format: pct },
  },

  // --- Markdown headings ---
  {
    key: "md-heading-margin-top",
    label: "Heading margin-top",
    group: "Markdown Headings",
    type: "range",
    initial: "32",
    selector: '[data-component="markdown"] :is(h1,h2,h3,h4,h5,h6)',
    property: "margin-top",
    min: "0",
    max: "60",
    step: "1",
    unit: "px",
    source: { file: MD, anchor: "/* Headings:", prop: "margin-top", format: px },
  },
  {
    key: "md-heading-margin-bottom",
    label: "Heading margin-bottom",
    group: "Markdown Headings",
    type: "range",
    initial: "12",
    selector: '[data-component="markdown"] :is(h1,h2,h3,h4,h5,h6)',
    property: "margin-bottom",
    min: "0",
    max: "40",
    step: "1",
    unit: "px",
    source: { file: MD, anchor: "/* Headings:", prop: "margin-bottom", format: px },
  },
  {
    key: "md-heading-font-size",
    label: "Heading font size",
    group: "Markdown Headings",
    type: "range",
    initial: "14",
    selector: '[data-component="markdown"] :is(h1,h2,h3,h4,h5,h6)',
    property: "font-size",
    min: "12",
    max: "28",
    step: "1",
    unit: "px",
    source: { file: MD, anchor: "/* Headings:", prop: "font-size", format: px },
  },

  // --- Markdown paragraphs ---
  {
    key: "md-p-margin-bottom",
    label: "Paragraph margin-bottom",
    group: "Markdown Paragraphs",
    type: "range",
    initial: "16",
    selector: '[data-component="markdown"] p',
    property: "margin-bottom",
    min: "0",
    max: "40",
    step: "1",
    unit: "px",
    source: { file: MD, anchor: "/* Paragraphs */", prop: "margin-bottom", format: px },
  },

  // --- Markdown lists ---
  {
    key: "md-list-margin-top",
    label: "List margin-top",
    group: "Markdown Lists",
    type: "range",
    initial: "8",
    selector: '[data-component="markdown"] :is(ul,ol)',
    property: "margin-top",
    min: "0",
    max: "40",
    step: "1",
    unit: "px",
    source: { file: MD, anchor: "/* Lists */", prop: "margin-top", format: px },
  },
  {
    key: "md-list-margin-bottom",
    label: "List margin-bottom",
    group: "Markdown Lists",
    type: "range",
    initial: "16",
    selector: '[data-component="markdown"] :is(ul,ol)',
    property: "margin-bottom",
    min: "0",
    max: "40",
    step: "1",
    unit: "px",
    source: { file: MD, anchor: "/* Lists */", prop: "margin-bottom", format: px },
  },
  {
    key: "md-list-padding-left",
    label: "List padding-left",
    group: "Markdown Lists",
    type: "range",
    initial: "24",
    selector: '[data-component="markdown"] :is(ul,ol)',
    property: "padding-left",
    min: "0",
    max: "60",
    step: "1",
    unit: "px",
    source: { file: MD, anchor: "/* Lists */", prop: "padding-left", format: px },
  },
  {
    key: "md-li-margin-bottom",
    label: "List item margin-bottom",
    group: "Markdown Lists",
    type: "range",
    initial: "8",
    selector: '[data-component="markdown"] li',
    property: "margin-bottom",
    min: "0",
    max: "20",
    step: "1",
    unit: "px",
    // Anchor on `li {` to skip the `ul,ol` margin-bottom above
    source: { file: MD, anchor: "\n  li {", prop: "margin-bottom", format: px },
  },

  // --- Markdown code blocks ---
  {
    key: "md-pre-margin-top",
    label: "Code block margin-top",
    group: "Markdown Code",
    type: "range",
    initial: "32",
    selector: '[data-component="markdown"] pre',
    property: "margin-top",
    min: "0",
    max: "60",
    step: "1",
    unit: "px",
    source: { file: MD, anchor: "\n  pre {", prop: "margin-top", format: px },
  },
  {
    key: "md-pre-margin-bottom",
    label: "Code block margin-bottom",
    group: "Markdown Code",
    type: "range",
    initial: "32",
    selector: '[data-component="markdown"] pre',
    property: "margin-bottom",
    min: "0",
    max: "60",
    step: "1",
    unit: "px",
    source: { file: MD, anchor: "\n  pre {", prop: "margin-bottom", format: px },
  },
  {
    key: "md-shiki-font-size",
    label: "Code font size",
    group: "Markdown Code",
    type: "range",
    initial: "13",
    selector: '[data-component="markdown"] .shiki',
    property: "font-size",
    min: "10",
    max: "20",
    step: "1",
    unit: "px",
    source: { file: MD, anchor: ".shiki {", prop: "font-size", format: px },
  },
  {
    key: "md-shiki-padding",
    label: "Code padding",
    group: "Markdown Code",
    type: "range",
    initial: "12",
    selector: '[data-component="markdown"] .shiki',
    property: "padding",
    min: "0",
    max: "32",
    step: "1",
    unit: "px",
    source: { file: MD, anchor: ".shiki {", prop: "padding", format: px },
  },
  {
    key: "md-shiki-radius",
    label: "Code border-radius",
    group: "Markdown Code",
    type: "range",
    initial: "6",
    selector: '[data-component="markdown"] .shiki',
    property: "border-radius",
    min: "0",
    max: "16",
    step: "1",
    unit: "px",
    source: { file: MD, anchor: ".shiki {", prop: "border-radius", format: px },
  },

  // --- Markdown blockquotes ---
  {
    key: "md-blockquote-margin",
    label: "Blockquote margin",
    group: "Markdown Blockquotes",
    type: "range",
    initial: "24",
    selector: '[data-component="markdown"] blockquote',
    property: "margin-block",
    min: "0",
    max: "60",
    step: "1",
    unit: "px",
    source: { file: MD, anchor: "/* Blockquotes */", prop: "margin", format: pxZero },
  },
  {
    key: "md-blockquote-padding-left",
    label: "Blockquote padding-left",
    group: "Markdown Blockquotes",
    type: "range",
    initial: "8",
    selector: '[data-component="markdown"] blockquote',
    property: "padding-left",
    min: "0",
    max: "40",
    step: "1",
    unit: "px",
    source: { file: MD, anchor: "/* Blockquotes */", prop: "padding-left", format: px },
  },
  {
    key: "md-blockquote-border-width",
    label: "Blockquote border width",
    group: "Markdown Blockquotes",
    type: "range",
    initial: "2",
    selector: '[data-component="markdown"] blockquote',
    property: "border-left-width",
    min: "0",
    max: "8",
    step: "1",
    unit: "px",
    source: {
      file: MD,
      anchor: "/* Blockquotes */",
      prop: "border-left",
      format: (v) => `${v}px solid var(--border-weak-base)`,
    },
  },

  // --- Markdown tables ---
  {
    key: "md-table-margin",
    label: "Table margin",
    group: "Markdown Tables",
    type: "range",
    initial: "24",
    selector: '[data-component="markdown"] table',
    property: "margin-block",
    min: "0",
    max: "60",
    step: "1",
    unit: "px",
    source: { file: MD, anchor: "/* Tables */", prop: "margin", format: pxZero },
  },
  {
    key: "md-td-padding",
    label: "Cell padding",
    group: "Markdown Tables",
    type: "range",
    initial: "12",
    selector: '[data-component="markdown"] :is(th,td)',
    property: "padding",
    min: "0",
    max: "24",
    step: "1",
    unit: "px",
    // Anchor on td selector to skip other padding rules
    source: { file: MD, anchor: "th,\n  td {", prop: "padding", format: px },
  },

  // --- Markdown HR ---
  {
    key: "md-hr-margin",
    label: "HR margin",
    group: "Markdown HR",
    type: "range",
    initial: "40",
    selector: '[data-component="markdown"] hr',
    property: "margin-block",
    min: "0",
    max: "80",
    step: "1",
    unit: "px",
    source: { file: MD, anchor: "/* Horizontal Rule", prop: "margin", format: pxZero },
  },

  // --- Reasoning part ---
  {
    key: "reasoning-md-font-size",
    label: "Reasoning font size",
    group: "Reasoning Part",
    type: "range",
    initial: "14",
    selector: '[data-component="reasoning-part"] [data-component="markdown"]',
    property: "font-size",
    min: "10",
    max: "22",
    step: "1",
    unit: "px",
    source: { file: MP, anchor: '[data-component="reasoning-part"]', prop: "font-size", format: px },
  },
  {
    key: "reasoning-md-margin-top",
    label: "Reasoning markdown margin-top",
    group: "Reasoning Part",
    type: "range",
    initial: "24",
    selector: '[data-component="reasoning-part"] [data-component="markdown"]',
    property: "margin-top",
    min: "0",
    max: "60",
    step: "1",
    unit: "px",
    source: { file: MP, anchor: '[data-component="reasoning-part"]', prop: "margin-top", format: px },
  },

  // --- User message ---
  {
    key: "user-msg-padding",
    label: "User bubble padding",
    group: "User Message",
    type: "range",
    initial: "12",
    selector: '[data-slot="user-message-text"]',
    property: "padding",
    min: "0",
    max: "32",
    step: "1",
    unit: "px",
    source: { file: MP, anchor: '[data-slot="user-message-text"]', prop: "padding", format: px },
  },
  {
    key: "user-msg-radius",
    label: "User bubble border-radius",
    group: "User Message",
    type: "range",
    initial: "6",
    selector: '[data-slot="user-message-text"]',
    property: "border-radius",
    min: "0",
    max: "24",
    step: "1",
    unit: "px",
    source: { file: MP, anchor: '[data-slot="user-message-text"]', prop: "border-radius", format: px },
  },

  // --- Tool parts ---
  {
    key: "bash-max-height",
    label: "Shell output max-height",
    group: "Tool Parts",
    type: "range",
    initial: "240",
    selector: '[data-slot="bash-scroll"]',
    property: "max-height",
    min: "100",
    max: "600",
    step: "10",
    unit: "px",
    source: { file: MP, anchor: '[data-slot="bash-scroll"]', prop: "max-height", format: px },
  },
]

// ---------------------------------------------------------------------------
// Playground component
// ---------------------------------------------------------------------------
function FileStub() {
  return <div style={{ padding: "8px", color: "var(--text-weak)", "font-size": "13px" }}>File viewer stub</div>
}

function Playground() {
  // ---- Messages & parts state ----
  const [state, setState] = createStore<{
    messages: Message[]
    parts: Record<string, Part[]>
  }>({
    messages: [],
    parts: {},
  })
  const [session, setSession] = createSignal({ ...DEFAULT_SESSION })
  const [loaded, setLoaded] = createSignal("")
  const [issue, setIssue] = createSignal("")

  // ---- CSS overrides ----
  const [css, setCss] = createStore<Record<string, string>>({})
  const [defaults, setDefaults] = createStore<Record<string, string>>({})
  let styleEl: HTMLStyleElement | undefined
  let previewRef: HTMLDivElement | undefined
  let pick: HTMLInputElement | undefined

  const sample = (ctrl: CSSControl) => {
    if (!ctrl.group.startsWith("Markdown")) return ctrl.selector
    return ctrl.selector.replace(
      '[data-component="markdown"]',
      '[data-component="text-part"] [data-component="markdown"]',
    )
  }

  /** Read computed styles from the DOM to seed slider defaults */
  const readDefaults = () => {
    const root = previewRef
    if (!root) return
    const next: Record<string, string> = {}
    for (const ctrl of CSS_CONTROLS) {
      const el = (root.querySelector(sample(ctrl)) ?? root.querySelector(ctrl.selector)) as HTMLElement | null
      if (!el) continue
      const styles = getComputedStyle(el)
      // Use bracket access — getPropertyValue doesn't resolve shorthands
      const raw = (styles as any)[ctrl.property] as string
      if (!raw) continue
      // Shorthands may return "24px 0px" — take the first value
      const num = parseFloat(raw.split(" ")[0])
      if (!Number.isFinite(num)) continue
      // line-height returns px — convert back to % relative to font-size
      if (ctrl.unit === "%") {
        const fs = parseFloat(styles.fontSize)
        if (fs > 0) {
          next[ctrl.key] = String(Math.round((num / fs) * 100))
          continue
        }
      }
      next[ctrl.key] = String(Math.round(num))
    }
    setDefaults(next)
  }

  const updateStyle = () => {
    const rules: string[] = []
    for (const ctrl of CSS_CONTROLS) {
      const val = css[ctrl.key]
      if (val === undefined) continue
      const value = ctrl.unit ? `${val}${ctrl.unit}` : val
      rules.push(`${ctrl.selector} { ${ctrl.property}: ${value} !important; }`)
    }
    if (styleEl) styleEl.textContent = rules.join("\n")
  }

  const setCssValue = (key: string, value: string) => {
    setCss(key, value)
    updateStyle()
  }

  const resetCss = () => {
    batch(() => {
      for (const ctrl of CSS_CONTROLS) {
        setCss(ctrl.key, undefined as any)
      }
    })
    if (styleEl) styleEl.textContent = ""
  }

  // ---- Derived ----
  const userMessages = createMemo(() => state.messages.filter((m): m is UserMessage => m.role === "user"))

  const data = createMemo(() => ({
    session: [session()],
    session_status: {},
    session_diff: {},
    message: { [session().id]: state.messages },
    part: state.parts,
    provider: {
      all: [{ id: "anthropic", models: { "claude-sonnet-4-20250514": { name: "Claude Sonnet" } } }],
    },
  }))

  // Read computed defaults once DOM has turn elements to query
  createEffect(
    on(
      () => userMessages().length,
      (len) => {
        if (len === 0) return
        // Wait a frame for the DOM to settle after render
        requestAnimationFrame(readDefaults)
      },
    ),
  )

  // ---- Find or create the last assistant message to append parts to ----
  const lastAssistantID = createMemo(() => {
    for (let i = state.messages.length - 1; i >= 0; i--) {
      if (state.messages[i].role === "assistant") return state.messages[i].id
    }
    return undefined
  })

  /** Ensure a turn (user + assistant) exists and return the assistant message id */
  const ensureTurn = (): string => {
    const id = lastAssistantID()
    if (id) return id
    // Create a minimal placeholder turn
    const user = mkUser("...", [], session().id)
    const asst = mkAssistant(user.message.id, session().id)
    setState(
      produce((draft) => {
        draft.messages.push(user.message)
        draft.messages.push(asst)
        draft.parts[user.message.id] = user.parts
        draft.parts[asst.id] = []
      }),
    )
    return asst.id
  }

  /** Append parts to the last assistant message */
  const appendParts = (parts: Part[]) => {
    const id = ensureTurn()
    setState(
      produce((draft) => {
        const existing = draft.parts[id] ?? []
        draft.parts[id] = [...existing, ...parts]
      }),
    )
  }

  // ---- User message helpers ----
  const addUser = (variant: keyof typeof USER_VARIANTS) => {
    const v = USER_VARIANTS[variant]
    const user = mkUser(v.text, v.parts, session().id)
    const asst = mkAssistant(user.message.id, session().id)
    setState(
      produce((draft) => {
        draft.messages.push(user.message)
        draft.messages.push(asst)
        draft.parts[user.message.id] = user.parts
        draft.parts[asst.id] = []
      }),
    )
  }

  // ---- Part helpers (append to last turn) ----
  const addText = (variant: keyof typeof MARKDOWN_SAMPLES) => {
    appendParts([textPart(MARKDOWN_SAMPLES[variant])])
  }

  const addReasoning = () => {
    const idx = Math.floor(Math.random() * REASONING_SAMPLES.length)
    appendParts([reasoningPart(REASONING_SAMPLES[idx])])
  }

  const addTool = (name: keyof typeof TOOL_SAMPLES) => {
    appendParts([toolPart(TOOL_SAMPLES[name])])
  }

  // ---- Composite helpers (create full turns with user + assistant) ----
  const addFullTurn = (userText: string, parts: Part[]) => {
    const user = mkUser(userText, [], session().id)
    const asst = mkAssistant(user.message.id, session().id)
    setState(
      produce((draft) => {
        draft.messages.push(user.message)
        draft.messages.push(asst)
        draft.parts[user.message.id] = user.parts
        draft.parts[asst.id] = parts
      }),
    )
  }

  const addContextGroupTurn = () => {
    addFullTurn("Read some files", [
      toolPart(TOOL_SAMPLES.read),
      toolPart(TOOL_SAMPLES.glob),
      toolPart(TOOL_SAMPLES.grep),
      textPart("After gathering context, here's what I found:\n\n" + LOREM[2]),
    ])
  }

  const addReasoningFullTurn = () => {
    addFullTurn("Make the changes described above", [
      reasoningPart(REASONING_SAMPLES[0]),
      toolPart(TOOL_SAMPLES.read),
      toolPart(TOOL_SAMPLES.glob),
      toolPart(TOOL_SAMPLES.grep),
      toolPart(TOOL_SAMPLES.edit),
      toolPart(TOOL_SAMPLES.bash),
      textPart(MARKDOWN_SAMPLES.mixed),
    ])
  }

  const addKitchenSink = () => {
    // User message variants
    addUser("short")
    appendParts([textPart(MARKDOWN_SAMPLES.headings)])
    addUser("medium")
    appendParts([textPart(MARKDOWN_SAMPLES.lists)])
    addUser("long")
    appendParts([textPart(MARKDOWN_SAMPLES.code)])
    addUser("with @file")
    appendParts([textPart(MARKDOWN_SAMPLES.mixed)])
    addUser("with image")
    appendParts([reasoningPart(REASONING_SAMPLES[0]), textPart(MARKDOWN_SAMPLES.table)])
    addUser("multi attachment")
    appendParts([
      toolPart(TOOL_SAMPLES.read),
      toolPart(TOOL_SAMPLES.glob),
      toolPart(TOOL_SAMPLES.grep),
      toolPart(TOOL_SAMPLES.edit),
      toolPart(TOOL_SAMPLES.bash),
      textPart(MARKDOWN_SAMPLES.blockquote),
    ])
    addContextGroupTurn()
    addReasoningFullTurn()
  }

  const interrupt = () => {
    const user = userMessages().at(-1)
    if (!user) return
    const now = Date.now()

    setState(
      produce((draft) => {
        const msg = draft.messages.findLast(
          (item): item is AssistantMessage => item.role === "assistant" && item.parentID === user.id,
        )

        if (msg) {
          const time = msg.time ?? { created: now }
          msg.time = { ...time, completed: time.completed ?? now }
          msg.error = { name: "MessageAbortedError", message: "Interrupted" }
          return
        }

        const asst = mkAssistant(user.id, session().id)
        asst.time = { created: now, completed: now }
        asst.error = { name: "MessageAbortedError", message: "Interrupted" }
        draft.messages.push(asst)
        draft.parts[asst.id] = []
      }),
    )
  }

  const load = (raw: unknown, name: string) => {
    const next = normalize(raw)
    const id = typeof next.info.id === "string" && next.info.id ? next.info.id : SESSION_ID
    const messages = next.messages.map((msg) => ({
      ...msg.info,
      sessionID: typeof msg.info.sessionID === "string" ? msg.info.sessionID : id,
    }))
    const parts = Object.fromEntries(
      next.messages.map((msg, idx) => {
        const info = messages[idx]
        return [
          info.id,
          msg.parts.map((part) => ({
            ...part,
            messageID: typeof part.messageID === "string" ? part.messageID : info.id,
            sessionID: typeof part.sessionID === "string" ? part.sessionID : info.sessionID,
          })),
        ]
      }),
    )

    batch(() => {
      setSession({
        ...DEFAULT_SESSION,
        ...next.info,
        id,
        title: typeof next.info.title === "string" && next.info.title ? next.info.title : name,
      })
      setState({ messages, parts })
      setLoaded(name)
      setIssue("")
    })
  }

  const importFile = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return

    setIssue("")

    try {
      load(JSON.parse(await file.text()), file.name)
    } catch (err) {
      setIssue(err instanceof Error ? err.message : String(err))
    } finally {
      input.value = ""
    }
  }

  const clearAll = () => {
    batch(() => {
      setState({ messages: [], parts: {} })
      setSession({ ...DEFAULT_SESSION })
      setLoaded("")
      setIssue("")
      seq = 0
    })
  }

  // ---- CSS export ----
  const exportCss = () => {
    const lines: string[] = ["/* Timeline Playground CSS Overrides */", ""]
    const groups = new Map<string, string[]>()

    for (const ctrl of CSS_CONTROLS) {
      const val = css[ctrl.key]
      if (val === undefined) continue
      const value = ctrl.unit ? `${val}${ctrl.unit}` : val
      const group = ctrl.group
      if (!groups.has(group)) groups.set(group, [])
      groups.get(group)!.push(`/* ${ctrl.label}: ${value} */`)
      groups.get(group)!.push(`${ctrl.selector} { ${ctrl.property}: ${value}; }`)
    }

    if (groups.size === 0) {
      lines.push("/* No overrides applied */")
    } else {
      for (const [group, rules] of groups) {
        lines.push(`/* --- ${group} --- */`)
        lines.push(...rules)
        lines.push("")
      }
    }

    const text = lines.join("\n")
    navigator.clipboard.writeText(text).catch(() => {})
    return text
  }

  const [exported, setExported] = createSignal("")

  // ---- Apply to source files ----
  const [applying, setApplying] = createSignal(false)
  const [applyResult, setApplyResult] = createSignal("")

  const changedControls = createMemo(() => CSS_CONTROLS.filter((ctrl) => css[ctrl.key] !== undefined && ctrl.source))

  const applyToSource = async () => {
    const controls = changedControls()
    if (controls.length === 0) return

    setApplying(true)
    setApplyResult("")

    const edits = controls.map((ctrl) => {
      const src = ctrl.source!
      return { file: src.file, anchor: src.anchor, prop: src.prop, value: src.format(css[ctrl.key]!) }
    })

    try {
      const resp = await fetch("/__playground/apply-css", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edits }),
      })
      const data = await resp.json()
      const ok = data.results?.filter((r: any) => r.ok).length ?? 0
      const fail = data.results?.filter((r: any) => !r.ok) ?? []
      const lines = [`Applied ${ok}/${edits.length} edits`]
      for (const f of fail) {
        lines.push(`  FAIL ${f.file} ${f.prop}: ${f.error}`)
      }
      setApplyResult(lines.join("\n"))

      if (ok === edits.length) {
        batch(() => {
          for (const ctrl of controls) {
            setDefaults(ctrl.key, css[ctrl.key]!)
            setCss(ctrl.key, undefined as any)
          }
        })
        updateStyle()
        // Wait for Vite HMR then re-read computed defaults
        setTimeout(readDefaults, 500)
      }
    } catch (err) {
      setApplyResult(`Error: ${err}`)
    } finally {
      setApplying(false)
    }
  }

  // ---- Panel collapse state ----
  const [panels, setPanels] = createStore({
    generators: true,
    css: true,
    export: false,
  })

  // ---- Group collapse state for CSS ----
  const [collapsed, setCollapsed] = createStore<Record<string, boolean>>({})
  const groups = createMemo(() => {
    const result = new Map<string, CSSControl[]>()
    for (const ctrl of CSS_CONTROLS) {
      if (!result.has(ctrl.group)) result.set(ctrl.group, [])
      result.get(ctrl.group)!.push(ctrl)
    }
    return result
  })

  // ---- Shared button styles ----
  const sectionLabel = {
    "font-size": "11px",
    color: "var(--text-weak)",
    "margin-bottom": "4px",
    "text-transform": "uppercase",
    "letter-spacing": "0.5px",
  } as const
  const btnStyle = {
    padding: "4px 8px",
    "border-radius": "4px",
    border: "1px solid var(--border-weak-base)",
    background: "var(--surface-base)",
    cursor: "pointer",
    "font-size": "12px",
    color: "var(--text-base)",
  } as const
  const btnAccent = {
    ...btnStyle,
    border: "1px solid var(--border-interactive-base)",
    background: "var(--surface-interactive-weak)",
    "font-weight": "500",
    color: "var(--text-interactive-base)",
  } as const
  const btnDanger = {
    ...btnStyle,
    border: "1px solid var(--border-critical-base)",
    background: "transparent",
    color: "var(--text-on-critical-base)",
  } as const

  return (
    <div style={{ display: "flex", height: "calc(100vh - 48px)", gap: "0", overflow: "hidden", margin: "-24px" }}>
      {/* Inject dynamic style element */}
      <style ref={styleEl!} />

      {/* Left sidebar: controls */}
      <div
        style={{
          width: "320px",
          "min-width": "320px",
          "border-right": "1px solid var(--border-weak-base)",
          overflow: "auto",
          "background-color": "var(--background-stronger)",
          "scrollbar-width": "none",
        }}
      >
        {/* Generate section */}
        <div style={{ "border-bottom": "1px solid var(--border-weak-base)" }}>
          <button
            style={{
              width: "100%",
              display: "flex",
              "align-items": "center",
              "justify-content": "space-between",
              padding: "10px 12px",
              background: "none",
              border: "none",
              cursor: "pointer",
              "font-weight": "500",
              "font-size": "13px",
              color: "var(--text-strong)",
            }}
            onClick={() => setPanels("generators", (v) => !v)}
          >
            Generate Messages
            <span>{panels.generators ? "−" : "+"}</span>
          </button>
          <Show when={panels.generators}>
            <div style={{ padding: "0 12px 12px", display: "flex", "flex-direction": "column", gap: "6px" }}>
              {/* ---- Session import ---- */}
              <div style={sectionLabel}>Import session</div>
              <div style={{ "font-size": "10px", color: "var(--text-weaker)", "margin-bottom": "2px" }}>
                Replaces the current timeline with an `opencode export` JSON file
              </div>
              <div style={{ display: "flex", "flex-wrap": "wrap", gap: "4px" }}>
                <button style={btnAccent} onClick={() => pick?.click()}>
                  Import session
                </button>
                <input
                  ref={pick!}
                  type="file"
                  accept=".json,application/json"
                  onChange={importFile}
                  style={{ display: "none" }}
                />
              </div>
              <Show when={loaded()}>
                <div style={{ "font-size": "10px", color: "var(--text-weaker)", "line-height": "1.4" }}>
                  {loaded()} • {session().title || session().id} • {state.messages.length} message
                  {state.messages.length === 1 ? "" : "s"}
                </div>
              </Show>
              <Show when={issue()}>
                <div style={{ "font-size": "10px", color: "var(--text-on-critical-base)", "line-height": "1.4" }}>
                  {issue()}
                </div>
              </Show>

              {/* ---- User messages ---- */}
              <div style={sectionLabel}>User messages</div>
              <div style={{ "font-size": "10px", color: "var(--text-weaker)", "margin-bottom": "2px" }}>
                Creates a new turn (user + empty assistant)
              </div>
              <div style={{ display: "flex", "flex-wrap": "wrap", gap: "4px" }}>
                <For each={Object.keys(USER_VARIANTS) as (keyof typeof USER_VARIANTS)[]}>
                  {(key) => (
                    <button style={btnStyle} onClick={() => addUser(key)}>
                      {USER_VARIANTS[key].label}
                    </button>
                  )}
                </For>
              </div>
              <div style={{ display: "flex", "flex-wrap": "wrap", gap: "4px" }}>
                <button
                  style={{
                    ...btnDanger,
                    opacity: userMessages().length === 0 ? "0.5" : "1",
                    cursor: userMessages().length === 0 ? "not-allowed" : "pointer",
                  }}
                  disabled={userMessages().length === 0}
                  onClick={interrupt}
                >
                  Interrupt last
                </button>
              </div>

              {/* ---- Text and reasoning blocks ---- */}
              <div style={{ ...sectionLabel, "margin-top": "8px" }}>Text and reasoning blocks</div>
              <div style={{ "font-size": "10px", color: "var(--text-weaker)", "margin-bottom": "2px" }}>
                Appends to the last turn's assistant parts
              </div>
              <div style={{ display: "flex", "flex-wrap": "wrap", gap: "4px" }}>
                <For each={Object.keys(MARKDOWN_SAMPLES) as (keyof typeof MARKDOWN_SAMPLES)[]}>
                  {(key) => (
                    <button style={btnStyle} onClick={() => addText(key)}>
                      {key}
                    </button>
                  )}
                </For>
                <button style={btnStyle} onClick={addReasoning}>
                  reasoning
                </button>
              </div>

              {/* ---- Tool calls ---- */}
              <div style={{ ...sectionLabel, "margin-top": "8px" }}>Tool calls</div>
              <div style={{ "font-size": "10px", color: "var(--text-weaker)", "margin-bottom": "2px" }}>
                Appends to the last turn's assistant parts
              </div>
              <div style={{ display: "flex", "flex-wrap": "wrap", gap: "4px" }}>
                <For each={Object.keys(TOOL_SAMPLES) as (keyof typeof TOOL_SAMPLES)[]}>
                  {(key) => (
                    <button style={btnStyle} onClick={() => addTool(key)}>
                      {key}
                    </button>
                  )}
                </For>
              </div>

              {/* ---- Composite (full turns) ---- */}
              <div style={{ ...sectionLabel, "margin-top": "8px" }}>Composite turns</div>
              <div style={{ "font-size": "10px", color: "var(--text-weaker)", "margin-bottom": "2px" }}>
                Creates complete user + assistant turns
              </div>
              <div style={{ display: "flex", "flex-wrap": "wrap", gap: "4px" }}>
                <button style={btnStyle} onClick={addContextGroupTurn}>
                  context group
                </button>
                <button style={btnStyle} onClick={addReasoningFullTurn}>
                  full turn
                </button>
                <button style={btnAccent} onClick={addKitchenSink}>
                  kitchen sink
                </button>
              </div>

              <div style={{ "margin-top": "8px" }}>
                <button style={btnDanger} onClick={clearAll}>
                  Clear all
                </button>
              </div>
            </div>
          </Show>
        </div>

        {/* CSS Controls section */}
        <div style={{ "border-bottom": "1px solid var(--border-weak-base)" }}>
          <button
            style={{
              width: "100%",
              display: "flex",
              "align-items": "center",
              "justify-content": "space-between",
              padding: "10px 12px",
              background: "none",
              border: "none",
              cursor: "pointer",
              "font-weight": "500",
              "font-size": "13px",
              color: "var(--text-strong)",
            }}
            onClick={() => setPanels("css", (v) => !v)}
          >
            CSS Controls
            <span>{panels.css ? "−" : "+"}</span>
          </button>
          <Show when={panels.css}>
            <div style={{ padding: "0 12px 12px" }}>
              <button
                style={{
                  padding: "4px 8px",
                  "border-radius": "4px",
                  border: "1px solid var(--border-weak-base)",
                  background: "var(--surface-base)",
                  cursor: "pointer",
                  "font-size": "11px",
                  color: "var(--text-base)",
                  "margin-bottom": "8px",
                }}
                onClick={resetCss}
              >
                Reset all
              </button>

              <For each={[...groups().entries()]}>
                {([group, controls]) => (
                  <div style={{ "margin-bottom": "4px" }}>
                    <button
                      style={{
                        width: "100%",
                        display: "flex",
                        "align-items": "center",
                        "justify-content": "space-between",
                        padding: "6px 0",
                        background: "none",
                        border: "none",
                        "border-bottom": "1px solid var(--border-weaker-base)",
                        cursor: "pointer",
                        "font-size": "11px",
                        "font-weight": "500",
                        color: "var(--text-base)",
                        "text-transform": "uppercase",
                        "letter-spacing": "0.5px",
                      }}
                      onClick={() => setCollapsed(group, (v) => !v)}
                    >
                      {group}
                      <span style={{ "font-size": "10px" }}>{collapsed[group] ? "+" : "−"}</span>
                    </button>
                    <Show when={!collapsed[group]}>
                      <div style={{ padding: "6px 0", display: "flex", "flex-direction": "column", gap: "8px" }}>
                        <For each={controls}>
                          {(ctrl) => (
                            <div style={{ display: "flex", "flex-direction": "column", gap: "2px" }}>
                              <div
                                style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}
                              >
                                <label
                                  style={{
                                    "font-size": "11px",
                                    color: "var(--text-base)",
                                  }}
                                >
                                  {ctrl.label}
                                </label>
                                <span
                                  style={{
                                    "font-size": "11px",
                                    color:
                                      css[ctrl.key] !== undefined ? "var(--text-interactive-base)" : "var(--text-weak)",
                                    "font-family": "var(--font-family-mono)",
                                    "min-width": "40px",
                                    "text-align": "right",
                                  }}
                                >
                                  {css[ctrl.key] ?? defaults[ctrl.key] ?? ctrl.initial}
                                  {ctrl.unit ?? ""}
                                </span>
                              </div>
                              <input
                                type="range"
                                min={ctrl.min ?? "0"}
                                max={ctrl.max ?? "100"}
                                step={ctrl.step ?? "1"}
                                value={css[ctrl.key] ?? defaults[ctrl.key] ?? ctrl.initial}
                                onInput={(e) => setCssValue(ctrl.key, e.currentTarget.value)}
                                style={{
                                  width: "100%",
                                  height: "4px",
                                  "accent-color": "var(--text-interactive-base)",
                                  cursor: "pointer",
                                }}
                              />
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>

        {/* Export section */}
        <div style={{ "border-bottom": "1px solid var(--border-weak-base)" }}>
          <button
            style={{
              width: "100%",
              display: "flex",
              "align-items": "center",
              "justify-content": "space-between",
              padding: "10px 12px",
              background: "none",
              border: "none",
              cursor: "pointer",
              "font-weight": "500",
              "font-size": "13px",
              color: "var(--text-strong)",
            }}
            onClick={() => setPanels("export", (v) => !v)}
          >
            Export CSS
            <span>{panels.export ? "−" : "+"}</span>
          </button>
          <Show when={panels.export}>
            <div style={{ padding: "0 12px 12px", display: "flex", "flex-direction": "column", gap: "8px" }}>
              <button style={btnAccent} onClick={() => setExported(exportCss())}>
                Copy CSS to clipboard
              </button>
              <button
                style={{
                  ...btnAccent,
                  opacity: changedControls().length === 0 || applying() ? "0.5" : "1",
                  cursor: changedControls().length === 0 || applying() ? "not-allowed" : "pointer",
                }}
                disabled={changedControls().length === 0 || applying()}
                onClick={applyToSource}
              >
                {applying()
                  ? "Applying..."
                  : `Apply ${changedControls().length} edit${changedControls().length === 1 ? "" : "s"} to source`}
              </button>
              <Show when={changedControls().length > 0}>
                <div
                  style={{
                    "font-size": "10px",
                    color: "var(--text-weaker)",
                    "line-height": "1.4",
                  }}
                >
                  <For each={changedControls()}>
                    {(ctrl) => (
                      <div>
                        {ctrl.source!.file}: {ctrl.property} = {css[ctrl.key]}
                        {ctrl.unit}
                      </div>
                    )}
                  </For>
                </div>
              </Show>
              <Show when={applyResult()}>
                <pre
                  style={{
                    padding: "8px",
                    "border-radius": "4px",
                    background: "var(--surface-inset-base)",
                    border: "1px solid var(--border-weak-base)",
                    "font-size": "11px",
                    "font-family": "var(--font-family-mono)",
                    "line-height": "1.5",
                    "white-space": "pre-wrap",
                    "word-break": "break-all",
                    "max-height": "200px",
                    "overflow-y": "auto",
                    color: "var(--text-base)",
                  }}
                >
                  {applyResult()}
                </pre>
              </Show>
              <Show when={exported()}>
                <pre
                  style={{
                    padding: "8px",
                    "border-radius": "4px",
                    background: "var(--surface-inset-base)",
                    border: "1px solid var(--border-weak-base)",
                    "font-size": "11px",
                    "font-family": "var(--font-family-mono)",
                    "line-height": "1.5",
                    "white-space": "pre-wrap",
                    "word-break": "break-all",
                    "max-height": "300px",
                    "overflow-y": "auto",
                    color: "var(--text-base)",
                  }}
                >
                  {exported()}
                </pre>
              </Show>
            </div>
          </Show>
        </div>
      </div>

      {/* Main area: timeline preview */}
      <div
        ref={previewRef!}
        style={{ flex: "1", overflow: "auto", "min-width": "0", "background-color": "var(--background-stronger)" }}
      >
        <DataProvider data={data()} directory="/project">
          <FileComponentProvider component={FileStub}>
            <div
              style={{
                "max-width": "800px",
                margin: "0 auto",
                padding: "16px 0",
              }}
            >
              <Show
                when={userMessages().length > 0}
                fallback={
                  <div
                    style={{
                      display: "flex",
                      "align-items": "center",
                      "justify-content": "center",
                      height: "400px",
                      color: "var(--text-weak)",
                      "font-size": "14px",
                    }}
                  >
                    Click a generator button or import a session
                  </div>
                }
              >
                <div
                  role="log"
                  data-slot="session-turn-list"
                  style={{ display: "flex", "flex-direction": "column", width: "100%", padding: "0 20px" }}
                >
                  <For each={userMessages()}>
                    {(msg) => (
                      <div style={{ width: "100%" }}>
                        <SessionTurn
                          sessionID={session().id}
                          messageID={msg.id}
                          messages={state.messages}
                          active={false}
                          showReasoningSummaries={true}
                          shellToolDefaultOpen={true}
                          editToolDefaultOpen={true}
                          classes={{
                            root: "min-w-0 w-full relative",
                            content: "flex flex-col justify-between !overflow-visible",
                            container: "w-full",
                          }}
                        />
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </FileComponentProvider>
        </DataProvider>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Story export
// ---------------------------------------------------------------------------
export default {
  title: "Playground/Timeline",
  id: "playground-timeline",
  parameters: {
    layout: "fullscreen",
  },
}

export const Basic = {
  render: () => <Playground />,
}
