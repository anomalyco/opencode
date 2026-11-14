import { expect, test } from "bun:test"
import {
  canAuthenticatePluginServer,
  createPluginServerState,
  PLUGIN_CONNECT_TIMEOUT_MS,
  selectPluginStatus,
  transitionPluginServer,
  type PluginEntrySnapshot,
  type PluginServerEffect,
  type PluginServerEvent,
  type PluginServerState,
  type PluginServerStatus,
} from "./plugin-machine"

const http = { url: "http://127.0.0.1:4100", password: "secret" }

const entry = (state: PluginEntrySnapshot["state"], endpoint?: PluginEntrySnapshot["http"]): PluginServerEvent => ({
  type: "entry.updated",
  entry: { state, http: endpoint },
})

const settled = (attempt: number, ready: boolean): PluginServerEvent => ({ type: "connect.settled", attempt, ready })

function replay(events: readonly PluginServerEvent[], state = createPluginServerState({ state: "auth" })) {
  return events.reduce<{ state: PluginServerState; effects: PluginServerEffect[] }>(
    (result, event) => {
      const next = transitionPluginServer(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

// What the callbacks the driver ran did.
const log: string[] = []

const logs = (step: string) => () => void log.push(step)

/** Plays the driver's `notify.connected`: runs every callback and returns what they logged. */
function run(effects: readonly PluginServerEffect[]) {
  const from = log.length
  effects.forEach((effect) => effect.type === "notify.connected" && effect.callbacks.forEach((callback) => callback()))

  return log.slice(from)
}

test("a second sign-in request joins the first instead of connecting again", () => {
  const clicked = replay([
    { type: "authenticate", onConnected: logs("focus") },
    { type: "authenticate", onConnected: logs("open project") },
  ])

  expect(clicked.effects).toEqual([{ type: "connect", attempt: 1, timeoutMs: PLUGIN_CONNECT_TIMEOUT_MS }])
  expect(selectPluginStatus(clicked.state)).toEqual({ type: "starting" })
  expect(canAuthenticatePluginServer(clicked.state)).toBe(true)

  const ready = transitionPluginServer(clicked.state, entry("ready", http))
  expect(selectPluginStatus(ready.state)).toEqual({ type: "ready", http })
  expect(run(ready.effects)).toEqual(["focus", "open project"])
})

test("a password prompt during sign-in keeps the server connecting until the attempt ends", () => {
  const prompted = replay([{ type: "authenticate", onConnected: logs("focus") }, entry("starting"), entry("auth")])
  expect(selectPluginStatus(prompted.state)).toEqual({ type: "starting" })

  // The user cancels the prompt: the server asks for sign-in again and nothing continues.
  const cancelled = transitionPluginServer(prompted.state, settled(1, false))
  expect(selectPluginStatus(cancelled.state)).toEqual({ type: "auth" })
  expect(cancelled.effects).toEqual([{ type: "timeout.cancel" }])
  expect(canAuthenticatePluginServer(cancelled.state)).toBe(true)
})

test.each([
  { name: "the plugin reports ready first", events: [entry("ready", http), settled(1, true)] },
  { name: "connect resolves first", events: [settled(1, true), entry("ready", http)] },
])("sign-in continues exactly once when $name", (input) => {
  const result = replay([{ type: "authenticate", onConnected: logs("focus") }, ...input.events])

  expect(run(result.effects)).toEqual(["focus"])
  expect(selectPluginStatus(result.state)).toEqual({ type: "ready", http })
})

test("a sign-in that runs out of time shows the plugin's stage again and never continues", () => {
  const timedOut = replay([
    { type: "authenticate", onConnected: logs("focus") },
    entry("starting"),
    { type: "connect.timed-out", attempt: 1 },
  ])

  expect(selectPluginStatus(timedOut.state)).toEqual({ type: "starting" })

  const late = replay([settled(1, true), entry("ready", http)], timedOut.state)
  expect(run(late.effects)).toEqual([])
  expect(selectPluginStatus(late.state)).toEqual({ type: "ready", http })
})

test.each<{ name: string; event: PluginServerEvent; status: PluginServerStatus["type"] }>([
  { name: "fails", event: entry("failed"), status: "failed" },
  { name: "stops", event: entry("stopped"), status: "stopped" },
  { name: "is unlisted", event: { type: "disposed" }, status: "stopped" },
])("a sign-in ends and drops its callbacks when the server $name", (input) => {
  const ended = replay([{ type: "authenticate", onConnected: logs("focus") }, input.event])

  expect(ended.effects).toContainEqual({ type: "timeout.cancel" })
  expect(selectPluginStatus(ended.state).type).toBe(input.status)
  expect(run(replay([settled(1, true), entry("ready", http)], ended.state).effects)).toEqual([])
})

test.each(["stopped", "starting", "ready", "failed", "incompatible"] as const)(
  "a server in %s does not start sign-in",
  (stage) => {
    const state = createPluginServerState({ state: stage, http })

    expect(canAuthenticatePluginServer(state)).toBe(false)
    expect(transitionPluginServer(state, { type: "authenticate" })).toEqual({ state, effects: [] })
  },
)

test("a ready report without an endpoint is a failure, never a ready server", () => {
  const state = createPluginServerState({ state: "ready" })

  expect(selectPluginStatus(state)).toEqual({ type: "failed" })
  expect(transitionPluginServer(state, entry("ready")).state).toBe(state)

  const ready = transitionPluginServer(state, entry("ready", { ...http })).state
  expect(transitionPluginServer(ready, entry("ready", { ...http })).state).toBe(ready)
})
