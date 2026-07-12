/** @jsxImportSource @opentui/solid */
import { TextareaRenderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onCleanup } from "solid-js"
import { tmpdir } from "../../fixture/fixture"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import type { TuiKeybind } from "../../../src/config/v1/keybind"
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
}) {
  const state = path.join(input.root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")

  const [
    { DialogProvider },
    { DialogPrompt },
    { KVProvider },
    { ThemeProvider },
    { TuiConfigProvider },
    { ToastProvider },
    { OpencodeKeymapProvider, registerOpencodeKeymap },
  ] = await Promise.all([
    import("../../../src/ui/dialog"),
    import("../../../src/ui/dialog-prompt"),
    import("../../../src/context/kv"),
    import("../../../src/context/theme"),
    import("../../../src/config/v1"),
    import("../../../src/ui/toast"),
    import("../../../src/keymap"),
  ])

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const resolvedConfig = createTuiResolvedConfig({
      keybinds: input.keybinds,
      leader_timeout: 1000,
    })
    const off = registerOpencodeKeymap(keymap, renderer, resolvedConfig)
    onCleanup(off)

    return (
      <TestTuiContexts
        directory={input.root}
        paths={{
          home: input.root,
          state,
          worktree: input.root,
        }}
      >
        <OpencodeKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={resolvedConfig}>
            <KVProvider>
              <ThemeProvider mode="dark">
                <ToastProvider>
                  <DialogProvider>
                    <DialogPrompt title="Rename Session" value="draft" onConfirm={input.onConfirm} />
                  </DialogProvider>
                </ToastProvider>
              </ThemeProvider>
            </KVProvider>
          </TuiConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { kittyKeyboard: true })
  return {
    app,
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
      input_submit: "super+return",
      input_newline: "return,shift+return,alt+return,ctrl+j",
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

test("dialog prompt submit can be rebound separately from input submit", async () => {
  await using tmp = await tmpdir()
  const confirmed: string[] = []
  const prompt = await mountPrompt({
    root: tmp.path,
    keybinds: {
      input_submit: "return",
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
