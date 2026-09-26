/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { TuiSlotPlugin } from "@opencode-ai/plugin/tui"
import { createSlot, createSolidSlotRegistry, testRender, useRenderer } from "@opentui/solid"
import { onMount } from "solid-js"
import { createBuiltinPlugins } from "../../src/feature-plugins/builtins"
import { createSlots } from "../../src/plugin/slots"
import { createTuiPluginApi } from "../fixture/tui-plugin"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

type Slots = {
  prompt: {}
}

test("replace slot mounts plugin content once", async () => {
  let mounts = 0

  const Probe = () => {
    onMount(() => {
      mounts += 1
    })
    return <box />
  }

  const App = () => {
    const registry = createSolidSlotRegistry<Slots>(useRenderer(), {})
    const Slot = createSlot(registry)
    registry.register({ id: "plugin", slots: { prompt: () => <Probe /> } })

    return (
      <Slot name="prompt" mode="replace">
        <box />
      </Slot>
    )
  }

  const app = await testRender(() => <App />)
  try {
    expect(mounts).toBe(1)
  } finally {
    app.renderer.destroy()
  }
})

async function sidebarFrame(sections?: { order?: string[]; hidden?: string[] }, externalOrder = 600) {
  const App = () => {
    const api = Object.assign(createTuiPluginApi(), {
      renderer: useRenderer(),
      tuiConfig: createTuiResolvedConfig(sections ? { sidebar_sections: sections } : {}),
    })
    const slots = createSlots()
    const host = slots.setup(api)
    host.register({
      id: "internal:sidebar-context",
      order: 100,
      slots: { sidebar_content: () => <text>Context</text> },
    })
    host.register({ id: "internal:sidebar-mcp", order: 200, slots: { sidebar_content: () => <text>MCP</text> } })
    host.register({ id: "internal:sidebar-lsp", order: 300, slots: { sidebar_content: () => <text>LSP</text> } })
    host.register({ id: "internal:sidebar-todo", order: 400, slots: { sidebar_content: () => <text>Todo</text> } })
    host.register({ id: "internal:sidebar-files", order: 500, slots: { sidebar_content: () => <text>Files</text> } })
    host.register({
      id: "external-plugin",
      order: externalOrder,
      slots: { sidebar_content: () => <text>External</text> },
    })
    return <slots.Slot name="sidebar_content" session_id="one" />
  }
  const app = await testRender(() => <App />, { width: 80, height: 20 })
  try {
    await app.renderOnce()
    return app
      .captureCharFrame()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
  } finally {
    app.renderer.destroy()
  }
}

test("default sidebar section order and visibility remain unchanged", async () => {
  expect(await sidebarFrame()).toEqual(["Context", "MCP", "LSP", "Todo", "Files", "External"])
})

test("sidebar section order moves named sections first, including external plugin ids", async () => {
  expect(await sidebarFrame({ order: ["todo", "external-plugin", "context"] })).toEqual([
    "Todo",
    "External",
    "Context",
    "MCP",
    "LSP",
    "Files",
  ])
})

test("named sections render before plugins with negative default orders", async () => {
  expect(await sidebarFrame({ order: ["todo"] }, -50)).toEqual(["Todo", "External", "Context", "MCP", "LSP", "Files"])
})

test("sidebar hidden removes named sections including external plugin ids", async () => {
  expect(await sidebarFrame({ hidden: ["mcp", "external-plugin"] })).toEqual(["Context", "LSP", "Todo", "Files"])
})

test("unknown sidebar section names do not change order or visibility", async () => {
  expect(await sidebarFrame({ order: ["absent"], hidden: ["missing"] })).toEqual(await sidebarFrame())
})

async function multiSlotFrames(sections: { order?: string[]; hidden?: string[] }) {
  let dispose = () => {}
  let setups = 0
  let disposals = 0
  const App = () => {
    const api = Object.assign(createTuiPluginApi(), {
      renderer: useRenderer(),
      tuiConfig: createTuiResolvedConfig({ sidebar_sections: sections }),
    })
    const slots = createSlots()
    const host = slots.setup(api)
    host.register({ id: "base", order: 100, slots: { sidebar_content: () => <text>SIDE-BASE</text> } })
    host.register({ id: "base-footer", order: 50, slots: { sidebar_footer: () => <text>FOOTER-BASE</text> } })
    host.register({ id: "footer-only", order: 100, slots: { sidebar_footer: () => <text>FOOTER-OTHER</text> } })
    dispose = host.register({
      id: "external-plugin",
      order: 900,
      setup() {
        setups++
      },
      dispose() {
        disposals++
      },
      slots: {
        sidebar_content: () => <text>SIDE-EXT</text>,
        sidebar_footer: () => <text>FOOTER-EXT</text>,
      },
    })
    return (
      <box>
        <slots.Slot name="sidebar_content" session_id="one" />
        <text>FOOTER-START</text>
        <slots.Slot name="sidebar_footer" session_id="one" />
      </box>
    )
  }
  const app = await testRender(() => <App />, { width: 80, height: 20 })
  const rows = () =>
    app
      .captureCharFrame()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
  try {
    await app.renderOnce()
    const before = rows()
    dispose()
    await app.renderOnce()
    return { before, after: rows(), setups, disposals }
  } finally {
    app.renderer.destroy()
  }
}

test("ordering a multi-slot plugin changes only its sidebar section", async () => {
  const frame = await multiSlotFrames({ order: ["external-plugin", "footer-only"] })
  expect(frame.before).toEqual(["SIDE-EXT", "SIDE-BASE", "FOOTER-START", "FOOTER-BASE", "FOOTER-OTHER", "FOOTER-EXT"])
  expect(frame.after).toEqual(["SIDE-BASE", "FOOTER-START", "FOOTER-BASE", "FOOTER-OTHER"])
  expect([frame.setups, frame.disposals]).toEqual([1, 1])
})

test("hiding a multi-slot plugin section leaves its footer and footer-only plugins visible", async () => {
  const frame = await multiSlotFrames({ hidden: ["external-plugin", "footer-only"] })
  expect(frame.before).toEqual(["SIDE-BASE", "FOOTER-START", "FOOTER-BASE", "FOOTER-OTHER", "FOOTER-EXT"])
  expect(frame.after).toEqual(["SIDE-BASE", "FOOTER-START", "FOOTER-BASE", "FOOTER-OTHER"])
  expect([frame.setups, frame.disposals]).toEqual([1, 1])
})

async function builtinSidebarFrame(sections?: { order?: string[]; hidden?: string[] }, collapsed = false) {
  const pending: Promise<unknown>[] = []
  const App = () => {
    const api = Object.assign(createTuiPluginApi(), {
      renderer: useRenderer(),
      tuiConfig: createTuiResolvedConfig(sections ? { sidebar_sections: sections } : {}),
    })
    Object.assign(api.state, {
      config: { lsp: true },
      mcp: () => ["server-one", "server-two", "server-three"].map((name) => ({ name, status: "connected" as const })),
      lsp: () => [],
      session: {
        ...api.state.session,
        messages: () => [],
        todo: () => [],
        diff: () => [],
      },
    })
    if (collapsed) api.kv.set("sidebar:mcp:open", false)
    const slots = createSlots()
    const host = slots.setup(api)
    createBuiltinPlugins({ experimentalEventSystem: false })
      .filter((plugin) => plugin.id.startsWith("internal:sidebar-") && plugin.id !== "internal:sidebar-footer")
      .forEach((plugin) => {
        const scoped = {
          ...api,
          slots: {
            register(entry: TuiSlotPlugin) {
              host.register({ ...entry, id: plugin.id })
              return plugin.id
            },
          },
        }
        pending.push(Promise.resolve(plugin.tui(scoped, undefined, {} as Parameters<typeof plugin.tui>[2])))
      })
    host.register({ id: "third-party", order: 600, slots: { sidebar_content: () => <text>CLAUDE</text> } })
    return <slots.Slot name="sidebar_content" session_id="one" />
  }
  const app = await testRender(() => <App />, { width: 80, height: 24 })
  try {
    await Promise.all(pending)
    await app.renderOnce()
    return app.captureCharFrame()
  } finally {
    app.renderer.destroy()
  }
}

const builtinCases: {
  name: string
  sections?: { order?: string[]; hidden?: string[] }
  collapsed: boolean
  titles: string[]
}[] = [
  { name: "default", sections: undefined, collapsed: false, titles: ["Context", "MCP", "LSP", "CLAUDE"] },
  { name: "hidden context", sections: { hidden: ["context"] }, collapsed: false, titles: ["MCP", "LSP", "CLAUDE"] },
  {
    name: "hidden context and lsp",
    sections: { hidden: ["context", "lsp"] },
    collapsed: false,
    titles: ["MCP", "CLAUDE"],
  },
  { name: "ordered mcp", sections: { order: ["mcp"] }, collapsed: false, titles: ["MCP", "Context", "LSP", "CLAUDE"] },
  {
    name: "hidden context with collapsed mcp",
    sections: { hidden: ["context"] },
    collapsed: true,
    titles: ["MCP", "LSP", "CLAUDE"],
  },
  {
    name: "hidden context and lsp with collapsed mcp",
    sections: { hidden: ["context", "lsp"] },
    collapsed: true,
    titles: ["MCP", "CLAUDE"],
  },
]

test.each(builtinCases)("real built-in sidebar sections: $name", async ({ sections, collapsed, titles }) => {
  const frame = await builtinSidebarFrame(sections, collapsed)
  expect(frame.split("\n").flatMap((line) => line.match(/\b(Context|MCP|LSP|CLAUDE)\b/)?.[0] ?? [])).toEqual(titles)
  expect(frame.includes("server-one")).toBe(!collapsed)
})
