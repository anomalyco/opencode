/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { render } from "@opentui/solid"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { ConfigProvider } from "../../src/config"
import { TuiAppProvider } from "../../src/context/runtime"
import { StorageProvider } from "../../src/context/storage"
import { ThemeProvider, useThemes } from "../../src/context/theme"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const darkPalette = {
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

async function mount(input: { reply?: string[]; mode: "dark" | "light" }) {
  const temporary = await tmpdir()
  const directory = path.join(temporary.path, "test", "tui")
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, "system-theme.json"), JSON.stringify({ colors: darkPalette }))

  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
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
  await using app = await mount({
    mode: "light",
    reply: ["\x1b]10;rgb:0000/0000/0000\x07", "\x1b]11;rgb:ffff/ffff/ffff\x07"],
  })
  expect(app.renderer.themeMode).toBe("light")
  expect(app.themes.mode()).toBe("light")
})

test("cached palette still decides mode before the terminal answers", async () => {
  await using app = await mount({ mode: "light" })
  expect(app.renderer.themeMode).toBeNull()
  expect(app.themes.mode()).toBe("dark")
})
