import { base64Encode } from "@opencode/util/encode"
import type {
  JsonValue,
  OpenCodeEvent,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
} from "@opencode/client/promise"
import type { Page } from "@playwright/test"
import { timelinePresets } from "@opencode/session-ui/timeline/detail"
import { createTwoFilesPatch } from "diff"
import { mockOpenCodeServer } from "../../e2e/utils/mock-server"
import { eventSource } from "./events"

const directory = "C:/OpenCode/TimelineStateRegression"

const projectID = "proj_timeline_state_regression"

const sessionID = "ses_timeline_state_regression"

const userMessageID = "msg_user_regression"

const assistantMessageID = "msg_assistant_regression"

const editPartID = "prt_0001_edit"

const title = "Timeline collapse state regression"

const model = { providerID: "opencode", modelID: "claude-opus-4-6", variant: "max" }

/** The session's scroll container. */
export const timeline = ".scroll-view__viewport:has([data-timeline-row])"

export const composer = '[data-component="composer-editor"]'

/** The streamed reply's text part; its last delta ends with "benchmark-complete". */
export const reply = `[data-timeline-part-id="${assistantMessageID}:text:0"]`

/** The oldest user prompt, "Historical prompt 0", at the top of the history. */
export const oldestPrompt = '[data-timeline-part-id="msg_0000_0000_a_user:text:0"]'

const userMessage = {
  id: userMessageID,
  type: "user",
  time: { created: 1700000000000 },
  text: "Please edit the file.",
} satisfies SessionMessageInfo

const editPart = tool({
  id: editPartID,
  name: "edit",
  input: {
    path: "src/regression.ts",
    oldString: "export const value = 'before'",
    newString: "export const value = 'after'",
  },
  output: "Edited src/regression.ts",
  files: [currentFile("src/regression.ts", "export const value = 'before'\n", "export const value = 'after'\n", 1, 1)],
  at: 1700000001000,
  took: 1000,
})

type TimelineOptions = {
  /** The mocked server's origin: a production build is its own server. */
  server: string
  historyTurns: number
  /** Six completed file reads in every answer of the history. */
  toolHeavy?: boolean
  /** Reports the session as running, as while a reply streams. */
  busy?: boolean
  /** The workspace's changed files, for the review pane. */
  vcsDiff?: unknown[]
  /** Edits listed one per file and collapsed, each file opening on its own (by default they start open). */
  collapsedEdits?: boolean
  /** The last assistant turn's tool parts, in place of its one small edit. */
  tools?: SessionMessageAssistant["content"]
  /** Events arrive from a real SSE endpoint (`source`); otherwise the mock's own stream stays idle. */
  stream?: boolean
}

/**
 * Mocks the server for one long session under the variant's own origin, without navigating: strobe owns navigation
 * and timing. Returns the session's path and, with `stream`, the event source that delivers a reply.
 */
export async function mockTimelineSession(page: Page, options: TimelineOptions) {
  const messages = [
    ...Array.from({ length: options.historyTurns }, (_, index) => performanceTurn(index))
      .flat()
      .map((message) =>
        options.toolHeavy && message.type === "assistant"
          ? {
              ...message,
              content: [
                ...Array.from({ length: 6 }, (_, index) =>
                  tool({
                    id: `${message.id}:read:${index}`,
                    name: "read",
                    input: { path: `src/session/module-${index}.ts` },
                    output: historicalSource(index, false),
                    at: message.time.created,
                    took: 100,
                  }),
                ),
                ...message.content,
              ],
            }
          : message,
      ),
    userMessage,
    {
      id: assistantMessageID,
      type: "assistant",
      time: { created: 1700000001000 },
      model: { id: model.modelID, providerID: model.providerID, variant: model.variant },
      agent: "build",
      cost: 0.01,
      tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
      content: options.tools ?? [editPart],
    } satisfies SessionMessageInfo,
  ]

  const source = options.stream ? await eventSource(page, options.server) : undefined

  await mockOpenCodeServer(page, {
    server: options.server,
    directory,
    project: project(),
    provider: provider(),
    sessions: [session()],
    vcsDiff: options.vcsDiff,
    sessionStatus: options.busy ? { [sessionID]: { type: "busy" } } : undefined,
    pageMessages: () => ({ items: messages }),
  })
  await page.addInitScript((general) => localStorage.setItem("settings.v3", JSON.stringify({ general })), {
    editToolPartsExpanded: true,
    shellToolPartsExpanded: true,
    showReasoningSummaries: true,
    timelineDetail: options.collapsedEdits
      ? { ...timelinePresets[2].value, edit: { placement: "separate", details: "collapsed" } }
      : undefined,
  })

  return { path: `/server/${base64Encode(options.server)}/session/${sessionID}`, source }
}

/** Answers `/vcs/diff` with `files` serialized once: tens of megabytes would otherwise be encoded per request. */
export function serveDiffs(page: Page, files: unknown[]) {
  const body = JSON.stringify({
    location: { directory, project: { id: projectID, directory, canonical: directory } },
    data: files,
  })

  return page.route("**/vcs/diff**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body,
    }),
  )
}

/** A streamed reply of `deltas` markdown deltas after its first: a paragraph, a table and a code fence, repeating. */
export function streamedReply(deltas: number) {
  return {
    start: [
      {
        ...envelope(),
        type: "session.text.started",
        durable: { aggregateID: sessionID, seq: eventSequence, version: 1 },
        data: { sessionID, assistantMessageID, ordinal: 0 },
      } satisfies Extract<OpenCodeEvent, { type: "session.text.started" }>,
      delta(`Streaming${streamChunk(0, deltas + 1)}\n\n\`\`\`ts\nconst initial = true\n\`\`\``),
    ],
    deltas: Array.from({ length: deltas }, (_, index) => delta(streamChunk(index + 1, deltas + 1))),
  }
}

function performanceTurn(index: number) {
  const suffix = String(index).padStart(4, "0")
  const assistantID = `msg_0000_${suffix}_b_assistant`
  const before = historicalSource(index, false)
  const after = historicalSource(index, true)
  const at = 1690000001000 + index * 2_000
  const content: SessionMessageAssistant["content"] = []

  if (index % 5 === 0)
    content.push({
      type: "reasoning",
      text: `Reviewing the existing implementation. ${"constraint analysis ".repeat(20)}`,
      time: { created: at, completed: at + 200 },
    })
  content.push({ type: "text", text: historicalMarkdown(index) })

  if (index % 8 === 0)
    content.push(
      tool({
        id: `prt_0000_${suffix}_edit`,
        name: "edit",
        input: { path: `src/history-${index}.ts`, oldString: before, newString: after },
        output: `Edited src/history-${index}.ts`,
        files: [currentFile(`src/history-${index}.ts`, before, after, 48, 48)],
        at: at + 200,
        took: 200,
      }),
    )

  if (index % 12 === 0)
    content.push(
      tool({
        id: `prt_0000_${suffix}_write`,
        name: "write",
        input: { path: `src/generated-${index}.tsx`, content: after },
        output: `Wrote src/generated-${index}.tsx`,
        files: [currentFile(`src/generated-${index}.tsx`, "", after, 32, 0)],
        at: at + 400,
        took: 100,
      }),
    )

  if (index % 16 === 0)
    content.push(
      tool({
        id: `prt_0000_${suffix}_patch`,
        name: "patch",
        input: { patchText: realisticPatch(index) },
        output: "Success. Updated src/components/SessionCard.tsx",
        files: [currentFile("src/components/SessionCard.tsx", before, after, 8, 3)],
        at: at + 500,
        took: 200,
      }),
    )

  return [
    {
      id: `msg_0000_${suffix}_a_user`,
      type: "user",
      time: { created: at - 1_000 },
      text: `Historical prompt ${index}`,
    },
    {
      id: assistantID,
      type: "assistant",
      time: { created: at, completed: at + 500 },
      model: { id: model.modelID, providerID: model.providerID, variant: model.variant },
      agent: "build",
      cost: 0.01,
      tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
      finish: "stop",
      content,
    },
  ] satisfies SessionMessageInfo[]
}

/** A completed tool call: its input, its text output, and the files it changed, from `at` for `took` ms. */
function tool(input: {
  id: string
  name: string
  input: Record<string, JsonValue>
  output: string
  files?: ReturnType<typeof currentFile>[]
  at: number
  took: number
}): SessionMessageAssistantTool {
  return {
    type: "tool",
    id: input.id,
    name: input.name,
    time: { created: input.at, ran: input.at, completed: input.at + input.took },
    state: {
      status: "completed",
      input: input.input,
      content: [{ type: "text", text: input.output }],
      metadata: input.files ? { files: input.files } : {},
    },
  }
}

let eventSequence = 0

function envelope() {
  eventSequence++

  return {
    id: `evt_timeline_benchmark_${eventSequence}`,
    created: 1700000002000 + eventSequence,
    location: { directory },
  }
}

function delta(text: string) {
  return {
    ...envelope(),
    type: "session.text.delta",
    data: { sessionID, assistantMessageID, ordinal: 0, delta: text },
  } satisfies Extract<OpenCodeEvent, { type: "session.text.delta" }>
}

function historicalMarkdown(index: number) {
  const code = `import { For, Show, createSignal } from "solid-js"

type SessionRow = { id: string; title: string; active: boolean }

export function SessionList(props: { rows: SessionRow[] }) {
  const [selected, setSelected] = createSignal<string>()
  return (
    <section aria-label="Sessions">
      <For each={props.rows}>{(row) => (
        <button classList={{ active: row.active }} onClick={() => setSelected(row.id)}>
          <Show when={selected() === row.id} fallback={row.title}>{row.title.toUpperCase()}</Show>
        </button>
      )}</For>
    </section>
  )
}`

  return `## Session renderer review ${index}

The active session keeps **semantic row identity** while reconciling measured content. See [Solid documentation](https://docs.solidjs.com/) and the inline \`measureElement(node)\` call.

| Concern | Current behavior | Verification |
| --- | --- | --- |
| streaming | appends Markdown blocks | painted frames |
| geometry | anchors visible rows | DOM coordinates |
| tools | preserves expanded state | keyed remount probe |

> Long sessions combine Markdown, syntax highlighting, tool output, and asynchronously rendered diffs.

${index % 4 === 0 ? `\`\`\`tsx\n${code}\n\`\`\`\n\n\`\`\`bash\nbun typecheck\nbun test --preload ./happydom.ts ./src/pages/session\ngit diff --check\n\`\`\`` : "- preserve the viewport anchor\n- avoid replacing stable Markdown nodes\n- process provider deltas without blocking input"}`
}

function historicalSource(index: number, updated: boolean) {
  const method = updated ? "toLocaleUpperCase(props.locale)" : "toUpperCase()"
  const limit = updated ? 24 : 20

  return `import { createMemo, For } from "solid-js"

type Message = {
  id: string
  role: "user" | "assistant"
  text: string
  tokens: { input: number; output: number }
}

export function MessageSummary(props: { messages: Message[]; locale: string }) {
  const visible = createMemo(() => props.messages.filter((message) => message.text.trim()).slice(-${limit}))
  const total = createMemo(() => visible().reduce((sum, message) => sum + message.tokens.output, 0))
  return (
    <article data-session-index="${index}">
      <header>{total().toLocaleString(props.locale)} output tokens</header>
      <For each={visible()}>{(message) => <p data-role={message.role}>{message.text.${method}}</p>}</For>
    </article>
  )
}
`
}

function currentFile(file: string, before: string, after: string, additions: number, deletions: number) {
  return {
    file,
    patch: createTwoFilesPatch(`a/${file}`, `b/${file}`, before, after),
    additions,
    deletions,
    status: before ? (after ? "modified" : "deleted") : "added",
  }
}

function realisticPatch(index: number) {
  return `*** Begin Patch
*** Update File: src/components/SessionCard.tsx
@@
-const title = props.session.title.toUpperCase()
-const messages = props.messages.slice(-20)
+const title = props.session.title.toLocaleUpperCase(props.locale)
+const messages = props.messages.filter((message) => message.text.trim()).slice(-24)
+const outputTokens = messages.reduce((sum, message) => sum + message.tokens.output, 0)
@@
-  <h2>{title}</h2>
+  <h2 data-session-index="${index}">{title}</h2>
+  <span>{outputTokens.toLocaleString(props.locale)} output tokens</span>
*** End Patch`
}

function streamChunk(index: number, count: number) {
  if (index === 0) return `\n\n## Implementation plan\n\nStreaming **bold analysis`

  if (index === count - 1)
    return `\n\`\`\`\n\n## Verification\n\n- **Typecheck:** passed\n- **Timeline geometry:** stable\n- **Streaming output:** benchmark-complete <!-- stream-${index} -->`

  const section = Math.floor(index / 18) + 1

  const fragments = [
    ` continues across three`,
    ` or four word`,
    ` provider deltas and`,
    ` closes in this fragment**. <!-- stream-${index} -->\n\n`,
    `| Concern | State`,
    ` | Verification |\n|`,
    ` --- | ---`,
    ` | --- |\n|`,
    ` markdown | incremental |`,
    ` painted frames | <!-- stream-${index} -->\n\n`,
    `\`\`\`tsx\nconst row: SessionRow`,
    ` = rows[index] ??`,
    ` fallback\nconst title =`,
    ` row.title.toLocaleUpperCase(locale)\n`,
    `const selected = createMemo(()`,
    ` => row.id ===`,
    ` activeID()) // stream-${index}\n`,
    `// stream-${index}\n\`\`\`\n\n### Iteration ${section}\n\nStreaming **bold analysis`,
  ]

  return fragments[(index - 1) % fragments.length]!
}

function project() {
  return {
    id: projectID,
    worktree: directory,
    vcs: "git",
    name: "timeline-state-regression",
    time: { created: 1700000000000, updated: 1700000000000 },
    sandboxes: [],
  }
}

function session() {
  return {
    id: sessionID,
    slug: "timeline-state-regression",
    projectID,
    directory,
    title,
    version: "dev",
    time: { created: 1700000000000, updated: 1700000000000 },
  }
}

function provider() {
  return {
    all: [
      {
        id: "opencode",
        name: "OpenCode",
        models: { "claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6", limit: { context: 200_000 } } },
      },
    ],
    connected: ["opencode"],
    default: { providerID: "opencode", modelID: "claude-opus-4-6" },
  }
}
