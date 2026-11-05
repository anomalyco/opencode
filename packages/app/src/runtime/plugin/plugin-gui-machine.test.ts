import { describe, expect, test } from "bun:test"
import type { BridgePluginGui, BridgePluginGuis } from "@opencode/plugin/gui/host"
import {
  createPluginGuiState,
  transitionPluginGui,
  type LoadedPluginGui,
  type PluginGuiEffect,
  type PluginGuiEvent,
  type PluginGuiState,
} from "./plugin-gui-machine"

const gui = (id: string, revision: string): BridgePluginGui => ({ id, revision, code: "", options: {} })

const guis = (plugins: BridgePluginGui[], reserved: string[] = []): BridgePluginGuis => ({ plugins, reserved })

const evaluated = (plugin: BridgePluginGui): LoadedPluginGui => ({
  id: plugin.id,
  revision: plugin.revision,
  options: plugin.options,
  definition: { id: plugin.id },
})

function run(events: PluginGuiEvent[], state: PluginGuiState = createPluginGuiState().state) {
  return events.reduce<{ state: PluginGuiState; effects: PluginGuiEffect[] }>(
    (current, event) => {
      const next = transitionPluginGui(current.state, event)

      return { state: next.state, effects: [...current.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

function published(effects: readonly PluginGuiEffect[]) {
  return effects.flatMap((effect) =>
    effect.type === "publish" ? [effect.plugins.map((plugin) => `${plugin.id}@${plugin.revision}`)] : [],
  )
}

describe("plugin GUI machine", () => {
  test("starts the first request with its timeout", () => {
    expect(createPluginGuiState()).toEqual({
      state: { status: "awaiting", attempt: 1 },
      effects: [
        { type: "fetch.initial", attempt: 1 },
        { type: "timer.start", attempt: 1 },
      ],
    })
  })

  test("a rejected first request settles with no plugins, and a later push recovers", () => {
    const failed = run([{ type: "initial.failed", attempt: 1, cause: new Error("ipc") }])

    expect(failed.state.status).toBe("failed")
    expect(failed.effects).toContainEqual({ type: "timer.stop" })
    expect(published(failed.effects)).toEqual([[]])

    const acme = gui("acme", "r1")
    const pushed = transitionPluginGui(failed.state, { type: "pushed", guis: guis([acme]) })

    expect(pushed.state).toMatchObject({ status: "evaluating", settled: true })
    const loaded = transitionPluginGui(pushed.state, {
      type: "evaluated",
      attempt: pushed.state.status === "evaluating" ? pushed.state.attempt : 0,
      loaded: [evaluated(acme)],
    })

    expect(published(loaded.effects)).toEqual([["acme@r1"]])
  })

  test("a first request main never answers times out and settles", () => {
    const timedOut = run([{ type: "timeout", attempt: 1 }])

    expect(timedOut.state.status).toBe("failed")
    expect(published(timedOut.effects)).toEqual([[]])

    // The reply that finally arrives still loads.
    const late = transitionPluginGui(timedOut.state, {
      type: "initial.resolved",
      attempt: 1,
      guis: guis([gui("acme", "r1")]),
    })

    expect(late.state.status).toBe("evaluating")
  })

  test("a push before the first reply wins, and the late reply is ignored", () => {
    const pushed = run([{ type: "pushed", guis: guis([], ["file"]) }])

    expect(pushed.effects).toEqual([{ type: "timer.stop" }, { type: "publish", plugins: [], reserved: ["file"] }])

    const late = transitionPluginGui(pushed.state, {
      type: "initial.resolved",
      attempt: 1,
      guis: guis([gui("acme", "r1")]),
    })

    expect(late.state).toBe(pushed.state)
    expect(late.effects).toEqual([])
  })

  test("a slow evaluation of an older push never lands over a newer one", () => {
    const r1 = gui("acme", "r1")
    const r2 = gui("acme", "r2")
    const first = run([{ type: "initial.resolved", attempt: 1, guis: guis([r1]) }])
    const second = transitionPluginGui(first.state, { type: "pushed", guis: guis([r2]) })
    const fast = transitionPluginGui(second.state, { type: "evaluated", attempt: 3, loaded: [evaluated(r2)] })

    expect(published(fast.effects)).toEqual([["acme@r2"]])

    const slow = transitionPluginGui(fast.state, { type: "evaluated", attempt: 2, loaded: [evaluated(r1)] })

    expect(slow.state).toBe(fast.state)
    expect(slow.effects).toEqual([])
    expect(fast.state.status === "loaded" && fast.state.cache.get("acme")?.revision).toBe("r2")
  })

  test("a removed plugin is not brought back by a slower evaluation", () => {
    const r1 = gui("acme", "r1")
    const first = run([{ type: "initial.resolved", attempt: 1, guis: guis([r1]) }])
    const removed = transitionPluginGui(first.state, { type: "pushed", guis: guis([]) })

    expect(published(removed.effects)).toEqual([[]])

    const slow = transitionPluginGui(removed.state, { type: "evaluated", attempt: 2, loaded: [evaluated(r1)] })

    expect(slow.state).toBe(removed.state)
    expect(removed.state.status === "loaded" && removed.state.cache.size).toBe(0)
  })

  test("an unchanged revision publishes the cached definition without evaluating", () => {
    const acme = gui("acme", "r1")
    const definition = evaluated(acme)
    const loaded = run([
      { type: "initial.resolved", attempt: 1, guis: guis([acme]) },
      { type: "evaluated", attempt: 2, loaded: [definition] },
    ])
    const again = transitionPluginGui(loaded.state, { type: "pushed", guis: guis([acme], ["x"]) })

    expect(again.effects).toEqual([{ type: "publish", plugins: [definition], reserved: ["x"] }])
  })

  test("a first evaluation that fails settles empty, keeping the reserved ids", () => {
    const failed = run([
      { type: "initial.resolved", attempt: 1, guis: guis([gui("acme", "r1")], ["file"]) },
      { type: "evaluate.failed", attempt: 2, cause: new Error("chunk") },
    ])

    expect(failed.state.status).toBe("failed")
    expect(failed.effects).toContainEqual({ type: "publish", plugins: [], reserved: ["file"] })
  })

  test("a reload that fails keeps the plugins that already run", () => {
    const r1 = gui("acme", "r1")
    const loaded = run([
      { type: "initial.resolved", attempt: 1, guis: guis([r1]) },
      { type: "evaluated", attempt: 2, loaded: [evaluated(r1)] },
    ])
    const reload = run(
      [
        { type: "pushed", guis: guis([gui("acme", "r2")]) },
        { type: "evaluate.failed", attempt: 3, cause: new Error("chunk") },
      ],
      loaded.state,
    )

    expect(reload.state.status === "loaded" && reload.state.cache.get("acme")?.revision).toBe("r1")
    expect(published(reload.effects)).toEqual([])
  })

  test("disposal stops the timer and ignores late results", () => {
    const disposed = transitionPluginGui(createPluginGuiState().state, { type: "disposed" })

    expect(disposed).toEqual({ state: { status: "disposed" }, effects: [{ type: "timer.stop" }] })

    const late = transitionPluginGui(disposed.state, { type: "initial.resolved", attempt: 1, guis: guis([]) })

    expect(late.state).toBe(disposed.state)
    expect(late.effects).toEqual([])
  })
})
