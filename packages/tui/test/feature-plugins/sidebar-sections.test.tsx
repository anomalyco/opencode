/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { TuiSlotPlugin } from "@opencode-ai/plugin/tui"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import Mcp from "../../src/feature-plugins/sidebar/mcp"
import Lsp from "../../src/feature-plugins/sidebar/lsp"
import { createTuiPluginApi } from "../fixture/tui-plugin"

test.each([
  { plugin: Mcp, label: "MCP", row: "server-one" },
  { plugin: Lsp, label: "LSP", row: "server-one" },
])("$label collapse survives remounts and is shared across sessions", async ({ plugin, label, row }) => {
  const api = createTuiPluginApi()
  Object.assign(api.state, { config: { lsp: true } })
  api.state.mcp = () => ["server-one", "server-two", "server-three"].map((name) => ({ name, status: "connected" }))
  api.state.lsp = () =>
    ["server-one", "server-two", "server-three"].map((id) => ({ id, root: "/tmp", status: "connected" }))
  let slot: TuiSlotPlugin["slots"]["sidebar_content"]
  const calls: string[] = []
  api.slots = {
    register(value: TuiSlotPlugin) {
      const render = value.slots.sidebar_content
      slot = (context, props) => {
        calls.push(props.session_id)
        return render?.(context, props)
      }
      return "sidebar-test"
    },
  }
  const writes: [string, unknown][] = []
  const [values, setValues] = createSignal<Record<string, unknown>>({})
  api.kv.get = <Value,>(key: string, fallback?: Value) => (values()[key] ?? fallback) as Value
  api.kv.set = (key, value) => {
    writes.push([key, value])
    setValues((previous) => ({ ...previous, [key]: value }))
  }
  await plugin.tui(api, undefined, {} as Parameters<typeof plugin.tui>[2])

  const first = await testRender(() => slot?.({ theme: api.theme }, { session_id: "one" }), {
    width: 70,
    height: 20,
  })
  try {
    await first.renderOnce()
    expect(first.captureCharFrame()).toContain(row)
    await first.mockMouse.click(2, 0)
    await first.renderOnce()
    expect(first.captureCharFrame()).toContain(label)
    expect(first.captureCharFrame()).not.toContain(row)
  } finally {
    first.renderer.destroy()
  }

  const second = await testRender(() => slot?.({ theme: api.theme }, { session_id: "two" }), {
    width: 70,
    height: 20,
  })
  try {
    await second.renderOnce()
    expect(calls).toEqual(["one", "two"])
    expect(second.captureCharFrame()).toContain(label)
    expect(second.captureCharFrame()).not.toContain(row)
    expect(writes).toEqual([[`sidebar:${label.toLowerCase()}:open`, false]])
    expect(api.kv.get(`sidebar:${label.toLowerCase()}:open`, true)).toBe(false)
  } finally {
    second.renderer.destroy()
  }
})
