/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { DiffRenderable, type Renderable, ScrollBoxRenderable } from "@opentui/core"
import { testRender, useRenderer } from "@opentui/solid"
import type { TuiPluginApi, TuiPluginMeta, TuiRouteCurrent, TuiRouteDefinition } from "@opencode-ai/plugin/tui"
import type { Session } from "@opencode-ai/sdk/v2"
import { ThemeProvider } from "../../../src/context/theme"
import { ConfigProvider } from "../../../src/config"
import { SDKProvider } from "../../../src/context/sdk"
import { TuiKeybind } from "../../../src/config/keybind"
import { OpencodeKeymapProvider } from "../../../src/keymap"
import diffViewerPlugin from "../../../src/feature-plugins/system/diff-viewer"
import { createTuiPluginApi } from "../../fixture/tui-plugin"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createApi, createClient, createEventStream, createFetch, json } from "../../fixture/tui-sdk"

test("closing the diff viewer returns to the route it opened from", async () => {
  const viewer = await renderDiffViewer([])
  try {
    expect(viewer.current()).toEqual({
      name: "diff",
      params: { mode: "working", sessionID: "session-1", returnRoute: startRoute },
    })
    expect(viewer.vcsDiffInput()).toEqual({
      location: { directory: "/repo/session" },
      mode: "working",
      context: "12",
    })

    expect(viewer.commands.has("diff.close")).toBe(true)
    viewer.commands.get("diff.close")!.run?.({} as never)
    expect(viewer.current()).toEqual(startRoute)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("brackets navigate diff hunks", async () => {
  const viewer = await renderDiffViewer(
    [
      {
        file: "src/file.ts",
        additions: 3,
        deletions: 3,
        status: "modified",
        patch: `--- a/src/file.ts
+++ b/src/file.ts
@@ -1,3 +1,3 @@
 const first = true
-const oldFirst = true
+const newFirst = true
 const afterFirst = true
@@ -20,3 +20,3 @@
 const second = true
-const oldSecond = true
+const newSecond = true
 const afterSecond = true
@@ -40,3 +40,3 @@
 const third = true
-const oldThird = true
+const newThird = true
 const afterThird = true`,
      },
    ],
    12,
  )
  try {
    await viewer.app.waitForFrame((frame) => frame.includes("const first"))
    await viewer.app.waitFor(() => Boolean(findScrollBox(viewer.app.renderer.root)))
    await viewer.app.flush()
    const scroll = findScrollBox(viewer.app.renderer.root)!
    const initial = scroll.scrollTop

    expect(TuiKeybind.defaultValue("diff_next_hunk")).toBe("]")
    expect(TuiKeybind.defaultValue("diff_previous_hunk")).toBe("[")

    viewer.commands.get("diff.next_hunk")!.run?.({} as never)
    await viewer.app.renderOnce()
    const first = scroll.scrollTop
    expect(first).toBeGreaterThan(initial)

    viewer.commands.get("diff.next_hunk")!.run?.({} as never)
    await viewer.app.renderOnce()
    const second = scroll.scrollTop
    expect(second).toBeGreaterThan(first)

    viewer.commands.get("diff.previous_hunk")!.run?.({} as never)
    await viewer.app.renderOnce()
    expect(scroll.scrollTop).toBe(first)

    viewer.commands.get("diff.next_hunk")!.run?.({} as never)
    await viewer.app.renderOnce()
    expect(scroll.scrollTop).toBe(second)

    scroll.scrollTo(initial)
    viewer.commands.get("diff.next_hunk")!.run?.({} as never)
    await viewer.app.renderOnce()
    expect(scroll.scrollTop).toBe(first)
  } finally {
    viewer.app.renderer.destroy()
  }
})

async function renderDiffViewer(vcsDiff: unknown[], height = 20, initialRoute?: TuiRouteCurrent) {
  const commands = new Map<
    string,
    NonNullable<Parameters<TuiPluginApi["keymap"]["registerLayer"]>[0]["commands"]>[number]
  >()
  let current = initialRoute ?? startRoute
  let renderDiff: TuiRouteDefinition["render"] | undefined
  let vcsDiffInput: unknown
  let sessionDiffInput: unknown
  const config = createTuiResolvedConfig()
  const transport = createFetch((url) => {
    if (url.pathname !== "/api/vcs/diff") return
    vcsDiffInput = {
      location: { directory: url.searchParams.get("location[directory]") },
      mode: url.searchParams.get("mode"),
      context: url.searchParams.get("context"),
    }
    return json({
      location: { directory: "/repo/session", project: { id: "project-1", directory: "/repo/session" } },
      data: vcsDiff,
    })
  }, createEventStream())
  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const registerLayer = keymap.registerLayer.bind(keymap)
    keymap.registerLayer = (layer) => {
      layer.commands?.forEach((command) => commands.set(command.name, command))
      return registerLayer(layer)
    }
    const base = createTuiPluginApi({
      keymap,
      client: {
        session: {
          diff: async (input: unknown) => {
            sessionDiffInput = input
            return { data: [] }
          },
        },
      } as unknown as TuiPluginApi["client"],
      state: {
        session: {
          get: () => session,
        },
      },
    })
    const api = {
      ...base,
      route: {
        register(routes) {
          renderDiff = routes.find((route) => route.name === "diff")?.render
          return () => {}
        },
        navigate(name, params) {
          current = params ? { name, params } : { name }
        },
        get current() {
          return current
        },
      },
    } satisfies TuiPluginApi

    void diffViewerPlugin.tui(api, undefined, pluginMeta)
    if (!initialRoute) commands.get("diff.open")?.run?.({} as never)

    return (
      <TestTuiContexts>
        <SDKProvider client={createClient(transport.fetch)} api={createApi(transport.fetch)}>
          <OpencodeKeymapProvider keymap={keymap}>
            <ConfigProvider config={config}>
              <ThemeProvider mode="dark">
                {renderDiff?.({ params: "params" in current ? current.params : undefined })}
              </ThemeProvider>
            </ConfigProvider>
          </OpencodeKeymapProvider>
        </SDKProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { width: 80, height })
  await waitForCommand(app, commands, "diff.close")
  return {
    app,
    commands,
    current: () => current,
    vcsDiffInput: () => vcsDiffInput,
    sessionDiffInput: () => sessionDiffInput,
  }
}

const startRoute: TuiRouteCurrent = { name: "session", params: { sessionID: "session-1" } }

function findScrollBox(root: Renderable): ScrollBoxRenderable | undefined {
  if (root instanceof ScrollBoxRenderable && containsDiff(root)) return root
  return root.getChildren().map(findScrollBox).find(Boolean)
}

function containsDiff(root: Renderable): boolean {
  if (root instanceof DiffRenderable) return true
  return root.getChildren().some(containsDiff)
}

const session = {
  id: "session-1",
  slug: "session-1",
  projectID: "project-1",
  directory: "/repo/session",
  title: "Session",
  version: "1",
  time: {
    created: 0,
    updated: 0,
  },
} satisfies Session

test("branch diff source requests branch VCS diff", async () => {
  const viewer = await renderDiffViewer([], 20, {
    name: "diff",
    params: { mode: "branch", sessionID: "session-1", returnRoute: startRoute },
  })
  try {
    expect(viewer.current()).toEqual({
      name: "diff",
      params: { mode: "branch", sessionID: "session-1", returnRoute: startRoute },
    })
    expect(viewer.vcsDiffInput()).toEqual({
      location: { directory: "/repo/session" },
      mode: "branch",
      context: "12",
    })
    expect(viewer.sessionDiffInput()).toBeUndefined()
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("last-turn diff source requests session diff", async () => {
  const viewer = await renderDiffViewer([], 20, {
    name: "diff",
    params: { mode: "last-turn", sessionID: "session-1", messageID: "message-1", returnRoute: startRoute },
  })
  try {
    expect(viewer.current()).toEqual({
      name: "diff",
      params: { mode: "last-turn", sessionID: "session-1", messageID: "message-1", returnRoute: startRoute },
    })
    expect(viewer.sessionDiffInput()).toEqual({ sessionID: "session-1", messageID: "message-1" })
    expect(viewer.vcsDiffInput()).toBeUndefined()
  } finally {
    viewer.app.renderer.destroy()
  }
})

async function waitForCommand(
  app: Awaited<ReturnType<typeof testRender>>,
  commands: Map<string, unknown>,
  command: string,
) {
  for (let attempt = 0; attempt < 10; attempt++) {
    await app.renderOnce()
    if (commands.has(command)) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

const pluginMeta = {
  id: "diff-viewer",
  source: "internal",
  spec: "diff-viewer",
  target: "diff-viewer",
  first_time: 0,
  last_time: 0,
  time_changed: 0,
  load_count: 1,
  fingerprint: "test",
  state: "same",
} satisfies TuiPluginMeta
