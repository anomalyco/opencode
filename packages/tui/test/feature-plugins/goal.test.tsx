/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
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

const objective = [
  ...Array.from({ length: 40 }, (_, i) => `Step ${i + 1}: refactor module ${i + 1} and keep tests green.`),
  "ENDMARKER",
].join(" ")

test.each([
  { width: 100, height: 30 },
  { width: 44, height: 24 },
])(
  "scrolls long goal content while keeping header and actions visible ($width x $height)",
  async ({ width, height }) => {
    await using temporary = await tmpdir()
    const commands: { sessionID: string; name: string; text: string }[] = []
    const [goal] = createSignal({
      id: "goal_1",
      objective,
      status: "active" as const,
      reason: "Waiting on test run",
      rounds: 1,
      maxRounds: 10,
      boot: "boot",
      updatedAt: 0,
    })

    function Open() {
      const dialog = useDialog()
      onMount(() =>
        dialog.replace(() => (
          <GoalDialog
            context={{
              ui: {
                dialog: { clear: () => dialog.clear() },
                toast: { show: () => {} },
              },
              client: {
                session: {
                  command: async (input) => {
                    commands.push({ sessionID: input.sessionID, name: input.name, text: input.text ?? "" })
                  },
                },
              },
            }}
            sessionID="ses_1"
            goal={goal}
          />
        )),
      )
      return null
    }

    const app = await testRender(
      () => (
        <TestTuiContexts directory={temporary.path} paths={{ state: temporary.path, home: temporary.path }}>
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
      { width, height, kittyKeyboard: true },
    )

    try {
      await app.renderOnce()
      const top = app.captureCharFrame()
      expect(top).toContain("Goal")
      expect(top).toContain("Step 1:")
      expect(top).toContain("pause p")
      expect(top).toContain("clear x")
      expect(top).not.toContain("ENDMARKER")
      expect(top).not.toContain("◎ Active")

      app.mockInput.pressArrow("down")
      await app.renderOnce()
      expect(app.captureCharFrame()).not.toContain("Step 1:")

      app.mockInput.pressKey("END")
      await app.renderOnce()
      const bottom = app.captureCharFrame()
      expect(bottom).toContain("Goal")
      expect(bottom).toContain("ENDMARKER")
      expect(bottom).toContain("◎ Active")
      expect(bottom).toContain("Waiting on test run")
      expect(bottom).toContain("pause p")
      expect(bottom).toContain("clear x")
      expect(bottom).not.toContain("Step 1:")

      app.mockInput.pressKey("HOME")
      await app.renderOnce()
      const back = app.captureCharFrame()
      expect(back).toContain("Step 1:")
      expect(back).not.toContain("ENDMARKER")

      app.mockInput.pressKey("p")
      await app.renderOnce()
      expect(commands).toEqual([{ sessionID: "ses_1", name: "goal", text: "pause" }])

      app.mockInput.pressEscape()
      await app.renderOnce()
      expect(app.captureCharFrame()).not.toContain("Goal")
    } finally {
      app.renderer.destroy()
    }
  },
)
