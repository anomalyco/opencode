/** @jsxImportSource @opentui/solid */
import { TextareaRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onCleanup } from "solid-js"
import { emptyThemeSource, tmpdir } from "../../fixture/fixture"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import type { Config } from "../../../src/config"
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
  cursor?: Config.Info["cursor"]
  service?: Config.Interface
  onConfirm: (value: string) => void
}) {
  const state = path.join(input.root, "state")
  await mkdir(state, { recursive: true })

  const [{ DialogProvider }, { DialogPrompt }, { ThemeProvider }, { Config }, { ToastProvider }, { Keymap }] =
    await Promise.all([
      import("../../../src/ui/dialog"),
      import("../../../src/ui/dialog-prompt"),
      import("../../../src/context/theme"),
      import("../../../src/config"),
      import("../../../src/ui/toast"),
      import("../../../src/context/keymap"),
    ])

  let config: ReturnType<typeof Config.useConfig> | undefined

  function Harness() {
    const resolvedConfig = createTuiResolvedConfig({
      keybinds: input.keybinds,
      leader: { timeout: 1000 },
      cursor: input.cursor,
    })

    function Prompt() {
      config = Config.useConfig()
      onCleanup(Keymap.use().mode.push("modal"))
      return <DialogPrompt title="Rename Session" value="draft" onConfirm={input.onConfirm} />
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
        <Config.ConfigProvider config={resolvedConfig} service={input.service}>
          <Keymap.Provider>
            <ThemeProvider mode="dark" source={emptyThemeSource}>
              <ToastProvider>
                <DialogProvider>
                  <Prompt />
                </DialogProvider>
              </ToastProvider>
            </ThemeProvider>
          </Keymap.Provider>
        </Config.ConfigProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { width: 80, height: 24, kittyKeyboard: true })
  app.renderer.start()
  return {
    app,
    get config() {
      if (!config) throw new Error("expected config context")
      return config
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

test("dialog prompt renders block cursor and survives cursor hot reloads", async () => {
  await using tmp = await tmpdir()
  let current: Config.Info = { cursor: { style: "block", blinking: true } }
  const service: Config.Interface = {
    get: async () => current,
    update: async (fn) => {
      const next = structuredClone(current)
      fn(next)
      current = next
      return current
    },
  }
  const prompt = await mountPrompt({
    root: tmp.path,
    keybinds: {},
    cursor: current.cursor,
    service,
    onConfirm: () => {},
  })

  try {
    await wait(() => prompt.app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    const textarea = prompt.app.renderer.currentFocusedEditor
    if (!(textarea instanceof TextareaRenderable)) throw new Error("expected focused dialog textarea")

    await prompt.app.renderOnce()
    expect(prompt.app.captureCharFrame()).toContain("Rename Session")
    expect(textarea.cursorStyle).toMatchObject({ style: "block", blinking: true })

    await prompt.config.update((draft) => {
      delete draft.cursor
    })
    await prompt.app.renderOnce()
    expect(textarea.cursorStyle).toMatchObject({ style: "block", blinking: true })

    const cases = (["block", "underline", "default", "line"] as const).flatMap((style) =>
      ([true, false] as const).map((blinking) => ({ style, blinking })),
    )
    for (const cursor of cases) {
      await prompt.config.update((draft) => {
        draft.cursor = cursor
      })
      await prompt.app.renderOnce()
      expect(textarea.cursorStyle).toMatchObject(cursor)
    }

    await prompt.config.update((draft) => {
      delete draft.cursor
    })
    await prompt.app.renderOnce()
    expect(textarea.cursorStyle).toMatchObject({ style: "block", blinking: true })
  } finally {
    await prompt.cleanup()
  }
})
