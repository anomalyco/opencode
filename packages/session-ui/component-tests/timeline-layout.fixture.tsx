import { For, batch, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import { DialogProvider } from "@opencode/ui/context/dialog"
import type { SessionMessageAssistantTool } from "@opencode/client/promise"
import type { SessionDocument } from "../src/document"
import { CurrentSessionProviders } from "../src/storybook/current-session-story"
import { CURRENT_SESSION_ID, STORY_MODEL, STORY_TIME } from "../src/storybook/current-session-fixtures"
import { createReactiveTimelineProjection, TimelineRow } from "../src/timeline/projection"
import { createSessionTimelineRowRenderer } from "../src/timeline/session-timeline-row"
import { readTimelineTypography } from "../src/timeline/text-layout"

const prompts = [
  "Short prompt.",
  "A prompt whose wrapping must match the bubble width. ".repeat(12),
  "Preserve these newlines.\n\nAnd this indented line:\n    indentation is meaningful.",
  "日本語の会話を読みながら English words and emoji 🦊🌿 move between lines. ".repeat(7),
  "Show the implementation.",
  "Explain the sequence.",
]
const replies = [
  "A short response.",
  "Ordinary prose wraps at the same width before and after it is mounted. ".repeat(9),
  "## A heading\n\nA **strong phrase** followed by `inline code` and more prose.\n\nAnother paragraph.",
  "日本語の返答と English text share a paragraph. ".repeat(9),
  "Here is the code.\n\n```ts\nconst long = 'a deliberately long non-wrapping source line that must not change the row height when the column narrows';\nconsole.log(long)\n```\n\nThe result stays selectable.",
  "A list with nested items.\n\n- First item with **emphasis** and enough prose to wrap in the narrow column.\n- Second item\n  - Nested item with more detail.\n  - Another nested item.\n\n1. An ordered step.\n2. Another ordered step.\n\n> A quoted paragraph that should wrap and retain its ordinary paragraph height.\n\nA closing paragraph.",
]
const documentFixture: SessionDocument = {
  sessionID: CURRENT_SESSION_ID,
  status: { type: "idle" },
  diffs: [],
  messages: prompts.flatMap<SessionDocument["messages"][number]>((text, index) => [
    {
      id: `layout-user-${index}`,
      type: "user" as const,
      text,
      files:
        index === 1
          ? Array.from({ length: 7 }, (_, image) => ({
              mime: "image/svg+xml",
              name: `image-${image}.svg`,
              data: "",
              source: {
                type: "uri" as const,
                uri: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='200'%3E%3Crect width='400' height='200' fill='steelblue'/%3E%3C/svg%3E",
              },
            }))
          : undefined,
      time: { created: STORY_TIME + index * 2 },
      metadata: { agent: "build", model: STORY_MODEL },
    },
    {
      id: `layout-assistant-${index}`,
      type: "assistant" as const,
      agent: "build",
      model: STORY_MODEL,
      content: [
        ...(index === 0
          ? [
              {
                type: "reasoning" as const,
                text: "Inspect the existing implementation.",
                time: { created: STORY_TIME, completed: STORY_TIME + 1 },
              },
              {
                type: "tool" as const,
                id: "layout-read",
                name: "read",
                state: {
                  status: "completed" as const,
                  input: { path: "packages/app/src/session/timeline/virtualizer.tsx" },
                  content: [{ type: "text" as const, text: "Source content." }],
                },
                time: { created: STORY_TIME, ran: STORY_TIME, completed: STORY_TIME + 1 },
              } satisfies SessionMessageAssistantTool,
            ]
          : []),
        { type: "text" as const, text: replies[index]! },
      ],
      time: { created: STORY_TIME + index * 2, completed: STORY_TIME + index * 2 + 1 },
    },
  ]),
}

let inspect = () => [] as { key: string; source: string; expected?: number; actual: number }[]
let resize = (_width: number) => {}
let stream = (_text: string, _complete: boolean) => {}
let reasoning = (_text: string) => {}

export async function mountTimelineLayout(width: number) {
  const host = document.createElement("div")
  host.dataset.testid = "timeline-layout-fixture"
  document.body.append(host)
  const typography = readTimelineTypography(host, 1)
  const text = [...prompts, ...replies].join("")
  await Promise.all([
    document.fonts.load(`${typography.weight} ${typography.size}px ${typography.family}`, text),
    document.fonts.load(`${typography.medium} ${typography.size}px ${typography.family}`, text),
    document.fonts.load(`${typography.weight} ${typography.size}px ${typography.codeFamily}`, text),
  ])
  function Fixture() {
    const [state, setState] = createStore({ width, open: false, document: structuredClone(documentFixture) })
    const projection = createReactiveTimelineProjection({
      sessionMessages: () => state.document.messages,
      status: () => state.document.status,
      reasoningMode: () => "compact",
      shellToolDefaultOpen: () => false,
      editToolDefaultOpen: () => false,
    })
    const renderer = createSessionTimelineRowRenderer({
      sessionID: () => documentFixture.sessionID,
      status: () => state.document.status,
      projection,
      presentation: () => undefined,
      reasoningMode: () => "compact",
      shellToolDefaultOpen: () => false,
      editToolDefaultOpen: () => false,
      disclosure: { value: () => (state.open ? true : undefined), set: () => {} },
    })
    // Calculate before constructing row DOM. The sample below never feeds a height back into the model.
    const sizes = createMemo(() =>
      projection.rows().map((row) =>
        renderer.layout(row, {
          width: state.width,
          desktop: matchMedia("(min-width: 768px)").matches,
          typography,
        }),
      ),
    )
    resize = (width) => setState("width", width)
    stream = (text, complete) =>
      batch(() => {
        setState("document", "status", { type: complete ? "idle" : "busy" })
        setState("document", "messages", state.document.messages.length - 1, {
          id: `layout-assistant-${replies.length - 1}`,
          type: "assistant",
          agent: "build",
          model: STORY_MODEL,
          content: [{ type: "text", text }],
          time: { created: STORY_TIME, completed: complete ? STORY_TIME + 1 : undefined },
        })
      })
    reasoning = (text) =>
      batch(() => {
        setState("open", true)
        setState("document", "status", { type: "busy" })
        // Keep the earlier context collapsed; only the live Thinking row is expanded.
        setState("document", "messages", 1, (message): SessionDocument["messages"][number] =>
          message.type === "assistant" ? { ...message, content: [{ type: "text", text: replies[0]! }] } : message,
        )
        setState("document", "messages", state.document.messages.length - 1, {
          id: `layout-assistant-${replies.length - 1}`,
          type: "assistant",
          agent: "build",
          model: STORY_MODEL,
          content: [{ type: "reasoning", text, time: { created: STORY_TIME } }],
          time: { created: STORY_TIME, completed: undefined },
        })
      })
    inspect = () =>
      projection.rows().map((row, index) => {
        const value = sizes()[index]!
        const element = host.querySelector<HTMLElement>(`[data-layout-row="${index}"]`)!
        return {
          key: TimelineRow.key(row),
          source: value.source,
          fallbackBlocks: value.source === "dom" ? (value.blocks?.length ?? 1) : 0,
          expected: value.source === "dom" ? undefined : value.height,
          actual: element.getBoundingClientRect().height,
          blocks: [
            ...element.querySelectorAll<HTMLElement>(
              'p,h1,h2,h3,pre,[data-slot="user-message-text"],[data-slot="collapsible-trigger"]',
            ),
          ].map((block) => {
            const style = getComputedStyle(block)
            return {
              tag: block.tagName,
              width: block.getBoundingClientRect().width,
              height: block.getBoundingClientRect().height,
              font: style.font,
              leading: style.lineHeight,
              before: style.marginTop,
              after: style.marginBottom,
            }
          }),
        }
      })
    return (
      <div style={{ width: `${state.width}px` }}>
        <For each={projection.rows()}>
          {(row, index) => (
            <div data-layout-row={index()}>
              <renderer.Row row={() => row} />
            </div>
          )}
        </For>
      </div>
    )
  }
  render(
    () => (
      <DialogProvider>
        <CurrentSessionProviders document={documentFixture}>
          <Fixture />
        </CurrentSessionProviders>
      </DialogProvider>
    ),
    host,
  )
}

export function timelineLayoutReport(width?: number) {
  if (width !== undefined) resize(width)
  return inspect()
}

export function streamTimelineLayout(text: string, complete: boolean) {
  stream(text, complete)
  return inspect()
}

export function reasonTimelineLayout(text: string) {
  reasoning(text)
  return inspect()
}
