/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { Schema } from "effect"
import { resolve, ConfigProvider, Info, useConfig, type Interface } from "../src/config"
import { settings } from "../src/component/dialog-config"
import { TuiKeybind } from "../src/config/keybind"
import { CommandMap, Definitions } from "../src/config/v1/keybind"

const decodeInfo = Schema.decodeUnknownSync(Info)

test("validates mini replay settings", () => {
  expect(decodeInfo({ mini: { replay: false, replay_limit: 50 } })).toEqual({
    mini: { replay: false, replay_limit: 50 },
  })
  expect(() => decodeInfo({ mini: { replay_limit: 0 } })).toThrow()
  expect(() => decodeInfo({ mini: { replay_limit: 1.5 } })).toThrow()
})

test("validates the session tabs setting", () => {
  const decode = Schema.decodeUnknownSync(Info)

  expect(decode({ tabs: { enabled: true, layout: "vertical" } })).toEqual({
    tabs: { enabled: true, layout: "vertical" },
  })
  expect(() => decode({ tabs: { layout: true } })).toThrow()
  expect(() => decode({ tabs: { enabled: "on" } })).toThrow()
  expect(decode({ prompt: { image_preview: true } })).toEqual({ prompt: { image_preview: true } })
  expect(decode({ session: { image_preview: true } })).toEqual({ session: { image_preview: true } })
  expect(decode({ session: { new_location: "inherit" } })).toEqual({ session: { new_location: "inherit" } })
  expect(() => decode({ session: { new_location: "current" } })).toThrow()
})

test("resolves nested config and keybind defaults", () => {
  const config = resolve(
    {
      keybinds: { leader: "ctrl+o" },
      leader: { timeout: 500 },
      scroll: { speed: 2, acceleration: true },
      diffs: { view: "split" },
      debug: { devtools: true },
    },
    { terminalSuspend: true },
  )

  expect(config.leader.timeout).toBe(500)
  expect(config.keybinds.get("leader")?.[0]?.key).toBe("ctrl+o")
  expect(config.scroll).toEqual({ speed: 2, acceleration: true })
  expect(config.diffs).toEqual({ view: "split" })
  expect(config.debug).toEqual({ devtools: true })
  expect(config.tabs).toEqual({ enabled: true, scope: "cwd", layout: "horizontal" })
  expect(config.session.new_location).toBe("launch")
})

test("shows resolved tab defaults in settings", () => {
  expect(settings.find((setting) => setting.path.join(".") === "tabs.enabled")?.default).toBe(true)
  expect(settings.find((setting) => setting.path.join(".") === "tabs.scope")?.default).toBe("cwd")
  expect(settings.find((setting) => setting.path.join(".") === "tabs.layout")?.default).toBe("horizontal")
})

test("shows the new session location default in settings", () => {
  expect(settings.find((setting) => setting.path.join(".") === "session.new_location")?.default).toBe("launch")
})

test("validates terminal copy behavior", () => {
  expect(decodeInfo({ terminal: { copy: "manual" } })).toEqual({ terminal: { copy: "manual" } })
  expect(decodeInfo({ terminal: { copy: "select" } })).toEqual({ terminal: { copy: "select" } })
  expect(() => decodeInfo({ terminal: { copy: "always" } })).toThrow()

  const setting = settings.find((setting) => setting.path.join(".") === "terminal.copy")
  expect(setting?.values).toEqual(["manual", "select"])
  expect(setting?.default).toBe(process.platform === "win32" ? "manual" : "select")
})

test("uses command IDs as keybind keys", () => {
  const config = resolve({ keybinds: { "session.list": "ctrl+l" } }, { terminalSuspend: true })

  expect(config.keybinds.get("session.list")).toMatchObject([{ key: "ctrl+l" }])
  expect(TuiKeybind.unknownKeys({ session_list: "ctrl+l" })).toEqual(["session_list"])
  expect(
    Object.keys(TuiKeybind.Definitions)
      .filter((key) => key !== "leader")
      .every((key) => key.includes(".")),
  ).toBe(true)
})

test("preserves current navigation defaults", () => {
  const config = resolve({}, { terminalSuspend: true })

  expect(config.keybinds.get("open.menu")).toMatchObject([{ key: "ctrl+o" }])
  expect(config.keybinds.get("session.tab.next")).toMatchObject([{ key: "ctrl+tab,alt+down" }])
  expect(config.keybinds.get("session.tab.previous")).toMatchObject([{ key: "ctrl+shift+tab,alt+up" }])
  expect(config.keybinds.get("session.tab.next_unread")).toMatchObject([{ key: "alt+shift+down" }])
  expect(config.keybinds.get("session.tab.previous_unread")).toMatchObject([{ key: "alt+shift+up" }])
  expect(config.keybinds.get("session.tab.reopen")).toMatchObject([{ key: "ctrl+shift+t" }])
  expect(config.keybinds.get("session.tab.select.10")).toMatchObject([{ key: "<leader>0,ctrl+0" }])
  expect(config.keybinds.get("session.message.next")).toEqual([])
  expect(config.keybinds.get("session.message.previous")).toEqual([])
  expect(config.keybinds.get("session.message.user.next")).toEqual([])
  expect(config.keybinds.get("session.message.user.previous")).toEqual([])
  expect(config.keybinds.get("input.buffer.home")).toEqual([])
  expect(config.keybinds.get("input.buffer.end")).toEqual([])
  expect(config.keybinds.get("prompt.images.view")).toMatchObject([{ key: "<leader>i" }])
})

test("preserves migrated v1 keybind defaults", () => {
  const pairs = [
    ["app.exit", "app_exit"],
    ["prompt.paste", "input_paste"],
    ["prompt.queue", "prompt_queue"],
    ["session.delete", "session_delete"],
    ["session.list", "session_list"],
    ["agent.list", "agent_list"],
  ] as const

  pairs.forEach(([command, name]) => {
    expect(CommandMap[name]).toBe(command)
    expect(TuiKeybind.Definitions[command].default).toEqual(Definitions[name].default)
  })
})

test("accepts every v2-only named command ID", () => {
  const commands = [
    "server.pair",
    "session.toggle.exploration_grouping",
    "composer.subagent.up",
    "composer.subagent.down",
    "composer.subagent.select",
    "composer.subagent.interrupt",
    "composer.shell.up",
    "composer.shell.down",
    "composer.shell.kill",
    "diff.down",
    "diff.up",
    "diff.page.down",
    "diff.page.up",
    "diff.mark_reviewed",
    "opencode.settings",
    "service.restart",
    "permission.mode",
    "session.cd",
    "app.scrap",
  ]
  const config = resolve(
    decodeInfo({ keybinds: Object.fromEntries(commands.map((command) => [command, "ctrl+alt+z"])) }),
    { terminalSuspend: true },
  )

  commands.forEach((command) => expect(config.keybinds.get(command)).toMatchObject([{ key: "ctrl+alt+z" }]))
})

test("centralizes named command defaults and resolves explicit none", () => {
  const defaults = {
    "composer.subagent.up": "up",
    "composer.subagent.down": "down",
    "composer.subagent.select": "return",
    "composer.subagent.interrupt": "ctrl+d",
    "composer.shell.up": "up",
    "composer.shell.down": "down",
    "composer.shell.kill": "ctrl+d",
    "diff.down": "j,down",
    "diff.up": "k,up",
    "diff.page.down": "pagedown,ctrl+f",
    "diff.page.up": "pageup,ctrl+b",
    "diff.mark_reviewed": "m",
  }
  const config = resolve({}, { terminalSuspend: true })
  Object.entries(defaults).forEach(([command, key]) => expect(config.keybinds.get(command)).toMatchObject([{ key }]))

  const disabled = resolve(
    decodeInfo({ keybinds: Object.fromEntries(Object.keys(defaults).map((command) => [command, "none"])) }),
    { terminalSuspend: true },
  )
  Object.keys(defaults).forEach((command) => expect(disabled.keybinds.get(command)).toEqual([]))
})

test("rejects orphaned keybind definitions", () => {
  expect(decodeInfo({ keybinds: { "app.heap_snapshot": "ctrl+h" } })).toEqual({ keybinds: {} })
})

test("uses ctrl+z for input undo when terminal suspend is unavailable", () => {
  const config = resolve({}, { terminalSuspend: false })
  expect(config.keybinds.has("terminal.suspend")).toBe(false)
  expect(config.keybinds.get("input.undo")).toMatchObject([{ key: "ctrl+z,ctrl+-,super+z" }])

  const overridden = resolve(
    { keybinds: { "terminal.suspend": "ctrl+s", "input.undo": "ctrl+u" } },
    { terminalSuspend: false },
  )
  expect(overridden.keybinds.has("terminal.suspend")).toBe(false)
  expect(overridden.keybinds.get("input.undo")).toMatchObject([{ key: "ctrl+u" }])
})

test("keeps turn token usage inside developer tools", () => {
  expect(settings.find((setting) => setting.path.join(".") === "debug.devtools")?.title).toBe("Developer tools")
  expect(settings.some((setting) => setting.path.join(".") === "debug.turn_tokens")).toBe(false)
})

test("provides config and its host interface", async () => {
  const config = resolve({}, { terminalSuspend: true })
  let current = {}
  const service: Interface = {
    get: async () => current,
    update: async (update) => {
      const draft: Record<string, any> = { ...current }
      update(draft)
      current = draft
      return draft
    },
  }
  let context: ReturnType<typeof useConfig> | undefined

  function Consumer() {
    context = useConfig()
    return <text>{`${context.data.mouse ? "mouse" : "none"} ${context.data.keybinds.get("leader")?.[0]?.key}`}</text>
  }

  const app = await testRender(() => (
    <ConfigProvider config={config} service={service}>
      <Consumer />
    </ConfigProvider>
  ))
  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("mouse ctrl+x")
    if (!context) throw new Error("Config context was not provided")
    await context.update((draft) => {
      draft.mouse = false
      draft.keybinds = { leader: "ctrl+o" }
    })
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("none ctrl+o")
  } finally {
    app.renderer.destroy()
  }
})
