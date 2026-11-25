import { describe, expect, test } from "bun:test"
import { storeName } from "@/runtime/plugin/stores"
import { ServerKey } from "@/runtime/server/persistence"
import { ServerScope } from "@/runtime/server/scope"
import { Persist } from "./storage"
import {
  DEFAULT_PREFERENCES,
  GLOBAL_PREFERENCES,
  INITIAL_SERVER_PREFERENCES_STATE,
  selectMirrorServer,
  syncsPreference,
  transitionServerPreferences,
  type ServerPreferencesEvent,
  type ServerPreferencesState,
  type ServerPreferencesTransition,
} from "./server-preferences-machine"

const server = { url: "http://127.0.0.1:4096", password: "old" }

function replay(events: ServerPreferencesEvent[], from = INITIAL_SERVER_PREFERENCES_STATE) {
  return events.reduce<ServerPreferencesTransition[]>((steps, event) => {
    steps.push(transitionServerPreferences(steps.at(-1)?.state ?? from, event))

    return steps
  }, [])
}

function settle(events: ServerPreferencesEvent[], from = INITIAL_SERVER_PREFERENCES_STATE) {
  return replay(events, from).at(-1)?.state ?? from
}

const empty = { [GLOBAL_PREFERENCES]: {}, [DEFAULT_PREFERENCES]: {} }

const mirroring = settle([
  { type: "hydrate.started", server },
  { type: "hydrate.succeeded", stored: empty, local: empty },
])

// The server refused the password the page started with.
const signedOut = settle([
  { type: "hydrate.started", server },
  { type: "hydrate.failed", unauthorized: true },
])

describe("syncsPreference", () => {
  // On the web the server that serves the app is the local one, so its server-scoped keys carry no scope.
  const served = ServerKey.make(server.url)
  const local = ServerScope.fromServerKey(served, served)
  const remote = ServerScope.fromServerKey(ServerKey.make("https://remote.example"), served)

  test.each<[{ readonly storage?: string; readonly key: string }, boolean]>([
    [Persist.global("language"), true],
    [{ key: "settings.v3" }, true],
    [{ key: "opencode-theme-id" }, true],
    [{ key: "opencode-color-scheme" }, true],
    // The server list holds passwords and this browser's connections.
    [Persist.global("server"), false],
    [{ key: "server.v3" }, false],
    // Layout holds the tabs, scroll positions and closed tabs of sessions on every server.
    [Persist.global("layout"), false],
    [{ key: "layout.v6" }, false],
    [Persist.global("model"), false],
    [Persist.global("tips.queue"), false],
    [Persist.global("free-limit"), false],
    [Persist.global("navigation.list-snapshot"), false],
    // Data kept for each server, the serving one or another, and plugin stores.
    [Persist.serverGlobal(local, "settings-v2.models.providers"), false],
    [Persist.serverGlobal(remote, "notification"), false],
    [Persist.global(storeName("review", "diff")), false],
    [Persist.serverGlobal(remote, storeName("review", "diff")), false],
    [{ key: "opencode-theme-css-dark" }, false],
    [{ storage: "opencode.window.browser.dat", key: "tabs" }, false],
    [Persist.workspace("/home/user/app", "layout"), false],
  ])("%j syncs: %p", (target, synced) => {
    // A write without a storage goes to the default namespace, as `recordPreference` records it.
    expect(syncsPreference(target.storage ?? DEFAULT_PREFERENCES, target.key)).toBe(synced)
  })
})

describe("transitionServerPreferences", () => {
  test("before the first render the server's values win, keys only this browser holds are sent, and none is deleted", () => {
    const steps = replay([
      { type: "hydrate.started", server },
      {
        type: "hydrate.succeeded",
        stored: {
          // Keys off the list, such as the server list, never come from the server.
          [GLOBAL_PREFERENCES]: { language: '{"locale":"de"}', server: '{"list":[]}', layout: '{"sidebar":{}}' },
          [DEFAULT_PREFERENCES]: { "settings.v3": '{"general":{}}', "opencode-color-scheme": "dark" },
        },
        local: {
          [GLOBAL_PREFERENCES]: { language: '{"locale":"en"}' },
          [DEFAULT_PREFERENCES]: { "opencode-theme-id": "nord", "opencode-color-scheme": "dark" },
        },
      },
    ])

    expect(steps.map((step) => step.effects)).toEqual([
      [{ type: "load", server }],
      [
        {
          type: "store",
          changes: [
            { name: GLOBAL_PREFERENCES, key: "language", value: '{"locale":"de"}' },
            { name: DEFAULT_PREFERENCES, key: "settings.v3", value: '{"general":{}}' },
          ],
        },
        { type: "send", changes: [{ name: DEFAULT_PREFERENCES, key: "opencode-theme-id", value: "nord" }] },
      ],
    ])
    expect(steps.at(-1)?.state).toEqual({ status: "mirroring", server })
  })

  test("a sign-in that finds the server's values differ stores them and reloads instead of mirroring", () => {
    const steps = replay(
      [
        { type: "signed-in", password: "new" },
        {
          type: "hydrate.succeeded",
          stored: { [GLOBAL_PREFERENCES]: { language: '{"locale":"de"}' }, [DEFAULT_PREFERENCES]: {} },
          local: { [GLOBAL_PREFERENCES]: {}, [DEFAULT_PREFERENCES]: { "opencode-theme-id": "nord" } },
        },
      ],
      signedOut,
    )

    expect(steps.map((step) => step.effects)).toEqual([
      [{ type: "load", server: { url: server.url, password: "new" } }],
      [
        { type: "store", changes: [{ name: GLOBAL_PREFERENCES, key: "language", value: '{"locale":"de"}' }] },
        { type: "reload" },
      ],
    ])
    expect(steps.at(-1)?.state).toBe(INITIAL_SERVER_PREFERENCES_STATE)
  })

  test("a sign-in that finds the server's values match mirrors without a reload", () => {
    const steps = replay(
      [
        { type: "signed-in", password: "new" },
        {
          type: "hydrate.succeeded",
          stored: { [GLOBAL_PREFERENCES]: { language: '{"locale":"de"}' }, [DEFAULT_PREFERENCES]: {} },
          local: {
            [GLOBAL_PREFERENCES]: { language: '{"locale":"de"}' },
            [DEFAULT_PREFERENCES]: { "opencode-theme-id": "nord" },
          },
        },
      ],
      signedOut,
    )

    expect(steps.at(-1)?.effects).toEqual([
      { type: "send", changes: [{ name: DEFAULT_PREFERENCES, key: "opencode-theme-id", value: "nord" }] },
    ])
    expect(steps.at(-1)?.state).toEqual({ status: "mirroring", server: { url: server.url, password: "new" } })
  })

  test("only a mirroring page sends its writes", () => {
    const change = { name: GLOBAL_PREFERENCES, key: "language", value: null }

    const states: ServerPreferencesState[] = [
      INITIAL_SERVER_PREFERENCES_STATE,
      settle([{ type: "hydrate.started", server }]),
      signedOut,
      mirroring,
    ]

    expect(states.map((state) => transitionServerPreferences(state, { type: "written", change }))).toEqual([
      { state: states[0], effects: [] },
      { state: states[1], effects: [] },
      { state: states[2], effects: [] },
      { state: mirroring, effects: [{ type: "send", changes: [change] }] },
    ])
  })

  test("a refused password waits for a sign-in with another one, which loads again", () => {
    expect(signedOut).toEqual({ status: "signed-out", server })
    expect(transitionServerPreferences(signedOut, { type: "signed-in", password: "old" }).state).toBe(signedOut)
    expect(transitionServerPreferences(signedOut, { type: "signed-in", password: undefined })).toEqual({
      state: { status: "hydrating", server: { url: server.url, password: undefined }, mounted: true },
      effects: [{ type: "load", server: { url: server.url, password: undefined } }],
    })
  })

  test("a server that cannot keep preferences leaves the page local, and a later sign-in changes nothing", () => {
    const local = settle([
      { type: "hydrate.started", server },
      { type: "hydrate.failed", unauthorized: false },
    ])

    expect(local).toBe(INITIAL_SERVER_PREFERENCES_STATE)
    expect(transitionServerPreferences(local, { type: "signed-in", password: "new" }).state).toBe(local)
  })

  test("a new password while mirroring becomes the one writes and retries use", () => {
    const next = transitionServerPreferences(mirroring, { type: "signed-in", password: "new" })

    expect(next).toEqual({ state: { status: "mirroring", server: { url: server.url, password: "new" } }, effects: [] })
    expect(selectMirrorServer(next.state)).toEqual({ url: server.url, password: "new" })
    expect(transitionServerPreferences(mirroring, { type: "signed-in", password: "old" }).state).toBe(mirroring)
  })

  test("events that do not apply return the same state", () => {
    const hydrating = settle([{ type: "hydrate.started", server }])

    const cases: [ServerPreferencesState, ServerPreferencesEvent][] = [
      [INITIAL_SERVER_PREFERENCES_STATE, { type: "hydrate.succeeded", stored: empty, local: empty }],
      [INITIAL_SERVER_PREFERENCES_STATE, { type: "hydrate.failed", unauthorized: true }],
      [INITIAL_SERVER_PREFERENCES_STATE, { type: "signed-in", password: "new" }],
      [hydrating, { type: "hydrate.started", server }],
      [hydrating, { type: "signed-in", password: "new" }],
      [signedOut, { type: "hydrate.started", server }],
      [signedOut, { type: "hydrate.failed", unauthorized: false }],
      [mirroring, { type: "hydrate.started", server }],
      [mirroring, { type: "hydrate.succeeded", stored: empty, local: empty }],
    ]

    cases.forEach(([state, event]) => {
      const next = transitionServerPreferences(state, event)

      expect(next.state).toBe(state)
      expect(next.effects).toEqual([])
    })
  })
})
