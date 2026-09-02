/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onCleanup } from "solid-js"
import type { PluginInfo } from "@opencode-ai/client"
import type { Context, ToastOptions } from "@opencode-ai/plugin/tui/context"
import { ConfigProvider } from "../../../src/config"
import { Keymap } from "../../../src/context/keymap"
import { ThemeProvider, useThemes } from "../../../src/context/theme"
// The plugin context registers every builtin, and the plugins dialog imports
// the context back, so the context must load first exactly as it does in the app.
import type { usePlugin } from "../../../src/plugin/context"
import "../../../src/plugin/context"
import { PluginsDialog } from "../../../src/feature-plugins/system/plugins"
import { DialogProvider } from "../../../src/ui/dialog"
import { ToastProvider } from "../../../src/ui/toast"
import { emptyThemeSource, tmpdir } from "../../fixture/fixture"
import { createApi, createFetch, json } from "../../fixture/tui-client"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

const target = "git+ssh://git@github.com/example/team-plugins.git"

function packagePlugin(outdated: boolean): PluginInfo {
  return {
    id: "team.plugins",
    source: { type: "package", target, version: "dadba13", ...(outdated ? { outdated: true as const } : {}) },
    features: { server: true },
    state: { status: "active" },
  }
}

async function renderPlugins(root: string, inventory: { list: PluginInfo[]; check: PluginInfo[] }) {
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  const requests: { path: string; body: unknown }[] = []
  const toasts: ToastOptions[] = []
  const location = { directory: root, project: { id: "proj_test", directory: root, canonical: root } }
  const transport = createFetch(async (url, request) => {
    if (url.pathname === "/api/plugin") return json({ location, data: inventory.list })
    if (url.pathname === "/api/plugin/check") {
      requests.push({ path: url.pathname, body: await request.json() })
      return json({ location, data: inventory.check })
    }
    if (url.pathname === "/api/plugin/update") {
      requests.push({ path: url.pathname, body: await request.json() })
      return new Response(null, { status: 204 })
    }
  })

  function Harness() {
    function Content() {
      onCleanup(Keymap.use().mode.push("modal"))
      const theme = useThemes().currentTokens()
      const context = {
        client: createApi(transport.fetch),
        data: { location: { default: () => ({ directory: root }) }, on: () => () => {} },
        get theme() {
          return theme
        },
        ui: {
          toast: { show: (toast: ToastOptions) => toasts.push(toast) },
          format: { path: (value: string) => value },
        },
      } as unknown as Context
      const plugins = {
        registered: () => [],
        list: () => [],
        activate: async () => true,
        deactivate: async () => true,
      } as unknown as ReturnType<typeof usePlugin>
      return <PluginsDialog context={context} plugins={plugins} />
    }

    return (
      <TestTuiContexts directory={root} paths={{ home: root, state, worktree: root }}>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <Keymap.Provider>
            <ThemeProvider mode="dark" source={emptyThemeSource}>
              <ToastProvider>
                <DialogProvider>
                  <Content />
                </DialogProvider>
              </ToastProvider>
            </ThemeProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { width: 80, height: 20, kittyKeyboard: true })
  app.renderer.start()
  await app.waitForFrame((frame) => frame.includes("Plugins"))
  return { app, requests, toasts }
}

test("checking for updates refreshes the inventory and reveals the update action", async () => {
  await using tmp = await tmpdir()
  const fixture = await renderPlugins(tmp.path, { list: [packagePlugin(false)], check: [packagePlugin(true)] })

  try {
    const initial = await fixture.app.waitForFrame((frame) => frame.includes("dadba13"))
    expect(initial).toContain("check ctrl+r")
    expect(initial).not.toContain("update available")
    expect(initial).not.toContain("ctrl+u")

    fixture.app.mockInput.pressKey("r", { ctrl: true })
    const checked = await fixture.app.waitForFrame((frame) => frame.includes("update available"))
    expect(checked).toContain("ctrl+u")
    expect(fixture.requests).toEqual([{ path: "/api/plugin/check", body: {} }])
    expect(fixture.toasts).toEqual([{ variant: "info", message: "1 plugin update available" }])

    fixture.app.mockInput.pressKey("u", { ctrl: true })
    await fixture.app.waitFor(() => fixture.requests.length === 2)
    expect(fixture.requests[1]).toEqual({ path: "/api/plugin/update", body: { targets: [target] } })
  } finally {
    fixture.app.renderer.destroy()
  }
})

test("checking for updates reports an up-to-date inventory", async () => {
  await using tmp = await tmpdir()
  const fixture = await renderPlugins(tmp.path, { list: [packagePlugin(false)], check: [packagePlugin(false)] })

  try {
    await fixture.app.waitForFrame((frame) => frame.includes("dadba13"))
    fixture.app.mockInput.pressKey("r", { ctrl: true })
    await fixture.app.waitFor(() => fixture.toasts.length === 1)

    expect(fixture.toasts).toEqual([{ variant: "success", message: "All plugins are up to date" }])
    expect(fixture.requests).toEqual([{ path: "/api/plugin/check", body: {} }])
  } finally {
    fixture.app.renderer.destroy()
  }
})

test("the check action stays hidden without package plugins", async () => {
  await using tmp = await tmpdir()
  const local: PluginInfo = {
    id: "local.plugin",
    source: { type: "local", path: path.join(tmp.path, "plugin.ts") },
    features: { server: true },
    state: { status: "active" },
  }
  const fixture = await renderPlugins(tmp.path, { list: [local], check: [] })

  try {
    const frame = await fixture.app.waitForFrame((frame) => frame.includes("local.plugin"))
    expect(frame).not.toContain("ctrl+r")

    fixture.app.mockInput.pressKey("r", { ctrl: true })
    await fixture.app.flush()
    expect(fixture.requests).toEqual([])
  } finally {
    fixture.app.renderer.destroy()
  }
})
