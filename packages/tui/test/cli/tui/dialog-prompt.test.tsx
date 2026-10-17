/** @jsxImportSource @opentui/solid */
import { TextareaRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { createSignal, onMount } from "solid-js"
import { emptyThemeSource, tmpdir } from "../../fixture/fixture"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import type { TuiKeybind } from "../../../src/config/keybind"
import { TestTuiContexts } from "../../fixture/tui-environment"

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

async function mountPrompt(input: {
  root: string
  keybinds: Partial<TuiKeybind.Keybinds>
  onConfirm: (value: string) => void
  onCancel?: () => void
}) {
  const [busy, setBusy] = createSignal(false)
  let closed = 0
  const state = path.join(input.root, "state")
  await mkdir(state, { recursive: true })

  const [{ DialogProvider, useDialog }, { DialogPrompt }, { ThemeProvider }, { ConfigProvider }, { ToastProvider }, { Keymap }] =
    await Promise.all([
      import("../../../src/ui/dialog"),
      import("../../../src/ui/dialog-prompt"),
      import("../../../src/context/theme"),
      import("../../../src/config"),
      import("../../../src/ui/toast"),
      import("../../../src/context/keymap"),
    ])

  function Harness() {
    const resolvedConfig = createTuiResolvedConfig({
      keybinds: input.keybinds,
      leader: { timeout: 1000 },
    })

    function Prompt() {
      const dialog = useDialog()
      onMount(() =>
        dialog.replace(
          () => (
            <DialogPrompt
              title="Rename Session"
              value="draft"
              busy={busy()}
              onConfirm={input.onConfirm}
              onCancel={input.onCancel}
            />
          ),
          () => closed++,
        ),
      )
      return null
    }

    return (
      <TestTuiContexts
        directory={input.root}
        paths={{
          home: input.root,
          state,
          worktree: input.root,
        }}
      >
        <ConfigProvider config={resolvedConfig}>
          <Keymap.Provider>
            <ThemeProvider mode="dark" source={emptyThemeSource}>
              <ToastProvider>
                <DialogProvider>
                  <Prompt />
                </DialogProvider>
              </ToastProvider>
            </ThemeProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { width: 80, height: 24, kittyKeyboard: true })
  app.renderer.start()
  return {
    app,
    setBusy,
    get closed() {
      return closed
    },
    async cleanup() {
      app.renderer.destroy()
    },
  }
}

test("dialog prompt submit wins when return is also input newline", async () => {
  await using tmp = await tmpdir()
  const confirmed: string[] = []
  const prompt = await mountPrompt({
    root: tmp.path,
    keybinds: {
      "input.submit": "super+return",
      "input.newline": "return,shift+return,alt+return,ctrl+j",
    },
    onConfirm: (value) => confirmed.push(value),
  })

  try {
    await wait(() => prompt.app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    const textarea = prompt.app.renderer.currentFocusedEditor
    if (!(textarea instanceof TextareaRenderable)) throw new Error("expected focused dialog textarea")

    prompt.app.mockInput.pressEnter()

    expect(confirmed).toEqual(["draft"])
    expect(textarea.plainText).toBe("draft")
  } finally {
    await prompt.cleanup()
  }
})

test.each([false, true])("busy prompt preserves input and stays open on ctrl+c (onCancel: %s)", async (cancel) => {
  await using tmp = await tmpdir()
  const confirmed: string[] = []
  let cancelled = 0
  const prompt = await mountPrompt({
    root: tmp.path,
    keybinds: {},
    onConfirm: (value) => confirmed.push(value),
    onCancel: cancel ? () => cancelled++ : undefined,
  })

  try {
    await wait(() => prompt.app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    const textarea = prompt.app.renderer.currentFocusedEditor
    if (!(textarea instanceof TextareaRenderable)) throw new Error("expected focused dialog textarea")

    prompt.setBusy(true)
    await wait(() => prompt.app.renderer.currentFocusedEditor === null)
    await prompt.app.renderOnce()
    await prompt.app.mockInput.pressKey("c", { ctrl: true })
    await prompt.app.mockInput.pressEnter()
    await prompt.app.renderOnce()

    expect(prompt.closed).toBe(0)
    expect(cancelled).toBe(0)
    expect(confirmed).toEqual([])
    expect(textarea.plainText).toBe("draft")
    expect(prompt.app.captureCharFrame()).toContain("Working…")

    prompt.setBusy(false)
    await wait(() => prompt.app.renderer.currentFocusedEditor === textarea)
    await prompt.app.renderOnce()
    await prompt.app.mockInput.pressKey("c", { ctrl: true })
    expect(textarea.plainText).toBe("")
    expect(prompt.closed).toBe(0)
    await prompt.app.mockInput.pressKey("c", { ctrl: true })
    expect(prompt.closed).toBe(1)
  } finally {
    await prompt.cleanup()
  }
})

test("alt return inserts a newline with default keybinds", async () => {
  await using tmp = await tmpdir()
  const confirmed: string[] = []
  const prompt = await mountPrompt({
    root: tmp.path,
    keybinds: {},
    onConfirm: (value) => confirmed.push(value),
  })

  try {
    await wait(() => prompt.app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    const textarea = prompt.app.renderer.currentFocusedEditor
    if (!(textarea instanceof TextareaRenderable)) throw new Error("expected focused dialog textarea")

    prompt.app.mockInput.pressEnter({ meta: true })

    expect(confirmed).toEqual([])
    expect(textarea.plainText).toBe("draft\n")
  } finally {
    await prompt.cleanup()
  }
})

test("dialog prompt submit can be rebound separately from input submit", async () => {
  await using tmp = await tmpdir()
  const confirmed: string[] = []
  const prompt = await mountPrompt({
    root: tmp.path,
    keybinds: {
      "input.submit": "return",
      "dialog.prompt.submit": "ctrl+y",
    },
    onConfirm: (value) => confirmed.push(value),
  })

  try {
    await wait(() => prompt.app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    const textarea = prompt.app.renderer.currentFocusedEditor
    if (!(textarea instanceof TextareaRenderable)) throw new Error("expected focused dialog textarea")

    prompt.app.mockInput.pressEnter()
    expect(confirmed).toEqual([])
    expect(textarea.plainText).toBe("draft")

    prompt.app.mockInput.pressKey("y", { ctrl: true })

    expect(confirmed).toEqual(["draft"])
  } finally {
    await prompt.cleanup()
  }
})

test("dialog prompt submit can be disabled", async () => {
  await using tmp = await tmpdir()
  const confirmed: string[] = []
  const prompt = await mountPrompt({
    root: tmp.path,
    keybinds: {
      "input.submit": "return",
      "dialog.prompt.submit": "none",
    },
    onConfirm: (value) => confirmed.push(value),
  })

  try {
    await wait(() => prompt.app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    const textarea = prompt.app.renderer.currentFocusedEditor
    if (!(textarea instanceof TextareaRenderable)) throw new Error("expected focused dialog textarea")

    prompt.app.mockInput.pressEnter()

    expect(confirmed).toEqual([])
    expect(textarea.plainText).toBe("draft")
  } finally {
    await prompt.cleanup()
  }
})
