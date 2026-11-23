/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin/tui"
import { Goal } from "@opencode/schema/goal"
import { createSignal, onMount } from "solid-js"
import { ConfigProvider } from "../../src/config"
import { Keymap } from "../../src/context/keymap"
import { ThemeProvider } from "../../src/context/theme"
import { GoalDialog } from "../../src/feature-plugins/prompt/goal"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const objective =
  Array.from(
    { length: 40 },
    (_, index) => `Step ${index + 1}: refactor module ${index + 1} and keep tests green.`,
  ).join(" ") + " FINALMARKER"

const goal: Goal.State = {
  id: "goal",
  objective,
  status: "active",
  rounds: 1,
  maxRounds: 50,
  boot: "boot",
  updatedAt: 0,
}

// Only `run` reads the plugin context, and this dialog never triggers an action.
const context = { ui: { toast: { show() {} } } } as unknown as Plugin.Context

// GoalDialog centers itself and owns the scroll area; open it through a real dialog stack.
function Open() {
  const dialog = useDialog()
  const [current] = createSignal<Goal.State>(goal)
  onMount(() => dialog.replace(() => <GoalDialog context={context} sessionID="session" goal={current} />))
  return null
}

test("scrolls a long objective between the dialog header and its status and actions", async () => {
  await using temporary = await tmpdir()
  const app = await testRender(
    () => (
      <TestTuiContexts directory={temporary.path} paths={{ state: temporary.path }}>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <Keymap.Provider>
              <ToastProvider>
                <DialogProvider>
                  <Open />
                </DialogProvider>
              </ToastProvider>
            </Keymap.Provider>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 70, height: 20, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Goal") && frame.includes("Step 1:"))
    const top = app.captureCharFrame()
    expect(top).toContain("Step 1:")
    expect(top).toContain("◎ Active")
    expect(top).toContain("clear")
    expect(top).not.toContain("FINALMARKER")

    app.mockInput.pressKey("END")
    await app.waitForFrame((frame) => frame.includes("FINALMARKER"))
    const bottom = app.captureCharFrame()
    expect(bottom).toContain("FINALMARKER")
    expect(bottom).toContain("◎ Active")
    expect(bottom).toContain("clear")

    app.mockInput.pressKey("HOME")
    await app.waitForFrame((frame) => frame.includes("Step 1:"))
  } finally {
    app.renderer.destroy()
  }
})
