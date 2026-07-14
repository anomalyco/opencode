/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { DiffRenderable, type Renderable, ScrollBoxRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type {
  Context,
  Destination,
  KeymapCommand,
  KeymapLayer,
  Page,
  Route,
  Slot,
} from "@opencode-ai/plugin/v2/tui/context"
import { ThemeProvider } from "../../../src/context/theme"
import { ConfigProvider } from "../../../src/config"
import { TuiKeybind } from "../../../src/config/keybind"
import { Keymap } from "../../../src/context/keymap"
import diffViewerPlugin from "../../../src/feature-plugins/system/diff-viewer"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createApi, createEventStream, createFetch, json } from "../../fixture/tui-client"
import { DialogProvider } from "../../../src/ui/dialog"
import { ToastProvider } from "../../../src/ui/toast"

test("closing the diff viewer returns to the route it opened from", async () => {
  const viewer = await renderDiffViewer([])
  try {
    expect(viewer.current()).toEqual({
      type: "plugin",
      id: "diff-viewer",
      name: "diff",
      data: { mode: "working", sessionID: "session-1", returnRoute: startRoute },
    })
    const route = viewer.current()
    expect(route.type === "plugin" ? route.data?.returnRoute : undefined).not.toBe(startRoute)
    expect(viewer.vcsDiffInput()).toEqual({
      location: { directory: "/repo/session" },
      mode: "working",
      context: "12",
    })

    expect(viewer.commands.has("diff.close")).toBe(true)
    viewer.commands.get("diff.close")!.run()
    expect(viewer.current()).toEqual(startRoute)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("shows an error instead of an empty diff when loading fails", async () => {
  const viewer = await renderDiffViewer([], 20, undefined, true)
  try {
    await viewer.app.waitForFrame((frame) => frame.includes("Could not load diff"))
    expect(viewer.app.captureCharFrame()).not.toContain("No changes to show")
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("uses the active location when opened outside a session", async () => {
  const viewer = await renderDiffViewer([], 20, { type: "home" })
  try {
    expect(viewer.vcsDiffInput()).toEqual({
      location: { directory: "/repo/default" },
      mode: "working",
      context: "12",
    })
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

    viewer.commands.get("diff.next_hunk")!.run()
    await viewer.app.renderOnce()
    const first = scroll.scrollTop
    expect(first).toBeGreaterThan(initial)

    viewer.commands.get("diff.next_hunk")!.run()
    await viewer.app.renderOnce()
    const second = scroll.scrollTop
    expect(second).toBeGreaterThan(first)

    viewer.commands.get("diff.previous_hunk")!.run()
    await viewer.app.renderOnce()
    expect(scroll.scrollTop).toBe(first)

    viewer.commands.get("diff.next_hunk")!.run()
    await viewer.app.renderOnce()
    expect(scroll.scrollTop).toBe(second)

    scroll.scrollTo(initial)
    viewer.commands.get("diff.next_hunk")!.run()
    await viewer.app.renderOnce()
    expect(scroll.scrollTop).toBe(first)
  } finally {
    viewer.app.renderer.destroy()
  }
})

async function renderDiffViewer(vcsDiff: unknown[], height = 20, initialRoute?: Route, fail = false) {
  const commands = new Map<string, KeymapCommand>()
  let current = initialRoute ?? startRoute
  let renderDiff: Page["render"] | undefined
  let renderCommands: Slot | undefined
  let vcsDiffInput: unknown
  const config = createTuiResolvedConfig()
  const transport = createFetch((url) => {
    if (url.pathname !== "/api/vcs/diff") return
    if (fail) return json({ message: "boom" }, { status: 500 })
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
    const context = {
      options: {},
      client: createApi(transport.fetch),
      data: {
        session: { get: () => session },
        location: { default: () => ({ directory: "/repo/default" }) },
      },
      keymap: {
        layer(input: () => KeymapLayer) {
          input().commands?.forEach((command) => {
            if (command.id) commands.set(command.id, command)
          })
        },
        dispatch() {},
        shortcut: () => undefined,
        mode: { current: () => "base", push: () => () => {} },
      },
      ui: {
        router: {
          register(page: Page) {
            if (page.name === "diff") renderDiff = page.render
          return () => {}
          },
          navigate(destination: Destination) {
            current = destination.type === "plugin" && !("id" in destination)
              ? { ...destination, id: "diff-viewer" }
              : destination
          },
          current: () => current,
        },
        slot(_name: string, render: Slot) {
          renderCommands = render
          return () => {}
        },
      },
    } as unknown as Context

    void diffViewerPlugin.setup(context)
    function Content() {
      const commandView = renderCommands?.({})
      if (current.type !== "plugin") commands.get("diff.open")?.run()
      return (
        <>
          {commandView}
          {renderDiff?.({ data: current.type === "plugin" ? current.data : undefined })}
        </>
      )
    }

    return (
      <TestTuiContexts>
        <ConfigProvider config={config}>
          <Keymap.Provider>
            <ToastProvider>
              <ThemeProvider mode="dark">
                <DialogProvider>
                  <Content />
                </DialogProvider>
              </ThemeProvider>
            </ToastProvider>
          </Keymap.Provider>
        </ConfigProvider>
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
  }
}

const startRoute: Route = { type: "session", sessionID: "session-1" }

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
  projectID: "project-1",
  location: { directory: "/repo/session" },
  title: "Session",
  cost: { currency: "USD", amount: 0 },
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: {
    created: 0,
    updated: 0,
  },
}

test("branch diff source requests branch VCS diff", async () => {
  const viewer = await renderDiffViewer([], 20, {
    type: "plugin",
    id: "diff-viewer",
    name: "diff",
    data: { mode: "branch", sessionID: "session-1", returnRoute: startRoute },
  })
  try {
    expect(viewer.current()).toEqual({
      type: "plugin",
      id: "diff-viewer",
      name: "diff",
      data: { mode: "branch", sessionID: "session-1", returnRoute: startRoute },
    })
    expect(viewer.vcsDiffInput()).toEqual({
      location: { directory: "/repo/session" },
      mode: "branch",
      context: "12",
    })
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
