import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { JSX } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { addDefaultParsers, type TextRenderable } from "@opentui/core"
import parsers from "../../../src/parsers-config"
import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client"
import { ConfigProvider } from "../../../src/config"
import { ThemeProvider } from "../../../src/context/theme"
import { SessionGroupView } from "../../../src/routes/session/group-view"
import { createTimelineAnchors, groupID, type AnchorTarget } from "../../../src/routes/session/anchors"
import { context } from "../../../src/routes/session/render-context"
import type { SessionEntry, SessionGroup } from "../../../src/routes/session/grouping/session"
import { emptyThemeSource } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

test("retains nested expansion state and registers exact headers and parts", async () => {
  addDefaultParsers(parsers.parsers)
  const anchors = createTimelineAnchors()
  const [expanded, setExpanded] = createStore<Record<string, boolean>>({})
  const config = createTuiResolvedConfig({ animations: false })
  const messages = new Map<string, SessionMessageAssistant>(
    ["a", "b"].map((id) => [
      id,
      {
        id,
        type: "assistant",
        agent: "build",
        model: { providerID: "fixture", id: "fixture" },
        time: { created: 0, completed: 2 },
        content: [
          {
            type: "tool",
            id: `read-${id}`,
            name: "read",
            time: { created: 0, completed: 2 },
            state: { status: "completed", input: { path: id }, content: [{ type: "text", text: id }], metadata: {} },
          },
          { type: "reasoning", text: "**Reset title**\n\nReset thought body", time: { created: 0, completed: 2 } },
        ],
      },
    ]),
  )
  const [row, setRow] = createStore<SessionGroup>({
    type: "group",
    kind: "exploration",
    size: 2,
    completed: true,
    pending: [],
    children: [
      {
        type: "group",
        kind: "exploration",
        size: 2,
        children: [
          { type: "entry", size: 1, entry: { type: "part", ref: { messageID: "a", partID: "read-a" } } },
          { type: "entry", size: 1, entry: { type: "part", ref: { messageID: "b", partID: "read-b" } } },
        ],
      },
    ],
  })
  let target: TextRenderable | undefined
  const app = await mount({
    row,
    anchors,
    config,
    expanded: (id) => expanded[id],
    setExpanded: (id, value) => setExpanded(id, value),
    message: (id) => messages.get(id),
    entry: (entry) =>
      entry.type === "part" && entry.ref.messageID === "b" ? (
        <text ref={(node) => (target = node)}>Target B</text>
      ) : (
        <text>A wrapped entry with enough text to occupy more than one terminal line</text>
      ),
  })
  app.renderer.start()
  const outerID = groupID(row, 0)
  const inner = row.children[0]
  if (inner.type !== "group") throw new Error("Missing nested group")
  const innerID = groupID(inner, 1)
  if (!outerID || !innerID) throw new Error("Missing group IDs")
  const outer: AnchorTarget = { type: "group", groupID: outerID }
  const nested: AnchorTarget = { type: "group", groupID: innerID }
  const a: AnchorTarget = { type: "part", ref: { messageID: "a", partID: "read-a" } }
  const b: AnchorTarget = { type: "part", ref: { messageID: "b", partID: "read-b" } }
  try {
    await app.waitForFrame((frame) => frame.includes("Explored"))
    expect(app.captureCharFrame()).not.toContain("Target B")
    expect(anchors.get(b)).toBeUndefined()
    expect(anchors.get(nested)).toBeUndefined()
    await app.mockMouse.click(4, anchors.get(outer)?.node.y ?? -1)
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("Target B")
    expect(expanded[outerID]).toBe(true)
    expect(anchors.get(outer)).toBeDefined()
    await app.mockMouse.click(4, anchors.get(nested)?.node.y ?? -1)
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Target B")
    expect(expanded[innerID]).toBe(true)
    expect(anchors.get(b)?.node.y).toBe(target?.y)
    expect(anchors.get(b)?.node.y).toBeGreaterThan(anchors.get(a)?.node.y ?? Infinity)
    expect(anchors.get(nested)).toBeDefined()
    expect(app.captureCharFrame().match(/Image previews/g)?.length).toBe(1)
    setExpanded(outerID, false)
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("Target B")
    expect(anchors.get(b)).toBeUndefined()
    expect(anchors.get(outer)).toBeDefined()
    expect(expanded[innerID]).toBe(true)
    setExpanded(outerID, true)
    await app.renderOnce()
    setRow(
      reconcile({
        type: "group",
        kind: "exploration",
        size: 2,
        completed: true,
        pending: [],
        children: [
          { type: "entry", size: 1, entry: { type: "part", ref: { messageID: "a", partID: "read-a" } } },
          { type: "entry", size: 1, entry: { type: "part", ref: { messageID: "b", partID: "read-b" } } },
        ],
      }),
    )
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Target B")
    expect(anchors.get(b)?.node.y).toBe(target?.y)
    setRow(
      reconcile({
        type: "group",
        kind: "reasoning",
        size: 2,
        completed: true,
        children: [
          { type: "entry", size: 1, entry: { type: "part", ref: { messageID: "a", partID: "reasoning:0" } } },
          { type: "entry", size: 1, entry: { type: "part", ref: { messageID: "b", partID: "reasoning:0" } } },
        ],
      }),
    )
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Thought")
    expect(app.captureCharFrame()).not.toContain("Reset thought body")
    const thinkingID = groupID(row, 0)
    if (!thinkingID) throw new Error("Missing thinking group ID")
    setExpanded(thinkingID, true)
    await app.waitForFrame((frame) => frame.includes("Reset thought body"))
    expect(app.captureCharFrame()).toContain("Reset thought body")
  } finally {
    app.renderer.destroy()
  }
  expect(anchors.list()).toEqual([])
})

test("a low activity group with nothing finished spaces its live items", async () => {
  const config = createTuiResolvedConfig({ animations: false })
  const shell = (id: string) => ({
    type: "tool" as const,
    id,
    name: "shell",
    time: { created: 0 },
    state: { status: "running" as const, input: {}, metadata: {} },
  })
  const message: SessionMessageAssistant = {
    id: "a",
    type: "assistant",
    agent: "build",
    model: { providerID: "fixture", id: "fixture" },
    time: { created: 0 },
    content: [shell("one"), shell("two")],
  }
  const app = await mount({
    row: {
      type: "group",
      kind: "activity",
      size: 2,
      completed: false,
      pending: [],
      children: ["one", "two"].map((partID) => ({
        type: "entry" as const,
        size: 1,
        entry: { type: "part" as const, ref: { messageID: "a", partID } },
      })),
    },
    anchors: createTimelineAnchors(),
    config,
    expanded: () => false,
    setExpanded: () => {},
    message: () => message,
    entry: (entry) => <text>{entry.type === "part" ? `Shell ${entry.ref.partID}` : ""}</text>,
  })
  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Shell two"))
    const lines = app.captureCharFrame().split("\n")
    const one = lines.findIndex((line) => line.includes("Shell one"))
    const two = lines.findIndex((line) => line.includes("Shell two"))
    expect(two - one).toBe(2)
  } finally {
    app.renderer.destroy()
  }
})

function mount(input: {
  row: SessionGroup
  anchors: ReturnType<typeof createTimelineAnchors>
  config: ReturnType<typeof createTuiResolvedConfig>
  expanded: (id: string) => boolean
  setExpanded: (id: string, value: boolean) => void
  message: (id: string) => SessionMessageInfo | undefined
  entry: (entry: SessionEntry) => JSX.Element
}) {
  return testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={input.config}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <context.Provider
              value={{
                width: 40,
                terminal: { width: 40, height: 24 },
                sessionID: "fixture",
                anchors: input.anchors,
                groupExpanded: input.expanded,
                setGroupExpanded: input.setExpanded,
                thinkingMode: () => "hide",
                markdownMode: () => "rendered",
                groupExploration: () => true,
                legacyTurns: () => false,
                diffWrapMode: () => "word",
                models: () => [],
                messageIndex: () => undefined,
                config: input.config,
                mutatePending: async () => true,
                pendingDelivery: () => undefined,
              }}
            >
              <box paddingTop={2}>
                <SessionGroupView
                  row={input.row}
                  message={input.message}
                  images={() => <text>Image previews</text>}
                  entry={input.entry}
                />
              </box>
            </context.Provider>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 40, height: 24 },
  )
}
