import { base64Encode } from "@opencode-ai/core/util/encode"
import type { Page } from "@playwright/test"
import { mockOpenCodeServer } from "../../utils/mock-server"
import { expectAppVisible, expectSessionTitle } from "../../utils/waits"
import { expect } from "../benchmark"

const directory = "C:/OpenCode/TimelineStateRegression"
const projectID = "proj_timeline_state_regression"
const sessionID = "ses_timeline_state_regression"
const userMessageID = "msg_user_regression"
const assistantMessageID = "msg_assistant_regression"
const editPartID = "prt_0001_edit"
export const textPartID = "prt_9999_text"
const title = "Timeline collapse state regression"
const model = { providerID: "opencode", modelID: "claude-opus-4-6", variant: "max" }

type EventPayload = {
  directory: string
  payload: Record<string, unknown>
}

const userMessage = {
  info: {
    id: userMessageID,
    sessionID,
    role: "user",
    time: { created: 1700000000000 },
    summary: { diffs: [] },
    agent: "build",
    model,
  },
  parts: [
    {
      id: "prt_user_text",
      sessionID,
      messageID: userMessageID,
      type: "text",
      text: "Please edit the file.",
    },
  ],
}

const editPart = {
  id: editPartID,
  sessionID,
  messageID: assistantMessageID,
  type: "tool",
  callID: "call_edit_regression",
  tool: "edit",
  state: {
    status: "completed",
    input: { filePath: "src/regression.ts" },
    output: "Edited src/regression.ts",
    title: "src/regression.ts",
    metadata: {
      filediff: {
        file: "src/regression.ts",
        additions: 1,
        deletions: 1,
        before: "export const value = 'before'\n",
        after: "export const value = 'after'\n",
      },
      diff: "diff --git a/src/regression.ts b/src/regression.ts\n-export const value = 'before'\n+export const value = 'after'\n",
    },
    time: { start: 1700000001000, end: 1700000002000 },
  },
}

const streamedTextPart = {
  id: textPartID,
  sessionID,
  messageID: assistantMessageID,
  type: "text",
  text: "Streaming added a later assistant text part.",
}

const assistantMessage = {
  info: {
    id: assistantMessageID,
    sessionID,
    role: "assistant",
    time: { created: 1700000001000 },
    parentID: userMessageID,
    modelID: model.modelID,
    providerID: model.providerID,
    mode: "build",
    agent: "build",
    path: { cwd: directory, root: directory },
    cost: 0.01,
    tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
    variant: "max",
  },
  parts: [editPart],
}

export async function setupTimelineBenchmark(
  page: Page,
  options: {
    historyTurns: number
    eventBatch: number
    newLayoutDesigns?: boolean
    vcsDiff?: unknown[]
    turnDiffs?: unknown[]
  },
) {
  const events: EventPayload[] = []
  let eventBatch = options.eventBatch
  const currentUserMessage = options.turnDiffs
    ? { ...userMessage, info: { ...userMessage.info, summary: { diffs: options.turnDiffs } } }
    : userMessage
  await mockOpenCodeServer(page, {
    directory,
    project: project(),
    provider: provider(),
    sessions: [session()],
    vcsDiff: options.vcsDiff,
    pageMessages: () => ({
      items: [
        ...Array.from({ length: options.historyTurns }, (_, index) => performanceTurn(index)).flat(),
        currentUserMessage,
        assistantMessage,
      ],
    }),
    events: () => events.splice(0, eventBatch),
    eventRetry: 16,
  })
  await page.addInitScript(
    (input) => {
      localStorage.setItem(
        "settings.v3",
        JSON.stringify({
          general: {
            newLayoutDesigns: input.newLayoutDesigns,
            editToolPartsExpanded: true,
            shellToolPartsExpanded: true,
            showReasoningSummaries: true,
          },
        }),
      )
    },
    { newLayoutDesigns: options.newLayoutDesigns ?? false },
  )
  await page.setViewportSize({ width: 1366, height: 768 })
  const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
  const text = page.locator(`[data-timeline-part-id="${textPartID}"]`).first()
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectSessionTitle(page, title)
  await expectAppVisible(scroller)
  return {
    scroller,
    text,
    transport: {
      enqueue(payload: EventPayload | EventPayload[]) {
        events.push(...(Array.isArray(payload) ? payload : [payload]))
      },
      pendingCount() {
        return events.length
      },
      releaseAll() {
        eventBatch = events.length
      },
    },
    async scrollToBottom() {
      await scroller.evaluate((element) => {
        element.scrollTop = element.scrollHeight
      })
    },
    async waitForStableGeometry() {
      await expect
        .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
        .toBeLessThanOrEqual(1)
      await page.waitForFunction((partID) => {
        const root = [...document.querySelectorAll<HTMLElement>(".scroll-view__viewport")].find((element) =>
          element.querySelector(`[data-timeline-part-id="${partID}"]`),
        )
        if (!root) return false
        return new Promise<boolean>((resolve) => {
          const height = root.scrollHeight
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              resolve(root.scrollHeight === height && root.scrollHeight - root.clientHeight - root.scrollTop <= 1),
            ),
          )
        })
      }, textPartID)
    },
  }
}

export function buildInitialStreamEvent(deltaCount: number): EventPayload {
  return {
    directory,
    payload: {
      type: "message.part.updated",
      properties: {
        part: {
          ...streamedTextPart,
          text: `Streaming${streamChunk(0, deltaCount + 1)}\n\n\`\`\`ts\nconst initial = true\n\`\`\``,
        },
      },
    },
  }
}

export function buildStreamDeltaEvents(deltaCount: number): EventPayload[] {
  return Array.from({ length: deltaCount }, (_, index) => ({
    directory,
    payload: {
      type: "message.part.delta",
      properties: {
        messageID: assistantMessageID,
        partID: textPartID,
        field: "text",
        delta: streamChunk(index + 1, deltaCount + 1),
      },
    },
  }))
}

function performanceTurn(index: number) {
  const suffix = String(index).padStart(4, "0")
  const userID = `msg_0000_${suffix}_a_user`
  const assistantID = `msg_0000_${suffix}_b_assistant`
  const before = historicalSource(index, false)
  const after = historicalSource(index, true)
  const parts = [
    ...(index % 5 === 0
      ? [
          {
            id: `prt_0000_${suffix}_reasoning`,
            sessionID,
            messageID: assistantID,
            type: "reasoning",
            text: `Reviewing the existing implementation. ${"constraint analysis ".repeat(20)}`,
            time: { start: 1690000001000 + index * 2_000, end: 1690000001200 + index * 2_000 },
          },
        ]
      : []),
    {
      id: `prt_0000_${suffix}_assistant`,
      sessionID,
      messageID: assistantID,
      type: "text",
      text: historicalMarkdown(index),
    },
    ...(index % 8 === 0
      ? [
          {
            id: `prt_0000_${suffix}_edit`,
            sessionID,
            messageID: assistantID,
            type: "tool",
            callID: `call_0000_${suffix}_edit`,
            tool: "edit",
            state: {
              status: "completed",
              input: { filePath: `src/history-${index}.ts` },
              output: `Edited src/history-${index}.ts`,
              title: `src/history-${index}.ts`,
              metadata: {
                filediff: { file: `src/history-${index}.ts`, additions: 48, deletions: 48, before, after },
              },
              time: { start: 1690000001200 + index * 2_000, end: 1690000001400 + index * 2_000 },
            },
          },
        ]
      : []),
    ...(index % 12 === 0
      ? [
          {
            id: `prt_0000_${suffix}_write`,
            sessionID,
            messageID: assistantID,
            type: "tool",
            callID: `call_0000_${suffix}_write`,
            tool: "write",
            state: {
              status: "completed",
              input: { filePath: `src/generated-${index}.tsx`, content: after },
              output: `Wrote src/generated-${index}.tsx`,
              title: `src/generated-${index}.tsx`,
              metadata: {
                filediff: { file: `src/generated-${index}.tsx`, additions: 32, deletions: 0, before: "", after },
              },
              time: { start: 1690000001400 + index * 2_000, end: 1690000001500 + index * 2_000 },
            },
          },
        ]
      : []),
    ...(index % 16 === 0
      ? [
          {
            id: `prt_0000_${suffix}_patch`,
            sessionID,
            messageID: assistantID,
            type: "tool",
            callID: `call_0000_${suffix}_patch`,
            tool: "patch",
            state: {
              status: "completed",
              input: { patchText: realisticPatch(index) },
              output: "Success. Updated src/components/SessionCard.tsx",
              title: "src/components/SessionCard.tsx",
              metadata: {
                files: [
                  {
                    filePath: "src/components/SessionCard.tsx",
                    relativePath: "src/components/SessionCard.tsx",
                    type: "update",
                    additions: 8,
                    deletions: 3,
                    patch: realisticPatch(index),
                    before,
                    after,
                  },
                ],
              },
              time: { start: 1690000001500 + index * 2_000, end: 1690000001700 + index * 2_000 },
            },
          },
        ]
      : []),
  ]
  return [
    {
      info: {
        id: userID,
        sessionID,
        role: "user",
        time: { created: 1690000000000 + index * 2_000 },
        summary: { diffs: [] },
        agent: "build",
        model,
      },
      parts: [
        {
          id: `prt_0000_${suffix}_user`,
          sessionID,
          messageID: userID,
          type: "text",
          text: `Historical prompt ${index}`,
        },
      ],
    },
    {
      info: {
        id: assistantID,
        sessionID,
        role: "assistant",
        time: { created: 1690000001000 + index * 2_000, completed: 1690000001500 + index * 2_000 },
        parentID: userID,
        modelID: model.modelID,
        providerID: model.providerID,
        mode: "build",
        agent: "build",
        path: { cwd: directory, root: directory },
        cost: 0.01,
        tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
        variant: "max",
        finish: "stop",
      },
      parts,
    },
  ]
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

export function streamChunk(index: number, count: number) {
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
