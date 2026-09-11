import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createStore, reconcile } from "solid-js/store"
import { addDefaultParsers, type TextRenderable } from "@opentui/core"
import parsers from "../../../src/parsers-config"
import type { SessionMessageAssistant } from "@opencode/client"
import { ConfigProvider } from "../../../src/config"
import { ThemeProvider } from "../../../src/context/theme"
import { SessionGroupView } from "../../../src/routes/session/group-view"
import { createMessageAnchors } from "../../../src/routes/session/message-anchors"
import { context } from "../../../src/routes/session/render-context"
import type { SessionGroup } from "../../../src/routes/session/grouping/session"
import { emptyThemeSource } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

test("reveals two collapsed ancestors and registers the leaf's measured position", async () => {
  addDefaultParsers(parsers.parsers)
  const anchors = createMessageAnchors()
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
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={config}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <context.Provider
              value={{
                width: 40,
                terminal: { width: 40, height: 24 },
                sessionID: "fixture",
                anchors,
                thinkingMode: () => "hide",
                markdownMode: () => "rendered",
                groupExploration: () => true,
                diffWrapMode: () => "word",
                models: () => [],
                messageIndex: () => undefined,
                config,
                mutatePending: async () => true,
                pendingDelivery: () => undefined,
              }}
            >
              <box paddingTop={2}>
                <SessionGroupView
                  row={row}
                  path={[0]}
                  message={(id) => messages.get(id)}
                  images={() => <text>Image previews</text>}
                  entry={(entry) =>
                    entry.type === "part" && entry.ref.messageID === "b" ? (
                      <text ref={(node) => (target = node)}>Target B</text>
                    ) : (
                      <text>A wrapped entry with enough text to occupy more than one terminal line</text>
                    )
                  }
                />
              </box>
            </context.Provider>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 40, height: 24 },
  )
  app.renderer.start()
  try {
    await app.waitForFrame((frame) => frame.includes("Explored"))
    expect(app.captureCharFrame()).not.toContain("Target B")
    expect(anchors.get("b")?.path()).toEqual([0, 0, 1])
    const headerY = anchors.get("b")?.target.y ?? -1
    expect(anchors.get("b")?.reveal?.()).toBe(true)
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("Target B")
    expect(anchors.get("b")?.level).toBe(2)
    expect(anchors.get("b")?.reveal?.()).toBe(true)
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Target B")
    expect(anchors.get("b")?.reveal).toBeUndefined()
    expect(anchors.get("b")?.target.y).toBe(target?.y)
    expect(anchors.get("b")?.target.y).toBeGreaterThan(anchors.get("a")?.target.y ?? Infinity)
    expect(app.captureCharFrame().match(/Image previews/g)?.length).toBe(1)
    await app.mockMouse.click(4, headerY)
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("Target B")
    expect(anchors.get("b")?.level).toBe(1)
    anchors.get("b")?.reveal?.()
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
    expect(anchors.get("b")?.path()).toEqual([0, 1])
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
    expect(anchors.get("b")?.reveal?.()).toBe(true)
    await app.waitForFrame((frame) => frame.includes("Reset thought body"))
    expect(app.captureCharFrame()).toContain("Reset thought body")
  } finally {
    app.renderer.destroy()
  }
  expect(anchors.list()).toEqual([])
})
