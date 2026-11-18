import { describe, expect, test } from "bun:test"
import { createTrayState, transitionTray, type TrayDeps } from "./tray-machine"

const deps: TrayDeps = { iconPath: "/icons/32x32.png", show: () => {}, quit: () => {} }

describe("tray machine", () => {
  test("installs without creating the icon while the setting is off", () => {
    const next = transitionTray(createTrayState(), { type: "installed", deps, enabled: false })

    expect(next.state).toEqual({ status: "installed", deps, enabled: false })
    expect(next.commands).toEqual([])
  })

  test("creates the icon when installation finds the setting on", () => {
    const next = transitionTray(createTrayState(), { type: "installed", deps, enabled: true })

    expect(next.commands).toEqual([{ type: "create", deps }])
  })

  test("turning the setting on creates the icon and off destroys it", () => {
    const installed = { status: "installed", deps, enabled: false } as const
    const on = transitionTray(installed, { type: "enabled.changed", enabled: true })

    expect(on.state).toEqual({ status: "installed", deps, enabled: true })
    expect(on.commands).toEqual([{ type: "create", deps }])

    const off = transitionTray(on.state, { type: "enabled.changed", enabled: false })

    expect(off.state).toEqual(installed)
    expect(off.commands).toEqual([{ type: "destroy" }])
  })

  test("a setting change to the same value does nothing", () => {
    const state = { status: "installed", deps, enabled: true } as const

    expect(transitionTray(state, { type: "enabled.changed", enabled: true })).toEqual({
      state,
      commands: [],
    })
  })

  test("a refresh rebuilds a visible tray only", () => {
    const hidden = { status: "installed", deps, enabled: false } as const
    const visible = { status: "installed", deps, enabled: true } as const

    expect(transitionTray(hidden, { type: "refreshed" }).commands).toEqual([])
    expect(transitionTray(visible, { type: "refreshed" })).toEqual({
      state: visible,
      commands: [{ type: "rebuild", deps }],
    })
  })

  test("disposing destroys a visible tray and forgets the installation either way", () => {
    const visible = { status: "installed", deps, enabled: true } as const
    const hidden = { status: "installed", deps, enabled: false } as const

    expect(transitionTray(visible, { type: "disposed" })).toEqual({
      state: { status: "uninstalled" },
      commands: [{ type: "destroy" }],
    })
    expect(transitionTray(hidden, { type: "disposed" })).toEqual({
      state: { status: "uninstalled" },
      commands: [],
    })
  })

  test("events before installation record nothing and create nothing", () => {
    const base = createTrayState()

    expect(transitionTray(base, { type: "enabled.changed", enabled: true })).toEqual({
      state: base,
      commands: [],
    })
    expect(transitionTray(base, { type: "refreshed" })).toEqual({ state: base, commands: [] })
  })
})
