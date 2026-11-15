import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { SshStart, type SshConfig } from "./contract"
import {
  createSshMainState,
  selectSshServers,
  SSH_RETRY_DELAY_MS,
  SSH_RETRY_LIMIT,
  transitionSshMain,
  type SshMainEffect,
  type SshMainEvent,
  type SshMainState,
} from "./main-machine"

const box: SshConfig = { id: "box", target: "ssh box", name: "Box" }

const http = { url: "http://127.0.0.1:4100", password: "secret" }

const prompt = { id: "password", text: "box's password:", confirm: false }

// Windows call `start` through the Ipc, whose input main decodes.
const start = (input: typeof SshStart.Encoded, owner?: number): SshMainEvent => ({
  type: "start",
  request: Schema.decodeUnknownSync(SshStart)(input),
  owner,
})

function replay(state: SshMainState, events: readonly SshMainEvent[]) {
  return events.reduce<{ state: SshMainState; effects: SshMainEffect[] }>(
    (result, event) => {
      const next = transitionSshMain(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

function item(state: SshMainState, viewer?: number) {
  return selectSshServers(state, viewer).find((item) => item.config.id === box.id)
}

/** A saved server, ready on attempt 1 after a background restore. */
function ready() {
  return replay(createSshMainState([box]), [
    start({ ...box, background: true }),
    { type: "attempt.ready", id: box.id, attempt: 1, http },
  ]).state
}

describe("ssh main connection", () => {
  test("an endpoint never outlives the ready tunnel it belongs to", () => {
    const dropped = replay(ready(), [
      { type: "attempt.failed", id: box.id, attempt: 1, code: "connection", detail: "closed" },
    ]).state

    expect(item(dropped)).toMatchObject({ stage: "failed", retrying: true })
    expect(item(dropped)?.http).toBeUndefined()

    const restarted = replay(ready(), [start(box, 1)]).state
    expect(item(restarted, 1)).toMatchObject({ stage: "connecting" })
    expect(item(restarted, 1)?.http).toBeUndefined()

    const cancelled = replay(restarted, [{ type: "cancel", id: box.id, owner: 1 }]).state
    expect(item(cancelled, 1)).toMatchObject({ stage: "disconnected" })
    expect(item(cancelled, 1)?.http).toBeUndefined()
  })

  test("only the window that started an attempt sees its prompt", () => {
    const prompted = replay(createSshMainState([box]), [
      start(box, 1),
      { type: "prompt.received", id: box.id, attempt: 1, prompt },
    ]).state

    expect(item(prompted, 1)).toMatchObject({ stage: "authentication", prompt, authenticatingElsewhere: false })
    expect(item(prompted, 2)).toMatchObject({ stage: "authentication", authenticatingElsewhere: true })
    expect(item(prompted, 2)?.prompt).toBeUndefined()
  })

  test("closing the window that was adding a server removes the server and stops its attempt", () => {
    const added = replay(createSshMainState([]), [
      start({ id: "new", target: " ssh devbox ", name: "" }, 7),
      { type: "prompt.received", id: "new", attempt: 1, prompt },
    ]).state

    expect(selectSshServers(added, 7)).toHaveLength(1)

    const detached = transitionSshMain(added, { type: "window.detached", owner: 7 })
    expect(selectSshServers(detached.state)).toEqual([])
    expect(detached.effects).toEqual([{ type: "attempt.stop", attempt: 1 }])
  })

  test("cancelling restores where a saved server was and ignores its cancelled attempt", () => {
    const failed = replay(createSshMainState([box]), [
      start({ ...box, background: true }),
      { type: "attempt.failed", id: box.id, attempt: 1, code: "service", detail: "Permission denied" },
    ]).state

    const edited = replay(failed, [
      start(box, 1),
      { type: "destination.resolved", id: box.id, attempt: 2, destination: "me@box:22" },
      { type: "prompt.received", id: box.id, attempt: 2, prompt },
      { type: "cancel", id: box.id, owner: 1 },
    ])

    expect(item(edited.state, 1)).toMatchObject({
      config: box,
      saved: true,
      destination: "me@box:22",
      stage: "failed",
      error: "service",
      detail: "Permission denied",
    })
    expect(item(edited.state, 1)?.prompt).toBeUndefined()
    expect(item(edited.state, 1)?.retrying).toBeUndefined()
    expect(edited.effects).toContainEqual({ type: "attempt.stop", attempt: 2 })
    // The cancelled attempt's askpass cleanup clears its prompt after the restore.

    const late = transitionSshMain(edited.state, {
      type: "prompt.cleared",
      id: box.id,
      attempt: 2,
      promptID: prompt.id,
    })

    expect(late.state).toBe(edited.state)
  })

  test("results of a superseded attempt change nothing", () => {
    const superseded = replay(createSshMainState([box]), [start(box, 1), start(box, 1)])
    expect(superseded.effects).toContainEqual({ type: "attempt.stop", attempt: 1 })

    const stale: SshMainEvent[] = [
      { type: "destination.resolved", id: box.id, attempt: 1, destination: "me@box:22" },
      { type: "prompt.received", id: box.id, attempt: 1, prompt },
      { type: "attempt.ready", id: box.id, attempt: 1, http },
      { type: "attempt.failed", id: box.id, attempt: 1, code: "connection", detail: "" },
    ]

    stale.forEach((event) => expect(transitionSshMain(superseded.state, event).state).toBe(superseded.state))
  })

  test("another window cannot replace an attempt its owner is answering", () => {
    const prompted = replay(createSshMainState([box]), [
      start(box, 1),
      { type: "prompt.received", id: box.id, attempt: 1, prompt },
    ]).state

    expect(transitionSshMain(prompted, start(box, 2)).state).toBe(prompted)
    expect(transitionSshMain(prompted, start({ ...box, background: true })).state).toBe(prompted)
  })
})

describe("ssh reconnect budget", () => {
  test("main reconnects a dropped tunnel by itself until the budget runs out", () => {
    const waiting = replay(ready(), [
      { type: "attempt.failed", id: box.id, attempt: 1, code: "connection", detail: "closed" },
      { type: "resolve.requested", id: box.id, waiter: 1 },
    ])

    expect(waiting.effects).toEqual([{ type: "retry.schedule", id: box.id, attempt: 2, delayMs: SSH_RETRY_DELAY_MS }])

    const exhausted = Array.from({ length: SSH_RETRY_LIMIT - 1 }).reduce<{
      state: SshMainState
      effects: SshMainEffect[]
    }>(
      (result) => {
        const phase = result.state.servers[0]?.phase
        const retry = phase?.status === "failed" ? phase.retry : undefined

        if (!retry) throw new Error("expected a scheduled retry")

        const next = replay(result.state, [
          { type: "retry.due", id: box.id, attempt: retry.attempt },
          { type: "attempt.failed", id: box.id, attempt: retry.attempt + 1, code: "connection", detail: "refused" },
        ])

        return { state: next.state, effects: [...result.effects, ...next.effects] }
      },
      { state: waiting.state, effects: [] },
    )

    expect(item(exhausted.state)).toMatchObject({ stage: "failed", error: "connection" })
    expect(item(exhausted.state)?.retrying).toBeUndefined()
    expect(exhausted.effects.filter((effect) => effect.type === "attempt.start")).toHaveLength(SSH_RETRY_LIMIT - 1)
    expect(exhausted.effects.at(-1)).toEqual({ type: "waiters.resolve", waiters: [1], http: null })

    // The user asking again starts a new budget.
    const retried = replay(exhausted.state, [
      start(box, 1),
      { type: "attempt.failed", id: box.id, attempt: 10, code: "connection", detail: "refused" },
    ])

    expect(item(retried.state)).toMatchObject({ stage: "failed", retrying: true })
  })

  test("failures another try cannot fix wait for the user", () => {
    const failures: [string, SshMainEvent][] = [
      [
        "host key",
        { type: "attempt.failed", id: box.id, attempt: 2, code: "connection", detail: "Host key verification failed." },
      ],
      [
        "missing ssh",
        { type: "attempt.failed", id: box.id, attempt: 2, code: "connection", detail: "spawn ssh ENOENT" },
      ],
      [
        "rejected key",
        { type: "attempt.failed", id: box.id, attempt: 2, code: "service", detail: "Permission denied (publickey)" },
      ],
      ["version", { type: "attempt.failed", id: box.id, attempt: 2, code: "version", detail: "1.0.0" }],
      ["prompt", { type: "prompt.received", id: box.id, attempt: 2, prompt }],
    ]

    failures.forEach(([name, event]) => {
      const result = replay(ready(), [
        { type: "resolve.requested", id: box.id, waiter: 1 },
        { type: "health.probed", id: box.id, attempt: 1, waiter: 1, healthy: false },
        event,
      ])

      expect(item(result.state)?.retrying, name).toBeUndefined()
      expect(item(result.state)?.stage, name).not.toBe("connecting")
      expect(
        result.effects.filter((effect) => effect.type === "retry.schedule"),
        name,
      ).toEqual([])
      expect(result.effects.at(-1), name).toEqual({ type: "waiters.resolve", waiters: [1], http: null })
    })
  })

  test("a server that waits for the user answers resolve at once", () => {
    const signedOut = replay(ready(), [
      { type: "attempt.failed", id: box.id, attempt: 1, code: "connection", detail: "closed" },
      { type: "retry.due", id: box.id, attempt: 2 },
      { type: "prompt.received", id: box.id, attempt: 3, prompt },
    ]).state

    expect(item(signedOut)?.stage).toBe("authentication")

    const resolved = transitionSshMain(signedOut, { type: "resolve.requested", id: box.id, waiter: 4 })
    expect(resolved.effects).toEqual([{ type: "waiters.resolve", waiters: [4], http: null }])
  })

  test("a stale unhealthy probe answers with the tunnel that replaced it instead of restarting it", () => {
    const probing = transitionSshMain(ready(), { type: "resolve.requested", id: box.id, waiter: 1 })
    expect(probing.effects).toEqual([{ type: "health.probe", id: box.id, attempt: 1, http, waiter: 1 }])

    const replaced = replay(probing.state, [
      start(box, 2),
      { type: "attempt.ready", id: box.id, attempt: 2, http: { ...http, password: "next" } },
    ])

    expect(replaced.effects).toContainEqual({
      type: "waiters.resolve",
      waiters: [1],
      http: { ...http, password: "next" },
    })

    const stale = transitionSshMain(replaced.state, {
      type: "health.probed",
      id: box.id,
      attempt: 1,
      waiter: 1,
      healthy: false,
    })

    expect(stale.state).toBe(replaced.state)
    expect(stale.effects).toEqual([])
  })

  test("an unhealthy tunnel restarts in the background and answers the waiter once ready", () => {
    const result = replay(ready(), [
      { type: "resolve.requested", id: box.id, waiter: 1 },
      { type: "health.probed", id: box.id, attempt: 1, waiter: 1, healthy: false },
      { type: "attempt.ready", id: box.id, attempt: 2, http },
    ])

    expect(result.effects).toEqual([
      { type: "health.probe", id: box.id, attempt: 1, http, waiter: 1 },
      { type: "attempt.stop", attempt: 1 },
      { type: "attempt.start", id: box.id, attempt: 2, config: box, replace: false },
      { type: "configs.save", configs: [box] },
      { type: "waiters.resolve", waiters: [1], http },
    ])
  })

  test("closing stops every connection and retry and answers every waiter", () => {
    const busy = replay(createSshMainState([box, { ...box, id: "two" }]), [
      start({ ...box, background: true }),
      { type: "resolve.requested", id: box.id, waiter: 1 },
      start({ ...box, id: "two", background: true }),
      { type: "attempt.failed", id: "two", attempt: 2, code: "connection", detail: "" },
    ]).state

    const closed = transitionSshMain(busy, { type: "close" })
    expect(closed.effects).toEqual([
      { type: "attempt.stop", attempt: 1 },
      { type: "retry.cancel", attempt: 3 },
      { type: "waiters.resolve", waiters: [1], http: null },
    ])
    expect(transitionSshMain(closed.state, start(box, 1)).state).toBe(closed.state)
    expect(transitionSshMain(closed.state, { type: "resolve.requested", id: box.id, waiter: 2 }).effects).toEqual([
      { type: "waiters.resolve", waiters: [2], http: null },
    ])
  })

  test("forgetting a saved server stops its retry and saves the rest", () => {
    const other = { ...box, id: "other" }

    const failed = replay(ready(), [
      { type: "attempt.failed", id: box.id, attempt: 1, code: "connection", detail: "" },
    ]).state

    const forgotten = transitionSshMain(
      {
        ...failed,
        servers: [
          ...failed.servers,
          { config: other, savedConfig: other, phase: { status: "disconnected" }, waiters: [] },
        ],
      },
      {
        type: "forget",
        id: box.id,
      },
    )

    expect(forgotten.effects).toEqual([
      { type: "retry.cancel", attempt: 2 },
      { type: "configs.save", configs: [other] },
    ])
    expect(selectSshServers(forgotten.state).map((item) => item.config.id)).toEqual(["other"])
  })
})
