/** @jsxImportSource @opentui/solid */
import { RGBA, type TerminalColors } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { render } from "@opentui/solid"
import { expect, spyOn, test } from "bun:test"
import { Logo } from "../../../src/component/logo"
import { ConfigProvider } from "../../../src/config"
import { ThemeProvider, useThemes } from "../../../src/context/theme"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

const palette: TerminalColors = {
  palette: Array.from({ length: 16 }, () => "#000000"),
  defaultForeground: "#eeeeee",
  defaultBackground: null,
  cursorColor: null,
  mouseForeground: null,
  mouseBackground: null,
  tekForeground: null,
  tekBackground: null,
  highlightBackground: null,
  highlightForeground: null,
}

async function setup(background: string, surface: string | undefined, colors = palette) {
  const app = await createTestRenderer({ width: 80, height: 24 })
  const query = spyOn(app.renderer, "getPalette").mockResolvedValue(colors)
  let themes: ReturnType<typeof useThemes> | undefined
  function Content() {
    themes = useThemes()
    return (
      <box backgroundColor={surface} width="100%" height="100%">
        <Logo />
      </box>
    )
  }
  await render(
    () => (
      <ConfigProvider config={createTuiResolvedConfig({ theme: { name: "logo", mode: "dark" } })}>
        <ThemeProvider
          mode="dark"
          source={{
            discover: async () => ({
              logo: {
                version: 2,
                dark: { background: { default: background }, text: { default: "#eeeeee", subdued: "#eeeeee" } },
              },
            }),
          }}
        >
          <Content />
        </ThemeProvider>
      </ConfigProvider>
    ),
    app.renderer,
  )
  await app.waitFor(() => themes?.ready === true)
  await app.renderOnce()
  return {
    ...app,
    async palette(colors: TerminalColors) {
      query.mockResolvedValue(colors)
      await app.mockInput.pressKeys(["\x1b[?997;1n"])
      await app.waitFor(() => themes?.terminalBackgroundKnown() === !!colors.defaultBackground)
      await app.renderOnce()
    },
    cell(x: number, y: number) {
      return app.captureSpans().lines[y].spans.flatMap((span) => Array.from(span.text, (char) => ({ ...span, char })))[
        x
      ]
    },
    close() {
      query.mockRestore()
      app.renderer.destroy()
    },
  }
}

test.each(["#fdf6e3", "#18181b", "#292237"])("composites logo shadows over the actual %s surface", async (surface) => {
  // A different opaque theme background catches preblending against the wrong surface.
  const app = await setup("#000000", surface)
  try {
    const bg = RGBA.fromHex(surface).toInts()
    const expected = bg.slice(0, 3).map((channel) => Math.round(channel * 0.75 + 238 * 0.25))
    const full = app.cell(1, 2).bg.toInts()
    const mixed = app.cell(11, 2)
    const top = app.cell(16, 3).fg.toInts()
    for (const actual of [full, mixed.bg.toInts(), top]) {
      expected.forEach((channel, index) => expect(Math.abs(actual[index] - channel)).toBeLessThanOrEqual(1))
    }
    expect(mixed.char).toBe("▀")
    expect(mixed.fg.toInts()).toEqual([238, 238, 238, 255])
  } finally {
    app.close()
  }
})

test("leaves only letter faces when a transparent theme has no terminal background evidence", async () => {
  const app = await setup("transparent", "#fdf6e3")
  try {
    expect(app.cell(1, 2).bg.toInts()).toEqual(RGBA.fromHex("#fdf6e3").toInts())
    expect(app.cell(11, 2).char).toBe("▀")
    expect(app.cell(11, 2).bg.toInts()).toEqual(RGBA.fromHex("#fdf6e3").toInts())
    expect(app.cell(16, 3).char).toBe(" ")
  } finally {
    app.close()
  }
})

test("keeps shadows for a transparent theme with a detected terminal background", async () => {
  const app = await setup("transparent", "#fdf6e3", { ...palette, defaultBackground: "#fdf6e3" })
  try {
    expect(app.cell(1, 2).bg.toInts()).not.toEqual(RGBA.fromHex("#fdf6e3").toInts())
    expect(app.cell(16, 3).char).toBe("▀")
  } finally {
    app.close()
  }
})

test.each(["#fdf6e3", "#18181b", "#292237"])(
  "uses detected %s as the transparent compositor backdrop",
  async (background) => {
    const app = await setup("transparent", undefined, { ...palette, defaultBackground: background })
    try {
      const base = RGBA.fromHex(background).toInts()
      const expected = base.slice(0, 3).map((channel) => Math.round(channel * 0.75 + 238 * 0.25))
      for (const actual of [app.cell(1, 2).bg.toInts(), app.cell(11, 2).bg.toInts(), app.cell(16, 3).fg.toInts()]) {
        expected.forEach((channel, index) => expect(Math.abs(actual[index] - channel)).toBeLessThanOrEqual(1))
      }
      expect(app.cell(0, 0).bg.a).toBe(0)
    } finally {
      app.close()
    }
  },
)

test("updates every shadow cell when terminal background detection changes", async () => {
  const app = await setup("transparent", "#fdf6e3")
  try {
    const background = app.cell(1, 2).bg.toInts()
    await app.palette({ ...palette, defaultBackground: "#fdf6e3" })
    expect(app.cell(1, 2).bg.toInts()).not.toEqual(background)
    expect(app.cell(11, 2).bg.toInts()).not.toEqual(background)
    expect(app.cell(16, 3).char).toBe("▀")
    await app.palette(palette)
    expect(app.cell(1, 2).bg.toInts()).toEqual(background)
    expect(app.cell(11, 2).bg.toInts()).toEqual(background)
    expect(app.cell(16, 3).char).toBe(" ")
  } finally {
    app.close()
  }
})

test.each([
  [80, 24, 4],
  [30, 24, 7],
  [20, 24, 3],
  [80, 11, 0],
])("preserves logo layout at %ix%i", async (width, height, rows) => {
  const app = await setup("#18181b", "#18181b")
  try {
    app.resize(width, height)
    await app.renderOnce()
    expect(
      app
        .captureCharFrame()
        .split("\n")
        .filter((line) => line.trim()).length,
    ).toBe(rows)
  } finally {
    app.close()
  }
})
