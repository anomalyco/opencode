import { describe, expect, test } from "bun:test"
import { Scope } from "@opencode/plugin/gui/host"
import {
  initialState,
  isQuitting,
  keptScope,
  preventsQuit,
  quitsWhenAllWindowsClosed,
  restoresWindows,
  stopsForQuit,
  transition,
  type Event,
  type Reply,
  type State,
  type Transition,
} from "./machine"

const keep = Scope.make("updater", { timeout: 3_000, log: () => {} })

const reply = (): Reply => ({ resolve: () => {}, reject: () => {} })

const handoff = () => {}

/** Applies the events in order and returns the last state with every command they produced. */
const replay = (events: readonly Event[], from = initialState()) =>
  events.reduce<Transition>(
    (result, event) => {
      const next = transition(result.state, event)

      return { state: next.state, commands: [...result.commands, ...next.commands] }
    },
    { state: from, commands: [] },
  )

describe("app lifecycle machine", () => {
  test("a failed handoff starts the stopped plugins again before it rejects, and a retry stops them again", () => {
    const first = reply()
    const second = reply()
    const error = new Error("install failed")

    const steps: { event: Event; state: State["status"]; commands: unknown[]; quitting: boolean; kept?: Scope }[] = [
      {
        event: { type: "restart.requested", keep, handoff, reply: first },
        state: "suspending",
        commands: [{ type: "stop-plugins", attempt: 1 }],
        quitting: true,
        kept: keep,
      },
      {
        event: { type: "plugins.stopped", attempt: 1 },
        state: "handing-off",
        commands: [{ type: "run-handoff", attempt: 1, handoff }],
        quitting: true,
        kept: keep,
      },
      {
        event: { type: "handoff.failed", attempt: 1, error },
        state: "resuming",
        commands: [{ type: "resume-plugins", attempt: 1 }],
        quitting: false,
      },
      {
        event: { type: "plugins.resumed", attempt: 1 },
        state: "running",
        commands: [{ type: "reject", reply: first, reason: { kind: "failed", error } }],
        quitting: false,
      },
      {
        event: { type: "restart.requested", keep, handoff, reply: second },
        state: "suspending",
        commands: [{ type: "stop-plugins", attempt: 2 }],
        quitting: true,
        kept: keep,
      },
    ]

    steps.reduce((state, step) => {
      const next = transition(state, step.event)
      expect(next.state.status).toBe(step.state)
      expect(next.commands).toEqual(step.commands)
      expect(isQuitting(next.state)).toBe(step.quitting)
      expect(keptScope(next.state)).toBe(step.kept)

      return next.state
    }, initialState())
  })

  test.each([
    { name: "the handoff settles first (macOS)", events: ["handoff.succeeded", "before.quit"] },
    { name: "quitAndInstall quits first (Windows, Linux)", events: ["before.quit", "handoff.succeeded"] },
  ] as const)("a successful handoff lets the quit through when $name", (row) => {
    const caller = reply()

    const handingOff = replay([
      { type: "restart.requested", keep, handoff, reply: caller },
      { type: "plugins.stopped", attempt: 1 },
    ])

    const result = row.events.reduce<Transition>(
      (state, type) => {
        // Electron asks before it emits: the quit is never held while the handoff runs or after it succeeded.
        if (type === "before.quit") expect(preventsQuit(state.state)).toBe(false)
        const next = transition(state.state, type === "before.quit" ? { type } : { type, attempt: 1 })

        return { state: next.state, commands: [...state.commands, ...next.commands] }
      },
      { state: handingOff.state, commands: [] },
    )

    expect(result.state).toEqual({ status: "quitting" })
    expect(result.commands).toEqual([{ type: "resolve", reply: caller }])
    expect(transition(result.state, { type: "will.quit" }).commands).toEqual([])
  })

  test("a restart without a handoff relaunches once the other plugins stopped", () => {
    const caller = reply()

    const result = replay([
      { type: "restart.requested", keep, reply: caller },
      { type: "plugins.stopped", attempt: 1 },
    ])

    expect(result.state).toEqual({ status: "quitting" })
    expect(result.commands).toEqual([
      { type: "stop-plugins", attempt: 1 },
      { type: "resolve", reply: caller },
      { type: "exit", mode: "relaunch" },
    ])
  })

  test("a quit holds Electron until the plugins stopped, and a relaunch asked meanwhile still relaunches", () => {
    expect(preventsQuit(initialState())).toBe(true)

    const result = replay([
      { type: "before.quit" },
      { type: "exit.requested", mode: "relaunch" },
      { type: "exit.requested", mode: "quit" },
      { type: "before.quit" },
      { type: "plugins.stopped", attempt: 1 },
      { type: "will.quit" },
    ])

    expect(result.state).toEqual({ status: "quitting" })
    expect(result.commands).toEqual([
      { type: "stop-plugins", attempt: 1 },
      { type: "exit", mode: "relaunch" },
    ])
  })

  test("the first quit holds Electron while the user answers, then stops the plugins exactly once", () => {
    const asked = transition(initialState(), { type: "before.quit", confirm: true })

    expect(asked).toEqual({
      state: { status: "confirming", attempt: 1 },
      commands: [{ type: "confirm-quit", attempt: 1 }],
    })
    expect(preventsQuit(asked.state)).toBe(true)
    expect(isQuitting(asked.state)).toBe(false)

    // Cmd+Q pressed again, or the window closed again, while the dialog is open asks nothing new.
    expect(transition(asked.state, { type: "before.quit", confirm: true })).toEqual({
      state: asked.state,
      commands: [],
    })
    expect(transition(asked.state, { type: "quit.confirmed", attempt: 0 })).toEqual({
      state: asked.state,
      commands: [],
    })

    const answered = transition(asked.state, { type: "quit.confirmed", attempt: 1 })
    expect(answered).toEqual({
      state: { status: "stopping", attempt: 2, exit: "quit" },
      commands: [{ type: "stop-plugins", attempt: 2 }],
    })
    expect(stopsForQuit(answered.state)).toBe(true)
    expect(transition(answered.state, { type: "quit.confirmed", attempt: 1 }).state).toBe(answered.state)
  })

  test.each([
    { name: "the OS ends the session", event: { type: "session.ending" } },
    { name: "a signal quits", event: { type: "exit.requested", mode: "quit" } },
    { name: "Electron quits without before-quit", event: { type: "will.quit" } },
  ] satisfies { name: string; event: Event }[])("$name while the user is answering: the quit goes on", (row) => {
    const asked = transition(initialState(), { type: "before.quit", confirm: true }).state
    const next = transition(asked, row.event)

    expect(next.commands).toEqual([{ type: "stop-plugins", attempt: 2 }])
    expect(stopsForQuit(next.state)).toBe(true)
    expect(transition(next.state, { type: "quit.confirmed", attempt: 1 }).state).toBe(next.state)
  })

  test("a restart while the user is answering is rejected as busy", () => {
    const asked = transition(initialState(), { type: "before.quit", confirm: true }).state
    const caller = reply()

    expect(transition(asked, { type: "restart.requested", keep, handoff, reply: caller })).toEqual({
      state: asked,
      commands: [{ type: "reject", reply: caller, reason: { kind: "busy" } }],
    })
  })

  test.each([
    { name: "quit", events: [{ type: "before.quit" }], quit: true },
    { name: "Electron quit", events: [{ type: "will.quit" }], quit: true },
    { name: "relaunch", events: [{ type: "exit.requested", mode: "relaunch" }], quit: false },
    { name: "restart handoff", events: [{ type: "restart.requested", keep, handoff, reply: reply() }], quit: false },
  ] satisfies { name: string; events: Event[]; quit: boolean }[])(
    "only a quit stops the background service, not a $name",
    (row) => {
      expect(stopsForQuit(replay(row.events).state)).toBe(row.quit)
    },
  )

  const phases = [
    { phase: "suspending", events: [], reason: { kind: "quitting" }, stale: { type: "plugins.stopped", attempt: 1 } },
    {
      phase: "handing-off",
      events: [{ type: "plugins.stopped", attempt: 1 }],
      reason: { kind: "quitting" },
      stale: { type: "handoff.failed", attempt: 1, error: "late" },
    },
    {
      phase: "resuming",
      events: [
        { type: "plugins.stopped", attempt: 1 },
        { type: "handoff.failed", attempt: 1, error: "failed" },
      ],
      reason: { kind: "failed", error: "failed" },
      stale: { type: "plugins.resumed", attempt: 1 },
    },
  ] satisfies { phase: string; events: Event[]; reason: unknown; stale: Event }[]

  const quits = [
    { quit: { type: "exit.requested", mode: "quit" }, state: { status: "stopping", attempt: 2, exit: "quit" } },
    { quit: { type: "will.quit" }, state: { status: "quitting" } },
    { quit: { type: "before.quit" }, state: { status: "stopping", attempt: 2, exit: "quit" } },
    // Windows logoff or shutdown: a handoff that fails late must not make the app look running again.
    { quit: { type: "session.ending" }, state: { status: "stopping", attempt: 2, exit: "quit" } },
  ] satisfies { quit: Event; state: State }[]

  test.each(phases.flatMap((phase) => quits.map((quit) => ({ ...phase, ...quit, name: quit.quit.type }))))(
    "$name while $phase stops every plugin, settles the restart and drops the superseded step",
    (row) => {
      const caller = reply()
      const start = replay([{ type: "restart.requested", keep, handoff, reply: caller }, ...row.events]).state
      expect(start.status).toBe(row.phase)
      const next = transition(start, row.quit)

      // quitAndInstall quits before its promise settles, so that quit goes through untouched.
      if (row.phase === "handing-off" && row.quit.type === "before.quit") {
        expect(next).toEqual({ state: start, commands: [] })

        return
      }

      expect(next.state).toEqual(row.state)
      expect(next.commands).toEqual([
        { type: "reject", reply: caller, reason: row.reason },
        { type: "stop-plugins", attempt: 2 },
      ])
      expect(keptScope(next.state)).toBeUndefined()
      expect(transition(next.state, row.stale)).toEqual({ state: next.state, commands: [] })
      expect(isQuitting(next.state)).toBe(true)
    },
  )

  test("Windows ending the session stops every plugin once, however many windows report it", () => {
    const first = transition(initialState(), { type: "session.ending" })

    expect(first.state).toEqual({ status: "stopping", attempt: 1, exit: "quit" })
    expect(first.commands).toEqual([{ type: "stop-plugins", attempt: 1 }])
    expect(isQuitting(first.state)).toBe(true)
    expect(restoresWindows(first.state)).toBe(false)

    const second = transition(first.state, { type: "session.ending" })
    expect(second.state).toBe(first.state)
    expect(second.commands).toEqual([])

    const done = transition(second.state, { type: "plugins.stopped", attempt: 1 })
    expect(done).toEqual({ state: { status: "quitting" }, commands: [{ type: "exit", mode: "quit" }] })
    expect(transition(done.state, { type: "session.ending" }).state).toBe(done.state)
  })

  test("Windows ending the session turns a pending relaunch into a quit", () => {
    const result = replay([{ type: "exit.requested", mode: "relaunch" }, { type: "session.ending" }])

    expect(result.state).toEqual({ status: "stopping", attempt: 1, exit: "quit" })
    expect(result.commands).toEqual([{ type: "stop-plugins", attempt: 1 }])
    expect(transition(result.state, { type: "plugins.stopped", attempt: 1 }).commands).toEqual([
      { type: "exit", mode: "quit" },
    ])
  })

  test("a repeated quit while stopping keeps the same state", () => {
    const stopping = transition(initialState(), { type: "exit.requested", mode: "quit" }).state

    expect(transition(stopping, { type: "exit.requested", mode: "quit" }).state).toBe(stopping)
    expect(transition(stopping, { type: "before.quit" }).state).toBe(stopping)
  })

  test.each([
    { phase: "suspending", events: [], kind: "busy" },
    { phase: "handing-off", events: [{ type: "plugins.stopped", attempt: 1 }], kind: "busy" },
    {
      phase: "resuming",
      events: [
        { type: "plugins.stopped", attempt: 1 },
        { type: "handoff.failed", attempt: 1, error: "failed" },
      ],
      kind: "busy",
    },
    { phase: "stopping", events: [{ type: "exit.requested", mode: "quit" }], kind: "quitting" },
    { phase: "quitting", events: [{ type: "will.quit" }], kind: "quitting" },
  ] satisfies { phase: State["status"]; events: Event[]; kind: string }[])(
    "a second restart while $phase is rejected and changes nothing",
    (row) => {
      const events: Event[] =
        row.phase === "stopping" || row.phase === "quitting"
          ? row.events
          : [{ type: "restart.requested", keep, handoff, reply: reply() }, ...row.events]

      const start = replay(events).state
      expect(start.status).toBe(row.phase)
      const caller = reply()

      expect(transition(start, { type: "restart.requested", keep, handoff, reply: caller })).toEqual({
        state: start,
        commands: [{ type: "reject", reply: caller, reason: { kind: row.kind } }],
      })
    },
  )

  test.each([
    { phase: "running", events: [], restores: true },
    { phase: "suspending", events: [{ type: "restart.requested", keep, handoff, reply: reply() }], restores: true },
    {
      phase: "handing-off",
      events: [
        { type: "restart.requested", keep, handoff, reply: reply() },
        { type: "plugins.stopped", attempt: 1 },
      ],
      restores: true,
    },
    {
      phase: "resuming",
      events: [
        { type: "restart.requested", keep, handoff, reply: reply() },
        { type: "plugins.stopped", attempt: 1 },
        { type: "handoff.failed", attempt: 1, error: "failed" },
      ],
      restores: true,
    },
    { phase: "stopping", events: [{ type: "before.quit" }], restores: false },
    { phase: "quitting", events: [{ type: "will.quit" }], restores: false },
  ] satisfies { phase: State["status"]; events: Event[]; restores: boolean }[])(
    "the macOS dock reopens windows while $phase: $restores",
    (row) => {
      const state = replay(row.events).state

      expect(state.status).toBe(row.phase)
      expect(restoresWindows(state)).toBe(row.restores)
    },
  )

  test.each([
    { state: initialState(), darwin: false, win32: true },
    { state: { status: "stopping", attempt: 1, exit: "quit" }, darwin: true, win32: true },
    { state: { status: "quitting" }, darwin: true, win32: true },
  ] satisfies { state: State; darwin: boolean; win32: boolean }[])(
    "closing the last window quits on macOS only once a quit started ($state.status)",
    (row) => {
      expect(quitsWhenAllWindowsClosed(row.state, "darwin")).toBe(row.darwin)
      expect(quitsWhenAllWindowsClosed(row.state, "win32")).toBe(row.win32)
    },
  )
})
