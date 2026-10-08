/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import {
  AttentionSoundName,
  footerConfigured,
  footerSelections,
  footerSelects,
  footerShows,
  Info,
  LeaderTimeoutDefault,
  PluginSpec,
  resolve,
  timestampTypes,
  TuiConfigProvider,
  type Info as TuiConfigInfo,
  useTuiConfig,
} from "../src/config"

const decodeInfo = Schema.decodeUnknownSync(Info)
const decodePlugin = Schema.decodeUnknownSync(PluginSpec)

test("defines package-owned plugin specs and attention sound names", () => {
  expect(decodePlugin("example-plugin")).toBe("example-plugin")
  expect(decodePlugin(["example-plugin", { enabled: true }])).toEqual(["example-plugin", { enabled: true }])
  expect(() => decodePlugin(["example-plugin"])).toThrow()
  expect(AttentionSoundName.literals).toEqual(["default", "question", "permission", "error", "done", "subagent_done"])
})

test("validates config constraints", () => {
  expect(
    decodeInfo({
      leader_timeout: 250,
      attention: { volume: 1, sounds: { done: "done.wav" } },
      prompt: { max_height: 10, max_width: "auto" },
      scroll_speed: 0.001,
      diff_style: "stacked",
      cursor: { blinking: false },
      plugin: ["example-plugin"],
    }),
  ).toMatchObject({
    leader_timeout: 250,
    attention: { volume: 1 },
    diff_style: "stacked",
    cursor: { blinking: false },
  })
  expect(() => decodeInfo({ leader_timeout: 0 })).toThrow()
  expect(() => decodeInfo({ attention: { volume: 1.1 } })).toThrow()
  expect(() => decodeInfo({ prompt: { max_width: 0 } })).toThrow()
  expect(() => decodeInfo({ scroll_speed: 0 })).toThrow()
  expect(() => decodeInfo({ cursor: { style: "beam" } })).toThrow()
  expect(decodeInfo({ model_label: "id" })).toEqual({ model_label: "id" })
  expect(() => decodeInfo({ model_label: "provider" })).toThrow()
  expect(decodeInfo({ footer_variant: true })).toEqual({ footer_variant: true })
  expect(() => decodeInfo({ footer_variant: "high" })).toThrow()
  expect(decodeInfo({ attention: { sounds: { unknown: "sound.wav" } } })).toEqual({ attention: { sounds: {} } })
})

test("decodes timestamps as all, none, a comma-separated list, or an array", () => {
  const types = (value: unknown) => {
    const set = timestampTypes(decodeInfo({ timestamps: value }).timestamps)
    return set && [...set]
  }

  expect(timestampTypes(decodeInfo({}).timestamps)).toBeUndefined()
  expect(types("all")).toEqual(["user", "assistant", "text", "reasoning", "tool", "error", "compaction"])
  expect(types("none")).toEqual([])
  expect(types(" user , tool")).toEqual(["user", "tool"])
  expect(types(["reasoning", "compaction"])).toEqual(["reasoning", "compaction"])
  expect(() => decodeInfo({ timestamps: "tools" })).toThrow()
  expect(() => decodeInfo({ timestamps: "all,user" })).toThrow()
  expect(() => decodeInfo({ timestamps: "user," })).toThrow()
  expect(() => decodeInfo({ timestamps: ["all"] })).toThrow()
})

describe("footer elements", () => {
  const selected = (value: unknown) => {
    const footer = decodeInfo({ footer: { time: value } }).footer
    const selection = footerSelections({ footer }, {}).time
    return { important: selection.important, types: [...selection.types] as string[] }
  }
  const all = ["user", "assistant", "text", "reasoning", "tool", "error", "compaction"]
  const types = (selections: ReturnType<typeof footerSelections>) =>
    Object.fromEntries(
      Object.entries(selections).map(([key, selection]) => [
        key,
        selection.important ? ["important", ...selection.types] : [...selection.types],
      ]),
    )

  test("every element takes a boolean, all, none, important, or a type list", () => {
    expect(selected(true)).toEqual({ important: false, types: all })
    expect(selected("all")).toEqual({ important: false, types: all })
    expect(selected(false)).toEqual({ important: false, types: [] })
    expect(selected("none")).toEqual({ important: false, types: [] })
    expect(selected("important")).toEqual({ important: true, types: [] })
    expect(selected(" user , important")).toEqual({ important: true, types: ["user"] })
    expect(selected(["tool", "assistant"])).toEqual({ important: false, types: ["assistant", "tool"] })
    for (const key of ["agent", "model", "variant", "time", "duration", "total", "message_id"])
      expect(decodeInfo({ footer: { [key]: "important,user" } })).toEqual({ footer: { [key]: "important,user" } })
    expect(() => decodeInfo({ footer: { time: "tools" } })).toThrow()
    expect(() => decodeInfo({ footer: { time: "all,user" } })).toThrow()
    expect(() => decodeInfo({ footer: { time: ["all"] } })).toThrow()
    expect(() => decodeInfo({ footer: { message_id: 1 } })).toThrow()
  })

  test("defaults keep the upstream footer", () => {
    expect(types(footerSelections({}, {}))).toEqual({
      agent: all,
      model: all,
      variant: [],
      time: [],
      duration: ["reasoning"],
      total: all,
      message_id: [],
    })
  })

  test("legacy keys and persisted toggles map onto the elements while footer leaves them unset", () => {
    expect(
      types(
        footerSelections(
          { timestamps: "user,tool", turn_timing: { time: false, duration: true }, footer_variant: true },
          { timestamps: false, turnTime: true },
        ),
      ),
    ).toMatchObject({ variant: all, time: ["user", "tool"], duration: ["assistant", "reasoning", "tool"] })
    expect(types(footerSelections({ turn_timing: { time: true } }, { timestamps: true }))).toMatchObject({
      time: ["user", "assistant"],
    })
    expect(types(footerSelections({ turn_timing: { time: true, duration: true } }, { turnTime: false, turnDuration: false })))
      .toMatchObject({ time: [], duration: ["reasoning"] })
  })

  test("footer wins over the legacy keys", () => {
    expect(
      types(
        footerSelections(
          {
            timestamps: "all",
            turn_timing: { duration: true },
            footer_variant: true,
            footer: { time: "important", duration: false, variant: "none", message_id: "all", total: false },
          },
          { timestamps: true, turnTime: true, turnDuration: true },
        ),
      ),
    ).toMatchObject({ variant: [], time: ["important"], duration: [], message_id: all, total: [] })
  })

  test("toggles are session-only for elements tui.json decides", () => {
    expect(footerConfigured({}, "time")).toBe(false)
    expect(footerConfigured({ timestamps: "none" }, "time")).toBe(true)
    expect(footerConfigured({ timestamps: "none" }, "duration")).toBe(false)
    expect(footerConfigured({ footer: { duration: false } }, "duration")).toBe(true)
  })

  test("important shows only on landmarks, and asks only when the type list does not decide", () => {
    const important = footerSelections({ footer: { time: "important,tool" } }, {}).time
    let asked = 0
    const landmark = (value: boolean) => () => {
      asked++
      return value
    }
    expect(footerShows(important, "tool", landmark(false))).toBe(true)
    expect(asked).toBe(0)
    expect(footerShows(important, "assistant", landmark(true))).toBe(true)
    expect(footerShows(important, "assistant", landmark(false))).toBe(false)
    expect(asked).toBe(2)
    const none = footerSelections({ footer: { time: "user" } }, {}).time
    expect(footerShows(none, "assistant", landmark(true))).toBe(false)
    expect(asked).toBe(2)
    expect(footerSelects(important, "reasoning")).toBe(true)
    expect(footerSelects(none, "assistant")).toBe(false)
  })
})

test("resolves host-neutral defaults", () => {
  const config = resolve({}, { terminalSuspend: true })

  expect(config.attention).toEqual({
    enabled: false,
    notifications: true,
    sound: true,
    volume: 0.4,
    sound_pack: "opencode.default",
    sounds: {},
  })
  expect(config.leader_timeout).toBe(LeaderTimeoutDefault)
  expect(config.mouse).toBe(true)
  expect(config.keybinds.has("terminal.suspend")).toBe(true)
  expect(config.keybinds.has("session.list")).toBe(true)
  expect(config.cursor).toBeUndefined()
})

test("resolves overrides without mutating input", () => {
  const input: TuiConfigInfo = {
    theme: "custom",
    mouse: false,
    leader_timeout: 750,
    attention: {
      enabled: true,
      notifications: false,
      sound: false,
      volume: 0.8,
      sound_pack: "custom.pack",
      sounds: { question: "/sounds/question.wav" },
    },
    keybinds: { session_list: "ctrl+l" },
    cursor: { blinking: false },
  }
  const config = resolve(input, { terminalSuspend: true })

  expect(config).toMatchObject({
    theme: "custom",
    mouse: false,
    leader_timeout: 750,
    attention: input.attention,
    cursor: { style: "block", blinking: false },
  })
  expect(config.keybinds.get("session.list")).toHaveLength(1)
  expect(input.keybinds).toEqual({ session_list: "ctrl+l" })
})

test("resolves a session move keybind", () => {
  const config = resolve({ keybinds: { session_move: "ctrl+o" } }, { terminalSuspend: true })

  expect(config.keybinds.get("session.move")).toMatchObject([{ key: "ctrl+o" }])
})

test("disables suspend and assigns ctrl+z to undo when unsupported", () => {
  const config = resolve({}, { terminalSuspend: false })

  expect(config.keybinds.has("terminal.suspend")).toBe(false)
  expect(config.keybinds.get("input.undo")).toMatchObject([{ key: "ctrl+z,ctrl+-,super+z" }])
})

test("preserves an explicit undo binding when suspend is unsupported", () => {
  const config = resolve({ keybinds: { input_undo: "ctrl+u", terminal_suspend: "ctrl+s" } }, { terminalSuspend: false })

  expect(config.keybinds.has("terminal.suspend")).toBe(false)
  expect(config.keybinds.get("input.undo")).toHaveLength(1)
  expect(config.keybinds.get("input.undo")).toMatchObject([{ key: "ctrl+u" }])
})

test("provides resolved config through Solid context", async () => {
  const config = resolve({ theme: "custom" }, { terminalSuspend: true })

  function Consumer() {
    const value = useTuiConfig()
    return <text>{`${value.theme} ${value.mouse} ${value.leader_timeout}`}</text>
  }

  const app = await testRender(() => (
    <TuiConfigProvider config={config}>
      <Consumer />
    </TuiConfigProvider>
  ))
  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain(`custom true ${LeaderTimeoutDefault}`)
  } finally {
    app.renderer.destroy()
  }
})

test("requires the config provider", () => {
  expect(() => useTuiConfig()).toThrow("TuiConfigProvider is missing")
})
