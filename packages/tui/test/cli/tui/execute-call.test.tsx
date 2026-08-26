import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { ConfigProvider } from "../../../src/config"
import { ThemeProvider, useTheme } from "../../../src/context/theme"
import { ExecuteCallView, InlineToolRow } from "../../../src/routes/session"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

test.each(["dark", "light", "custom"] as const)("execute expansion, hover, and failure in %s theme", async (mode) => {
  const [status, setStatus] = createSignal<"running" | "completed" | "error">("running")
  const colors: { theme?: ReturnType<typeof useTheme> } = {}
  function Fixture() {
    colors.theme = useTheme()
    return (
      <box>
        <InlineToolRow icon="✓" complete pending="">
          execute
        </InlineToolRow>
        <ExecuteCallView
          index={0}
          call={() => ({ tool: "demo.lookup", status: status(), input: { query: "rendering" } })}
        />
      </box>
    )
  }

  const app = await testRender(
    () => (
      <ConfigProvider
        config={createTuiResolvedConfig({
          theme: { name: mode === "custom" ? "execute-custom" : "opencode", mode: mode === "light" ? "light" : "dark" },
        })}
      >
        <ThemeProvider
          mode={mode === "light" ? "light" : "dark"}
          source={{
            discover: async () => ({
              "execute-custom": {
                version: 2,
                dark: { text: { default: "#eeeeee", subdued: "#777777" } },
              },
            }),
          }}
        >
          <Fixture />
        </ThemeProvider>
      </ConfigProvider>
    ),
    { width: 60, height: 8 },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("demo.lookup"))
    const theme = colors.theme!
    const foreground = (row: number, text: string) =>
      app.renderer.currentRenderBuffer.getSpanLines()[row]!.spans.find((span) => span.text.includes(text))!.fg

    expect(app.captureCharFrame()).toContain("   › demo.lookup [query=rendering]")
    expect(foreground(1, "demo.lookup").equals(theme.text.subdued)).toBeTrue()
    setStatus("completed")
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("   › demo.lookup [query=rendering]")

    await app.mockMouse.click(8, 1)
    await app.waitForFrame((frame) => frame.includes("query: rendering"))
    await app.mockMouse.moveTo(59, 7)
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("   │ query: rendering")
    expect(foreground(1, "demo.lookup").equals(theme.raise(theme.text.subdued))).toBeTrue()
    expect(foreground(2, "│").equals(theme.raise(theme.text.subdued))).toBeTrue()

    await app.mockMouse.moveTo(8, 1)
    await app.renderOnce()
    expect(foreground(1, "demo.lookup").equals(theme.text.default)).toBeTrue()
    expect(foreground(2, "│").equals(theme.raise(theme.text.subdued))).toBeTrue()

    setStatus("error")
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("   ✗ demo.lookup")
    expect(foreground(1, "demo.lookup").equals(theme.text.feedback.error.default)).toBeTrue()
  } finally {
    app.renderer.destroy()
  }
})
