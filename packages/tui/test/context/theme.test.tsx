/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { CliRenderEvents, RGBA, type TerminalColors } from "@opentui/core"
import { resolveThemeDocument } from "@opencode/theme/tui"
import { ConfigProvider, useConfig, type Info } from "../../src/config"
import { ThemeProvider, useTheme, useThemes } from "../../src/context/theme"
import { getOpenCode2Theme, getOpenCodeTheme, setSystemTheme } from "../../src/theme"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

test("offers opencode2 only while the new designs experiment is enabled", async () => {
  await using temporary = await tmpdir()
  const settings: Info = {}
  let config!: ReturnType<typeof useConfig>
  let themes!: ReturnType<typeof useThemes>
  let theme!: ReturnType<typeof useTheme>
  function Probe() {
    config = useConfig()
    themes = useThemes()
    theme = useTheme()
    return null
  }
  const app = await testRender(() => (
    <TestTuiContexts paths={{ state: temporary.path }}>
      <ConfigProvider
        config={createTuiResolvedConfig(settings)}
        service={{
          get: async () => settings,
          update: async (update) => {
            update(settings)
            return settings
          },
        }}
      >
        <ThemeProvider mode="dark" source={emptyThemeSource}>
          <Probe />
        </ThemeProvider>
      </ConfigProvider>
    </TestTuiContexts>
  ))

  try {
    app.renderer.start()
    await app.waitForFrame(() => themes !== undefined)
    expect(themes.has("opencode2")).toBeFalse()
    expect(Object.keys(themes.all())).not.toContain("opencode2")
    expect(themes.set("opencode2")).toBeFalse()

    await config.update((draft) => {
      draft.experimental = { "new-designs": true }
    })
    expect(themes.has("opencode2")).toBeTrue()
    expect(themes.set("opencode2")).toBeTrue()
    expect(theme.background.base.equals(resolveThemeDocument(getOpenCode2Theme(), "dark").background.base)).toBeTrue()

    await config.update((draft) => {
      draft.experimental = { "new-designs": false }
    })
    expect(themes.has("opencode2")).toBeFalse()
    expect(theme.background.base.equals(resolveThemeDocument(getOpenCodeTheme(), "dark").background.base)).toBeTrue()
    expect(themes.selected).toBe("opencode2")
    expect(settings.theme?.name).toBe("opencode2")
  } finally {
    app.renderer.destroy()
  }
})

const palette = [
  "#000000",
  "#cc0000",
  "#4e9a06",
  "#c4a000",
  "#3465a4",
  "#75507b",
  "#06989a",
  "#d3d7cf",
  "#555753",
  "#ef2929",
  "#8ae234",
  "#fce94f",
  "#729fcf",
  "#ad7fa8",
  "#34e2e2",
  "#eeeeec",
]

function terminalColors(background: string, foreground: string): TerminalColors {
  return {
    palette,
    defaultForeground: foreground,
    defaultBackground: background,
    cursorColor: null,
    mouseForeground: null,
    mouseBackground: null,
    tekForeground: null,
    tekBackground: null,
    highlightBackground: null,
    highlightForeground: null,
  }
}

test("a focus probe follows the terminal palette without mode 2031", async () => {
  await using temporary = await tmpdir()
  const settings: Info = { theme: { name: "system" } }
  let themes!: ReturnType<typeof useThemes>
  let theme!: ReturnType<typeof useTheme>
  function Probe() {
    themes = useThemes()
    theme = useTheme()
    return null
  }
  const terminal = { colors: terminalColors("#1a1b26", "#c0caf5"), queries: 0 }
  const app = await testRender(() => (
    <TestTuiContexts paths={{ state: temporary.path }}>
      <ConfigProvider
        config={createTuiResolvedConfig(settings)}
        service={{
          get: async () => settings,
          update: async (update) => {
            update(settings)
            return settings
          },
        }}
      >
        <ThemeProvider mode="dark" source={emptyThemeSource}>
          <Probe />
        </ThemeProvider>
      </ConfigProvider>
    </TestTuiContexts>
  ))
  app.renderer.getPalette = async () => {
    terminal.queries++
    return terminal.colors
  }

  try {
    app.renderer.start()
    await app.waitForFrame(() => themes !== undefined)

    themes.afterPaint()
    await app.waitFor(() => terminal.queries > 0 && theme.background.base.a === 0)
    expect(themes.mode()).toBe("dark")
    expect(theme.background.base.toInts().slice(0, 3)).toEqual(RGBA.fromHex("#1a1b26").toInts().slice(0, 3))

    terminal.colors = terminalColors("#fbf1c7", "#3c3836")
    app.renderer.emit(CliRenderEvents.FOCUS)
    await app.waitFor(() => themes.mode() === "light")
    expect(theme.background.base.a).toBe(0)
    expect(theme.background.base.toInts().slice(0, 3)).toEqual(RGBA.fromHex("#fbf1c7").toInts().slice(0, 3))
  } finally {
    app.renderer.destroy()
    setSystemTheme(undefined)
  }
})

test("a mode event waits for colors captured in the new mode", async () => {
  await using temporary = await tmpdir()
  const settings: Info = { theme: { name: "system" } }
  let themes!: ReturnType<typeof useThemes>
  let theme!: ReturnType<typeof useTheme>
  function Probe() {
    themes = useThemes()
    theme = useTheme()
    return null
  }
  const terminal = { colors: terminalColors("#1a1b26", "#c0caf5") }
  const pending = Promise.withResolvers<TerminalColors>()
  let queries = 0
  const app = await testRender(() => (
    <TestTuiContexts paths={{ state: temporary.path }}>
      <ConfigProvider
        config={createTuiResolvedConfig(settings)}
        service={{
          get: async () => settings,
          update: async (update) => {
            update(settings)
            return settings
          },
        }}
      >
        <ThemeProvider mode="dark" source={emptyThemeSource}>
          <Probe />
        </ThemeProvider>
      </ConfigProvider>
    </TestTuiContexts>
  ))
  app.renderer.getPalette = () => (queries++ === 0 ? Promise.resolve(terminal.colors) : pending.promise)

  try {
    app.renderer.start()
    await app.waitForFrame(() => themes !== undefined)
    themes.afterPaint()
    await app.waitFor(() => theme.background.base.a === 0)

    terminal.colors = terminalColors("#fbf1c7", "#3c3836")
    app.renderer.emit(CliRenderEvents.THEME_MODE, "light")
    await app.waitFor(() => themes.mode() === "light")
    // The dark palette would paint stale surfaces over the light background, so the default theme stands in
    // until the probe returns colors for the new mode.
    expect(theme.background.base.a).toBe(1)

    pending.resolve(terminal.colors)
    await app.waitFor(() => theme.background.base.a === 0)
    expect(theme.background.base.toInts().slice(0, 3)).toEqual(RGBA.fromHex("#fbf1c7").toInts().slice(0, 3))
  } finally {
    pending.resolve(terminal.colors)
    app.renderer.destroy()
    setSystemTheme(undefined)
  }
})
