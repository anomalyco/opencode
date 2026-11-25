import { describe, expect, test } from "bun:test"
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
  test.each([
    [GLOBAL_PREFERENCES, "language", true],
    [GLOBAL_PREFERENCES, "layout", true],
    [GLOBAL_PREFERENCES, "plugin.terminal.font", true],
    [DEFAULT_PREFERENCES, "settings.v3", true],
    [DEFAULT_PREFERENCES, "opencode-theme-id", true],
    [DEFAULT_PREFERENCES, "opencode-color-scheme", true],
    // The server list holds passwords and this browser's connections.
    [GLOBAL_PREFERENCES, "server", false],
    [DEFAULT_PREFERENCES, "server.v3", false],
    [DEFAULT_PREFERENCES, "layout.v6", false],
    [DEFAULT_PREFERENCES, "opencode-theme-css-dark", false],
    ["opencode.window.browser.dat", "tabs", false],
    ["opencode.workspace.C--Projects.1a2b.dat", "workspace:layout", false],
  ])("%s %s syncs: %p", (name, key, synced) => {
    expect(syncsPreference(name, key)).toBe(synced)
  })
})

describe("transitionServerPreferences", () => {
  test("before the first render the server's values win, keys only this browser holds are sent, and none is deleted", () => {
    const steps = replay([
      { type: "hydrate.started", server },
      {
        type: "hydrate.succeeded",
        stored: {
          [GLOBAL_PREFERENCES]: { language: '{"locale":"de"}', server: '{"list":[]}', layout: "{}" },
          [DEFAULT_PREFERENCES]: { "settings.v3": '{"general":{}}' },
        },
        local: {
          [GLOBAL_PREFERENCES]: { language: '{"locale":"en"}', layout: "{}", model: "{}" },
          [DEFAULT_PREFERENCES]: { "opencode-theme-id": "nord" },
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
        {
          type: "send",
          changes: [
            { name: GLOBAL_PREFERENCES, key: "model", value: "{}" },
            { name: DEFAULT_PREFERENCES, key: "opencode-theme-id", value: "nord" },
          ],
        },
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
          local: { [GLOBAL_PREFERENCES]: { model: "{}" }, [DEFAULT_PREFERENCES]: {} },
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
          local: { [GLOBAL_PREFERENCES]: { language: '{"locale":"de"}', model: "{}" }, [DEFAULT_PREFERENCES]: {} },
        },
      ],
      signedOut,
    )

    expect(steps.at(-1)?.effects).toEqual([
      { type: "send", changes: [{ name: GLOBAL_PREFERENCES, key: "model", value: "{}" }] },
    ])
    expect(steps.at(-1)?.state).toEqual({ status: "mirroring", server: { url: server.url, password: "new" } })
  })

  test("only a mirroring page sends its writes", () => {
    const change = { name: GLOBAL_PREFERENCES, key: "layout", value: null }

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
