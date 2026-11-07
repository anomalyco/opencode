/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA, TextRenderable, type Renderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import { createSignal } from "solid-js"
import { ConfigProvider } from "../../src/config"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { PromptFooter } from "../../src/feature-plugins/prompt/footer"

test("prompt footer separates simultaneous subagent, shell, and usage status", async () => {
  const color = RGBA.fromInts(200, 200, 200)
  const subdued = RGBA.fromInts(100, 100, 100)
  const dispatched: string[] = []
  const context = {
    location: { directory: "/workspace" },
    theme: {
      text: {
        base: color,
        muted: subdued,
      },
    },
    keymap: {
      shortcuts: (id: string) =>
        id === "session.child.first" ? ["ctrl+j"] : id === "command.palette.show" ? ["ctrl+p"] : [],
      dispatch: (id: string) => dispatched.push(id),
    },
    client: { rpc: () => ({ get: () => Promise.resolve(null), events: { on: () => () => {} } }) },
    data: {
      on: () => () => {},
      session: {
        family: () => ["session", "child"],
        status: (id: string) => (id === "child" ? "running" : "idle"),
        get: () => ({ id: "session", location: { directory: "/workspace" } }),
        cost: () => 1,
        message: { list: () => [] },
      },
      shell: {
        list: () => [{ metadata: { sessionID: "session" } }],
      },
      location: {
        model: { list: () => [] },
      },
    },
  } as unknown as Context
  const app = await testRender(
    () => (
      <ConfigProvider config={createTuiResolvedConfig()}>
        <PromptFooter context={context} sessionID="session" mode="normal" showDetails={true} />
      </ConfigProvider>
    ),
    {
      width: 80,
      height: 2,
    },
  )

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("ctrl+j 1 subagent · 1 shell · $1.00")
    expect(app.captureCharFrame()).toContain("ctrl+p commands")

    await app.mockMouse.moveTo(2, 0)
    const live = app.renderer.root.getChildren()[0]?.getChildren()[0]?.getChildren()[0]
    expect(live).toBeInstanceOf(TextRenderable)
    expect((live as TextRenderable).fg.toInts()).toEqual(color.toInts())

    await app.mockMouse.click(2, 0)
    expect(dispatched).toEqual(["session.child.first"])
  } finally {
    app.renderer.destroy()
  }
})

test("prompt footer can hide details", async () => {
  const color = RGBA.fromInts(200, 200, 200)
  const context = {
    location: { directory: "/workspace" },
    theme: {
      text: {
        base: color,
        muted: color,
      },
    },
    keymap: {
      shortcuts: (id: string) => {
        if (id === "command.palette.show") return ["ctrl+p"]
        if (id === "agent.cycle") return ["shift+tab"]
        return []
      },
    },
    client: { rpc: () => ({ get: () => Promise.resolve(null), events: { on: () => () => {} } }) },
    data: {
      on: () => () => {},
      session: {
        family: () => ["session"],
        status: () => "running",
        get: () => ({ id: "session", location: { directory: "/workspace" } }),
        cost: () => 1,
        message: {
          list: () => [
            {
              id: "message",
              type: "assistant",
              model: { providerID: "provider", id: "model" },
              tokens: { input: 1_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            },
          ],
        },
      },
      shell: { list: () => [] },
      location: {
        model: { list: () => [{ providerID: "provider", id: "model", limit: { context: 10_000 } }] },
      },
    },
  } as unknown as Context
  const [showDetails, setShowDetails] = createSignal(true)
  const [sessionID, setSessionID] = createSignal<string | undefined>("session")
  const app = await testRender(
    () => (
      <box width="100%" flexDirection="row" justifyContent="space-between" gap={2}>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <PromptFooter
            context={context}
            sessionID={sessionID()}
            mode="normal"
            showDetails={showDetails()}
          />
        </ConfigProvider>
      </box>
    ),
    {
      width: 80,
      height: 1,
    },
  )

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("1.0K (10%) · $1.00")
    expect(app.captureCharFrame()).toContain("ctrl+p commands")

    setShowDetails(false)
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).not.toContain("1.0K (10%)")
    expect(frame).not.toContain("$1.00")
    expect(frame).not.toContain("ctrl+p commands")

    setSessionID(undefined)
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("shift+tab agents")
  } finally {
    app.renderer.destroy()
  }
})

test("prompt footer shows the session's goal without its objective and opens it on click", async () => {
  const muted = RGBA.fromInts(100, 100, 100)
  const warning = RGBA.fromInts(200, 200, 0)
  const goal = {
    id: "goal",
    objective: "Make the test suite pass",
    status: "active",
    rounds: 3,
    maxRounds: 50,
    boot: "boot",
    updatedAt: 0,
  }
  const fetched = Promise.resolve(goal)
  const changed: ((event: { data: { sessionID: string; goal: unknown } }) => void)[] = []
  const dialogs: unknown[] = []
  const context = {
    location: { directory: "/workspace" },
    theme: {
      text: {
        base: RGBA.fromInts(200, 200, 200),
        muted,
        feedback: { warning: { base: warning }, success: { base: muted } },
      },
    },
    keymap: { shortcuts: () => [] },
    ui: { dialog: { show: (render: unknown) => dialogs.push(render) }, toast: { show: () => {} } },
    client: {
      rpc: () => ({
        get: () => fetched,
        events: { on: (_name: string, handler: (typeof changed)[number]) => (changed.push(handler), () => {}) },
      }),
    },
    data: {
      on: () => () => {},
      session: {
        family: () => ["session"],
        status: () => "idle",
        get: () => ({ id: "session", location: { directory: "/workspace" } }),
        cost: () => 0,
        message: { list: () => [] },
      },
      shell: { list: () => [] },
      location: { model: { list: () => [] } },
    },
  } as unknown as Context
  const app = await testRender(
    () => (
      <ConfigProvider config={createTuiResolvedConfig()}>
        <PromptFooter context={context} sessionID="session" mode="normal" showDetails={true} />
      </ConfigProvider>
    ),
    { width: 80, height: 2 },
  )

  try {
    // The footer fetches the goal from the goal plugin's RPC.
    await fetched
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("◎ goal")
    // The objective and any round count live in the dialog, not the footer.
    expect(frame).not.toContain("Make the test suite pass")
    expect(frame).not.toMatch(/\d+\/\d+/)
    expect(findText(app.renderer.root, "◎ goal")?.fg.toInts()).toEqual(muted.toInts())

    await app.mockMouse.click(2, 0)
    expect(dialogs).toHaveLength(1)
    await app.mockMouse.moveTo(70, 1)

    // Then it follows the plugin's changes for this Session only.
    const change = (sessionID: string, next: unknown) =>
      changed.forEach((handler) => handler({ data: { sessionID, goal: next } }))
    change("session", { ...goal, status: "paused", reason: "Stopped by the user" })
    change("other", null)
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("◎ goal paused")
    expect(findText(app.renderer.root, "◎ goal paused")?.fg.toInts()).toEqual(warning.toInts())

    change("session", null)
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("goal")
  } finally {
    app.renderer.destroy()
  }
})

test.each(
  [
    { sessionID: "session", expected: "≈ $12.60" },
    { sessionID: "child", expected: "≈ $1.50" },
    { sessionID: "session", scale: 0.0001, expected: "≈ <$0.01" },
    { sessionID: "session", cost: 1, expected: "$1.00" },
    { sessionID: "session", experiment: false, expected: undefined },
    { sessionID: "session", unpriced: true, expected: undefined },
  ].map((options) => ({ cost: 0, experiment: true, scale: 1, unpriced: false, ...options })),
)("prompt footer spend: $expected ($sessionID)", async ({ sessionID, expected, cost, experiment, scale, unpriced }) => {
  const color = RGBA.fromInts(200, 200, 200)
  const context = {
    location: { directory: "/workspace" },
    theme: { text: { base: color, muted: color } },
    keymap: { shortcuts: () => [] },
    client: { rpc: () => ({ get: () => Promise.resolve(null), events: { on: () => () => {} } }) },
    data: {
      on: () => () => {},
      session: {
        family: () => ["session", "child", "sibling"],
        status: () => "idle",
        get: (id: string) => {
          if (id !== sessionID && (cost > 0 || !experiment)) throw new Error("Unused estimate reads family sessions")
          return {
            id,
            parentID: id === "session" ? undefined : "session",
            location: { directory: "/workspace" },
            model: { providerID: "provider", id: unpriced && id === "child" ? "removed" : "model" },
            tokens:
              id === "session"
                ? {
                    input: 1_000_000 * scale,
                    output: 100_000 * scale,
                    reasoning: 0,
                    cache: { read: 2_000_000 * scale, write: 0 },
                  }
                : {
                    input: (id === "child" ? 500_000 : 2_000_000) * scale,
                    output: 0,
                    reasoning: 0,
                    cache: { read: 0, write: 0 },
                  },
            cost: 0,
          }
        },
        cost: () => cost,
        message: { list: () => [] },
      },
      shell: { list: () => [] },
      location: {
        model: {
          list: () => [
            {
              providerID: "provider",
              id: "model",
              cost: [{ input: 3, output: 15, cache: { read: 0.3, write: 0 } }],
            },
          ],
        },
      },
    },
  } as unknown as Context
  const app = await testRender(
    () => (
      <ConfigProvider config={createTuiResolvedConfig({ experimental: { "cost-estimate": experiment } })}>
        <PromptFooter context={context} sessionID={sessionID} mode="normal" showDetails={true} />
      </ConfigProvider>
    ),
    {
      width: 80,
      height: 1,
    },
  )

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    if (expected) expect(frame).toContain(expected)
    if (!expected) expect(frame).not.toContain("$")
    if (cost > 0) expect(frame).not.toContain("≈")
  } finally {
    app.renderer.destroy()
  }
})

function findText(node: Renderable, text: string): TextRenderable | undefined {
  if (node instanceof TextRenderable && node.plainText.includes(text)) return node
  return node
    .getChildren()
    .map((child) => findText(child, text))
    .find((found) => found !== undefined)
}
