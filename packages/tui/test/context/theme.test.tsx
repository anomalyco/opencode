/** @jsxImportSource @opentui/solid */
import { createTestRenderer } from "@opentui/core/testing"
import { render, testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { resolveThemeDocument } from "@opencode/theme/tui"
import { ConfigProvider, useConfig, type Info } from "../../src/config"
import { TuiAppProvider } from "../../src/context/runtime"
import { StorageProvider } from "../../src/context/storage"
import { ThemeProvider, useTheme, useThemes } from "../../src/context/theme"
import { getOpenCode2Theme, getOpenCodeTheme } from "../../src/theme"
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

test("terminal light mode wins over a cached dark system palette", async () => {
  await using temporary = await tmpdir()
  await mkdir(path.join(temporary.path, "test", "tui"), { recursive: true })
  await writeFile(
    path.join(temporary.path, "test", "tui", "system-theme.json"),
    JSON.stringify({
      colors: { palette: ["#000000"], defaultForeground: "#dddddd", defaultBackground: "#101010" },
    }),
  )
  const setup = await createTestRenderer({ width: 80, height: 24 })
  await setup.mockInput.pressKeys(["\x1b]11;rgb:ffff/ffff/ffff\x07"])
  let themes!: ReturnType<typeof useThemes>
  function Probe() {
    themes = useThemes()
    return null
  }

  try {
    expect(setup.renderer.themeMode).toBe("light")
    await render(
      () => (
        <TestTuiContexts paths={{ state: temporary.path }}>
          <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
            <StorageProvider>
              <ConfigProvider config={createTuiResolvedConfig({ theme: { name: "github", mode: "system" } })}>
                <ThemeProvider mode="light" source={emptyThemeSource}>
                  <Probe />
                </ThemeProvider>
              </ConfigProvider>
            </StorageProvider>
          </TuiAppProvider>
        </TestTuiContexts>
      ),
      setup.renderer,
    )
    await setup.renderOnce()
    expect(themes.mode()).toBe("light")
  } finally {
    setup.renderer.destroy()
  }
})
