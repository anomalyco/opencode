import { expect } from "bun:test"
import { Effect, Exit } from "effect"
import { Plugin } from "@opencode/core/plugin"
import { testEffect } from "./lib/effect"
import { PluginTestLayer } from "./plugin/fixture"

const it = testEffect(PluginTestLayer)

it.live("activate burst yields to the event loop", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const started: number[] = []
    let observed = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    yield* Effect.addFinalizer(() => Effect.sync(() => clearTimeout(timer)))
    yield* plugins.activate(Array.from({ length: 3 }, (_, index) => ({
      id: `burst-${index}`,
      revision: "1",
      effect: () => Effect.sync(() => {
        // Arm inside the first plugin so an initial yield cannot satisfy the test.
        if (index === 0) timer = setTimeout(() => { observed = started.length }, 0)
        // CPU work stays below the fiber operation-count auto-yield threshold.
        const end = performance.now() + 5
        while (performance.now() < end) {}
        started.push(index)
      }),
    })))
    expect(started).toEqual([0, 1, 2])
    expect(observed).toBeGreaterThan(0)
    expect(observed).toBeLessThan(started.length)
    expect((yield* plugins.list()).every((plugin) => plugin.state.status === "active")).toBe(true)
  }),
)

it.live("close burst yields to the event loop", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const stopped: number[] = []
    let observed = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    yield* Effect.addFinalizer(() => Effect.sync(() => clearTimeout(timer)))
    yield* plugins.activate(Array.from({ length: 3 }, (_, index) => ({
      id: `close-${index}`,
      revision: "1",
      effect: () => Effect.addFinalizer(() => Effect.sync(() => {
        if (index === 2) timer = setTimeout(() => { observed = stopped.length }, 0)
        const end = performance.now() + 5
        while (performance.now() < end) {}
        stopped.push(index)
      })),
    })))
    yield* plugins.close(Exit.void)
    expect(stopped).toEqual([2, 1, 0])
    expect(observed).toBeGreaterThan(0)
    expect(observed).toBeLessThan(stopped.length)
    yield* plugins.close(Exit.void)
    expect(stopped).toEqual([2, 1, 0])
  }),
)
