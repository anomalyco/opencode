/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import type { ModelInfo } from "@opencode/client"
import { ConfigProvider } from "../../../src/config"
import { ModelDetail } from "../../../src/component/model-options"
import { ThemeProvider } from "../../../src/context/theme"
import { emptyThemeSource, tmpdir } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

async function renderModelDetailLines(input: readonly string[]) {
  await using tmp = await tmpdir()
  const model = {
    id: "model",
    modelID: "model",
    providerID: "provider",
    name: "Model",
    capabilities: { tools: true, input: [...input], output: ["text"] },
    variants: [{ id: "reasoning" }],
    time: { released: 0 },
    cost: [],
    status: "active",
    enabled: true,
    limit: { context: 1_000_000, output: 1_000 },
  } satisfies ModelInfo

  function Harness() {
    return (
      <TestTuiContexts directory={tmp.path} paths={{ home: tmp.path, state: tmp.path, worktree: tmp.path }}>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <box width={44} height={4}>
              <ModelDetail model={model} price={false} />
            </box>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { width: 44, height: 4 })
  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("1M"))
    return app
      .captureCharFrame()
      .split("\n")
      .map((line) => line.trim())
  } finally {
    app.renderer.destroy()
  }
}

test("model detail wraps input modalities three per line", async () => {
  const lines = await renderModelDetailLines(["text", "image", "pdf", "audio", "video"])

  expect(lines).toContain("Text, Image, PDF")
  expect(lines).toContain("Audio, Video")
  expect(lines).toContain("1M · Reasoning")
})

test("model detail starts a third modality line after six entries", async () => {
  const lines = await renderModelDetailLines(["text", "image", "pdf", "audio", "video", "tool"])

  expect(lines).toContain("Text, Image, PDF")
  expect(lines).toContain("Audio, Video, Tool")
  expect(lines).toContain("1M · Reasoning")
})

test("model detail keeps three or fewer modalities on one line", async () => {
  const lines = await renderModelDetailLines(["text", "image", "pdf"])

  expect(lines).toContain("Text, Image, PDF · 1M · Reasoning")
})
