/** @jsxImportSource @opentui/solid */
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { PromptMetadataRow } from "../../src/component/prompt/metadata"
import { ConfigProvider } from "../../src/config"
import { ThemeProvider } from "../../src/context/theme"
import { emptyThemeSource } from "../fixture/fixture"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const props = {
  mode: "normal" as const,
  agent: "Build",
  auto: false,
  model: "Qwen 3.8 Flash Next (EXL3 4.05 bpw, 256K)",
  provider: "My Local Provider",
  variant: "medium",
  muted: false,
  highlight: RGBA.fromInts(250, 178, 131, 255),
  agentAlpha: 1,
  modelAlpha: 1,
  variantAlpha: 1,
}

async function row(terminalWidth: number, promptWidth: number) {
  const app = await testRender(
    () => (
      <ConfigProvider config={createTuiResolvedConfig()}>
        <ThemeProvider mode="dark" source={emptyThemeSource}>
          <box width={promptWidth} flexDirection="column">
            <PromptMetadataRow {...props} />
          </box>
        </ThemeProvider>
      </ConfigProvider>
    ),
    { width: terminalWidth, height: 8 },
  )
  await app.renderOnce()
  await app.renderOnce()
  const line = app.captureCharFrame().split("\n")[0]
  app.renderer.destroy()
  return line
}

// The home screen caps the prompt at 75 columns inside a wider terminal.
for (const [terminalWidth, promptWidth] of [
  [120, 75],
  [120, 60],
  [46, 41],
]) {
  test(`lays out against the ${promptWidth}-column prompt, not the terminal`, async () => {
    const line = await row(terminalWidth, promptWidth)

    expect(line).toContain("Build")
    expect(line).toContain("medium")
    expect(line).not.toContain("Buil ")
    expect(line.trimEnd().length).toBeLessThanOrEqual(promptWidth)
  })
}
