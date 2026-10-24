import { describe, expect, mock, test } from "bun:test"
import type { TuiPluginApi, TuiPluginMeta, TuiSlotPlugin } from "@opencode-ai/plugin/tui"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import HomeTips from "../../src/feature-plugins/home/tips"
import HomeFooter from "../../src/feature-plugins/home/footer"
import { homeMaxWidth, rows } from "../../src/component/prompt/size"
import { HomeStack } from "../../src/routes/home/stack"
import type { Info } from "../../src/config"
import { tmpdir } from "../fixture/fixture"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "../fixture/tui-sdk"

const sessionID = "ses_layout"
const session = {
  id: sessionID,
  title: "Layout",
  slug: sessionID,
  projectID: "proj_test",
  directory,
  version: "0.0.0-test",
  time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
}
const model = { providerID: "test", modelID: "model" }

type Options = {
  width: number
  height: number
  config?: Info
  lines?: number
  screen?: "home" | "session"
  kv?: Record<string, unknown>
}

// Runs the TUI on the home screen, or in a session whose turn is running, types `lines` lines and
// reads where the logo, the prompt and the footer ended up.
async function render(options: Options) {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, JSON.stringify(options.kv ?? {}))
  const setup = await createTestRenderer({ width: options.width, height: options.height, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const calls = createFetch((url) => {
    if (url.pathname === "/session") return json([session])
    if (url.pathname === "/session/status") return json({ [sessionID]: { type: "busy" } })
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${sessionID}/message`) return url.searchParams.has("limit") ? json([]) : json({})
    if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`) return json([])
    if (url.pathname === "/agent")
      return json([{ name: "build", mode: "primary", permission: [], options: {}, hidden: false }])
    if (url.pathname === "/config/providers")
      return json({
        providers: [
          {
            id: model.providerID,
            name: "Test",
            source: "config",
            env: [],
            options: {},
            models: { [model.modelID]: { id: model.modelID, name: "Model", providerID: model.providerID } },
          },
        ],
        default: { [model.providerID]: model.modelID },
      })
  })
  const started = Promise.withResolvers<TuiPluginApi>()
  const { run } = await import("../../src/app")
  const frame = async () => {
    await setup.renderOnce()
    await setup.renderOnce()
    return setup.captureCharFrame()
  }
  try {
    const task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {}, ...options.config }),
        fetch: calls.fetch,
        events: createEventSource().source,
        args: options.screen === "session" ? { continue: true } : {},
        pluginHost: {
          async start(input) {
            const host = input.runtime.setupSlots(input.api)
            for (const plugin of [HomeTips, HomeFooter]) {
              function register(slots: TuiSlotPlugin) {
                host.register({ ...slots, id: plugin.id })
                return plugin.id
              }
              await plugin.tui({ ...input.api, slots: { register } }, undefined, meta(plugin.id))
            }
            started.resolve(input.api)
          },
          async dispose() {},
        },
      }).pipe(
        Effect.provide(
          Global.layerWith({
            home: tmp.path,
            data: tmp.path,
            cache: tmp.path,
            config: tmp.path,
            state: tmp.path,
            tmp: tmp.path,
            bin: tmp.path,
            log: tmp.path,
            repos: tmp.path,
          }),
        ),
      ),
    )
    const api = await started.promise
    // The prompt is ready once it shows the model it will send to.
    for (let tries = 0; !(await frame()).includes("Model Test"); tries++) {
      if (tries > 1000) throw new Error("the prompt never became ready")
      await Bun.sleep(10)
    }
    // The prompt keeps its text across the tests in this file; ctrl+c clears it.
    if (options.screen !== "session" && !(await frame()).includes("Ask anything")) {
      setup.renderer.stdin.emit("data", Buffer.from("\x03"))
      await Bun.sleep(30)
    }
    if (options.lines) setup.renderer.stdin.emit("data", Buffer.from("x\n".repeat(options.lines)))
    // The layout follows measured sizes, so it takes a few frames to settle.
    let last = ""
    for (let tries = 0; tries < 50; tries++) {
      await Bun.sleep(10)
      const next = await frame()
      if (next === last) break
      last = next
    }
    api.keymap.dispatchCommand("app.exit")
    await task
    return measure(last)
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
}

function meta(id: string): TuiPluginMeta {
  return {
    id,
    source: "internal",
    spec: id,
    target: id,
    first_time: 0,
    last_time: 0,
    time_changed: 0,
    load_count: 1,
    fingerprint: "test",
    state: "same",
  }
}

function measure(frame: string) {
  const rows = frame.split("\n")
  const logo = rows.findIndex((row) => row.includes("█▀▀█ █▀▀█ █▀▀█"))
  const bars = rows.flatMap((row, index) => (row.trimStart().startsWith("┃") ? [index] : []))
  return {
    rows,
    logo: logo === -1 ? undefined : logo - 1,
    prompt: bars[0],
    // The bar runs down the padding, the text, the padding and the agent/model row.
    textRows: bars.length - 3,
    // The frame's bottom edge spans the prompt's width.
    width: (() => {
      const edge = rows.find((row) => row.includes("╹▀")) ?? ""
      return edge.trimEnd().length - edge.indexOf("╹")
    })(),
    status: rows.findIndex((row) => row.includes("ctrl+p commands")),
    tip: rows.findIndex((row) => row.includes("● Tip")),
    interrupt: rows.findIndex((row) => row.includes("esc interrupt")),
    footer: rows.findIndex((row) => row.includes(":main")),
  }
}

describe("home screen", () => {
  test("a short prompt keeps the default layout", async () => {
    const screen = await render({ width: 100, height: 40 })
    expect(screen.textRows).toBe(1)
    expect(screen.prompt - screen.logo!).toBe(4 + 1 + 1)
  }, 30_000)

  test("a prompt taller than the screen stays above the footer, one row below the top of the logo", async () => {
    const screen = await render({ width: 100, height: 30, lines: 40, config: { prompt: { max_height: 999 } } })
    expect(screen.logo).toBe(1)
    expect(screen.status).toBe(screen.footer - 2)
    // 27 rows above the footer, less the logo and the row above it, the padding and 5 rows around the text.
    expect(screen.textRows).toBe(16)
  }, 30_000)

  test("a small terminal keeps the prompt on screen at its default height", async () => {
    const screen = await render({ width: 60, height: 16, lines: 20 })
    expect(screen.logo).toBeGreaterThanOrEqual(1)
    expect(screen.status).toBe(screen.footer - 2)
  }, 30_000)

  test("on a terminal too short for the logo and a row to type in, the logo gives way", async () => {
    const screen = await render({ width: 60, height: 12, lines: 3 })
    expect(screen.logo).toBeUndefined()
    expect(screen.status).toBeLessThan(screen.footer)
  }, 30_000)
})

describe("session screen", () => {
  test("a prompt taller than the screen stays on it", async () => {
    const screen = await render({
      width: 100,
      height: 24,
      lines: 40,
      config: { prompt: { max_height: 999 } },
      screen: "session",
    })
    expect(screen.prompt).toBe(1)
    expect(screen.interrupt).toBe(24 - 2)
  }, 30_000)
})

describe("home screen settings", () => {
  test("top and bottom positions pin the logo and prompt, and the prompt grows away from the edge", async () => {
    const config = (position: "top" | "bottom"): Info => ({ home: { prompt_position: position, tips: false } })
    const top = await render({ width: 100, height: 30, config: config("top") })
    expect(top.logo).toBe(1)
    expect(top.prompt).toBe(1 + 4 + 1 + 1)
    const topTall = await render({ width: 100, height: 30, lines: 5, config: config("top") })
    expect(topTall.prompt).toBe(top.prompt)
    expect(topTall.status).toBe(top.status + 5)
  }, 60_000)

  test("the bottom position keeps the prompt on the footer and the logo above it", async () => {
    const config: Info = { home: { prompt_position: "bottom", tips: false } }
    const bottom = await render({ width: 100, height: 30, config })
    expect(bottom.status).toBe(bottom.footer - 2)
    expect(bottom.prompt - bottom.logo!).toBe(4 + 1 + 1)
    const tall = await render({ width: 100, height: 30, lines: 3, config })
    expect(tall.status).toBe(bottom.status)
    expect(tall.prompt).toBe(bottom.prompt - 3)
    expect(tall.prompt - tall.logo!).toBe(4 + 1 + 1)
  }, 60_000)

  test("the logo and the tip can be hidden, and home.tips wins over the remembered tips toggle", async () => {
    const hidden = await render({ width: 100, height: 30, config: { home: { logo: false, tips: false } } })
    expect(hidden.logo).toBeUndefined()
    expect(hidden.tip).toBe(-1)
    const toggled = await render({
      width: 100,
      height: 30,
      config: { home: { tips: false } },
      kv: { tips_hidden: false },
    })
    expect(toggled.tip).toBe(-1)
    const remembered = await render({ width: 100, height: 30, kv: { tips_hidden: true } })
    expect(remembered.tip).toBe(-1)
  }, 60_000)

  test("at the bottom the prompt sits on the footer, the tip above the logo", async () => {
    const config: Info = { home: { prompt_position: "bottom" }, prompt: { min_height: 8, max_height: 999 } }
    const screen = await render({ width: 160, height: 45, config })
    expect(screen.status).toBe(screen.footer - 2)
    expect(screen.textRows).toBe(8)
    expect(screen.tip).toBeGreaterThan(-1)
    expect(screen.tip).toBeLessThan(screen.logo!)
  }, 60_000)

  test("home.prompt_min_height and home.prompt_max_height size the home prompt alone", async () => {
    const config: Info = {
      home: { prompt_position: "bottom", tips: false, logo: false, prompt_min_height: "35%", prompt_max_height: "80%" },
      prompt: { max_height: 999 },
    }
    // 42 rows above the footer, less the padding and 5 rows around the text, leave 36.
    const start = await render({ width: 160, height: 45, config })
    expect(start.textRows).toBe(12)
    expect(start.status).toBe(start.footer - 2)
    // Before typing: the prompt keeps its text across the renders in this file.
    const session = await render({ width: 160, height: 45, config, screen: "session" })
    expect(session.textRows).toBe(1)
    const tall = await render({ width: 160, height: 45, lines: 60, config })
    expect(tall.textRows).toBe(28)
  }, 60_000)

  test("min_height starts the prompt taller, and percentages size it from the room it has", async () => {
    // 27 rows above the footer: the logo and the row above it, the padding and 5 rows around the text leave 16.
    const percent = await render({
      width: 100,
      height: 30,
      lines: 40,
      config: { prompt: { min_height: "25%", max_height: "50%", max_width: "50%" } },
    })
    expect(percent.textRows).toBe(8)
    expect(percent.width).toBe(48)
  }, 30_000)
})

describe("sizes", () => {
  test("the text area starts at min_height and grows to max_height, never past the space", () => {
    expect(rows({ terminalHeight: 30 })).toEqual({ min: 1, max: 10 })
    expect(rows({ terminalHeight: 12 })).toEqual({ min: 1, max: 6 })
    expect(rows({ max: 999, terminalHeight: 30 })).toEqual({ min: 1, max: 999 })
    expect(rows({ max: 999, terminalHeight: 30, space: 16 })).toEqual({ min: 1, max: 16 })
    expect(rows({ min: 5, max: "50%", terminalHeight: 30, space: 20 })).toEqual({ min: 5, max: 10 })
    expect(rows({ min: "25%", max: "80%", terminalHeight: 30, space: 20 })).toEqual({ min: 5, max: 16 })
    expect(rows({ min: 30, terminalHeight: 30, space: 20 })).toEqual({ min: 10, max: 10 })
    expect(rows({ terminalHeight: 8, space: -3 })).toEqual({ min: 1, max: 1 })
  })

  test("the home prompt's width takes columns, 'auto' or a percentage of the home column", () => {
    expect(homeMaxWidth(undefined, 200, 196)).toBe(75)
    expect(homeMaxWidth(90, 200, 196)).toBe(90)
    expect(homeMaxWidth("auto", 200, 196)).toBe(140)
    expect(homeMaxWidth("50%", 200, 196)).toBe(98)
  })

  test("the gaps and the tips shrink in proportion, the gap above the logo to one row", () => {
    const stack = (prompt: number, position: HomeStack.Position = "middle") =>
      HomeStack.stack({ height: 27, logo: 4, prompt, bottom: 4, position })
    expect(stack(7)).toMatchObject({ gapAbove: 4, gapBelow: 1, bottom: 4 })
    expect(stack(7, "top")).toMatchObject({ gapAbove: 1, gapBelow: 1, bottom: 4 })
    expect(stack(16)).toMatchObject({ gapAbove: 3, gapBelow: 0, bottom: 3 })
    expect(stack(22)).toMatchObject({ gapAbove: 1, gapBelow: 0, bottom: 0 })
    expect(HomeStack.promptSpace({ height: 27, logo: 4, notice: 0 })).toBe(21)
    expect(HomeStack.logoFits({ height: 9, logo: 4, notice: 0 })).toBe(false)
  })
})
