/** @jsxImportSource @opentui/solid */
import { InputRenderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onCleanup } from "solid-js"
import type { DialogSelectOption } from "../../../src/ui/dialog-select"
import { tmpdir } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

async function renderSelect(
  root: string,
  options: DialogSelectOption<string>[],
  onGlobal: () => void,
  onRow: (option: DialogSelectOption<string>) => void,
) {
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  const config = createTuiResolvedConfig()
  const [
    { ConfigProvider },
    { ThemeProvider },
    { OpencodeKeymapProvider, registerOpencodeKeymap },
    { DialogProvider },
    { DialogSelect },
    { ToastProvider },
  ] = await Promise.all([
    import("../../../src/config"),
    import("../../../src/context/theme"),
    import("../../../src/keymap"),
    import("../../../src/ui/dialog"),
    import("../../../src/ui/dialog-select"),
    import("../../../src/ui/toast"),
  ])

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const off = registerOpencodeKeymap(keymap, renderer, config)
    onCleanup(off)

    return (
      <TestTuiContexts directory={root} paths={{ home: root, state, worktree: root }}>
        <OpencodeKeymapProvider keymap={keymap}>
          <ConfigProvider config={config}>
            <ThemeProvider mode="dark" source={{ discover: () => Promise.resolve({}) }}>
              <ToastProvider>
                <DialogProvider>
                  <DialogSelect
                    title="Items"
                    options={options}
                    actions={[
                      {
                        command: "dialog.move_session.delete",
                        title: "delete",
                        onTrigger: onRow,
                      },
                      {
                        command: "dialog.move_session.new",
                        title: "new",
                        selection: "none",
                        onTrigger: onGlobal,
                      },
                    ]}
                  />
                </DialogProvider>
              </ToastProvider>
            </ThemeProvider>
          </ConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { width: 80, height: 20, kittyKeyboard: true })
  app.renderer.start()
  await app.waitForFrame((frame) => frame.includes("Items"))
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
  return app
}

test("dialog actions run without options while row actions still require a selection", async () => {
  await using tmp = await tmpdir()
  let global = 0
  const rows: string[] = []
  const app = await renderSelect(
    tmp.path,
    [],
    () => global++,
    (option) => rows.push(option.value),
  )

  try {
    app.mockInput.pressKey("m", { ctrl: true })
    app.mockInput.pressKey("d", { ctrl: true })

    expect(global).toBe(1)
    expect(rows).toEqual([])
  } finally {
    app.renderer.destroy()
  }
})

test("footer actions run when filtering leaves no selected row", async () => {
  await using tmp = await tmpdir()
  let global = 0
  const rows: string[] = []
  const app = await renderSelect(
    tmp.path,
    [{ title: "Alpha", value: "alpha" }],
    () => global++,
    (option) => rows.push(option.value),
  )

  try {
    for (const key of "missing") app.mockInput.pressKey(key)
    await app.waitForFrame((frame) => frame.includes("No results found"))

    app.mockInput.pressKey("d", { ctrl: true })
    app.mockInput.pressTab()
    app.mockInput.pressEnter()

    expect(global).toBe(1)
    expect(rows).toEqual([])
  } finally {
    app.renderer.destroy()
  }
})

test("row actions receive the selected option", async () => {
  await using tmp = await tmpdir()
  const rows: string[] = []
  const app = await renderSelect(
    tmp.path,
    [{ title: "Alpha", value: "alpha" }],
    () => {},
    (option) => rows.push(option.value),
  )

  try {
    app.mockInput.pressKey("d", { ctrl: true })

    expect(rows).toEqual(["alpha"])
  } finally {
    app.renderer.destroy()
  }
})
