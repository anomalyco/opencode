/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { RGBA, TerminalColors } from "@opentui/core"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../../fixture/fixture"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { generateSystem, setSystemTheme } from "../../../src/theme"

function terminalColors(defaultBackground: string, palette: Array<string | null> = []): TerminalColors {
  return {
    palette,
    defaultForeground: "#c0caf5",
    defaultBackground,
    cursorColor: null,
    mouseForeground: null,
    mouseBackground: null,
    tekForeground: null,
    tekBackground: null,
    highlightBackground: null,
    highlightForeground: null,
  }
}

// ANSI palette with magenta in slot 5, which the system theme maps to `secondary`
const palette = [
  "#1a1b26",
  "#f7768e",
  "#9ece6a",
  "#e0af68",
  "#7aa2f7",
  "#bb9af7",
  "#7dcfff",
  "#c0caf5",
]

async function mountChip(root: string) {
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")

  const [{ KVProvider }, { ThemeProvider, useTheme }, { TuiConfigProvider }, { FileChip }] = await Promise.all([
    import("../../../src/context/kv"),
    import("../../../src/context/theme"),
    import("../../../src/config"),
    import("../../../src/routes/session"),
  ])

  let themeCtx: ReturnType<typeof useTheme> | undefined

  function Harness() {
    const resolvedConfig = createTuiResolvedConfig({})
    const Probe = () => {
      themeCtx = useTheme()
      return null
    }
    return (
      <TestTuiContexts
        directory={root}
        paths={{
          home: root,
          state,
          worktree: root,
        }}
      >
        <TuiConfigProvider config={resolvedConfig}>
          <KVProvider>
            <ThemeProvider mode="dark" source={{ discover: async () => ({}) }}>
              <Probe />
              <FileChip
                file={
                  {
                    type: "file",
                    mime: "text/plain",
                    filename: "/tmp/todo.md",
                    url: "file:///tmp/todo.md",
                  } as never
                }
              />
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { width: 60, height: 5 })
  const start = Date.now()
  while (themeCtx?.ready !== true) {
    if (Date.now() - start > 5000) throw new Error("timed out waiting for theme provider")
    await Bun.sleep(10)
  }
  return { app, theme: () => themeCtx }
}

function badgeSpan(app: Awaited<ReturnType<typeof testRender>>) {
  return app
    .captureSpans()
    .lines.flatMap((line) => line.spans)
    .find((span) => span.text.includes("File"))
}

// A badge is only readable if its text, composited over its own background,
// stays distinguishable from that background.
function visibility(span: { fg: RGBA; bg: RGBA }) {
  const { fg, bg } = span
  const r = fg.r * fg.a + bg.r * (1 - fg.a)
  const g = fg.g * fg.a + bg.g * (1 - fg.a)
  const b = fg.b * fg.a + bg.b * (1 - fg.a)
  return Math.abs(r - bg.r) + Math.abs(g - bg.g) + Math.abs(b - bg.b)
}

let cleanup: (() => void) | undefined

afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

test("file chip badge text is visible with the default theme", async () => {
  await using tmp = await tmpdir()
  const { app, theme } = await mountChip(tmp.path)
  cleanup = () => app.renderer.destroy()

  await app.renderOnce()
  await app.renderOnce()

  const span = badgeSpan(app)
  expect(span).toBeDefined()
  expect(visibility(span!)).toBeGreaterThan(0.1)
  expect(theme()!.selected).toBe("opencode")
})

test("file chip badge text stays visible with the generated system theme", async () => {
  await using tmp = await tmpdir()
  const { app, theme } = await mountChip(tmp.path)
  cleanup = () => {
    theme()?.set("opencode")
    setSystemTheme(undefined)
    app.renderer.destroy()
  }

  // The generated system theme intentionally uses a fully transparent
  // `background` (alpha 0) so terminal transparency shows through.
  setSystemTheme(generateSystem(terminalColors("#1a1b26", palette), "dark"))
  expect(theme()!.set("system")).toBe(true)

  await app.renderOnce()
  await app.renderOnce()

  const span = badgeSpan(app)
  expect(span).toBeDefined()
  // Regression: the badge used `fg: theme.background`, which is transparent in
  // the generated system theme, so the label blended into its own background.
  expect(visibility(span!)).toBeGreaterThan(0.1)
})
