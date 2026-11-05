import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { WslServersState } from "./contract"
import { addServerProbePlan, type AddServerProbePlan } from "./model"
import {
  createWslProbeState,
  selectWslProbingAddable,
  transitionWslProbes,
  WSL_PROBE_TIMEOUT_MS,
  type WslProbeEffect,
  type WslProbeEvent,
  type WslProbeInput,
  type WslProbeState,
} from "./probe-machine"

// Main's state reaches the window through the Ipc, which decodes it.
function wsl(fields: Partial<typeof WslServersState.Encoded>) {
  return Schema.decodeUnknownSync(WslServersState)({
    runtime: { available: true, version: "2.0", error: null },
    installed: [],
    online: [],
    distroProbes: {},
    opencodeChecks: {},
    pendingRestart: false,
    servers: [],
    hostJob: "idle",
    distroJobs: {},
    ...fields,
  })
}

const ubuntu = { name: "Ubuntu", version: 2, isDefault: true }

const debian = { name: "Debian", version: 2, isDefault: false }

// Plans the probe from main's state, as the dialog does.
function input(state: WslServersState, selectedDistro: string | null = null): WslProbeInput {
  const busy = state.hostJob === "busy"
  const addable = [...state.installed]

  return {
    plan: addServerProbePlan({
      state,
      view: "main",
      adding: false,
      busy,
      selectedDistro,
      addableInstalledDistros: addable,
    }),
    busy,
    available: true,
  }
}

function replay(state: WslProbeState, events: readonly WslProbeEvent[]) {
  return events.reduce<{ state: WslProbeState; effects: WslProbeEffect[] }>(
    (result, event) => {
      const next = transitionWslProbes(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

const runs = (effects: readonly WslProbeEffect[]) =>
  effects.flatMap((effect) => (effect.type === "probe.run" ? [effect.command.key] : []))

function plan(value: WslProbeInput): AddServerProbePlan {
  if (!value.plan) throw new Error("expected a plan")

  return value.plan
}

describe("wsl add-server probes", () => {
  test("a reply that beats main's state does not run the same probe again", () => {
    const unknown = input(wsl({ runtime: null }))

    const result = replay(createWslProbeState(), [
      { type: "synced", ...unknown },
      // The reply arrives a tick before the state that carries the runtime.
      { type: "probe.succeeded", attempt: 1, ...unknown },
      { type: "synced", ...input(wsl({ runtime: null, hostJob: "busy" })) },
      { type: "synced", ...unknown },
    ])

    expect(runs(result.effects)).toEqual(["auto:runtime"])
    expect(result.effects[0]).toEqual({
      type: "probe.run",
      attempt: 1,
      command: plan(unknown),
      timeoutMs: WSL_PROBE_TIMEOUT_MS,
    })
  })

  test("an empty distro list does not refresh in a loop", () => {
    const empty = input(wsl({}))

    const result = replay(createWslProbeState(), [
      { type: "synced", ...empty },
      { type: "probe.succeeded", attempt: 1, ...empty },
      { type: "synced", ...input(wsl({ hostJob: "busy" })) },
      { type: "synced", ...empty },
    ])

    expect(runs(result.effects)).toEqual(["auto:distros"])

    // A distro appears: the plan moves on and runs at once.
    const next = transitionWslProbes(result.state, { type: "synced", ...input(wsl({ installed: [ubuntu] })) })
    expect(runs(next.effects)).toEqual(["addable:distro:Ubuntu"])
  })

  test("keys that fail in turn are not tried again until the user checks again", () => {
    const state = wsl({ installed: [ubuntu, debian] })
    const first = input(state, "Ubuntu")
    const second = input(state, "Debian")

    const failed = replay(createWslProbeState(), [
      { type: "synced", ...first },
      { type: "probe.failed", attempt: 1, cause: "no", ...first },
      { type: "synced", ...second },
      { type: "probe.failed", attempt: 2, cause: "no", ...second },
      { type: "synced", ...first },
    ])

    expect(runs(failed.effects)).toEqual([plan(first).key, plan(second).key])
    expect(failed.effects.filter((effect) => effect.type === "probe.error")).toHaveLength(2)

    const reset = replay(failed.state, [{ type: "reset" }, { type: "synced", ...second }])
    expect(runs(reset.effects)).toEqual([plan(second).key])
  })

  test("one probe runs at a time and stale replies are ignored", () => {
    const state = wsl({ installed: [ubuntu] })
    const running = transitionWslProbes(createWslProbeState(), { type: "synced", ...input(state) }).state

    expect(selectWslProbingAddable(running)).toBe(true)
    expect(transitionWslProbes(running, { type: "synced", ...input(wsl({ runtime: null })) }).state).toBe(running)
    expect(transitionWslProbes(running, { type: "probe.succeeded", attempt: 7, ...input(state) }).state).toBe(running)
    expect(transitionWslProbes(running, { type: "probe.failed", attempt: 7, cause: "x", ...input(state) }).state).toBe(
      running,
    )
  })

  test("main going away stops the probe and forgets failures", () => {
    const state = wsl({ installed: [ubuntu, debian] })
    const first = input(state, "Ubuntu")

    const result = replay(createWslProbeState(), [
      { type: "synced", ...first },
      { type: "probe.failed", attempt: 1, cause: "no", ...input(state, "Debian") },
      { type: "synced", ...first, available: false },
    ])

    expect(result.effects.at(-1)).toEqual({ type: "probe.abort", attempt: 2 })
    expect(runs(transitionWslProbes(result.state, { type: "synced", ...first }).effects)).toEqual([plan(first).key])
  })

  test("disposing aborts the running probe and ignores later events", () => {
    const value = input(wsl({ runtime: null }))
    const running = transitionWslProbes(createWslProbeState(), { type: "synced", ...value }).state
    const disposed = transitionWslProbes(running, { type: "disposed" })

    expect(disposed.effects).toEqual([{ type: "probe.abort", attempt: 1 }])
    expect(transitionWslProbes(disposed.state, { type: "probe.succeeded", attempt: 1, ...value }).state).toBe(
      disposed.state,
    )
    expect(transitionWslProbes(disposed.state, { type: "synced", ...value }).effects).toEqual([])
  })
})
