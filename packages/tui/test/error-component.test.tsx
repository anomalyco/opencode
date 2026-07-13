/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { testRender } from "@opentui/solid"
import { ErrorComponent } from "../src/component/error-component"
import { ClipboardProvider } from "../src/context/clipboard"
import { ExitProvider } from "../src/context/exit"

test("names OpenCode consistently in the crash screen and generated report", async () => {
  const copied: string[] = []
  const app = await testRender(
    () => (
      <ExitProvider exit={() => {}}>
        <ClipboardProvider value={{ write: async (text) => void copied.push(text) }}>
          <ErrorComponent error={new Error("boom")} reset={() => {}} />
        </ClipboardProvider>
      </ExitProvider>
    ),
    { width: 100, height: 24 },
  )
  app.renderer.start()

  try {
    await app.waitForFrame((frame) => frame.includes("OpenCode crashed"))
    expect(app.captureCharFrame()).toContain(`OpenCode ${InstallationVersion}`)

    app.mockInput.pressKey("c")
    await app.waitFor(() => copied.length === 1)

    const report = new URL(copied[0])
    expect(report.searchParams.get("reproduce")).toStartWith("Reported automatically from the OpenCode crash screen.")
    expect(report.searchParams.get("description")).toStartWith("The OpenCode TUI crashed with an unexpected error.")
  } finally {
    app.renderer.destroy()
  }
})
