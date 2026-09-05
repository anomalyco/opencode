/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onCleanup } from "solid-js"
import { tmpdir } from "../../fixture/fixture"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TestTuiContexts } from "../../fixture/tui-environment"

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

async function mountPreview(input: { root: string; file: string }) {
  const state = path.join(input.root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")

  const [
    { KVProvider },
    { ThemeProvider },
    { TuiConfigProvider },
    { DialogProvider },
    { ToastProvider },
    { OpencodeKeymapProvider, registerOpencodeKeymap },
    { PreviewPanel },
  ] = await Promise.all([
    import("../../../src/context/kv"),
    import("../../../src/context/theme"),
    import("../../../src/config"),
    import("../../../src/ui/dialog"),
    import("../../../src/ui/toast"),
    import("../../../src/keymap"),
    import("../../../src/routes/session/preview"),
  ])

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const resolvedConfig = createTuiResolvedConfig({
      keybinds: {},
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
                    <box width={80} height={30} flexDirection="row">
                      <PreviewPanel file={() => input.file} directory={() => input.root} width={() => 60} />
                    </box>
                  </DialogProvider>
                </ToastProvider>
              </ThemeProvider>
            </KVProvider>
          </TuiConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { width: 80, height: 30 })
  return {
    app,
    async cleanup() {
      app.renderer.destroy()
    },
  }
}

test("markdown preview renders file content", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "README.md")
  await Bun.write(file, "# Preview Title\n\nfirst **bold** line\n")
  const preview = await mountPreview({ root: tmp.path, file })

  const settledFrame = async () => {
    // theme config loads async at startup and triggers a re-render; let it settle
    await wait(() => preview.app.captureCharFrame().includes("README.md"))
    await Bun.sleep(300)
    return preview.app.captureCharFrame()
  }

  try {
    const frame = await settledFrame()
    expect(frame).toContain("Preview Title")
    expect(frame).toContain("bold")
    expect(frame).toContain("README.md")
  } finally {
    await preview.cleanup()
  }
})

test("markdown preview shows error for unreadable file", async () => {
  await using tmp = await tmpdir()
  const preview = await mountPreview({
    root: tmp.path,
    file: path.join(tmp.path, "missing.md"),
  })

  try {
    await wait(() => preview.app.captureCharFrame().includes("Unable to read file"))
    expect(preview.app.captureCharFrame()).toContain("Unable to read file")
  } finally {
    await preview.cleanup()
  }
})
