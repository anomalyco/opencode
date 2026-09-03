/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode-ai/plugin/tui"
import { MouseButton } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { createSignal, Show } from "solid-js"
import { Keymap } from "../../../src/context/keymap"
import { InteractivityProvider } from "../../../src/context/interactivity"
import { DiffFileMenu } from "../../../src/feature-plugins/system/diff-viewer-file-menu"
import { DEFAULT_THEMES, parseTheme, resolveThemeDocument } from "../../../src/theme"

test.each(["dark", "light"] as const)(
  "file menus escape an offset, narrower clipping pane in %s mode",
  async (mode) => {
    const menu = await renderFileMenu(mode)
    try {
      const pane = menu.app.renderer.root.findDescendantById("test-diff-pane")!
      expect([pane.x, pane.y, pane.width]).toEqual([48, 4, 12])
      expect(menu.app.renderer.currentFocusedRenderable).toBe(pane)
      await menu.app.mockMouse.click(pane.x + 2, pane.y, MouseButton.RIGHT)
      await menu.app.waitForFrame((frame) => frame.includes("Mark complete"))

      const overlay = menu.app.renderer.root.findDescendantById("diff-file-menu-overlay")!
      const popup = menu.app.renderer.root.findDescendantById("diff-file-menu")!
      expect([overlay.x, overlay.y, overlay.width, overlay.height]).toEqual([0, 0, 80, 20])
      expect(overlay.parent?.parent).toBe(menu.app.renderer.root)
      expect([popup.x, popup.y, popup.width, popup.height]).toEqual([50, 5, 19, 1])
      expect(popup.x + popup.width).toBeGreaterThan(pane.x + pane.width)
      expect(menu.app.captureCharFrame().split("\n")[5].indexOf("Mark complete")).toBe(51)
      expect(menu.mode()).toBe("menu")
      expect(menu.app.renderer.currentFocusedRenderable).toBe(pane)

      const idle = menu.app.captureSpans().lines[popup.y].spans.find((span) => span.text.includes("Mark complete"))!
      expect(idle.fg).toEqual(menu.theme.contextual.overlay.text.default)
      expect(idle.bg).toEqual(menu.theme.contextual.overlay.background.default)

      // The action remains clickable outside the clipping pane's right edge.
      await menu.app.mockMouse.moveTo(pane.x + pane.width + 1, popup.y)
      await menu.app.flush()
      const hovered = menu.app.captureSpans().lines[popup.y].spans.find((span) => span.text.includes("Mark complete"))!
      expect(hovered.bg).toEqual(menu.theme.contextual.overlay.background.action.primary.hovered)
      await menu.app.mockMouse.moveTo(1, 1)
      await menu.app.flush()
      expect(
        menu.app.captureSpans().lines[popup.y].spans.find((span) => span.text.includes("Mark complete"))!.bg,
      ).toEqual(idle.bg)
      await menu.app.mockMouse.click(pane.x + pane.width + 1, popup.y)
      await menu.app.flush()
      expect(menu.calls).toEqual(["close", "toggle"])
      expect(menu.reviewed()).toBe(true)
      expect(menu.mode()).toBe("base")
      expect(menu.app.renderer.currentFocusedRenderable).toBe(pane)
      expect(menu.app.renderer.root.findDescendantById("diff-file-menu-overlay")).toBeUndefined()
    } finally {
      menu.app.renderer.destroy()
    }
  },
)

test("file menus clamp to screen edges and follow terminal resizes rather than pane bounds", async () => {
  const menu = await renderFileMenu()
  try {
    menu.open(79, 19)
    await menu.app.flush()
    const popup = menu.app.renderer.root.findDescendantById("diff-file-menu")!
    const overlay = menu.app.renderer.root.findDescendantById("diff-file-menu-overlay")!
    expect([popup.x, popup.y, popup.width, popup.height]).toEqual([61, 19, 19, 1])
    expect(menu.app.captureCharFrame().split("\n")[19]).toContain("Mark complete")

    menu.app.resize(64, 14)
    await menu.app.flush()
    expect([overlay.x, overlay.y, overlay.width, overlay.height]).toEqual([0, 0, 64, 14])
    expect([popup.x, popup.y, popup.width, popup.height]).toEqual([45, 13, 19, 1])
    expect(menu.app.captureCharFrame().split("\n")[13]).toContain("Mark complete")

    menu.app.resize(12, 8)
    await menu.app.flush()
    expect([overlay.width, overlay.height]).toEqual([12, 8])
    expect([popup.x, popup.y, popup.width, popup.height]).toEqual([0, 7, 12, 1])
    expect(menu.app.captureCharFrame().split("\n")[7]).toContain("...")

    menu.open(-3, -2)
    await menu.app.flush()
    const clamped = menu.app.renderer.root.findDescendantById("diff-file-menu")!
    expect([clamped.x, clamped.y]).toEqual([0, 0])
  } finally {
    menu.app.renderer.destroy()
  }
})

test("clicking outside the pane dismisses its menu without activating the underlying control", async () => {
  const menu = await renderFileMenu()
  try {
    menu.open(50, 4)
    await menu.app.flush()
    await menu.app.mockMouse.click(1, 1)
    await menu.app.flush()
    expect(menu.calls).toEqual(["close"])
    expect(menu.mode()).toBe("base")
    expect(menu.app.renderer.currentFocusedRenderable?.id).toBe("test-diff-pane")
    expect(menu.app.renderer.root.findDescendantById("diff-file-menu-overlay")).toBeUndefined()

    await menu.app.mockMouse.click(1, 1)
    expect(menu.calls).toEqual(["close", "outside"])
  } finally {
    menu.app.renderer.destroy()
  }
})

test.each(["escape", "ctrl+c"] as const)("%s dismisses only the file menu and restores pane commands", async (key) => {
  const menu = await renderFileMenu()
  try {
    menu.open(50, 4)
    await menu.app.flush()
    menu.app.mockInput.pressKey("j")
    await menu.app.flush()
    expect(menu.calls).toEqual([])
    if (key === "escape") menu.app.mockInput.pressEscape()
    if (key === "ctrl+c") menu.app.mockInput.pressKey("c", { ctrl: true })
    await menu.app.flush()
    expect(menu.calls).toEqual(["close"])
    expect(menu.mode()).toBe("base")
    expect(menu.app.renderer.currentFocusedRenderable?.id).toBe("test-diff-pane")
    expect(menu.app.renderer.root.findDescendantById("diff-file-menu-overlay")).toBeUndefined()

    menu.app.mockInput.pressKey("j")
    expect(menu.calls).toEqual(["close", "pane"])
  } finally {
    menu.app.renderer.destroy()
  }
})

test("Enter toggles either review state after closing the menu and leaves no stale menu bindings", async () => {
  const menu = await renderFileMenu()
  try {
    menu.open(50, 4)
    await menu.app.waitForFrame((frame) => frame.includes("Mark complete"))
    menu.app.mockInput.pressEnter()
    await menu.app.flush()
    expect(menu.reviewed()).toBe(true)
    expect(menu.calls).toEqual(["close", "toggle"])
    expect(menu.mode()).toBe("base")

    menu.open(50, 4)
    await menu.app.waitForFrame((frame) => frame.includes("Mark incomplete"))
    menu.app.mockInput.pressEnter()
    await menu.app.flush()
    expect(menu.reviewed()).toBe(false)
    expect(menu.calls).toEqual(["close", "toggle", "close", "toggle"])
    expect(menu.mode()).toBe("base")
    expect(menu.app.renderer.currentFocusedRenderable?.id).toBe("test-diff-pane")
    expect(menu.app.renderer.root.findDescendantById("diff-file-menu-overlay")).toBeUndefined()

    menu.app.mockInput.pressEnter()
    expect(menu.calls).toEqual(["close", "toggle", "close", "toggle", "pane"])
  } finally {
    menu.app.renderer.destroy()
  }
})

test("right-clicking the menu dismisses without toggling", async () => {
  const menu = await renderFileMenu()
  try {
    menu.open(50, 4)
    await menu.app.flush()
    await menu.app.mockMouse.click(51, 5, MouseButton.RIGHT)
    await menu.app.flush()
    expect(menu.calls).toEqual(["close"])
    expect(menu.mode()).toBe("base")
    expect(menu.reviewed()).toBe(false)
    expect(menu.app.renderer.currentFocusedRenderable?.id).toBe("test-diff-pane")
  } finally {
    menu.app.renderer.destroy()
  }
})

test("portaling the menu leaves its mode and commands owned by the pane's keymap scope", async () => {
  const menu = await renderFileMenu()
  try {
    menu.open(50, 4)
    await menu.app.flush()
    expect(menu.mode()).toBe("menu")

    menu.setEnabled(false)
    await menu.app.flush()
    expect(menu.mode()).toBe("base")
    menu.app.mockInput.pressEnter()
    menu.app.mockInput.pressEscape()
    await menu.app.flush()
    expect(menu.calls).toEqual([])
    expect(menu.app.renderer.root.findDescendantById("diff-file-menu")).toBeDefined()

    menu.setEnabled(true)
    await menu.app.flush()
    expect(menu.mode()).toBe("menu")
    menu.app.mockInput.pressEnter()
    await menu.app.flush()
    expect(menu.calls).toEqual(["close", "toggle"])
    expect(menu.mode()).toBe("base")
  } finally {
    menu.app.renderer.destroy()
  }
})

async function renderFileMenu(mode: "dark" | "light" = "dark") {
  const theme = resolveThemeDocument(parseTheme(DEFAULT_THEMES.opencode), mode)
  const calls: string[] = []
  const [state, setState] = createSignal<{ fileIndex: number; x: number; y: number }>()
  const [reviewed, setReviewed] = createSignal(false)
  const [enabled, setEnabled] = createSignal(true)
  const open = (x: number, y: number) => setState({ fileIndex: 0, x, y })
  let currentMode = () => "base"

  function Harness() {
    const keymap = Keymap.use()
    currentMode = keymap.mode.current
    const context: Pick<Plugin.Context, "theme" | "keymap"> = {
      theme,
      keymap: {
        layer: Keymap.createLayer,
        dispatch: keymap.dispatch,
        shortcuts: Keymap.useShortcuts().list,
        ...Keymap.useState(),
        mode: keymap.mode,
      },
    }
    Keymap.createLayer(() => ({
      commands: [{ bind: "escape,ctrl+c,return,j", title: "Pane command", run: () => void calls.push("pane") }],
    }))
    return (
      <box width="100%" height="100%" backgroundColor={theme.background.default}>
        <box position="absolute" left={0} top={0} width={20} height={3} onMouseDown={() => calls.push("outside")}>
          <text>Other pane</text>
        </box>
        <box
          id="test-diff-pane"
          position="absolute"
          left={48}
          top={4}
          width={12}
          height={6}
          overflow="hidden"
          focusable
          focused
        >
          <text
            onMouseDown={(event) => {
              if (event.button !== MouseButton.RIGHT) return
              open(event.x, event.y)
              event.preventDefault()
              event.stopPropagation()
            }}
          >
            file.txt
          </text>
          <Show when={state()} keyed>
            {(state) => (
              <DiffFileMenu
                context={context as Plugin.Context}
                state={state}
                reviewed={reviewed()}
                onClose={() => {
                  calls.push("close")
                  setState(undefined)
                }}
                onToggle={() => {
                  calls.push("toggle")
                  setReviewed((value) => !value)
                }}
              />
            )}
          </Show>
        </box>
      </box>
    )
  }

  const app = await testRender(
    () => (
      <Keymap.Provider config={{ keybinds: { get: () => [] } }}>
        <InteractivityProvider enabled={enabled()}>
          <Harness />
        </InteractivityProvider>
      </Keymap.Provider>
    ),
    { width: 80, height: 20, kittyKeyboard: true },
  )
  await app.flush()
  return { app, calls, theme, open, reviewed, setEnabled, mode: () => currentMode() }
}
