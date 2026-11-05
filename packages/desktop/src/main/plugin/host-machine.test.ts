import { describe, expect, test } from "bun:test"
import {
  createHostState,
  transitionHost,
  type HostCommand,
  type HostEndpoint,
  type HostEvent,
  type HostState,
} from "./host-machine"

const a: HostEndpoint = { url: "http://127.0.0.1:4096", authorization: "Basic a" }

const b: HostEndpoint = { url: "http://127.0.0.1:4097", authorization: "Basic b" }

// Folds events through the machine and keeps the commands of each step.
function replay(events: readonly HostEvent<string>[], from: HostState = createHostState()) {
  return events.reduce<{ state: HostState; commands: (readonly HostCommand<string>[])[] }>(
    (result, event) => {
      const next = transitionHost(result.state, event)

      return { state: next.state, commands: [...result.commands, next.commands] }
    },
    { state: from, commands: [] },
  )
}

const live = { quitting: false }

describe("plugin host follow", () => {
  test("never applies a listing from an endpoint the server already left", () => {
    const run = replay([
      { type: "started", endpoint: a, ...live },
      { type: "relist.requested", watchAttempt: 1, ...live },
      { type: "endpoint.changed", endpoint: b, ...live },
      // On dev endpoint A's listing finished later and reloaded plugins against the old server.
      { type: "list.succeeded", attempt: 2, listing: "from a", ...live },
    ])

    expect(run.commands).toEqual([
      [{ type: "subscribe-credentials" }, { type: "start-watch", attempt: 1, endpoint: a }],
      [{ type: "start-list", attempt: 2, endpoint: a, timeoutMs: 30_000 }],
      [{ type: "cancel-watch" }, { type: "cancel-list" }, { type: "start-watch", attempt: 3, endpoint: b }],
      [],
    ])
  })

  test("coalesces changes during a listing into one more listing", () => {
    const listing = replay([
      { type: "started", endpoint: a, ...live },
      { type: "relist.requested", watchAttempt: 1, ...live },
      { type: "relist.requested", watchAttempt: 1, ...live },
    ]).state

    expect(transitionHost(listing, { type: "relist.requested", watchAttempt: 1, ...live }).state).toBe(listing)

    const ends: HostEvent<string>[] = [
      { type: "list.succeeded", attempt: 2, listing: "plugins", ...live },
      { type: "list.failed", attempt: 2, cause: "offline", ...live },
      { type: "list.timed-out", attempt: 2, ...live },
    ]

    expect(ends.map((event) => transitionHost(listing, event).commands)).toEqual([
      [
        { type: "apply-listing", listing: "plugins" },
        { type: "start-list", attempt: 3, endpoint: a, timeoutMs: 30_000 },
      ],
      [
        { type: "log-list-error", cause: "offline" },
        { type: "start-list", attempt: 3, endpoint: a, timeoutMs: 30_000 },
      ],
      [
        { type: "cancel-list" },
        { type: "log-list-error", cause: expect.any(Error) },
        { type: "start-list", attempt: 3, endpoint: a, timeoutMs: 30_000 },
      ],
    ])
  })

  test("retries an ended stream after a pause and ignores events from the old one", () => {
    const run = replay([
      { type: "started", endpoint: a, ...live },
      { type: "watch.ended", attempt: 1, ...live },
      { type: "relist.requested", watchAttempt: 1, ...live },
      { type: "watch.retry-due", attempt: 2, ...live },
    ])

    expect(run.commands.slice(1)).toEqual([
      [{ type: "schedule-watch-retry", attempt: 2, delayMs: 1_000 }],
      [],
      [{ type: "start-watch", attempt: 3, endpoint: a }],
    ])
  })

  test("a reconnect on the same endpoint follows anew and keeps the running listing", () => {
    const run = replay([
      { type: "started", endpoint: a, ...live },
      { type: "relist.requested", watchAttempt: 1, ...live },
      { type: "endpoint.changed", endpoint: { ...a }, ...live },
      { type: "list.succeeded", attempt: 2, listing: "plugins", ...live },
    ])

    expect(run.commands.slice(2)).toEqual([
      [{ type: "cancel-watch" }, { type: "start-watch", attempt: 3, endpoint: a }],
      [{ type: "apply-listing", listing: "plugins" }],
    ])
  })

  test("stops following on stop and starts again on resume", () => {
    const run = replay([
      { type: "started", endpoint: a, ...live },
      { type: "relist.requested", watchAttempt: 1, ...live },
      { type: "stopped" },
      { type: "list.succeeded", attempt: 2, listing: "late", ...live },
      { type: "resumed", endpoint: a, ...live },
    ])

    expect(run.commands.slice(2)).toEqual([
      [{ type: "unsubscribe-credentials" }, { type: "cancel-watch" }, { type: "cancel-list" }],
      [],
      [{ type: "queue-menubar" }, { type: "subscribe-credentials" }, { type: "start-watch", attempt: 3, endpoint: a }],
    ])
  })
})

describe("plugin host menubar", () => {
  test("publishes once per queued flush and keeps the menu while quitting", () => {
    const run = replay([
      { type: "menubar.scheduled" },
      { type: "menubar.scheduled" },
      { type: "menubar.flushed", quitting: false },
      { type: "menubar.scheduled" },
      { type: "menubar.flushed", quitting: true },
      { type: "menubar.flushed", quitting: false },
    ])

    expect(run.commands).toEqual([[{ type: "queue-menubar" }], [], [{ type: "publish-menubar" }], [{ type: "queue-menubar" }], [], []])
  })

  test("does not start following while the app quits, and drops a listing that lands during the quit", () => {
    const stopped = createHostState()

    expect(transitionHost(stopped, { type: "started", endpoint: a, quitting: true }).state).toBe(stopped)

    const listing = replay([
      { type: "started", endpoint: a, ...live },
      { type: "relist.requested", watchAttempt: 1, ...live },
    ]).state

    expect(
      transitionHost(listing, { type: "list.succeeded", attempt: 2, listing: "plugins", quitting: true }).commands,
    ).toEqual([])
  })
})
