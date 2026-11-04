import { describe, expect, test } from "bun:test"
import type { WslOpencodeCheck, WslServerConfig } from "./contract"
import {
  createWslMachineState,
  toServersState,
  transitionWslMachine,
  type WslMachineEffect,
  type WslMachineEvent,
  type WslMachineState,
} from "./machine"
import { wslRowView } from "./row-view"

const ubuntu: WslServerConfig = { id: "wsl:Ubuntu", distro: "Ubuntu" }

const readyProbe = { name: "Debian", canExecute: true, hasBash: true, hasCurl: true, error: null }

function check(distro: string, version: string): WslOpencodeCheck {
  return {
    distro,
    resolvedPath: "/usr/bin/opencode",
    version,
    expectedVersion: "2",
    matchesDesktop: version === "2",
    error: null,
  }
}

// Replays events through the pure machine and collects every effect it asked for, in order.
function play(state: WslMachineState, ...events: WslMachineEvent[]) {
  return events.reduce<{ state: WslMachineState; effects: readonly WslMachineEffect[] }>(
    (result, event) => {
      const transition = transitionWslMachine(result.state, event)

      return { state: transition.state, effects: [...result.effects, ...transition.effects] }
    },
    { state, effects: [] },
  )
}

// Ubuntu is added with its server up as start `s0`, reporting an older OpenCode than the desktop.
function readyUbuntu() {
  return play(
    createWslMachineState([ubuntu]),
    { type: "start", id: ubuntu.id, attempt: "s0" },
    { type: "server.spawned", distro: "Ubuntu", attempt: "s0", url: "http://127.0.0.1:4100", password: "secret" },
    { type: "cli.checked", distro: "Ubuntu", check: check("Ubuntu", "1") },
  ).state
}

function spawns(effects: readonly WslMachineEffect[]) {
  return effects.filter((effect) => effect.type === "spawn" || effect.type === "stop")
}

describe("one job per distro", () => {
  test("a dialog probe that finishes during an update keeps the row busy and turns away a second update", () => {
    const updating = play(
      readyUbuntu(),
      { type: "update", distro: "Ubuntu", attempt: "u1" },
      { type: "probe", distro: "Debian", attempt: "p1" },
      { type: "distro.probed", distro: "Debian", attempt: "p1", probe: readyProbe },
      { type: "cli.inspected", distro: "Debian", attempt: "p1", check: check("Debian", "2") },
    )

    expect(updating.effects).toContainEqual({ type: "resolve", attempt: "p1" })
    expect(toServersState(updating.state).distroJobs).toEqual({ Ubuntu: "updating" })
    expect(wslRowView(toServersState(updating.state), "Ubuntu")).toEqual({
      version: "1",
      button: { label: "server.updating", disabled: true },
      retry: false,
      removable: false,
    })

    const again = transitionWslMachine(updating.state, { type: "update", distro: "Ubuntu", attempt: "u2" })

    expect(again.state).toBe(updating.state)
    expect(again.effects).toEqual([{ type: "resolve", attempt: "u2" }])
  })

  test("two starts of a failed server spawn one server and answer both callers", () => {
    const failed = play(
      createWslMachineState([ubuntu]),
      { type: "start", id: ubuntu.id, attempt: "s0" },
      { type: "server.failed", distro: "Ubuntu", attempt: "s0", message: "boom" },
    ).state

    const started = play(
      failed,
      { type: "start", id: ubuntu.id, attempt: "s1" },
      { type: "start", id: ubuntu.id, attempt: "s2" },
      { type: "server.spawned", distro: "Ubuntu", attempt: "s1", url: "http://127.0.0.1:4100", password: "secret" },
    )

    expect(spawns(started.effects)).toEqual([{ type: "spawn", distro: "Ubuntu", attempt: "s1" }])
    expect(started.effects).toContainEqual({ type: "resolve", attempt: "s2" })
    expect(started.effects).toContainEqual({ type: "resolve", attempt: "s1" })
    expect(toServersState(started.state).servers[0]?.runtime).toEqual({
      kind: "ready",
      url: "http://127.0.0.1:4100",
      password: "secret",
    })
  })

  test("a restart stops the running server before it spawns the next, once", () => {
    const restart = play(
      readyUbuntu(),
      { type: "start", id: ubuntu.id, attempt: "s1" },
      { type: "start", id: ubuntu.id, attempt: "s2" },
      { type: "server.stopped", distro: "Ubuntu", attempt: "s1" },
    )

    expect(spawns(restart.effects)).toEqual([
      { type: "stop", distro: "Ubuntu", attempt: "s1", server: "s0" },
      { type: "spawn", distro: "Ubuntu", attempt: "s1" },
    ])
  })

  test("other jobs are turned away while a distro is busy", () => {
    const updating = play(readyUbuntu(), { type: "update", distro: "Ubuntu", attempt: "u1" }).state

    expect(transitionWslMachine(updating, { type: "remove", id: ubuntu.id, attempt: "r1" }).effects).toEqual([
      { type: "reject", attempt: "r1", failure: { kind: "busy", distro: "Ubuntu" } },
    ])

    const probing = play(createWslMachineState([]), { type: "probe", distro: "Debian", attempt: "p1" }).state

    expect(transitionWslMachine(probing, { type: "update", distro: "Debian", attempt: "u1" }).effects).toEqual([
      { type: "reject", attempt: "u1", failure: { kind: "busy", distro: "Debian" } },
    ])
    expect(transitionWslMachine(probing, { type: "probe", distro: "Debian", attempt: "p2" }).effects).toEqual([
      { type: "resolve", attempt: "p2" },
    ])
  })
})

describe("attempts fence completions", () => {
  test("a start an update superseded cannot come back", () => {
    const superseded = play(
      createWslMachineState([ubuntu]),
      { type: "start", id: ubuntu.id, attempt: "s1" },
      { type: "update", distro: "Ubuntu", attempt: "u1" },
    )

    expect(superseded.effects).toContainEqual({ type: "resolve", attempt: "s1" })
    expect(superseded.effects).toContainEqual({ type: "stop", distro: "Ubuntu", attempt: "u1", server: "s1" })

    const late = [
      { type: "server.spawned", distro: "Ubuntu", attempt: "s1", url: "http://127.0.0.1:4100", password: "x" },
      { type: "server.failed", distro: "Ubuntu", attempt: "s1", message: "aborted" },
      { type: "server.stopped", distro: "Ubuntu", attempt: "s1" },
      { type: "cli.installed", distro: "Ubuntu", attempt: "u0", check: check("Ubuntu", "2") },
    ] satisfies WslMachineEvent[]

    late.forEach((event) => {
      const transition = transitionWslMachine(superseded.state, event)

      expect(transition.state).toBe(superseded.state)
      expect(transition.effects).toEqual([])
    })
  })

  test("only the live server's exit fails it", () => {
    const exit = {
      type: "server.exited",
      distro: "Ubuntu",
      attempt: "s0",
      code: 1,
      signal: null,
      message: "exited",
    } satisfies WslMachineEvent

    const stopping = play(readyUbuntu(), { type: "update", distro: "Ubuntu", attempt: "u1" }).state

    expect(transitionWslMachine(stopping, exit).state).toBe(stopping)

    const crashed = transitionWslMachine(readyUbuntu(), exit)

    expect(toServersState(crashed.state).servers[0]?.runtime).toEqual({ kind: "failed", message: "exited" })
    expect(wslRowView(toServersState(crashed.state), "Ubuntu").retry).toBe(true)
  })
})

describe("updates", () => {
  test("an update stops the server, installs, and answers once the restarted server is up", () => {
    const updated = play(
      readyUbuntu(),
      { type: "update", distro: "Ubuntu", attempt: "u1" },
      { type: "server.stopped", distro: "Ubuntu", attempt: "u1" },
      { type: "cli.installed", distro: "Ubuntu", attempt: "u1", check: check("Ubuntu", "2") },
    )

    expect(spawns(updated.effects)).toEqual([
      { type: "stop", distro: "Ubuntu", attempt: "u1", server: "s0" },
      { type: "spawn", distro: "Ubuntu", attempt: "u1" },
    ])
    expect(updated.effects).toContainEqual({ type: "install-cli", distro: "Ubuntu", attempt: "u1" })
    expect(updated.effects).not.toContainEqual({ type: "resolve", attempt: "u1" })
    expect(wslRowView(toServersState(updated.state), "Ubuntu")).toEqual({
      version: "2",
      button: null,
      retry: false,
      removable: true,
    })

    const up = transitionWslMachine(updated.state, {
      type: "server.spawned",
      distro: "Ubuntu",
      attempt: "u1",
      url: "http://127.0.0.1:4200",
      password: "next",
    })

    expect(up.effects).toContainEqual({ type: "resolve", attempt: "u1" })
    expect(toServersState(up.state).distroJobs).toEqual({})
  })

  test("an update of a distro without a server answers once the CLI matches", () => {
    const updated = play(
      createWslMachineState([]),
      { type: "update", distro: "Debian", attempt: "u1" },
      { type: "cli.installed", distro: "Debian", attempt: "u1", check: check("Debian", "2") },
    )

    expect(spawns(updated.effects)).toEqual([])
    expect(updated.effects).toContainEqual({ type: "resolve", attempt: "u1" })
    expect(toServersState(updated.state).opencodeChecks.Debian).toEqual(check("Debian", "2"))
  })

  test("a failed update keeps the check it read and leaves the server stopped", () => {
    const failed = play(
      readyUbuntu(),
      { type: "update", distro: "Ubuntu", attempt: "u1" },
      { type: "server.stopped", distro: "Ubuntu", attempt: "u1" },
      { type: "job.failed", distro: "Ubuntu", attempt: "u1", message: "still 1", check: check("Ubuntu", "1") },
    )

    expect(failed.effects).toContainEqual({
      type: "reject",
      attempt: "u1",
      failure: { kind: "error", message: "still 1" },
    })
    expect(toServersState(failed.state).servers[0]?.runtime).toEqual({ kind: "stopped" })
    expect(wslRowView(toServersState(failed.state), "Ubuntu")).toMatchObject({
      button: { label: "onboarding.updateOpencode", disabled: false },
      retry: true,
    })
  })
})

describe("removal and shutdown", () => {
  test("removing a starting server stops it, then forgets the distro", () => {
    const removed = play(
      createWslMachineState([ubuntu]),
      { type: "start", id: ubuntu.id, attempt: "s1" },
      { type: "cli.checked", distro: "Ubuntu", check: check("Ubuntu", "1") },
      { type: "remove", id: ubuntu.id, attempt: "r1" },
      { type: "server.stopped", distro: "Ubuntu", attempt: "r1" },
      { type: "cli.checked", distro: "Ubuntu", check: check("Ubuntu", "1") },
    )

    expect(removed.effects).toContainEqual({ type: "resolve", attempt: "s1" })
    expect(removed.effects).toContainEqual({ type: "stop", distro: "Ubuntu", attempt: "r1", server: "s1" })
    expect(removed.effects).toContainEqual({ type: "persist", servers: [] })
    expect(removed.effects).toContainEqual({ type: "resolve", attempt: "r1" })
    expect(toServersState(removed.state)).toMatchObject({ servers: [], opencodeChecks: {}, distroJobs: {} })
  })

  test("closing answers every running job and turns away later requests", () => {
    const busy = play(
      readyUbuntu(),
      { type: "update", distro: "Ubuntu", attempt: "u1" },
      { type: "host", attempt: "h1", job: "probe-runtime" },
    ).state

    const closed = transitionWslMachine(busy, { type: "close" })

    expect(closed.effects).toEqual([
      { type: "reject", attempt: "h1", failure: { kind: "unavailable" } },
      { type: "reject", attempt: "u1", failure: { kind: "unavailable" } },
    ])
    expect(toServersState(closed.state)).toMatchObject({ hostJob: "idle", distroJobs: {} })

    const after = play(
      closed.state,
      { type: "server.stopped", distro: "Ubuntu", attempt: "u1" },
      { type: "start", id: ubuntu.id, attempt: "s1" },
    )

    expect(after.effects).toEqual([{ type: "reject", attempt: "s1", failure: { kind: "unavailable" } }])
  })
})

describe("host jobs", () => {
  test("a second host request joins the running one, and its result settles only the matching attempt", () => {
    const runtime = { available: true, version: "2", error: null }

    const probed = play(
      createWslMachineState([]),
      { type: "host", attempt: "h1", job: "probe-runtime" },
      { type: "host", attempt: "h2", job: "install-wsl" },
      { type: "runtime.probed", attempt: "h0", runtime },
    )

    expect(probed.effects).toEqual([
      { type: "host", attempt: "h1", job: "probe-runtime" },
      { type: "resolve", attempt: "h2" },
    ])
    expect(toServersState(probed.state).hostJob).toBe("busy")

    const settled = transitionWslMachine(probed.state, { type: "runtime.probed", attempt: "h1", runtime })

    expect(settled.effects).toEqual([{ type: "resolve", attempt: "h1" }])
    expect(toServersState(settled.state)).toMatchObject({ hostJob: "idle", runtime })
  })
})
