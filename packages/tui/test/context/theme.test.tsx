/** @jsxImportSource @opentui/solid */
import { testRender, render } from "@opentui/solid"
import { createTestRenderer } from "@opentui/core/testing"
import { expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { resolveThemeDocument } from "@opencode/theme/tui"
import { ConfigProvider, useConfig, type Info } from "../../src/config"
import { ThemeProvider, useTheme, useThemes } from "../../src/context/theme"
import { TuiAppProvider } from "../../src/context/runtime"
import { StorageProvider } from "../../src/context/storage"
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

const staleDarkPalette = {
  palette: [
    "#15191e",
    "#a74532",
    "#57bf38",
    "#c7c43f",
    "#2e43c0",
    "#b149b8",
    "#59c2c6",
    "#c7c7c7",
    "#686868",
    "#d07e78",
    "#82e498",
    "#eae24a",
    "#a7abed",
    "#d483dc",
    "#8efafd",
    "#ffffff",
  ],
  defaultForeground: "#dcdcdc",
  defaultBackground: "#15191e",
}

async function mountWithStaleCache(input: { reply?: string[]; mode: "dark" | "light" }) {
  const temporary = await tmpdir()
  const directory = path.join(temporary.path, "test", "tui")
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, "system-theme.json"), JSON.stringify({ colors: staleDarkPalette }))

  const setup = await createTestRenderer({ width: 80, height: 24 })
  if (input.reply) await setup.mockInput.pressKeys(input.reply)

  let themes: ReturnType<typeof useThemes> | undefined
  function Probe() {
    themes = useThemes()
    return <box />
  }
  await render(
    () => (
      <TestTuiContexts paths={{ state: temporary.path }}>
        <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
          <StorageProvider>
            <ConfigProvider config={createTuiResolvedConfig({ theme: { name: "opencode", mode: "system" } })}>
              <ThemeProvider mode={input.mode} source={emptyThemeSource}>
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
  if (!themes) throw new Error("ThemeProvider did not mount")
  return {
    renderer: setup.renderer,
    themes,
    async [Symbol.asyncDispose]() {
      setup.renderer.destroy()
      await temporary[Symbol.asyncDispose]()
    },
  }
}

test("detected terminal mode wins over a stale cached palette", async () => {
  await using app = await mountWithStaleCache({
    mode: "light",
    reply: ["\x1b]10;rgb:0000/0000/0000\x07", "\x1b]11;rgb:ffff/ffff/ffff\x07"],
  })
  expect(app.renderer.themeMode).toBe("light")
  expect(app.themes.mode()).toBe("light")
})

test("cached palette still decides mode before the terminal answers", async () => {
  await using app = await mountWithStaleCache({ mode: "light" })
  expect(app.renderer.themeMode).toBeNull()
  expect(app.themes.mode()).toBe("dark")
})
