import { expect, test } from "bun:test"
import { resolveMiniSettings } from "../../src/mini/runtime.boot"
import {
  applyMiniSettingChange,
  cycleMiniVerbosity,
  matchMiniVerbosity,
  verbosityChange,
  verbosityPreset,
} from "../../src/mini/verbosity"

test("default Mini settings match the default verbosity preset", () => {
  expect(matchMiniVerbosity(resolveMiniSettings())).toBe("default")
})

test("verbosity presets only change transcript and chrome knobs", () => {
  const current = resolveMiniSettings({ mini: { work_spinner: "seed", mono: true } })
  expect(applyMiniSettingChange(current, { key: "verbosity", value: "quiet" })).toEqual({
    ...current,
    ...verbosityPreset("quiet"),
  })
  expect(applyMiniSettingChange(current, { key: "verbosity", value: "verbose" }).mono).toBe(true)
  expect(applyMiniSettingChange(current, { key: "thinking", value: "show" }).thinking).toBe("show")
})

test("individual knobs mark verbosity custom until a preset matches again", () => {
  const quieter = applyMiniSettingChange(resolveMiniSettings(), { key: "tools", value: "hide" })
  expect(matchMiniVerbosity(quieter)).toBe("custom")
  expect(matchMiniVerbosity(applyMiniSettingChange(quieter, { key: "verbosity", value: "quiet" }))).toBe("quiet")
})

test("verbosity cycles like a clamped slider", () => {
  const settings = resolveMiniSettings()
  expect(cycleMiniVerbosity(settings, 1)).toBe("verbose")
  expect(cycleMiniVerbosity(settings, -1)).toBe("quiet")
  expect(cycleMiniVerbosity({ ...settings, ...verbosityPreset("quiet") }, -1)).toBe("quiet")
  expect(cycleMiniVerbosity({ ...settings, ...verbosityPreset("verbose") }, 1)).toBe("verbose")
  expect(verbosityChange({ ...settings, ...verbosityPreset("quiet") }, -1)).toBeUndefined()
  expect(verbosityChange(settings, 1)).toEqual({ key: "verbosity", value: "verbose" })
})

test("custom verbosity moves toward the nearest preset", () => {
  const custom = applyMiniSettingChange(resolveMiniSettings(), { key: "thinking", value: "show" })
  expect(matchMiniVerbosity(custom)).toBe("custom")
  expect(cycleMiniVerbosity(custom, 1)).toBe("verbose")
  expect(cycleMiniVerbosity(custom, -1)).toBe("quiet")
})
