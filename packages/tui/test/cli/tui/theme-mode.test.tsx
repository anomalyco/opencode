/** @jsxImportSource @opentui/solid */
import { render, testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { CliRenderEvents, RGBA, type TerminalColors } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { createSignal } from "solid-js"
import { DEFAULT_THEME, selectTheme } from "@opencode/theme/tui"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { DEFAULT_THEMES } from "../../../src/theme"
import { ConfigProvider } from "../../../src/config"
import {
  ThemeContextProvider,
  ThemeProvider,
  type ThemeError,
  type ThemeSource,
  useTheme,
  useThemes,
} from "../../../src/context/theme"

async function wait(fn: () => boolean) {
  const started = Date.now()
  while (!fn()) {
    if (Date.now() - started > 2000) throw new Error("timed out waiting for theme mode")
    await Bun.sleep(10)
  }
}

test("uses an available mode while retaining the pinned preference", async () => {
  const lightOnly = structuredClone(DEFAULT_THEMES.opencode)
  lightOnly.theme.background = "#eeeeee"
  lightOnly.theme.text = "#111111"
  const dual = structuredClone(DEFAULT_THEMES.opencode)
  dual.theme.background = { light: "#eeeeee", dark: "#111111" }
  dual.theme.text = { light: "#111111", dark: "#eeeeee" }
  const darkOnly = structuredClone(DEFAULT_THEMES.opencode)
  darkOnly.theme.background = "#111111"
  darkOnly.theme.text = "#eeeeee"
  const native = { version: 2, dark: { text: { default: "#abcdef" } } } as const
  let themes: ReturnType<typeof useThemes> | undefined

  function Probe() {
    const value = useThemes()
    themes = value
    return <text>{value.mode()}</text>
  }

  function current() {
    if (!themes) throw new Error("Theme provider is not mounted")
    return themes
  }

  const app = await testRender(
    () => (
      <ConfigProvider config={createTuiResolvedConfig({ theme: { name: "light-only", mode: "dark" } })}>
        <ThemeProvider
          mode="dark"
          source={{ discover: () => Promise.resolve({ "light-only": lightOnly, "dark-only": darkOnly, dual, native }) }}
        >
          <Probe />
        </ThemeProvider>
      </ConfigProvider>
    ),
    { width: 20, height: 2 },
  )
  app.renderer.start()

  try {
    await wait(() => themes?.ready === true)
    expect(current().mode()).toBe("light")
    expect(current().modes()).toEqual(["light"])
    expect(current().supports("dark")).toBeFalse()
    expect(current().setMode("dark")).toBeFalse()
    expect(current().set("dark-only")).toBeTrue()
    await wait(() => current().mode() === "dark")
    expect(current().modes()).toEqual(["dark"])
    expect(current().set("light-only")).toBeTrue()
    await wait(() => current().mode() === "light")
    expect(current().set("dual")).toBeTrue()
    await wait(() => current().mode() === "dark")
    expect(current().modes()).toEqual(["light", "dark"])
    expect(current().set("native")).toBeTrue()
    await wait(() => current().selected === "native")
    expect(current().modes()).toEqual(["dark"])
    expect(current().current.text.default.equals(RGBA.fromHex("#abcdef"))).toBeTrue()
  } finally {
    app.renderer.destroy()
  }
})

test.each([
  ["schema", { version: 2, light: { categorical: [] } }],
  ["mode merging", { version: 2, light: { mergeMode: true } }],
  ["token reference", { version: 2, light: { text: { default: "$missing" } } }],
] as const)("falls back to OpenCode when configured V2 theme %s is invalid", async (_label, source) => {
  let themes: ReturnType<typeof useThemes> | undefined
  let failure: ThemeError | undefined
  let unsubscribe: (() => void) | undefined
  const discovery = Promise.withResolvers<Record<string, unknown>>()

  function Probe() {
    const value = useThemes()
    themes = value
    unsubscribe = value.onError((error) => (failure = error))
    return <text>{value.selected}</text>
  }

  const app = await testRender(
    () => (
      <ConfigProvider config={createTuiResolvedConfig({ theme: { name: "invalid" } })}>
        <ThemeProvider mode="dark" source={{ discover: () => discovery.promise }}>
          <Probe />
        </ThemeProvider>
      </ConfigProvider>
    ),
    { width: 20, height: 2 },
  )
  app.renderer.start()
  discovery.resolve({ invalid: source })

  try {
    await wait(() => themes?.ready === true)
    expect(themes?.selected).toBe("opencode")
    expect(failure?.name).toBe("invalid")
    expect(failure?.error).toBeInstanceOf(Error)
    expect(failure?.error.message.length).toBeGreaterThan(0)
  } finally {
    unsubscribe?.()
    app.renderer.destroy()
  }
})

test("mounts built-in theme contents while custom theme discovery continues", async () => {
  const discovery = Promise.withResolvers<Record<string, unknown>>()
  const discovered = Promise.withResolvers<void>()
  let mounts = 0
  let themes: ReturnType<typeof useThemes> | undefined

  function Probe() {
    mounts++
    themes = useThemes()
    return <text>ready</text>
  }

  const app = await testRender(
    () => (
      <ConfigProvider config={createTuiResolvedConfig({})}>
        <ThemeProvider
          mode="dark"
          source={{
            discover: async () => {
              const value = await discovery.promise
              discovered.resolve()
              return value
            },
          }}
        >
          <Probe />
        </ThemeProvider>
      </ConfigProvider>
    ),
    { width: 20, height: 2 },
  )
  app.renderer.start()

  try {
    expect(mounts).toBe(1)
    expect(themes?.ready).toBeTrue()
    expect(themes?.selected).toBe("opencode")
    discovery.resolve({})
    await discovered.promise
    await app.renderOnce()
    expect(mounts).toBe(1)
    expect(themes?.selected).toBe("opencode")
  } finally {
    discovery.resolve({})
    app.renderer.destroy()
  }
})

test("contextual hooks resolve overrides and fall back to a standalone theme's base view", async () => {
  const standalone = {
    version: 2,
    standalone: true,
    dark: {
      hue: selectTheme(DEFAULT_THEME, "dark").hue,
      "@context:elevated": { text: { default: "#abcdef" } },
    },
  } as const
  let themes: ReturnType<typeof useThemes> | undefined
  let theme: ReturnType<typeof useTheme> | undefined
  let explicit: ReturnType<typeof useTheme> | undefined

  function ContextProbe() {
    theme = useTheme()
    explicit = useTheme("elevated")
    return <text>{theme.text.default.toString()}</text>
  }

  function Probe() {
    themes = useThemes()
    return (
      <ThemeContextProvider context="elevated">
        <ContextProbe />
      </ThemeContextProvider>
    )
  }

  const app = await testRender(
    () => (
      <ConfigProvider config={createTuiResolvedConfig({ theme: { name: "standalone", mode: "dark" } })}>
        <ThemeProvider mode="dark" source={{ discover: () => Promise.resolve({ standalone }) }}>
          <Probe />
        </ThemeProvider>
      </ConfigProvider>
    ),
    { width: 20, height: 2 },
  )
  app.renderer.start()

  try {
    await wait(() => themes?.ready === true)
    if (!themes) throw new Error("Theme provider is not mounted")
    if (!theme) throw new Error("Contextual theme is not mounted")
    if (!explicit) throw new Error("Explicit contextual theme is not mounted")
    expect(theme.text.default.equals(RGBA.fromHex("#abcdef"))).toBeTrue()
    expect(theme.text.default).toBe(explicit.text.default)
    expect(theme.text.default).toBe(themes.current.contextual.elevated.text.default)
    expect(themes.current.contextual.overlay.background.default).toBe(themes.current.background.default)
  } finally {
    app.renderer.destroy()
  }
})

test.each(["dark", "light"] as const)(
  "reactive %s theme contexts change without remounting their contents",
  async (mode) => {
    const [context, setContext] = createSignal<"elevated" | undefined>("elevated")
    const [parent, setParent] = createSignal<"overlay" | undefined>()
    let theme: ReturnType<typeof useTheme> | undefined
    let themes: ReturnType<typeof useThemes> | undefined
    let mounts = 0
    function Probe() {
      mounts++
      theme = useTheme()
      themes = useThemes()
      return <text fg={theme.text.default}>probe</text>
    }
    const app = await testRender(() => (
      <ConfigProvider config={createTuiResolvedConfig({ theme: { name: "opencode", mode } })}>
        <ThemeProvider mode={mode} source={{ discover: async () => ({}) }}>
          <ThemeContextProvider context={parent()}>
            <ThemeContextProvider context={context()}>
              <Probe />
            </ThemeContextProvider>
          </ThemeContextProvider>
        </ThemeProvider>
      </ConfigProvider>
    ))
    app.renderer.start()
    try {
      await wait(() => themes?.ready === true)
      if (!theme || !themes) throw new Error("Theme provider is not mounted")
      const view = theme
      expect(view.background.default).toBe(themes.current.contextual.elevated.background.default)
      setContext(undefined)
      await app.flush()
      expect(view.background.default).toBe(themes.current.background.default)
      setParent("overlay")
      await app.flush()
      expect(view.background.default).toBe(themes.current.contextual.overlay.background.default)
      setContext("elevated")
      await app.flush()
      expect(view.text.default).toBe(themes.current.contextual.elevated.text.default)
      expect(theme).toBe(view)
      expect(mounts).toBe(1)
    } finally {
      app.renderer.destroy()
    }
  },
)

test("does not request terminal colors before a named theme is usable", async () => {
  await using app = await renderPaletteTheme({ name: "opencode" })

  expect(app.paletteCalls()).toBe(0)
  expect(app.themes.selected).toBe("opencode")
  app.themes.prepareSystem()
  await wait(() => app.paletteCalls() === 1)
})

test("resolves the system theme from the terminal palette", async () => {
  await using app = await renderPaletteTheme({ name: "system", colors: terminalColors("#101010") })

  expect(app.paletteCalls()).toBe(1)
  expect(app.themes.selected).toBe("system")
  expect(app.themes.mode()).toBe("dark")
})

test("refreshes the system palette after a terminal theme notification", async () => {
  await using app = await renderPaletteTheme({ name: "system", colors: terminalColors("#101010") })

  app.notify("\x1b[?997;2n")
  await wait(() => app.paletteCalls() === 2)
  expect(app.themes.mode()).toBe("dark")
})

test.each([
  ["dark", "#fefefe"],
  ["light", "#010101"],
] as const)("keeps an explicit %s mode when the terminal reports the opposite mode", async (mode, background) => {
  await using app = await renderPaletteTheme({ name: "system", mode, colors: terminalColors(background) })

  expect(app.themes.mode()).toBe(mode)
})

test("removes theme handlers and pending refreshes on cleanup", async () => {
  let refresh = () => {}
  let unsubscribed = false
  const app = await renderPaletteTheme({
    name: "opencode",
    source: {
      discover: async () => ({}),
      subscribeRefresh(next) {
        refresh = next
        return () => {
          unsubscribed = true
        }
      },
    },
  })

  expect(app.renderer.listenerCount(CliRenderEvents.THEME_MODE)).toBe(1)
  refresh()
  app.renderer.destroy()
  await Bun.sleep(1100)
  expect(app.paletteCalls()).toBe(0)
  expect(app.renderer.listenerCount(CliRenderEvents.THEME_MODE)).toBe(0)
  expect(app.removedNotificationHandler()).toBeTrue()
  expect(unsubscribed).toBeTrue()
})

function terminalColors(background: string): TerminalColors {
  return {
    palette: [
      "#000000",
      "#cc0000",
      "#00cc00",
      "#cccc00",
      "#0000cc",
      "#cc00cc",
      "#00cccc",
      "#cccccc",
      "#555555",
      "#ff0000",
      "#00ff00",
      "#ffff00",
      "#0000ff",
      "#ff00ff",
      "#00ffff",
      "#ffffff",
    ],
    defaultForeground: "#eeeeee",
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

async function renderPaletteTheme(input: {
  name: "opencode" | "system"
  mode?: "dark" | "light"
  colors?: TerminalColors
  source?: ThemeSource
}) {
  const setup = await createTestRenderer({ width: 20, height: 2 })
  const colors = input.colors ?? terminalColors("#101010")
  let paletteCalls = 0
  let notificationHandler: ((sequence: string) => boolean) | undefined
  let removedNotificationHandler = false
  const prependInputHandler = setup.renderer.prependInputHandler.bind(setup.renderer)
  const removeInputHandler = setup.renderer.removeInputHandler.bind(setup.renderer)
  setup.renderer.getPalette = async () => {
    paletteCalls++
    return colors
  }
  setup.renderer.prependInputHandler = (handler) => {
    notificationHandler = handler
    prependInputHandler(handler)
  }
  setup.renderer.removeInputHandler = (handler) => {
    if (handler === notificationHandler) removedNotificationHandler = true
    removeInputHandler(handler)
  }
  let themes: ReturnType<typeof useThemes> | undefined

  function Probe() {
    themes = useThemes()
    return <text>{themes.selected}</text>
  }

  await render(
    () => (
      <ConfigProvider config={createTuiResolvedConfig({ theme: { name: input.name, mode: input.mode } })}>
        <ThemeProvider mode="dark" source={input.source ?? { discover: async () => ({}) }}>
          <Probe />
        </ThemeProvider>
      </ConfigProvider>
    ),
    setup.renderer,
  )
  setup.renderer.start()
  await wait(() => themes?.ready === true)
  if (!themes) throw new Error("Theme provider is not mounted")

  return {
    renderer: setup.renderer,
    themes,
    paletteCalls: () => paletteCalls,
    notify(sequence: string) {
      if (!notificationHandler) throw new Error("Theme notification handler is not registered")
      notificationHandler(sequence)
    },
    removedNotificationHandler: () => removedNotificationHandler,
    async [Symbol.asyncDispose]() {
      setup.renderer.destroy()
    },
  }
}
