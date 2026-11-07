import { expect, test } from "bun:test"
import {
  canUseServer,
  createServerHealthState,
  isServerFailed,
  selectServerHealthRank,
  selectServerHealthRecord,
  selectServerIndicator,
  SERVER_HEALTH_POLL_MS,
  transitionServerHealth,
  type ServerHealth,
  type ServerHealthEffect,
  type ServerHealthEvent,
  type ServerHealthInput,
  type ServerHealthState,
  type ServerProbeResult,
} from "./health-machine"
import { ServerKey } from "./persistence"

const key = (name: string) => ServerKey.make(`http://${name}`)

const endpoint = (name: string, password?: string, managed = false): ServerHealthInput => ({
  type: "endpoint",
  key: key(name),
  http: { url: `http://${name}`, password },
  managed,
})

const staged = (name: string, stage: Extract<ServerHealthInput, { type: "staged" }>["stage"]): ServerHealthInput => ({
  type: "staged",
  key: key(name),
  stage,
})

const synced = (...servers: ServerHealthInput[]): ServerHealthEvent => ({ type: "servers.synced", servers })

const answered = (name: string, attempt: number, result: ServerProbeResult): ServerHealthEvent => ({
  type: "probe.settled",
  key: key(name),
  attempt,
  result,
})

const poll: ServerHealthEvent = { type: "poll.due" }

function replay(events: readonly ServerHealthEvent[], state: ServerHealthState = createServerHealthState()) {
  return events.reduce<{ state: ServerHealthState; effects: ServerHealthEffect[] }>(
    (result, event) => {
      const next = transitionServerHealth(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

const health = (state: ServerHealthState, name: string) => selectServerHealthRecord(state)[key(name)]

const probes = (effects: readonly ServerHealthEffect[]) =>
  effects.flatMap((effect) => (effect.type === "probe" ? [`${effect.key} #${effect.attempt}`] : []))

const notified = (effects: readonly ServerHealthEffect[]) => effects.filter((effect) => effect.type === "notify.probe")

test("a slow server's answer never reverts a faster server's newer answer", () => {
  const start = replay([synced(endpoint("fast"), endpoint("slow")), answered("fast", 1, { type: "unreachable" })])

  // The poll comes due while the slow probe still runs: only the idle server probes again.
  const polled = transitionServerHealth(start.state, poll)
  expect(probes(polled.effects)).toEqual(["http://fast #2"])

  const end = replay(
    [answered("fast", 2, { type: "healthy" }), answered("slow", 1, { type: "unreachable" })],
    polled.state,
  )

  expect(health(end.state, "fast")).toEqual({ type: "healthy" })
  expect(health(end.state, "slow")).toEqual({ type: "unreachable" })
})

test("a probe that a retry replaced never reaches the listener", () => {
  const retried = replay([synced(endpoint("s", "pw1")), { type: "retry.requested", resolve: () => {} }])
  const current = transitionServerHealth(retried.state, answered("s", 2, { type: "healthy" }))
  expect(notified(current.effects)).toEqual([
    { type: "notify.probe", probe: { key: key("s"), auth: "http://s\npw1", result: { type: "healthy" } } },
  ])

  // The replaced probe answers 401 late: it neither signs the server out nor changes its health.
  const late = transitionServerHealth(current.state, answered("s", 1, { type: "unauthorized" }))
  expect(late).toEqual({ state: current.state, effects: [] })
  expect(health(late.state, "s")).toEqual({ type: "healthy" })
})

test.each([
  { name: "disposed", event: { type: "disposed" } as const },
  { name: "unlisted", event: synced() },
  { name: "moved to a new endpoint", event: synced(endpoint("s", "pw2")) },
  { name: "waiting for its plugin", event: synced(staged("s", "auth")) },
])("a probe of a server that was $name never reaches the listener", (input) => {
  const left = replay([synced(endpoint("s", "pw1")), input.event])
  const late = transitionServerHealth(left.state, answered("s", 1, { type: "unauthorized" }))

  expect(late).toEqual({ state: left.state, effects: [] })
})

test("a check in flight does not read as a failed server", () => {
  const moved = replay([synced(endpoint("tunnel", undefined, true), endpoint("plain"))]).state
  const tunnel = health(moved, "tunnel")
  const plain = health(moved, "plain")

  expect(tunnel).toEqual({ type: "checking", managed: true })
  expect(plain).toEqual({ type: "checking", managed: false })
  ;[tunnel, plain].forEach((value) => {
    expect(canUseServer(value)).toBe(true)
    expect(isServerFailed(value)).toBe(false)
    expect(selectServerHealthRank(value)).toBe(1)
  })
  expect(selectServerIndicator(tunnel)).toBe("connecting")
  expect(selectServerIndicator(plain)).toBe("unknown")
})

test("a contributed server that is not ready reports its stage and is never probed", () => {
  const stages = ["stopped", "starting", "auth", "failed", "incompatible"] as const

  const expected: ServerHealth[] = [
    { type: "stopped" },
    { type: "starting" },
    { type: "auth" },
    { type: "unreachable" },
    { type: "incompatible" },
  ]

  const seen = stages.map((stage, index) => {
    const result = replay(stages.slice(0, index + 1).map((item) => synced(staged("ssh", item))))

    expect(probes(result.effects)).toEqual([])

    return health(result.state, "ssh")
  })

  expect(seen).toEqual(expected)
  // The inbox stops waiting for a server that cannot answer yet.
  seen.forEach((value) => expect(canUseServer(value)).toBe(false))
  expect(seen.map(selectServerIndicator)).toEqual(["unknown", "connecting", "auth", "unreachable", "incompatible"])
})

test("a background poll keeps the last answer until the next one arrives", () => {
  const known = replay([synced(endpoint("s")), answered("s", 1, { type: "healthy", version: "2.0.0" })]).state
  const polled = transitionServerHealth(known, poll)

  expect(probes(polled.effects)).toEqual(["http://s #2"])
  expect(health(polled.state, "s")).toEqual({ type: "healthy", version: "2.0.0" })
  // A probe already in flight is not started again.
  expect(transitionServerHealth(polled.state, poll)).toEqual({ state: polled.state, effects: [] })
})

test("a server joining the list leaves the probe of an unchanged one running", () => {
  const first = replay([synced(endpoint("a"))])
  const joined = transitionServerHealth(first.state, synced(endpoint("a"), endpoint("b")))

  expect(probes(joined.effects)).toEqual(["http://b #1"])
  expect(health(transitionServerHealth(joined.state, answered("a", 1, { type: "healthy" })).state, "a")).toEqual({
    type: "healthy",
  })
})

test("the poll runs only while a server has an endpoint", () => {
  const listed = replay([synced(staged("ssh", "auth"))])
  expect(listed.effects).toEqual([])

  const ready = transitionServerHealth(listed.state, synced(endpoint("ssh")))
  expect(ready.effects).toContainEqual({ type: "timer.start", intervalMs: SERVER_HEALTH_POLL_MS })

  expect(transitionServerHealth(ready.state, synced()).effects).toEqual([{ type: "timer.stop" }])
})

test("retry probes every server again and resolves once each answers", () => {
  const log: string[] = []
  const resolve = () => log.push("resolved")

  const start = replay([
    synced(endpoint("a"), endpoint("b"), staged("ssh", "auth")),
    answered("a", 1, { type: "unreachable" }),
  ])

  const retried = transitionServerHealth(start.state, { type: "retry.requested", resolve })
  expect(probes(retried.effects)).toEqual(["http://a #2", "http://b #2"])
  expect(retried.effects).toContainEqual({ type: "timer.start", intervalMs: SERVER_HEALTH_POLL_MS })

  // The probe the retry replaced answers first: the caller keeps waiting.
  const stale = transitionServerHealth(retried.state, answered("b", 1, { type: "healthy" }))
  expect(stale.state).toBe(retried.state)

  const partial = transitionServerHealth(retried.state, answered("a", 2, { type: "healthy" }))
  expect(partial.effects).not.toContainEqual(expect.objectContaining({ type: "waiters.resolve" }))

  const done = transitionServerHealth(partial.state, answered("b", 2, { type: "healthy" }))
  done.effects.forEach((effect) => effect.type === "waiters.resolve" && effect.resolvers.forEach((run) => run()))
  expect(log).toEqual(["resolved"])
  expect(done.state.waiters).toEqual([])
})

test.each([
  { name: "is unlisted", event: synced(endpoint("a")) },
  { name: "waits for its plugin", event: synced(endpoint("a"), staged("b", "starting")) },
  { name: "is disposed", event: { type: "disposed" } as const },
])("retry resolves when the server it waits for $name", (input) => {
  const retried = replay([synced(endpoint("a"), endpoint("b")), answered("a", 1, { type: "healthy" })])

  const waiting = replay(
    [{ type: "retry.requested", resolve: () => {} }, answered("a", 2, { type: "healthy" })],
    retried.state,
  )

  expect(waiting.state.waiters).toHaveLength(1)

  const result = transitionServerHealth(waiting.state, input.event)
  expect(result.effects).toContainEqual(expect.objectContaining({ type: "waiters.resolve" }))
  expect(result.state.waiters).toEqual([])
})

test("retry with no server to probe resolves at once", () => {
  const resolve = () => {}

  expect(
    transitionServerHealth(replay([synced(staged("ssh", "auth"))]).state, { type: "retry.requested", resolve }).effects,
  ).toEqual([{ type: "waiters.resolve", resolvers: [resolve] }])
})
