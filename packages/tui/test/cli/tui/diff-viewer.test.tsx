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
  SlotClaim,
  Route,
} from "@opencode-ai/plugin/tui/context"
import { ThemeProvider, useThemes } from "../../../src/context/theme"
import { emptyThemeSource } from "../../fixture/fixture"
import { ConfigProvider } from "../../../src/config"
import type { TuiKeybind } from "../../../src/config/keybind"
import { Keymap } from "../../../src/context/keymap"
import diffViewerPlugin from "../../../src/feature-plugins/system/diff-viewer"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createApi, createEventStream, createFetch, json } from "../../fixture/tui-client"
import { DialogProvider } from "../../../src/ui/dialog"
import { ToastProvider } from "../../../src/ui/toast"
import { createSignal } from "solid-js"

test("closing the diff viewer returns to the route it opened from", async () => {
  const viewer = await renderDiffViewer([])
  try {
    expect(viewer.current()).toEqual({
      type: "plugin",
      id: "opencode.diffs",
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

test("ctrl+c closes the diff viewer without exiting the application", async () => {
  const viewer = await renderDiffViewer([])

  try {
    viewer.app.mockInput.pressKey("c", { ctrl: true })
    await viewer.app.waitFor(() => viewer.current().type !== "plugin")
    expect(viewer.current()).toEqual(startRoute)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("shows an error instead of an empty diff when loading fails", async () => {
  const viewer = await renderDiffViewer([], { fail: true })
  try {
    await viewer.app.waitForFrame((frame) => frame.includes("Could not load diff"))
    expect(viewer.app.captureCharFrame()).not.toContain("No changes to show")
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("uses the active location when opened outside a session", async () => {
  const viewer = await renderDiffViewer([], { initialRoute: { type: "home" } })
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
  const viewer = await renderDiffViewer(hunkDiff, { height: 12 })
  try {
    await viewer.app.waitForFrame((frame) => frame.includes("const first"))
    await viewer.app.waitFor(() => Boolean(findScrollBox(viewer.app.renderer.root)))
    await viewer.app.flush()
    expect(countDiffs(viewer.app.renderer.root)).toBe(3)
    const scroll = findScrollBox(viewer.app.renderer.root)!
    const initial = scroll.scrollTop

    viewer.app.mockInput.pressKey("]")
    await viewer.app.renderOnce()
    const first = scroll.scrollTop
    expect(first).toBeGreaterThan(initial)

    viewer.app.mockInput.pressKey("]")
    await viewer.app.renderOnce()
    const second = scroll.scrollTop
    expect(second).toBeGreaterThan(first)

    viewer.app.mockInput.pressKey("[")
    await viewer.app.renderOnce()
    expect(scroll.scrollTop).toBe(first)

    viewer.app.mockInput.pressKey("]")
    await viewer.app.renderOnce()
    expect(scroll.scrollTop).toBe(second)

    scroll.scrollTo(initial)
    viewer.app.mockInput.pressKey("]")
    await viewer.app.renderOnce()
    expect(scroll.scrollTop).toBe(first)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("disabled diff keybinds have no component fallbacks", async () => {
  const viewer = await renderDiffViewer(hunkDiff, {
    height: 12,
    keybinds: disabledDiffKeybinds,
  })
  try {
    await viewer.app.waitForFrame((frame) => frame.includes("const first"))
    await viewer.app.waitFor(() => Boolean(findScrollBox(viewer.app.renderer.root)))
    await viewer.app.flush()
    const scroll = findScrollBox(viewer.app.renderer.root)!
    const initial = scroll.scrollTop

    Object.keys(disabledDiffKeybinds).forEach((command) => expect(viewer.shortcut(command)).toBe(""))

    viewer.app.mockInput.pressKey("j")
    await viewer.app.renderOnce()

    expect(scroll.scrollTop).toBe(initial)
  } finally {
    viewer.app.renderer.destroy()
  }
})

async function renderDiffViewer(
  vcsDiff: unknown[],
  options: {
    height?: number
    initialRoute?: Route
    fail?: boolean
    keybinds?: TuiKeybind.KeybindOverrides
  } = {},
) {
  const commands = new Map<string, KeymapCommand>()
  const [current, setCurrent] = createSignal<Route>(options.initialRoute ?? startRoute)
  const currentData = () => {
    const route = current()
    return route.type === "plugin" ? route.data : undefined
  }
  let renderDiff: Page["render"] | undefined
  let renderCommands: SlotClaim<"app">["render"] | undefined
  let vcsDiffInput: unknown
  let shortcut: (command: string) => string | undefined = () => undefined
  const config = createTuiResolvedConfig({ keybinds: options.keybinds })
  const transport = createFetch((url) => {
    if (url.pathname !== "/api/vcs/diff") return
    vcsDiffInput = {
      location: { directory: url.searchParams.get("location[directory]") },
      mode: url.searchParams.get("mode"),
      context: url.searchParams.get("context"),
    }
    if (options.fail) return json({ message: "boom" }, { status: 500 })
    return json({
      location: { directory: "/repo/session", project: { id: "project-1", directory: "/repo/session" } },
      data: vcsDiff,
    })
  }, createEventStream())
  function Harness() {
    let theme: ReturnType<ReturnType<typeof useThemes>["currentTokens"]>
    function Content() {
      const keymap = Keymap.use()
      const shortcuts = Keymap.useShortcuts()
      shortcut = shortcuts.get
      theme = useThemes().currentTokens()
      const context = {
        options: {},
        client: createApi(transport.fetch),
        data: {
          session: { get: () => session },
          location: { default: () => ({ directory: "/repo/default" }) },
        },
        get theme() {
          return theme
        },
        keymap: {
          layer(input: () => KeymapLayer) {
            input().commands?.forEach((command) => {
              if (command.id) commands.set(command.id, command)
            })
            Keymap.createLayer(input)
          },
          dispatch: keymap.dispatch,
          shortcuts: shortcuts.list,
          mode: keymap.mode,
        },
        ui: {
          dialog: {
            show: () => () => {},
            set() {},
            clear() {},
          },
          router: {
            register(page: Page) {
              if (page.name === "diff") renderDiff = page.render
              return () => {}
            },
            navigate(destination: Destination) {
              setCurrent(
                destination.type === "plugin" && !("id" in destination)
                  ? { ...destination, id: "opencode.diffs" }
                  : destination,
              )
            },
            current,
          },
          slot(claim: SlotClaim<"app">) {
            renderCommands = claim.render
            return () => {}
          },
        },
      } as unknown as Context

      void diffViewerPlugin.setup(context)
      const commandView = renderCommands?.({})
      return (
        <>
          {commandView}
          {renderDiff?.({ data: currentData() })}
        </>
      )
    }

    return (
      <TestTuiContexts>
        <ConfigProvider config={config}>
          <Keymap.Provider>
            <ToastProvider>
              <ThemeProvider mode="dark" source={emptyThemeSource}>
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

  const app = await testRender(() => <Harness />, { width: 80, height: options.height ?? 20 })
  for (let attempt = 0; attempt < 100; attempt++) {
    await app.renderOnce()
    if (current().type !== "plugin") commands.get("diff.open")?.run()
    if (commands.has("diff.close")) break
    await Bun.sleep(25)
  }
  await app.waitFor(() => commands.has("diff.close"), { maxPasses: 1 })
  await app.waitFor(() => vcsDiffInput !== undefined)
  return {
    app,
    commands,
    current,
    shortcut: (command: string) => shortcut(command),
    vcsDiffInput: () => vcsDiffInput,
  }
}

const startRoute: Route = { type: "session", sessionID: "session-1" }

const disabledDiffKeybinds = {
  "diff.down": "none",
  "diff.up": "none",
  "diff.page.down": "none",
  "diff.page.up": "none",
  "diff.mark_reviewed": "none",
} satisfies TuiKeybind.KeybindOverrides

const hunkDiff = [
  {
    file: "src/file.txt",
    additions: 3,
    deletions: 3,
    status: "modified",
    patch: `--- a/src/file.txt
+++ b/src/file.txt
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
]

function findScrollBox(root: Renderable): ScrollBoxRenderable | undefined {
  if (root instanceof ScrollBoxRenderable && containsDiff(root)) return root
  return root.getChildren().map(findScrollBox).find(Boolean)
}

function containsDiff(root: Renderable): boolean {
  if (root instanceof DiffRenderable) return true
  return root.getChildren().some(containsDiff)
}

function countDiffs(root: Renderable): number {
  return (
    (root instanceof DiffRenderable ? 1 : 0) + root.getChildren().reduce((total, child) => total + countDiffs(child), 0)
  )
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
  const viewer = await renderDiffViewer([], {
    initialRoute: {
      type: "plugin",
      id: "opencode.diffs",
      name: "diff",
      data: { mode: "branch", sessionID: "session-1", returnRoute: startRoute },
    },
  })
  try {
    expect(viewer.current()).toEqual({
      type: "plugin",
      id: "opencode.diffs",
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
