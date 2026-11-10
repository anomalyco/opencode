import { describe, expect, test } from "bun:test"
import {
  CATALOG_TIMEOUT_MS,
  createHostState,
  selectCatalogMessages,
  transitionHost,
  type HostCommand,
  type HostEndpoint,
  type HostEvent,
  type HostState,
} from "./host-machine"

const a: HostEndpoint = { url: "http://127.0.0.1:4096", authorization: "Basic a" }

const b: HostEndpoint = { url: "http://127.0.0.1:4097", authorization: "Basic b" }

// Folds events through the machine and keeps the commands of each step.
function replay(events: readonly HostEvent<string, string>[], from: HostState<string> = createHostState("en")) {
  return events.reduce<{ state: HostState<string>; commands: (readonly HostCommand<string, string>[])[] }>(
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

    expect(run.commands).toEqual([
      [{ type: "queue-menubar" }],
      [],
      [{ type: "publish-menubar" }],
      [{ type: "queue-menubar" }],
      [],
      [],
    ])
  })

  test("does not start following while the app quits, and drops a listing that lands during the quit", () => {
    const stopped = createHostState("en")

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

const de = () => Promise.resolve({ default: { greeting: "Hallo" } })

const fr = () => Promise.resolve({ default: { greeting: "Bonjour" } })

// A built-in's catalog: English inline, the other locales loaded when the user picks them.
const catalog = { en: { greeting: "Hello", farewell: "Bye" }, de, fr }

const reply = () => {}

const registered: HostEvent<string, string> = { type: "catalog.registered", owner: "plugin", catalog, reply }

const load = (attempt: number, loader: typeof de): HostCommand<string, string> => ({
  type: "load-catalog",
  owner: "plugin",
  attempt,
  load: loader,
  timeoutMs: CATALOG_TIMEOUT_MS,
})

const cancelTimer: HostCommand<string, string> = { type: "cancel-catalog-timer", owner: "plugin" }

const ready: HostCommand<string, string> = { type: "resolve-catalog-ready", replies: [reply] }

const queue: HostCommand<string, string> = { type: "queue-menubar" }

describe("plugin host catalogs", () => {
  test("keeps the locale the user switched to while a plugin's first locale still loads", () => {
    const run = replay(
      [
        registered,
        { type: "locale.changed", locale: "en" },
        // On dev the first load's late answer overwrote the English the switch had already applied.
        { type: "catalog.loaded", owner: "plugin", attempt: 1, messages: { greeting: "Hallo" } },
      ],
      createHostState("de"),
    )

    expect(run.commands).toEqual([[load(1, de)], [cancelTimer, ready, queue], []])
    expect(selectCatalogMessages(run.state, "plugin")).toEqual(catalog.en)
  })

  test("applies only the newest locale and publishes the menubar once it loaded", () => {
    const running = replay([registered]).state

    const run = replay(
      [
        { type: "locale.changed", locale: "de" },
        { type: "locale.changed", locale: "fr" },
        // On dev a superseded load still rebuilt the menubar after the newer one settled.
        { type: "catalog.loaded", owner: "plugin", attempt: 1, messages: { greeting: "Hallo" } },
        { type: "catalog.loaded", owner: "plugin", attempt: 2, messages: { greeting: "Bonjour" } },
      ],
      running,
    )

    expect(run.commands).toEqual([[load(1, de)], [load(2, fr)], [], [cancelTimer, queue]])
    expect(selectCatalogMessages(run.state, "plugin")).toEqual({ greeting: "Bonjour", farewell: "Bye" })
  })

  test("ignores the first load when the locale switches away and back", () => {
    const run = replay([
      registered,
      { type: "locale.changed", locale: "de" },
      { type: "locale.changed", locale: "fr" },
      { type: "locale.changed", locale: "de" },
      { type: "catalog.loaded", owner: "plugin", attempt: 1, messages: { greeting: "stale" } },
      { type: "catalog.loaded", owner: "plugin", attempt: 3, messages: { greeting: "Hallo" } },
    ])

    expect(run.commands.slice(-2)).toEqual([[], [cancelTimer, queue]])
    expect(selectCatalogMessages(run.state, "plugin").greeting).toBe("Hallo")
  })

  test.each([
    ["fails", { type: "catalog.failed", owner: "plugin", attempt: 1 }],
    ["hangs", { type: "catalog.timed-out", owner: "plugin", attempt: 1 }],
  ] satisfies [string, HostEvent<string, string>][])(
    "runs setup in English when a plugin's first locale %s",
    (_name, event) => {
      // On dev a loader that never settled held the plugin's setup forever.
      const run = replay([registered, event], createHostState("de"))

      expect(run.commands.at(-1)).toEqual([cancelTimer, ready])
      expect(selectCatalogMessages(run.state, "plugin")).toEqual(catalog.en)
    },
  )

  test("keeps a running plugin's copy until its locale loads, and falls back to English when it fails", () => {
    const loading = replay([registered, { type: "locale.changed", locale: "de" }]).state
    const failed = transitionHost(loading, { type: "catalog.failed", owner: "plugin", attempt: 1 })

    expect(selectCatalogMessages(loading, "plugin")).toEqual(catalog.en)
    expect(failed.commands).toEqual([cancelTimer, queue])
    expect(selectCatalogMessages(failed.state, "plugin")).toEqual(catalog.en)
  })

  test("lets setup go and drops a late load when the plugin stops while its locale loads", () => {
    const run = replay(
      [
        registered,
        { type: "catalog.unregistered", owner: "plugin" },
        { type: "catalog.loaded", owner: "plugin", attempt: 1, messages: { greeting: "Hallo" } },
      ],
      createHostState("de"),
    )

    expect(run.commands.slice(1)).toEqual([[cancelTimer, ready], []])
    expect(run.state.catalogs.size).toBe(0)
  })

  test("keeps catalogs across a stop of the server follow", () => {
    const run = replay([registered, { type: "started", endpoint: a, ...live }, { type: "stopped" }])

    expect(selectCatalogMessages(run.state, "plugin")).toEqual(catalog.en)
    expect(run.state.locale).toBe("en")
  })
})
