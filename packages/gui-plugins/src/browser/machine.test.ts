import { describe, expect, test } from "bun:test"
import { Browser } from "@opencode/plugin-browser/rpc"
import {
  addressFocusTab,
  createInitialState,
  REGISTER_TIMEOUT_MS,
  serverSupported,
  sessionError,
  sessionPending,
  sessionSuspended,
  transition,
  type Event,
  type Ipc,
  type MachineEffect,
  type State,
} from "./machine"

const server = "browser-test"

const key = `${server}\nses_alpha`

const other = `${server}\nses_beta`

const target = { key, pending: false, server: { id: server, compatible: true } }

const active: Ipc = { status: "active", generation: 1 }

const id = (digit: string) => Browser.TabID.make(`tab_${digit.repeat(8)}-1111-1111-1111-111111111111`)

const tabA = id("a")

const tabB = id("b")

const tabC = id("c")

const tab = (tabID: Browser.TabID, url = `https://${tabID.slice(4, 8)}.example/`): Browser.Tab => ({
  id: tabID,
  url,
  title: url,
  loading: false,
  canGoBack: false,
  canGoForward: false,
  generation: 0,
})

const inventory = (...tabs: Browser.Tab[]): Browser.State => ({ tabs, focusedTabID: tabs.at(-1)?.id ?? null })

// Folds the events in order, keeping the last state and every effect along the way.
const replay = (events: readonly Event[], state: State = createInitialState(active)) =>
  events.reduce<{ state: State; effects: MachineEffect[] }>(
    (last, event) => {
      const next = transition(last.state, event)

      return { state: next.state, effects: [...last.effects, ...next.effects] }
    },
    { state, effects: [] },
  )

const attachment = (state: State, sessionKey = key) =>
  state.status === "open" ? state.sessions[sessionKey] : undefined

const phase = (state: State, sessionKey = key) => attachment(state, sessionKey)?.phase

const attempt = (state: State, sessionKey = key) => {
  const current = phase(state, sessionKey)

  return current && "attempt" in current ? current.attempt : -1
}

const attach = (sessionKey = key, located = true): Event[] => [
  { type: "session.attached", sessionKey, serverID: server, located },
  { type: "session.wake", sessionKey },
]

const paneState = (state: State, browser: Browser.State | null, error?: string, sessionKey = key): Event => ({
  type: "pane.state",
  sessionKey,
  attempt: attempt(state, sessionKey),
  state: browser,
  error,
})

const command = (focusAddress = false): Event => ({
  type: "session.command",
  sessionKey: key,
  action: { type: "tabs.open" },
  focusAddress,
})

// A session whose binding main took and answered with tab A.
const ready = (state = replay(attach()).state) => replay([paneState(state, inventory(tab(tabA)))], state).state

const types = (effects: readonly MachineEffect[]) => effects.map((effect) => effect.type)

describe("browser pane machine", () => {
  test("commands during backoff answer at once and keep the retry timer", () => {
    const start = ready()
    const closed = transition(start, paneState(start, null, "browser.pane.registration.closed"))
    expect(phase(closed.state)).toMatchObject({ status: "backoff", attempts: 1 })
    expect(closed.effects).toContainEqual(expect.objectContaining({ type: "schedule-retry", delayMs: 1_000 }))
    const retry = attempt(closed.state)

    const clicked = replay([command(), command()], closed.state)
    expect(types(clicked.effects)).toEqual(["reject-command", "reject-command"])
    expect(clicked.effects).toContainEqual(
      expect.objectContaining({ error: "browser.pane.unavailable", unavailable: false }),
    )
    expect(phase(clicked.state)).toEqual({ status: "backoff", attempt: retry, attempts: 1 })
  })

  test("a binding main took resets the backoff before it closes again", () => {
    const first = replay(attach())

    const failed = transition(first.state, {
      type: "register.failed",
      sessionKey: key,
      attempt: attempt(first.state),
      unavailable: false,
      closed: false,
    })

    expect(failed.effects).toContainEqual(expect.objectContaining({ type: "schedule-retry", delayMs: 1_000 }))

    const accepted = replay(
      [{ type: "retry.due", sessionKey: key, attempt: attempt(failed.state) }],
      failed.state,
    ).state

    const taken = transition(accepted, { type: "register.accepted", sessionKey: key, attempt: attempt(accepted) })
    expect(phase(taken.state)).toEqual({ status: "ready", attempt: attempt(accepted) })
    expect(types(taken.effects)).toEqual(["cancel-register-timeout"])

    const closed = transition(taken.state, paneState(taken.state, null, "browser.pane.registration.closed"))
    expect(closed.effects).toContainEqual(expect.objectContaining({ type: "schedule-retry", delayMs: 1_000 }))
  })

  test("failures in a row before main takes a binding double the backoff", () => {
    const first = replay(attach()).state

    const fail = (state: State): Event => ({
      type: "register.failed",
      sessionKey: key,
      attempt: attempt(state),
      unavailable: false,
      closed: false,
    })

    const once = transition(first, fail(first)).state
    const again = transition(once, { type: "retry.due", sessionKey: key, attempt: attempt(once) }).state
    expect(transition(again, fail(again)).effects).toContainEqual(
      expect.objectContaining({ type: "schedule-retry", delayMs: 2_000 }),
    )
  })

  test("a replaced binding after an idle suspension is no longer suspended and stays blocked", () => {
    const start = ready()
    const suspended = transition(start, paneState(start, inventory(tab(tabA)), "browser.pane.suspended")).state
    expect(sessionSuspended(suspended, key)).toBe(true)
    const woken = transition(suspended, { type: "session.wake", sessionKey: key })
    expect(woken.effects).toContainEqual(
      expect.objectContaining({ type: "open-registration", restore: inventory(tab(tabA)) }),
    )

    const replaced = transition(woken.state, paneState(woken.state, null, "browser.pane.replaced"))
    expect(sessionSuspended(replaced.state, key)).toBe(false)
    expect(attachment(replaced.state)?.browser).toBeNull()
    expect(sessionError(replaced.state, key)).toBe("browser.pane.replaced")
    expect(replaced.effects).toContainEqual({
      type: "close-registration",
      sessionKey: key,
      attempt: attempt(woken.state),
    })

    const later = replay(
      [
        { type: "session.wake", sessionKey: key },
        { type: "session.created", sessionKey: key },
      ],
      replaced.state,
    )

    expect(later.state).toBe(replaced.state)
    expect(later.effects).toEqual([])
  })

  test("losing the pane's Ipc during backoff suspends the session with its tabs and stops the timer", () => {
    const start = ready()
    const backoff = transition(start, paneState(start, null, "browser.pane.registration.closed")).state
    const lost = transition(backoff, { type: "ipc.changed", ipc: { status: "pending" } })
    expect(phase(lost.state)).toEqual({ status: "suspended", reason: "ipc" })
    expect(sessionSuspended(lost.state, key)).toBe(true)
    expect(attachment(lost.state)?.browser).toEqual(inventory(tab(tabA)))
    expect(types(lost.effects)).toEqual(["cancel-retry"])
  })

  test("a session attached while the pane's Ipc starts waits suspended, and is not pending once it is gone", () => {
    const waiting = replay(attach(), createInitialState({ status: "pending" }))
    expect(waiting.effects).toEqual([])
    expect(phase(waiting.state)).toEqual({ status: "suspended", reason: "ipc" })
    expect(sessionSuspended(waiting.state, key)).toBe(true)
    expect(sessionPending(waiting.state, target)).toBe(true)

    const gone = transition(waiting.state, { type: "ipc.changed", ipc: { status: "inactive" } }).state
    expect(sessionPending(gone, target)).toBe(false)

    const back = transition(gone, { type: "ipc.changed", ipc: active })
    expect(types(back.effects)).toEqual(["open-registration", "schedule-register-timeout"])
  })

  test("a registration whose companion closed-state event never arrives times out into backoff", () => {
    const start = replay(attach()).state
    const registering = attempt(start)

    const rejected = transition(start, {
      type: "register.failed",
      sessionKey: key,
      attempt: registering,
      unavailable: false,
      closed: true,
    })

    expect(rejected.state).toBe(start)
    expect(replay(attach()).effects).toContainEqual(
      expect.objectContaining({ type: "schedule-register-timeout", delayMs: REGISTER_TIMEOUT_MS }),
    )

    const timed = transition(start, { type: "register.timed-out", sessionKey: key, attempt: registering })
    expect(phase(timed.state)).toMatchObject({ status: "backoff", attempts: 1 })
    expect(timed.effects).toContainEqual({ type: "close-registration", sessionKey: key, attempt: registering })
    expect(timed.effects).toContainEqual(expect.objectContaining({ type: "schedule-retry", delayMs: 1_000 }))

    const replaced = transition(start, paneState(start, null, "browser.pane.replaced")).state
    expect(transition(replaced, { type: "register.timed-out", sessionKey: key, attempt: registering }).state).toBe(
      replaced,
    )
  })

  test("an unsupported server stops every session on it until the server changes", () => {
    const start = ready(replay([...attach(), ...attach(other)]).state)
    const unsupported = transition(start, paneState(start, null, "browser.pane.unsupported"))
    expect(serverSupported(unsupported.state, server)).toBe(false)
    expect(attachment(unsupported.state)).toBeUndefined()
    expect(attachment(unsupported.state, other)).toBeUndefined()
    expect(unsupported.effects).toEqual([
      { type: "close-registration", sessionKey: key, attempt: attempt(start) },
      { type: "detach", sessionKey: key },
      { type: "cancel-register-timeout", sessionKey: other },
      { type: "close-registration", sessionKey: other, attempt: attempt(start, other) },
      { type: "detach", sessionKey: other },
      { type: "watch-server", serverID: server },
    ])
    expect(replay(attach(), unsupported.state).state).toBe(unsupported.state)

    const changed = transition(unsupported.state, { type: "server.changed", serverID: server })
    expect(serverSupported(changed.state, server)).toBe(true)
    expect(changed.effects).toEqual([{ type: "unwatch-server", serverID: server }])
    expect(types(replay(attach(), changed.state).effects)).toEqual(["open-registration", "schedule-register-timeout"])
  })

  test("a focus held while the strip cannot be written is dropped when its tab closes first", () => {
    const start = replay(attach(key, false)).state

    const located = replay(
      [
        paneState(start, inventory(tab(tabA), tab(tabB))),
        { type: "pane.focus", sessionKey: key, attempt: attempt(start), tabID: tabB },
        paneState(start, inventory(tab(tabA))),
      ],
      start,
    )

    expect(located.effects.filter((effect) => effect.type === "sync-strip")).toEqual([])

    const flushed = transition(located.state, { type: "session.located", sessionKey: key, located: true })
    expect(flushed.effects).toEqual([{ type: "sync-strip", sessionKey: key, keep: [tabA], open: [tabA] }])
  })

  test("a held focus for a tab the desktop still has lands after the strip sync", () => {
    const start = replay(attach(key, false)).state

    const held = replay(
      [
        paneState(start, inventory(tab(tabA), tab(tabB))),
        { type: "pane.focus", sessionKey: key, attempt: attempt(start), tabID: tabB },
        { type: "session.located", sessionKey: key, located: true },
      ],
      start,
    )

    expect(held.effects).toEqual([
      { type: "cancel-register-timeout", sessionKey: key },
      { type: "record-history", sessionKey: key },
      { type: "sync-strip", sessionKey: key, keep: [tabA, tabB], open: [tabA, tabB] },
      { type: "focus-strip-tab", sessionKey: key, tabID: tabB },
    ])
  })

  test("a new tab request answered without a new tab gives no later blank tab the address focus", () => {
    const start = ready()
    const asked = transition(start, command(true)).state
    const request = attachment(asked)?.addressFocus
    expect(request).toMatchObject({ status: "opening", known: [tabA] })

    const settled = replay(
      [
        { type: "command.settled", sessionKey: key, request: request?.status === "opening" ? request.request : -1 },
        paneState(asked, inventory(tab(tabA))),
        paneState(asked, inventory(tab(tabA), tab(tabB, "about:blank"))),
      ],
      asked,
    ).state

    expect(addressFocusTab(settled, key)).toBeUndefined()
  })

  test("a failed new tab request gives no later blank tab the address focus", () => {
    const start = ready()
    const asked = transition(start, command(true)).state
    const request = attachment(asked)?.addressFocus

    const failed = replay(
      [
        {
          type: "command.failed",
          sessionKey: key,
          attempt: attempt(asked),
          request: request?.status === "opening" ? request.request : -1,
          error: "boom",
          unavailable: false,
        },
        paneState(asked, inventory(tab(tabA), tab(tabB, "about:blank"))),
      ],
      asked,
    ).state

    expect(addressFocusTab(failed, key)).toBeUndefined()
  })

  test("the user's new blank tab takes the address focus once, until it navigates or the route leaves", () => {
    const start = ready()
    const asked = transition(start, command(true)).state
    const opened = transition(asked, paneState(asked, inventory(tab(tabA), tab(tabB, "about:blank")))).state
    expect(addressFocusTab(opened, key)).toBe(tabB)
    expect(transition(opened, { type: "address.focused", sessionKey: key, tabID: tabC }).state).toBe(opened)
    expect(
      addressFocusTab(transition(opened, { type: "address.focused", sessionKey: key, tabID: tabB }).state, key),
    ).toBeUndefined()
    expect(
      addressFocusTab(transition(opened, { type: "session.routed", sessionKey: other }).state, key),
    ).toBeUndefined()
    expect(transition(opened, { type: "session.routed", sessionKey: key }).state).toBe(opened)
    const navigated = transition(opened, paneState(opened, inventory(tab(tabA), tab(tabB)))).state
    expect(addressFocusTab(navigated, key)).toBeUndefined()
  })

  test("a new tab main opens on an address ends the request", () => {
    const start = ready()
    const asked = transition(start, command(true)).state
    expect(
      addressFocusTab(transition(asked, paneState(asked, inventory(tab(tabA), tab(tabB)))).state, key),
    ).toBeUndefined()
  })

  test("a healthy inventory clears a failed command's error", () => {
    const start = ready()

    const failed = transition(start, {
      type: "command.failed",
      sessionKey: key,
      attempt: attempt(start),
      request: 1,
      error: "browser.address.web",
      unavailable: false,
    }).state

    expect(sessionError(failed, key)).toBe("browser.address.web")
    expect(sessionError(transition(failed, paneState(failed, inventory(tab(tabA)))).state, key)).toBeUndefined()
  })

  test("a command clears the error at once and an unreachable pane fails it without one", () => {
    const start = ready()

    const failed = transition(start, {
      type: "command.failed",
      sessionKey: key,
      attempt: attempt(start),
      request: 1,
      error: "browser.address.web",
      unavailable: false,
    }).state

    const sent = transition(failed, command())
    expect(sessionError(sent.state, key)).toBeUndefined()
    expect(sent.effects).toEqual([expect.objectContaining({ type: "send-command", attempt: attempt(start) })])

    const lost = transition(sent.state, {
      type: "command.failed",
      sessionKey: key,
      attempt: attempt(start),
      request: 2,
      error: "browser.pane.unavailable",
      unavailable: true,
    })

    expect(phase(lost.state)).toEqual({ status: "suspended", reason: "ipc" })
    expect(sessionError(lost.state, key)).toBeUndefined()
    expect(lost.effects).toEqual([{ type: "close-registration", sessionKey: key, attempt: attempt(start) }])
  })

  test("a command wakes a suspended session once, through the new binding", () => {
    const start = ready()
    const suspended = transition(start, paneState(start, inventory(tab(tabA)), "browser.pane.suspended")).state
    const sent = transition(suspended, command())
    expect(types(sent.effects)).toEqual(["open-registration", "schedule-register-timeout", "send-command"])
    expect(sent.effects[2]).toMatchObject({ attempt: attempt(sent.state) })
  })

  test("idle suspension keeps the tabs, never retries, and ignores the closed binding's late events", () => {
    const start = ready()
    const suspended = transition(start, paneState(start, inventory(tab(tabA)), "browser.pane.suspended"))
    expect(types(suspended.effects)).toEqual(["close-registration"])
    expect(phase(suspended.state)).toEqual({ status: "suspended", reason: "idle" })
    expect(transition(suspended.state, { type: "ipc.changed", ipc: active }).state).toBe(suspended.state)

    const woken = replay(
      [
        { type: "session.wake", sessionKey: key },
        { type: "session.wake", sessionKey: key },
      ],
      suspended.state,
    )

    expect(types(woken.effects)).toEqual(["open-registration", "schedule-register-timeout"])
    expect(transition(woken.state, paneState(start, null, "browser.pane.registration.closed")).state).toBe(woken.state)
  })

  test("the pane's Ipc returning registers each lost binding once with its tabs", () => {
    const start = ready()

    const embedded = transition(start, {
      type: "pane.embed",
      sessionKey: key,
      attempt: attempt(start),
      tabID: tabA,
      embed: "e1",
    }).state

    const lost = transition(embedded, { type: "ipc.changed", ipc: { status: "pending" } })
    expect(attachment(lost.state)?.embeds).toEqual({})
    expect(types(lost.effects)).toEqual(["close-registration"])

    const back = replay(
      [
        { type: "ipc.changed", ipc: active },
        { type: "ipc.changed", ipc: active },
      ],
      lost.state,
    )

    expect(back.effects.filter((effect) => effect.type === "open-registration")).toEqual([
      { type: "open-registration", sessionKey: key, attempt: attempt(back.state), restore: inventory(tab(tabA)) },
    ])
  })

  test("a pane Ipc that restarts in place registers every binding again", () => {
    const start = ready()
    const restarted = transition(start, { type: "ipc.changed", ipc: { status: "active", generation: 2 } })
    expect(types(restarted.effects)).toEqual(["close-registration", "open-registration", "schedule-register-timeout"])
    expect(attempt(restarted.state)).toBeGreaterThan(attempt(start))
  })

  test("only a native inventory prunes the strip, also when it was held for the location", () => {
    const start = replay(attach(key, false)).state

    const held = replay(
      [
        paneState(start, inventory(tab(tabA), tab(tabB))),
        { type: "pane.embed", sessionKey: key, attempt: attempt(start), tabID: tabB, embed: "e2" },
        { type: "session.located", sessionKey: key, located: true },
      ],
      start,
    )

    expect(held.effects.filter((effect) => effect.type === "sync-strip")).toEqual([
      { type: "sync-strip", sessionKey: key, keep: [tabA, tabB], open: [tabA, tabB] },
    ])

    const suspended = transition(
      held.state,
      paneState(held.state, inventory(tab(tabA), tab(tabB), tab(tabC)), "browser.pane.suspended"),
    )

    expect(suspended.effects.filter((effect) => effect.type === "sync-strip")).toEqual([
      { type: "sync-strip", sessionKey: key, keep: undefined, open: [tabC] },
    ])
  })

  test.each([
    { error: "browser.pane.replaced", rejectedFirst: false },
    { error: "browser.pane.unsupported", rejectedFirst: false },
    { error: "browser.pane.replaced", rejectedFirst: true },
    { error: "browser.pane.unsupported", rejectedFirst: true },
  ])("$error stops recovery (register rejected first: $rejectedFirst)", ({ error, rejectedFirst }) => {
    const start = replay(attach()).state

    const rejected: Event[] = rejectedFirst
      ? [{ type: "register.failed", sessionKey: key, attempt: attempt(start), unavailable: false, closed: true }]
      : []

    const blocked = replay([...rejected, paneState(start, null, error)], start)
    expect(blocked.effects.some((effect) => effect.type === "schedule-retry")).toBe(false)

    const later = replay(
      [
        { type: "session.wake", sessionKey: key },
        { type: "register.timed-out", sessionKey: key, attempt: attempt(start) },
      ],
      blocked.state,
    )

    expect(later.effects).toEqual([])
  })

  test("a missing session waits without an error until the server creates it", () => {
    const start = replay(attach()).state
    const missing = transition(start, paneState(start, null, "browser.pane.missing")).state
    expect(sessionError(missing, key)).toBeUndefined()
    expect(transition(missing, { type: "session.wake", sessionKey: key }).state).toBe(missing)
    expect(types(transition(missing, { type: "session.created", sessionKey: key }).effects)).toEqual([
      "open-registration",
      "schedule-register-timeout",
    ])
  })

  test("events from a superseded binding or retry timer are ignored", () => {
    const start = ready()
    const old = attempt(start)
    const backoff = transition(start, paneState(start, null, "browser.pane.registration.closed")).state
    const retry = attempt(backoff)
    const registering = transition(backoff, { type: "retry.due", sessionKey: key, attempt: retry }).state

    for (const event of [
      { type: "pane.state", sessionKey: key, attempt: old, state: null, error: "browser.pane.replaced" },
      { type: "pane.embed", sessionKey: key, attempt: old, tabID: tabA, embed: "stale" },
      { type: "pane.focus", sessionKey: key, attempt: old, tabID: tabA },
      { type: "register.accepted", sessionKey: key, attempt: old },
      { type: "retry.due", sessionKey: key, attempt: retry },
    ] satisfies Event[])
      expect(transition(registering, event)).toEqual({ state: registering, effects: [] })
  })

  test("disposal closes every binding and timer and ignores later events", () => {
    const start = ready(replay([...attach(), ...attach(other)]).state)
    const backoff = transition(start, paneState(start, null, "browser.pane.registration.closed")).state
    const disposed = transition(backoff, { type: "disposed" })
    expect(disposed.state).toEqual({ status: "disposed" })
    expect(disposed.effects).toEqual([
      { type: "cancel-retry", sessionKey: key },
      { type: "detach", sessionKey: key },
      { type: "cancel-register-timeout", sessionKey: other },
      { type: "close-registration", sessionKey: other, attempt: attempt(start, other) },
      { type: "detach", sessionKey: other },
    ])
    expect(transition(disposed.state, { type: "session.wake", sessionKey: key }).state).toBe(disposed.state)
  })

  test("removing a session closes its binding", () => {
    const start = ready()
    expect(transition(start, { type: "session.removed", sessionKeys: [key, other] }).effects).toEqual([
      { type: "close-registration", sessionKey: key, attempt: attempt(start) },
      { type: "detach", sessionKey: key },
    ])
    expect(transition(start, { type: "session.removed", sessionKeys: [other] }).state).toBe(start)
  })
})
