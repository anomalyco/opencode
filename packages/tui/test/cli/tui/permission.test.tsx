/** @jsxImportSource @opentui/solid */
import { BoxRenderable, type Renderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { ConfigProvider } from "../../../src/config"
import { Keymap } from "../../../src/context/keymap"
import { ThemeProvider } from "../../../src/context/theme"
import { SessionQuestion } from "../../../src/routes/session/permission"
import { emptyThemeSource } from "../../fixture/fixture"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

test.each([
  { config: undefined, height: 15 },
  { config: { max_height: 30 }, height: 30 },
])("limits the question panel to max_height=$height", async ({ config, height }) => {
  const app = await mountQuestion(config)
  try {
    expect(dialog(app.renderer.root)?.height).toBe(height)
    expect(app.captureCharFrame()).toContain("fullscreen")
  } finally {
    app.renderer.destroy()
  }
})

test("opens fullscreen by default and toggles back to the configured height", async () => {
  const app = await mountQuestion({ max_height: 20, default_expanded: true })
  try {
    expect(dialog(app.renderer.root)?.height).toBeGreaterThan(30)
    expect(app.captureCharFrame()).toContain("minimize")

    app.mockInput.pressKey("f", { ctrl: true })
    await app.waitForFrame((frame) => !frame.includes("minimize"))
    expect(dialog(app.renderer.root)?.height).toBe(20)
    expect(app.captureCharFrame()).toContain("fullscreen")

    app.mockInput.pressKey("f", { ctrl: true })
    await app.waitForFrame((frame) => frame.includes("minimize"))
    expect(dialog(app.renderer.root)?.height).toBeGreaterThan(30)
  } finally {
    app.renderer.destroy()
  }
})

test("questions without fullscreen stay collapsed", async () => {
  const app = await mountQuestion({ default_expanded: true }, { fullscreen: false })
  try {
    expect(dialog(app.renderer.root)?.height).toBe(15)
    expect(app.captureCharFrame()).not.toContain("fullscreen")
    expect(app.captureCharFrame()).not.toContain("minimize")
  } finally {
    app.renderer.destroy()
  }
})

async function mountQuestion(
  permissionPrompt?: { max_height?: number; default_expanded?: boolean },
  options?: { fullscreen?: boolean },
) {
  const app = await testRender(
    () => (
      <ConfigProvider config={createTuiResolvedConfig({ session: { permission_prompt: permissionPrompt } })}>
        <Keymap.Provider>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <box height="100%" justifyContent="flex-end">
              <box flexShrink={0}>
                <SessionQuestion
                  title="Permission required"
                  instance="per_1"
                  body={
                    <box paddingLeft={1}>
                      {Array.from({ length: 60 }, (_, index) => (
                        <text>/external/file-{index}</text>
                      ))}
                    </box>
                  }
                  options={options?.fullscreen === false ? { move: "Choose directory" } : { once: "Allow once" }}
                  escapeKey={options?.fullscreen === false ? undefined : "once"}
                  fullscreen={options?.fullscreen !== false}
                  onSelect={() => {}}
                />
              </box>
            </box>
          </ThemeProvider>
        </Keymap.Provider>
      </ConfigProvider>
    ),
    { width: 100, height: 40, kittyKeyboard: true },
  )
  app.renderer.start()
  await app.waitForFrame((frame) => frame.includes("Permission required"))
  return app
}

function dialog(root: Renderable): BoxRenderable | undefined {
  if (root instanceof BoxRenderable && Array.isArray(root.border) && root.border.includes("left")) return root
  return root
    .getChildren()
    .map(dialog)
    .find(Boolean)
}
