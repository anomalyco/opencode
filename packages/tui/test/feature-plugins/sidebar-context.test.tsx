/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender, type JSX } from "@opentui/solid"
import type { TuiPluginApi, TuiPluginMeta } from "@opencode-ai/plugin/tui"
import { createSignal } from "solid-js"

const theme = {
  text: "#ffffff",
  textMuted: "#888888",
  error: "#ff5555",
  primary: "#007acc",
  backgroundPanel: "#1e1e1e",
}

function createHarness(budget: number | null) {
  const updates: Array<{ sessionID: string; budget: number | null }> = []
  const session = () => ({
    id: "dummy",
    slug: "budget-test",
    title: "Budget session",
    projectID: "project",
    directory: "/tmp/opencode",
    version: "0.0.0-test",
    cost: 0.5,
    ...(budget === null ? {} : { budget }),
    tokens: { input: 100, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  })
  const [current, setCurrent] = createSignal(session())
  const registered: {
    slots: Record<string, (ctx: unknown, props: unknown) => unknown>
  }[] = []
  const api = {
    theme: { current: theme },
    state: {
      session: {
        messages: () => [],
        get: () => current(),
      },
      provider: [],
    },
    client: {
      session: {
        update: async (params: { sessionID: string; budget?: number | null }) => {
          updates.push({ sessionID: params.sessionID, budget: params.budget ?? null })
          budget = params.budget ?? null
          setCurrent(session())
          return { data: session() }
        },
      },
    },
    slots: {
      register: (plugin: (typeof registered)[number]) => {
        registered.push(plugin)
        return "test-plugin"
      },
    },
  } as unknown as TuiPluginApi
  return { api, registered, updates }
}

const waitForFrame = async (setup: Awaited<ReturnType<typeof testRender>>, text: string) => {
  let frame = ""
  for (let index = 0; index < 60; index++) {
    await setup.renderOnce()
    frame = setup.captureCharFrame()
    if (frame.includes(text)) return frame
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`frame never included "${text}"\n${frame}`)
}

const findBudgetRow = (frame: string) => {
  const rows = frame.split("\n")
  const rowIndex = rows.findIndex((row) => row.includes("budget"))
  const col = rows[rowIndex].indexOf("$0.50")
  return { rowIndex, col }
}

test("sidebar context widget renders, scrolls, and clears the session budget", async () => {
  const { api, registered, updates } = createHarness(2)
  const plugin = (await import("../../src/feature-plugins/sidebar/context")).default
  await plugin.tui(api, undefined, {} as TuiPluginMeta)
  const slot = registered[0].slots.sidebar_content

  const setup = await testRender(() => slot({}, { session_id: "dummy" }) as JSX.Element, { width: 60, height: 10 })

  try {
    let frame = await waitForFrame(setup, "$2.00 budget")
    expect(frame).toContain("$0.50 / $2.00 budget")
    const { rowIndex, col } = findBudgetRow(frame)
    expect(rowIndex).toBeGreaterThan(-1)
    expect(col).toBeGreaterThan(-1)

    await setup.mockMouse.scroll(col + 2, rowIndex, "up")
    frame = await waitForFrame(setup, "$2.25 budget")
    expect(updates).toContainEqual({ sessionID: "dummy", budget: 2.25 })

    for (let index = 0; index < 12; index++) {
      await setup.mockMouse.scroll(col + 2, rowIndex, "down")
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    frame = await waitForFrame(setup, "unlimited budget")
    expect(updates).toContainEqual({ sessionID: "dummy", budget: null })
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
  }
})

test("sidebar context widget edits the budget by typing", async () => {
  const { api, registered, updates } = createHarness(2)
  const plugin = (await import("../../src/feature-plugins/sidebar/context")).default
  await plugin.tui(api, undefined, {} as TuiPluginMeta)
  const slot = registered[0].slots.sidebar_content

  const setup = await testRender(() => slot({}, { session_id: "dummy" }) as JSX.Element, { width: 60, height: 10 })

  try {
    const frame = await waitForFrame(setup, "$2.00 budget")
    const { rowIndex, col } = findBudgetRow(frame)

    await setup.mockMouse.click(col + 2, rowIndex)
    await setup.mockInput.typeText(".5")
    setup.mockInput.pressEnter()
    await waitForFrame(setup, "$2.50 budget")
    expect(updates).toContainEqual({ sessionID: "dummy", budget: 2.5 })

    await setup.mockMouse.click(col + 2, rowIndex)
    setup.mockInput.pressEscape()
    await waitForFrame(setup, "$2.50 budget")
    expect(updates).toHaveLength(1)
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
  }
})
