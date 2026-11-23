/** @jsxImportSource @opentui/solid */
import { CliRenderEvents, RGBA, type TerminalColors } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { resolveThemeDocument } from "@opencode/theme/tui"
import { ConfigProvider, useConfig, type Info } from "../../src/config"
import { ThemeProvider, useTheme, useThemes } from "../../src/context/theme"
import { getOpenCodeTheme, getOpenCodeClassicTheme } from "../../src/theme"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

// OpenTUI emits palette again when an OSC reply arrives after its query ended at DA1.
test("the system theme follows a palette reply that arrives after the query", async () => {
  await using temporary = await tmpdir()
  const settings: Info = { theme: { name: "system" } }
  let theme!: ReturnType<typeof useTheme>
  let themes!: ReturnType<typeof useThemes>
  function Probe() {
    theme = useTheme()
    themes = useThemes()
    return null
  }
  const app = await testRender(() => (
    <TestTuiContexts paths={{ state: temporary.path }}>
      <ConfigProvider
        config={createTuiResolvedConfig(settings)}
        service={{ get: async () => settings, update: async () => settings }}
      >
        <ThemeProvider mode="dark" source={emptyThemeSource}>
          <Probe />
        </ThemeProvider>
      </ConfigProvider>
    </TestTuiContexts>
  ))
  const colors = (fg: string): TerminalColors => ({
    palette: [],
    defaultForeground: fg,
    defaultBackground: "#000000",
    cursorColor: null,
    mouseForeground: null,
    mouseBackground: null,
    tekForeground: null,
    tekBackground: null,
    highlightBackground: null,
    highlightForeground: null,
  })
  try {
    app.renderer.getPalette = async () => colors("#aaaaaa")
    app.renderer.start()
    await app.waitFor(() => themes !== undefined)
    themes.afterPaint()
    await app.waitFor(() => theme.text.base.equals(RGBA.fromHex("#aaaaaa")))
    app.renderer.emit(CliRenderEvents.PALETTE, colors("#123456"))
    expect(theme.text.base.equals(RGBA.fromHex("#123456"))).toBeTrue()
  } finally {
    app.renderer.destroy()
  }
})

test("names the new theme opencode and the previous one opencode-classic", async () => {
  await using temporary = await tmpdir()
  const settings: Info = { theme: { name: "opencode" } }
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
    const newTheme = resolveThemeDocument(getOpenCodeTheme(), "dark").background.base
    const classic = resolveThemeDocument(getOpenCodeClassicTheme(), "dark").background.base
    expect(theme.background.base.equals(newTheme)).toBeTrue()
    expect(themes.set("opencode-classic")).toBeTrue()
    expect(theme.background.base.equals(classic)).toBeTrue()
    expect(themes.set("opencode2")).toBeTrue()
    expect(theme.background.base.equals(newTheme)).toBeTrue()

    // The names do not depend on the new designs experiment.
    await config.update((draft) => {
      draft.experimental = { "new-designs": false }
    })
    expect(theme.background.base.equals(newTheme)).toBeTrue()
    expect(themes.has("opencode-classic")).toBeTrue()
  } finally {
    app.renderer.destroy()
  }
})
