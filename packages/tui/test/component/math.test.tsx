/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { setRendererCapabilities } from "@opentui/core/testing"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { MathBlock } from "../../src/component/math"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { KVProvider } from "../../src/context/kv"
import { tmpdir } from "../fixture/fixture"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"

const TEX = "\\frac{a^2}{2}"
const RAW = `$$${TEX}$$`

async function wait(fn: () => boolean, timeout = 5000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

async function mount(root: string) {
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")

  return testRender(
    () => (
      <TestTuiContexts
        directory={root}
        paths={{
          home: root,
          state,
          worktree: root,
        }}
      >
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <KVProvider>
            <ThemeProvider mode="dark">
              <box flexDirection="column">
                <MathBlock tex={TEX} width={36} fallback={<text>{RAW}</text>} />
              </box>
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width: 40, height: 10 },
  )
}

function hasImage(el: { constructor: { name: string }; getChildren?: () => unknown[] }): boolean {
  return (
    el.constructor.name === "ImageRenderable" ||
    (el.getChildren?.() ?? []).some((c) => hasImage(c as typeof el))
  )
}

test("math block falls back to raw source without image support", async () => {
  await using tmp = await tmpdir()
  const app = await mount(tmp.path)
  await wait(() => app.captureCharFrame().includes(RAW))
  app.renderer.destroy()
})

test("math block renders an image when kitty graphics is supported", async () => {
  await using tmp = await tmpdir()
  const app = await mount(tmp.path)
  await wait(() => app.captureCharFrame().includes(RAW))
  setRendererCapabilities(app.renderer, { kitty_graphics: true })
  app.renderer.emit("capabilities", app.renderer.capabilities)
  await wait(() => hasImage(app.renderer.root))
  await app.flush()
  app.renderer.destroy()
})
