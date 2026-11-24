import { describe, expect, test } from "bun:test"
import { Browser } from "@opencode/plugin-browser/rpc"
import {
  addressFocusTab,
  createInitialState,
  HELD_REQUEST_TTL_MS,
  PENDING_RETRIES,
  REGISTER_TIMEOUT_MS,
  sessionSupported,
  sessionError,
  sessionOpenable,
  sessionFailure,
  sessionPending,
  sessionRegistration,
  sessionSettled,
  revealGuard,
  sessionSuspended,
  sessionTabs,
  sessionUnavailable,
  tabUnnamed,
  transition,
  type Attachment,
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
  { type: "session.wake", sessionKey, takes: false },
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
  // A preview of tab A for the routed session, in a window with room, with the pane closed.
  const activity = (state: State) => ({ type: "pane.activity" as const, sessionKey: key, attempt: attempt(state),
    tabID: tabA, reveal: "tab" as const, room: true, enabled: true, onScreen: true, opened: false, visible: false })

  const side = (open: boolean): Event => ({ type: "side.changed", sessionKey: key, open, running: true })

  // "open": the tab is selected behind the click guard. "select": selected behind the guard and marked, as nobody was
  // looking. "mark": only the unseen mark. "none": nothing.
  test.each([
    ["a preview with the pane closed", {}, "open"],
    ["a preview with another browser tab, Review or Files selected", { opened: true }, "open"],
    ["the agent's new or focused tab with the pane closed", {}, "open"],
    ["the agent's new or focused tab with another tab selected", { opened: true }, "open"],
    ["target already visible", { opened: true, visible: true }, "none"],
    ["a preview of the tab a closed pane has selected", { visible: true }, "open"],
    ["a preview for a session off screen or in a hidden window", { onScreen: false }, "select"],
    ["a preview off screen with the setting turned off", { onScreen: false, enabled: false }, "mark"],
    ["the setting turned off", { enabled: false }, "mark"],
    ["open pane with the setting turned off", { enabled: false, opened: true }, "mark"],
    ["no room beside the chat", { room: false }, "mark"],
    ["navigate, popup or a tab opened with focus: false", { reveal: "none" }, "mark"],
    ["superseded binding", { attempt: -1 }, "none"],
    ["a tab the inventory does not have yet", { tabID: tabB }, "kept"],
  ] as const)("agent navigation, preview or new tab: %s", (_label, input, expected) => {
    const start = ready()
    const next = transition(start, { ...activity(start), ...input })
    expect(types(next.effects)).toEqual(expected === "open" || expected === "select" ? ["focus-strip-tab"] : expected === "kept" ? ["expire-held"] : [])
    expect(attachment(next.state)?.unseen).toEqual(expected === "mark" || expected === "select" ? [tabA] : [])
    expect(revealGuard(next.state, key, tabA) !== undefined).toBe(expected === "open" || expected === "select")
  })

  test("a tab selected while nobody looked keeps its guard through the pane opening for it", () => {
    const start = ready()
    const selected = transition(start, { ...activity(start), onScreen: false }).state
    const opened = transition(selected, side(true)).state
    expect(revealGuard(opened, key, tabA)).toBeDefined()
    // Closing the pane ends it: the person's own opening shows the page at once.
    expect(revealGuard(transition(opened, side(false)).state, key, tabA)).toBeUndefined()
  })

  // A prompt waits while this is false, so its first step lists the browser tools. It must never wait on a state
  // that only the person, another desktop or a retry timer can end.
  test("a prompt waits for a registration or a starting pane, and for nothing that cannot attach by itself", () => {
    const registering = replay(attach()).state
    const idle = transition(createInitialState(active), attach()[0]!).state
    expect(sessionSettled(createInitialState(active), key)).toBe(true)
    expect(sessionSettled(idle, key)).toBe(false)
    expect(sessionSettled(registering, key)).toBe(false)
    expect(sessionSettled(ready(), key)).toBe(true)

    // The pane's main plugin is still starting: it attaches as soon as its Ipc is active. One that does not run never does.
    const starting = replay(attach(), createInitialState({ status: "pending" })).state
    expect(phase(starting)).toEqual({ status: "suspended", reason: "ipc" })
    expect(sessionSettled(starting, key)).toBe(false)
    expect(sessionSettled(transition(starting, { type: "ipc.changed", ipc: active }).state, key)).toBe(false)
    expect(sessionSettled(replay(attach(), createInitialState({ status: "inactive" })).state, key)).toBe(true)
    // One that was starting and then failed to start: the prompt that waited for it goes.
    expect(sessionSettled(transition(starting, { type: "ipc.changed", ipc: { status: "inactive" } }).state, key)).toBe(true)

    // The server evicted the idle attachment: the prompt's wake registers it again, and the prompt waits for that.
    const evicted = transition(ready(), paneState(ready(), inventory(tab(tabA)), "browser.pane.suspended")).state
    expect(phase(evicted)).toEqual({ status: "suspended", reason: "idle" })
    expect(sessionSettled(evicted, key)).toBe(false)
    const woken = transition(evicted, { type: "session.wake", sessionKey: key, takes: false }).state
    expect(phase(woken)?.status).toBe("registering")
    expect(sessionSettled(woken, key)).toBe(false)

    for (const error of ["browser.pane.replaced", "browser.pane.unsupported", "browser.pane.missing", "browser.pane.registration.closed"]) {
      const ended = transition(registering, paneState(registering, null, error)).state
      expect(`${error}: ${sessionSettled(ended, key)}`).toBe(`${error}: true`)
    }

    expect(sessionSettled(transition(registering, { type: "disposed" }).state, key)).toBe(true)
  })

  test("closing the pane the agent showed its page in wins until reopening it or finishing the run", () => {
    const start = ready()
    const shown = transition(start, activity(start)).state
    const hidden = replay([side(true), side(false)], shown).state
    expect(attachment(hidden)?.side).toBe("dismissed")
    expect(transition(hidden, activity(hidden)).effects).toEqual([])
    const nextRun = transition(hidden, { type: "execution.ended", sessionKey: key }).state
    expect(types(transition(nextRun, activity(nextRun)).effects)).toEqual(["focus-strip-tab"])
    const mark = replay([side(true), { ...activity(hidden), reveal: "none", opened: true }], hidden).state
    expect(attachment(mark)?.unseen).toEqual([tabA])
    expect(attachment(transition(mark, { type: "activity.seen", sessionKey: key, tabID: tabA }).state)?.unseen).toEqual([])
  })

  // The person opens the side panel to look at something of their own, closes it, and only then does the agent ask to
  // show its first page: closing that panel was no answer to the agent.
  test("closing a pane that showed nothing of the agent's keeps its first show request", () => {
    const start = ready()
    const closed = replay([side(true), side(false)], start).state
    expect(attachment(closed)?.side).toBe("closed")
    expect(types(transition(closed, activity(closed)).effects)).toEqual(["focus-strip-tab"])
  })

  test("closing a pane in which the agent worked on the visible tab is a dismissal", () => {
    const start = ready()

    const hidden = replay(
      [side(true), { ...activity(start), reveal: "none", opened: true, visible: true }, side(false)],
      start,
    ).state

    expect(attachment(hidden)?.side).toBe("dismissed")
    expect(transition(hidden, activity(hidden)).effects).toEqual([])
  })

  // A show request that arrives before the strip can be written (`strip`) or before its tab's inventory (`inventory`).
  const kept = (waits: "inventory" | "strip", asked: Partial<Extract<Event, { type: "pane.activity" }>> = {}) => {
    const start = waits === "inventory" ? ready() : replay(attach(key, false)).state
    const listed = waits === "inventory" ? start : transition(start, paneState(start, inventory(tab(tabA)))).state
    const tabID = waits === "inventory" ? tabB : tabA

    return { tabID, early: transition(listed, { ...activity(listed), tabID, ...asked }) }
  }

  // The state the request waited for arrives.
  const arrive = (waits: "inventory" | "strip", state: State) =>
    waits === "inventory"
      ? transition(state, paneState(state, inventory(tab(tabA), tab(tabB))))
      : transition(state, { type: "session.located", sessionKey: key, located: true })

  // The driver answers `present-held` by sending the request again with what is true at that moment.
  const asked = (result: { state: State; effects: readonly MachineEffect[] }, now: Partial<Extract<Event, { type: "pane.activity" }>> = {}) => {
    const effect = result.effects.find((item) => item.type === "present-held")

    if (effect?.type !== "present-held") throw new Error("expected the kept request to be asked again")

    return transition(result.state, { ...activity(result.state), ...now, attempt: effect.attempt, tabID: effect.tabID, reveal: effect.reveal })
  }

  test.each(["inventory", "strip"] as const)("a show request that arrives before the %s is kept as asked, with a bound", (waits) => {
    const { tabID, early } = kept(waits, { reveal: "none", onScreen: false, opened: true, enabled: false, room: false, visible: true })
    const held = attachment(early.state)?.held

    // Only the binding, the tab and what was asked: nothing of the screen, the pane or the setting at that moment.
    expect(held).toEqual({ attempt: attempt(early.state), tabID, reveal: "none", token: held?.token ?? -1 })
    expect(early.effects).toEqual([{ type: "expire-held", sessionKey: key, token: held?.token ?? -1, delayMs: HELD_REQUEST_TTL_MS }])
    expect(revealGuard(early.state, key, tabID)).toBeUndefined()

    // What it waited for arrives: the machine decides nothing itself, and the request lands once.
    const landed = arrive(waits, early.state)
    expect(types(landed.effects)).not.toContain("focus-strip-tab")
    expect(landed.effects.at(-1)).toEqual({ type: "present-held", sessionKey: key, attempt: attempt(early.state), tabID, reveal: "none" })
    expect(attachment(landed.state)?.held).toBeUndefined()
    expect(types(arrive(waits, landed.state).effects)).not.toContain("present-held")
  })

  // "open": selected behind the guard. "select": selected behind the guard, with its mark. "mark": only the mark.
  test.each([
    ["asked off screen, the person is back", "inventory", { onScreen: false }, {}, "open"],
    ["asked off screen, the person is back", "strip", { onScreen: false }, {}, "open"],
    ["asked on screen, nobody looks now", "inventory", {}, { onScreen: false }, "select"],
    ["asked on screen, nobody looks now", "strip", {}, { onScreen: false }, "select"],
    ["asked with the setting on, which is off now", "strip", {}, { enabled: false }, "mark"],
    ["asked with room beside the chat, which is gone now", "inventory", {}, { room: false }, "mark"],
    ["asked for a tab the pane shows by now", "strip", {}, { opened: true, visible: true }, "none"],
  ] as const)("a kept show request is decided from what is true when it lands: %s (%s)", (_label, waits, then, now, expected) => {
    const { tabID, early } = kept(waits, then)
    const next = asked(arrive(waits, early.state), now)

    expect(types(next.effects)).toEqual(expected === "open" || expected === "select" ? ["focus-strip-tab"] : [])
    expect(revealGuard(next.state, key, tabID) !== undefined).toBe(expected === "open" || expected === "select")
    expect(attachment(next.state)?.unseen).toEqual(expected === "select" || expected === "mark" ? [tabID] : [])

    if (expected === "none") return
    // The guard holds until the pane shows the tab to the person, then for the delay.
    const token = revealGuard(next.state, key, tabID) ?? -1
    const drawn = transition(next.state, { type: "reveal.drawn", sessionKey: key, token })
    expect(drawn.effects).toEqual(expected === "mark" ? [] : [{ type: "expire-reveal", sessionKey: key, token }])
  })

  test.each([
    ["the person runs a browser command", (): Event[] => [{ type: "session.command", sessionKey: key, action: { type: "reload", tabID: tabA }, focusAddress: false }]],
    ["the person selects a tab", (): Event[] => [{ type: "session.command", sessionKey: key, action: { type: "tabs.focus", tabID: tabA }, focusAddress: false }]],
    ["the person closes the pane", (): Event[] => [side(true), side(false)]],
    ["the run ends or is stopped", (): Event[] => [{ type: "execution.ended", sessionKey: key }]],
    ["the session leaves the screen", (): Event[] => [{ type: "screen.left", sessionKey: key }]],
    ["its bound passes", (state: State): Event[] => [{ type: "held.expired", sessionKey: key, token: attachment(state)?.held?.token ?? -1 }]],
  ] as const)("a kept show request is dropped, not applied, when %s first", (_label, events) => {
    for (const waits of ["inventory", "strip"] as const) {
      const { early } = kept(waits)
      const dropped = replay(events(early.state), early.state).state
      expect(attachment(dropped)?.held).toBeUndefined()
      const landed = arrive(waits, dropped)
      expect(types(landed.effects)).not.toContain("present-held")
      expect(types(landed.effects)).not.toContain("focus-strip-tab")
    }
  })

  test("a kept show request is dropped when its tab closes or its binding is superseded first", () => {
    // The desktop had the tab when the request arrived, and has it no more.
    const closing = kept("strip")
    const closed = transition(closing.early.state, paneState(closing.early.state, inventory(tab(tabC))))
    expect(attachment(closed.state)?.held).toBeUndefined()
    expect(types(arrive("strip", closed.state).effects)).not.toContain("present-held")

    // Main closed the binding; the next registration is another attempt, whose inventory lands nothing of the old one.
    const { early } = kept("inventory")
    const lost = transition(early.state, paneState(early.state, inventory(tab(tabA)), "browser.pane.registration.closed")).state
    const again = transition(lost, { type: "retry.due", sessionKey: key, attempt: attempt(lost) }).state
    expect(attempt(again)).not.toBe(attempt(early.state))
    const landed = arrive("inventory", again)
    expect(types(landed.effects)).not.toContain("present-held")
    expect(attachment(landed.state)?.held).toBeUndefined()
  })

  test("an old bound cannot drop a newer kept request, and a request that can be decided replaces a kept one", () => {
    const { early } = kept("inventory")
    const first = attachment(early.state)?.held?.token ?? -1
    const newer = transition(early.state, { ...activity(early.state), tabID: tabC })
    expect(attachment(newer.state)?.held?.tabID).toBe(tabC)
    expect(transition(newer.state, { type: "held.expired", sessionKey: key, token: first }).state).toBe(newer.state)

    // A request for a tab the desktop has is decided at once, and the kept one is gone.
    const live = transition(newer.state, { ...activity(newer.state), reveal: "none" })
    expect(attachment(live.state)?.held).toBeUndefined()
    expect(attachment(live.state)?.unseen).toEqual([tabA])
    expect(types(arrive("inventory", live.state).effects)).not.toContain("present-held")
  })

  test("the strip's echo of a reveal is not the person's command: it keeps the guard", () => {
    const start = ready()
    const reveal = transition(start, activity(start)).state
    const echo = transition(reveal, { type: "session.command", sessionKey: key, action: { type: "tabs.focus", tabID: tabA }, focusAddress: false })
    expect(revealGuard(echo.state, key, tabA)).toBeDefined()
  })

  test("only the newly revealed page is held back, and an old timer cannot expose it", () => {
    const start = ready()
    const reveal = transition(start, activity(start)).state
    const token = revealGuard(reveal, key, tabA)

    if (!token) throw new Error("expected reveal guard")
    expect(revealGuard(reveal, key, tabB)).toBeUndefined()
    const again = transition(reveal, activity(reveal)).state
    const stale = transition(again, { type: "reveal.elapsed", sessionKey: key, token }).state
    expect(stale).toBe(again)
    const elapsed = transition(reveal, { type: "reveal.elapsed", sessionKey: key, token }).state
    expect(revealGuard(elapsed, key, tabA)).toBeUndefined()
  })

  test("the reveal delay starts once, when the pane draws the page", () => {
    const start = ready()
    const reveal = transition(start, activity(start)).state
    const token = revealGuard(reveal, key, tabA) ?? -1
    const drawn = transition(reveal, { type: "reveal.drawn", sessionKey: key, token })
    expect(drawn.effects).toEqual([{ type: "expire-reveal", sessionKey: key, token }])
    expect(revealGuard(drawn.state, key, tabA)).toBe(token)
    expect(transition(drawn.state, { type: "reveal.drawn", sessionKey: key, token })).toEqual({ state: drawn.state, effects: [] })
    expect(transition(reveal, { type: "reveal.drawn", sessionKey: key, token: token + 1 })).toEqual({ state: reveal, effects: [] })
  })

  test.each([
    ["navigating the revealed blank tab", { type: "navigate", tabID: tabA, url: "https://example.com" }, false],
    ["selecting another tab", { type: "tabs.focus", tabID: tabB }, false],
    ["the strip selecting the revealed tab", { type: "tabs.focus", tabID: tabA }, true],
  ] as const)("a reveal the pane never drew does not hold the person's own command: %s", (_label, action, guarded) => {
    const start = ready()
    const reveal = transition(start, activity(start)).state
    const next = transition(reveal, { type: "session.command", sessionKey: key, action, focusAddress: false })
    expect(types(next.effects)).toEqual(["send-command"])
    expect(revealGuard(next.state, key, tabA) !== undefined).toBe(guarded)
  })

  test.each([
    ["the pane closed", {}, true],
    ["another tab selected in the open pane", { opened: true }, true],
    ["the setting turned off", { enabled: false }, false],
    ["no room beside the chat", { room: false }, false],
  ] as const)("a file preview is selected with %s, and starting with a closed pane does not dismiss the run", (_label, input, select) => {
    const start = ready()
    const observed = transition(start, { type: "side.changed", sessionKey: key, open: false, running: true }).state
    const file = { ...activity(observed), type: "pane.file" as const, path: "report.pdf", ...input }
    expect(transition(observed, file).effects).toEqual([{ type: "present-file", sessionKey: key, path: file.path, select }])
  })

  test("a file preview follows the person's dismissal, counts as shown, and waits for an off-screen session's file panel", () => {
    const start = ready()
    const file = { ...activity(start), type: "pane.file" as const, path: "report.pdf" }
    expect(transition(start, { ...file, onScreen: false })).toEqual({ state: start, effects: [] })
    const hidden = replay([file, side(true), side(false)], start).state
    expect(attachment(hidden)?.side).toBe("dismissed")
    expect(transition(hidden, file).effects).toEqual([{ type: "present-file", sessionKey: key, path: file.path, select: false }])
  })

  test.each([
    ["the person's queued prompt", "user", "queue", "queue", "closed"],
    ["the person's steer", "user", "steer", "steer", "dismissed"],
    ["the person's steer they moved to the queue", "user", "steer", "queue", "closed"],
    ["the person's queued prompt they moved to steer", "user", "queue", "steer", "dismissed"],
    ["a synthetic item or a compaction", "other", "queue", "queue", "dismissed"],
  ] as const)("a delivered inbox item ends the person's dismissal only for %s", (_label, author, enqueued, delivered, side) => {
    const start = ready()
    const changed = (open: boolean): Event => ({ type: "side.changed", sessionKey: key, open, running: true })

    const next = replay([
      activity(start),
      changed(true),
      changed(false),
      ...(author === "user" ? [{ type: "prompt.enqueued" as const, sessionKey: key, id: "msg_1", delivery: enqueued }] : []),
      { type: "inbox.delivery.changed", sessionKey: key, id: "msg_1", delivery: delivered },
      { type: "inbox.cancelled", sessionKey: key, id: "msg_other" },
      { type: "inbox.delivered", sessionKey: key, id: "msg_1" },
    ], start).state

    expect(attachment(next)?.side).toBe(side)
    expect(attachment(next)?.prompts).toEqual({})
    expect(types(transition(next, activity(next)).effects)).toEqual(side === "closed" ? ["focus-strip-tab"] : [])
    // The reset opens nothing by itself: a restored inventory is not a show request.
    expect(types(transition(next, paneState(next, inventory(tab(tabA)))).effects)).not.toContain("focus-strip-tab")
  })

  test("a cancelled queued prompt no longer ends the dismissal", () => {
    const start = ready()
    const changed = (open: boolean): Event => ({ type: "side.changed", sessionKey: key, open, running: true })

    const next = replay([
      activity(start),
      changed(true),
      changed(false),
      { type: "prompt.enqueued", sessionKey: key, id: "msg_1", delivery: "queue" },
      { type: "inbox.cancelled", sessionKey: key, id: "msg_1" },
      { type: "inbox.delivered", sessionKey: key, id: "msg_1" },
    ], start).state

    expect(attachment(next)?.side).toBe("dismissed")
  })

  test("a visible restored tab requests its load on acceptance, not before the new registration exists", () => {
    const start = ready()
    const closed = transition(start, paneState(start, inventory(tab(tabA)), "browser.pane.registration.closed")).state
    const retry = transition(closed, { type: "retry.due", sessionKey: key, attempt: attempt(closed) }).state
    expect(sessionRegistration(retry, key)).toBeUndefined()
    const accepted = transition(retry, { type: "register.accepted", sessionKey: key, attempt: attempt(retry) }).state
    expect(sessionRegistration(accepted, key)).toBe(attempt(retry))
  })
  test("a cold registration that cannot reach the server keeps main's saved inventory until retry", () => {
    const start = replay(attach()).state
    const saved = inventory(tab(tabA, "workspace://ses_a/report.html"))
    const closed = transition(start, paneState(start, saved, "browser.pane.registration.closed"))
    expect(attachment(closed.state)?.browser).toEqual(saved)
    expect(phase(closed.state)?.status).toBe("backoff")
  })
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
    const woken = transition(suspended, { type: "session.wake", sessionKey: key, takes: false })
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
        { type: "session.wake", sessionKey: key, takes: false },
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

  // After a restart the strip draws the tabs it stored before the desktop has reported any. They left the strip, and
  // came back as new tabs, whenever the binding was not registering: in backoff, or while the server had no browser yet.
  test("the stored tabs stay listed until an inventory names the desktop's, whatever the binding does meanwhile", () => {
    const stored = [tabA, tabB]
    const start = replay(attach()).state
    const backoff = transition(start, { type: "register.timed-out", sessionKey: key, attempt: attempt(start) }).state
    const unsupported = transition(start, paneState(start, null, "browser.pane.unsupported")).state
    const paused = replay(attach(), createInitialState({ status: "inactive" })).state

    for (const state of [createInitialState(active), start, backoff, unsupported, paused])
      expect(sessionTabs(state, target, stored)).toEqual(stored)

    // The inventory decides, and prunes the stored tabs it lacks.
    expect(sessionTabs(ready(start), target, stored)).toEqual([tabA])

    // Another window's session, one the server lacks, and one that will not attach have no tabs here.
    for (const error of ["browser.pane.replaced", "browser.pane.missing"])
      expect(sessionTabs(transition(start, paneState(start, null, error)).state, target, stored)).toEqual([])
    expect(
      sessionTabs(createInitialState(active), { ...target, server: { id: server, compatible: false } }, stored),
    ).toEqual([])
  })

  // A tab drawn before the first inventory shows a loader for its content. That wait must end: in the pane, or in
  // the pane saying that the browser could not open, with a way to try again.
  test("a pane with no inventory waits only while one is on its way, then says the browser could not open", () => {
    const start = replay(attach()).state

    const fail = (state: State): State =>
      transition(state, { type: "register.timed-out", sessionKey: key, attempt: attempt(state) }).state

    const retry = (state: State): State =>
      transition(state, { type: "retry.due", sessionKey: key, attempt: attempt(state) }).state

    // Each failure in a row, in backoff: the first PENDING_RETRIES still wait, the next does not.
    const failures = Array.from({ length: PENDING_RETRIES + 1 }).reduce<State[]>(
      (states) => [...states, fail(states.length ? retry(states[states.length - 1]!) : start)],
      [],
    )

    const unsupported = transition(start, paneState(start, null, "browser.pane.unsupported")).state
    const paused = replay(attach(), createInitialState({ status: "inactive" })).state
    const view = (state: State) => [sessionPending(state, target), sessionUnavailable(state, key)]

    expect(view(start)).toEqual([true, false])
    expect(failures.map(view)).toEqual([...Array.from({ length: PENDING_RETRIES }, () => [true, false]), [false, true]])
    // The timer's next registration changes nothing the person sees; their own retry of it waits again, without a
    // second registration.
    const again = retry(failures[failures.length - 1]!)
    const asked = transition(again, { type: "session.retry", sessionKey: key })
    expect(view(again)).toEqual([false, true])
    expect([view(asked.state), asked.effects]).toEqual([[true, false], []])
    expect(view(unsupported)).toEqual([false, true])
    // A paused pane says so itself, and one with an inventory shows its tabs.
    expect(view(paused)).toEqual([false, false])
    expect(view(ready(start))).toEqual([false, false])

    // The person's retry registers at once, in place of the timer, and waits again.
    for (const state of [failures[failures.length - 1]!, unsupported]) {
      const retried = transition(state, { type: "session.retry", sessionKey: key })
      expect(phase(retried.state)).toMatchObject({ status: "registering", attempts: 0 })
      expect(types(retried.effects).filter((type) => type !== "cancel-retry")).toEqual(["open-registration", "schedule-register-timeout"])
      expect(view(retried.state)).toEqual([true, false])
    }

    expect(types(transition(failures[0]!, { type: "session.retry", sessionKey: key }).effects)).toContain("cancel-retry")
    // Nothing to try again where the pane is on its first way, open, or another window's.
    const replaced = transition(start, paneState(start, null, "browser.pane.replaced")).state

    for (const state of [start, ready(start), replaced, paused])
      expect(transition(state, { type: "session.retry", sessionKey: key }).state).toBe(state)
  })

  test("a tab a link opens joins the strip at once, after the tab the desktop names, and keeps its new-tab label until its page is named", () => {
    const start = ready()
    const placed = { tabID: tabB, after: tabA }
    // The inventory as main reports it: with the tab it lists for the first time and where, and the tabs with no name yet.
    const report = (state: State, browser: Browser.State, rest: { unnamed?: Browser.TabID[]; placed?: typeof placed }): Event => ({ type: "pane.state", sessionKey: key, attempt: attempt(state), state: browser, error: undefined, ...rest })
    const strips = (effects: readonly MachineEffect[]) => effects.filter((effect) => effect.type === "sync-strip")
    const labels = (state: State) => [tabA, tabB, tabC].map((tabID) => tabUnnamed(state, key, tabID))
    // A link opened B: the strip adds it now, after A.
    const opened = transition(start, report(start, inventory(tab(tabA), tab(tabB), tab(tabC)), { placed, unnamed: [tabB] }))
    expect(strips(opened.effects)).toEqual([{ type: "sync-strip", sessionKey: key, keep: [tabA, tabB, tabC], open: [tabB, tabC], placed: [placed] }])
    expect(labels(opened.state)).toEqual([false, true, false])
    // Its page loads: the strip changes nothing, and the label stays.
    const loading = transition(opened.state, report(opened.state, inventory(tab(tabA), { ...tab(tabB), loading: true }, tab(tabC)), { unnamed: [tabB] }))
    expect(strips(loading.effects)).toEqual([{ type: "sync-strip", sessionKey: key, keep: [tabA, tabB, tabC], open: [] }])
    expect(labels(loading.state)).toEqual([false, true, false])
    // Its page named itself: the label is the page's from now on.
    const named = transition(loading.state, report(loading.state, inventory(tab(tabA), tab(tabB), tab(tabC)), {}))
    expect(strips(named.effects)).toEqual([{ type: "sync-strip", sessionKey: key, keep: [tabA, tabB, tabC], open: [] }])
    expect(labels(named.state)).toEqual([false, false, false])
    // A tab the strip has already is not placed again: it stays where the person sees it.
    const again = transition(named.state, report(named.state, inventory(tab(tabA), tab(tabB)), { placed }))
    expect(strips(again.effects)).toEqual([{ type: "sync-strip", sessionKey: key, keep: [tabA, tabB], open: [] }])
  })

  // The strip is the host's, which can drop a session's tabs without the browser: it keeps the strips of the 50
  // sessions used last, and a session that returns in another directory starts with none. The strip took only the
  // tabs new to an inventory, so the tabs the desktop still held stayed out, and the next tab to open stood alone.
  describe("the strip shows the desktop's inventory", () => {
    const tabD = id("d")
    const all = inventory(tab(tabA), tab(tabB), tab(tabC))
    // The inventory as the model reports it: with the browser tabs the session's strip stores at that moment.
    const report = (state: State, browser: Browser.State, stored: readonly string[], placed?: { tabID: Browser.TabID; after: Browser.TabID }): Event => ({ type: "pane.state", sessionKey: key, attempt: attempt(state), state: browser, error: undefined, stored, placed })
    const strips = (effects: readonly MachineEffect[]) => effects.filter((effect) => effect.type === "sync-strip")
    const close = (tabID: Browser.TabID): Event => ({ type: "session.command", sessionKey: key, action: { type: "tabs.close", tabID }, focusAddress: false })

    // A, B and C open, in the strip.
    const three = () => {
      const start = ready()

      return transition(start, report(start, all, [tabA])).state
    }

    test("a strip that lost its tabs gets back every tab the desktop holds, in the desktop's order, with the next report", () => {
      const start = three()
      // The host dropped the strip, and a new tab D opens.
      const next = transition(start, report(start, inventory(tab(tabA), tab(tabB), tab(tabC), tab(tabD)), []))
      expect(strips(next.effects)).toEqual([
        {
          type: "sync-strip",
          sessionKey: key,
          keep: [tabA, tabB, tabC, tabD],
          open: [tabA, tabB, tabC, tabD],
          placed: [{ tabID: tabB, after: tabA }, { tabID: tabC, after: tabB }],
        },
      ])
      // Once: the strip stores them again.
      const again = transition(next.state, report(next.state, inventory(tab(tabA), tab(tabB), tab(tabC), tab(tabD)), [tabA, tabB, tabC, tabD]))
      expect(strips(again.effects)).toEqual([{ type: "sync-strip", sessionKey: key, keep: [tabA, tabB, tabC, tabD], open: [] }])
    })

    test("only the tabs the strip lost come back, each after the tab before it, and a tab a link opens still stands where the desktop says", () => {
      const start = three()
      const placed = { tabID: tabD, after: tabA }
      const next = transition(start, report(start, inventory(tab(tabA), tab(tabD), tab(tabB), tab(tabC)), [tabA, tabC], placed))
      expect(strips(next.effects)).toEqual([
        { type: "sync-strip", sessionKey: key, keep: [tabA, tabD, tabB, tabC], open: [tabD, tabB], placed: [placed, { tabID: tabB, after: tabD }] },
      ])
    })

    test("the person coming back to the session gives its strip the tabs it lost, with no report from the desktop", () => {
      const start = three()
      const back = transition(start, { type: "strip.read", sessionKey: key, stored: [] })
      expect(back.effects).toEqual([
        { type: "sync-strip", sessionKey: key, keep: undefined, open: [tabA, tabB, tabC], placed: [{ tabID: tabB, after: tabA }, { tabID: tabC, after: tabB }] },
      ])
      expect(back.state).toBe(start)
      // A strip that has them all, one whose session has no location, and one with no inventory yet, are left alone.
      expect(transition(start, { type: "strip.read", sessionKey: key, stored: [tabC, tabA, tabB] })).toEqual({ state: start, effects: [] })
      const unlocated = transition(start, { type: "session.located", sessionKey: key, located: false }).state
      expect(transition(unlocated, { type: "strip.read", sessionKey: key, stored: [] }).effects).toEqual([])
      const waiting = replay(attach()).state
      expect(transition(waiting, { type: "strip.read", sessionKey: key, stored: [] }).effects).toEqual([])
    })

    test("the tab the agent works in next does not stand alone: the strip gets the others back before it is selected", () => {
      const start = three()
      // The model reads the strip, which the host dropped, before main's request to bring B to the front lands.
      const next = replay([{ type: "strip.read", sessionKey: key, stored: [] }, { type: "pane.focus", sessionKey: key, attempt: attempt(start), tabID: tabB }], start)
      expect(next.effects).toEqual([
        { type: "sync-strip", sessionKey: key, keep: undefined, open: [tabA, tabB, tabC], placed: [{ tabID: tabB, after: tabA }, { tabID: tabC, after: tabB }] },
        { type: "focus-strip-tab", sessionKey: key, tabID: tabB },
      ])
    })

    test("a layout that cannot be read yet says nothing about the strip", () => {
      const start = three()
      expect(strips(transition(start, paneState(start, all)).effects)).toEqual([{ type: "sync-strip", sessionKey: key, keep: [tabA, tabB, tabC], open: [] }])
    })

    test("a tab the person closes in the strip stays out until the desktop answers, and comes back only if it kept the tab", () => {
      const start = three()
      // The strip dropped B at the click; the desktop has not closed it yet when its next report arrives.
      const closing = transition(start, close(tabB))
      const request = closing.effects.flatMap((effect) => (effect.type === "send-command" ? [effect.request] : []))[0] ?? -1
      const early = transition(closing.state, report(closing.state, all, [tabA, tabC]))
      expect(strips(early.effects)).toEqual([{ type: "sync-strip", sessionKey: key, keep: [tabA, tabB, tabC], open: [] }])
      expect(transition(early.state, { type: "strip.read", sessionKey: key, stored: [tabA, tabC] }).effects).toEqual([])
      // It closed the tab: nothing to bring back, before or after the command's answer.
      const gone = transition(early.state, report(early.state, inventory(tab(tabA), tab(tabC)), [tabA, tabC]))
      expect(strips(gone.effects)).toEqual([{ type: "sync-strip", sessionKey: key, keep: [tabA, tabC], open: [] }])
      expect(attachment(gone.state)?.strip.closing).toEqual([])
      // Or its page asked to stay and the person agreed: the command is answered with the tab still open.
      const stayed = transition(early.state, { type: "command.settled", sessionKey: key, request })
      expect(strips(transition(stayed.state, report(stayed.state, all, [tabA, tabC])).effects)).toEqual([
        { type: "sync-strip", sessionKey: key, keep: [tabA, tabB, tabC], open: [tabB], placed: [{ tabID: tabB, after: tabA }] },
      ])
      // A close that failed leaves the tab open too.
      const failed = transition(early.state, { type: "command.failed", sessionKey: key, attempt: attempt(early.state), request, action: { type: "tabs.close", tabID: tabB }, error: "browser.command.failed", unavailable: false })
      expect(attachment(failed.state)?.strip.closing).toEqual([])
    })

    test("a tab closed while no binding can take the close is closed on the desktop with its next inventory, and stays out", () => {
      const start = three()
      // Main closed the binding: the window waits to register again, with its tabs.
      const waiting = transition(start, paneState(start, all, "browser.pane.registration.closed")).state
      const closed = transition(waiting, close(tabB))
      expect(types(closed.effects)).toEqual(["reject-command"])
      const again = transition(closed.state, { type: "retry.due", sessionKey: key, attempt: attempt(closed.state) }).state
      const arrived = transition(again, report(again, all, [tabA, tabC]))
      expect(strips(arrived.effects)).toEqual([{ type: "sync-strip", sessionKey: key, keep: [tabA, tabB, tabC], open: [] }])
      expect(arrived.effects.flatMap((effect) => (effect.type === "send-command" ? [effect.action] : []))).toEqual([{ type: "tabs.close", tabID: tabB }])
      // The desktop's next report still has B, on its way out: the strip does not take it back.
      expect(strips(transition(arrived.state, report(arrived.state, all, [tabA, tabC])).effects)).toEqual([{ type: "sync-strip", sessionKey: key, keep: [tabA, tabB, tabC], open: [] }])
    })
  })

  // A tab drawn from the saved state can be closed or selected before the desktop reports it. With no inventory there
  // was no command to send, so the first inventory put a closed tab back in the strip.
  test("a saved tab closed or selected before the first inventory is closed or focused on the desktop once it arrives", () => {
    const start = replay(attach()).state
    const registering = attempt(start)

    const early = replay(
      [
        { type: "strip.tab.selected", sessionKey: key, tabID: tabB },
        { type: "strip.tab.closed", sessionKey: key, tabID: tabA },
        { type: "strip.tab.closed", sessionKey: key, tabID: tabA },
      ],
      start,
    )

    expect(early.effects).toEqual([])

    const arrived = transition(
      early.state,
      paneState(early.state, { tabs: [tab(tabA), tab(tabB), tab(tabC)], focusedTabID: tabA }),
    )

    expect(arrived.effects).toEqual([
      { type: "cancel-register-timeout", sessionKey: key },
      { type: "record-history", sessionKey: key },
      // The strip takes the tabs it lacks, and not the one the person closed.
      { type: "sync-strip", sessionKey: key, keep: [tabA, tabB, tabC], open: [tabB, tabC] },
      { type: "send-command", sessionKey: key, attempt: registering, request: registering + 1, action: { type: "tabs.close", tabID: tabA } },
      { type: "send-command", sessionKey: key, attempt: registering, request: registering + 2, action: { type: "tabs.focus", tabID: tabB } },
    ])

    // Once: the next inventory sends nothing, and with an inventory a close or a selection is the model's command.
    const next = transition(arrived.state, paneState(arrived.state, inventory(tab(tabC), tab(tabB))))
    expect(types(next.effects)).toEqual(["record-history", "sync-strip"])
    expect(replay(
      [
        { type: "strip.tab.closed", sessionKey: key, tabID: tabC },
        { type: "strip.tab.selected", sessionKey: key, tabID: tabC },
      ],
      next.state,
    ).state).toBe(next.state)

    // The tab the desktop already has in front needs no command, and a closed tab the desktop lacks none either.
    const front = replay(
      [
        { type: "strip.tab.selected", sessionKey: key, tabID: tabA },
        { type: "strip.tab.closed", sessionKey: key, tabID: tabB },
      ],
      start,
    ).state

    expect(types(transition(front, paneState(front, inventory(tab(tabA)))).effects)).not.toContain("send-command")
  })

  test("a saved tab closed while the strip cannot be written is not mirrored back once it can", () => {
    const start = replay(attach(key, false)).state
    const closed = transition(start, { type: "strip.tab.closed", sessionKey: key, tabID: tabA }).state

    const located = replay(
      [
        paneState(closed, inventory(tab(tabA), tab(tabB))),
        { type: "session.located", sessionKey: key, located: true },
      ],
      closed,
    )

    expect(located.effects.filter((effect) => effect.type === "sync-strip")).toEqual([
      { type: "sync-strip", sessionKey: key, keep: [tabA, tabB], open: [tabB] },
    ])
    expect(located.effects).toContainEqual(
      expect.objectContaining({ type: "send-command", action: { type: "tabs.close", tabID: tabA } }),
    )
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

  test("a cold location keeps every other session on its server running and retries on plugin update", () => {
    const start = ready(replay([...attach(), ...attach(other)]).state)
    const unsupported = transition(start, paneState(start, null, "browser.pane.unsupported"))
    expect(sessionSupported(unsupported.state, key)).toBe(false)
    expect(attachment(unsupported.state,other)).toBe(attachment(start,other))
    expect(unsupported.effects).toEqual([
      { type: "close-registration", sessionKey: key, attempt: attempt(start) },
    ])
    expect(replay(attach(), unsupported.state).state).toBe(unsupported.state)

    const changed = transition(unsupported.state, { type: "session.capability.changed", sessionKey:key })
    expect(sessionSupported(changed.state,key)).toBe(true)
    expect(types(changed.effects)).toEqual(["open-registration", "schedule-register-timeout"])
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
          action: { type: "tabs.open" },
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

  const navigate: Browser.Action = { type: "navigate", tabID: tabA, url: "ftp://files.example/" }

  const refused = (state: State, request = 1): Event => ({
    type: "command.failed",
    sessionKey: key,
    attempt: attempt(state),
    request,
    action: navigate,
    error: "browser.address.web",
    unavailable: false,
  })

  test("a failed command stays with what was attempted until its tab moves on or the person dismisses it", () => {
    const start = ready()
    const failed = transition(start, refused(start)).state
    expect(sessionFailure(failed, key)).toEqual({ id: 1, code: "browser.address.web", action: navigate })

    // The same page reporting again, such as a new title, is not a reason to take the notice away unread.
    const titled = transition(failed, paneState(failed, inventory({ ...tab(tabA), title: "Renamed" }))).state
    expect(sessionError(titled, key)).toBe("browser.address.web")
    // Another document in that tab is: the notice was about the page that was there.
    const moved = transition(titled, paneState(titled, inventory({ ...tab(tabA), generation: 1 }))).state
    expect(sessionFailure(moved, key)).toBeUndefined()

    // Only the notice the person closed goes; a stale dismissal leaves a newer failure.
    expect(transition(failed, { type: "failure.dismissed", sessionKey: key, id: 7 }).state).toBe(failed)
    expect(sessionFailure(transition(failed, { type: "failure.dismissed", sessionKey: key, id: 1 }).state, key)).toBeUndefined()
  })

  test("an error main reports is one failure however often the inventory repeats it", () => {
    const start = ready()
    const reported = transition(start, paneState(start, inventory(tab(tabA)), "download_failed")).state
    const first = sessionFailure(reported, key)
    expect(first).toMatchObject({ code: "download_failed", action: undefined })
    const repeated = transition(reported, paneState(reported, inventory(tab(tabA)), "download_failed")).state
    expect(sessionFailure(repeated, key)).toEqual(first)
    const another = transition(repeated, paneState(repeated, inventory(tab(tabA)), "browser.menu.failed")).state
    expect(sessionFailure(another, key)?.id).not.toBe(first?.id)
  })

  test("a command clears the error at once and an unreachable pane fails it without one", () => {
    const start = ready()

    const failed = transition(start, refused(start)).state

    const sent = transition(failed, command())
    expect(sessionError(sent.state, key)).toBeUndefined()
    expect(sent.effects).toEqual([expect.objectContaining({ type: "send-command", attempt: attempt(start) })])

    const lost = transition(sent.state, {
      type: "command.failed",
      sessionKey: key,
      attempt: attempt(start),
      request: 2,
      action: navigate,
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
        { type: "session.wake", sessionKey: key, takes: false },
        { type: "session.wake", sessionKey: key, takes: false },
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
        { type: "session.wake", sessionKey: key, takes: false },
        { type: "register.timed-out", sessionKey: key, attempt: attempt(start) },
      ],
      blocked.state,
    )

    expect(later.effects).toEqual([])
  })

  // Another window that opens the session takes its browser. That window may close, and the person may come back to
  // the session here: its browser must not stay gone for as long as the app runs.
  test("a session another window took comes back with a wake that takes it, and stays on offer meanwhile", () => {
    const start = ready()
    const replaced = transition(start, paneState(start, null, "browser.pane.replaced")).state
    expect(phase(replaced)).toEqual({ status: "blocked", reason: "replaced" })
    expect(sessionOpenable(replaced, key)).toBe(true)
    expect(transition(replaced, { type: "session.wake", sessionKey: key, takes: false }).state).toBe(replaced)

    const taken = transition(replaced, { type: "session.wake", sessionKey: key, takes: true })
    expect(phase(taken.state)?.status).toBe("registering")
    expect(sessionFailure(taken.state, key)).toBeUndefined()
    // Main restores the tabs it saved for the session: the window forgot them with the block.
    expect(taken.effects).toEqual([
      { type: "open-registration", sessionKey: key, attempt: attempt(taken.state), restore: undefined },
      { type: "schedule-register-timeout", sessionKey: key, attempt: attempt(taken.state), delayMs: REGISTER_TIMEOUT_MS },
    ])
  })

  test.each(["browser.pane.missing", "browser.pane.unsupported"])("%s is neither on offer nor lifted by a wake that takes", (error) => {
    const start = replay(attach()).state
    const blocked = transition(start, paneState(start, null, error)).state
    expect(sessionOpenable(blocked, key)).toBe(false)
    expect(transition(blocked, { type: "session.wake", sessionKey: key, takes: true }).state).toBe(blocked)
  })

  test("a missing session waits without an error until the server creates it", () => {
    const start = replay(attach()).state
    const missing = transition(start, paneState(start, null, "browser.pane.missing")).state
    expect(sessionError(missing, key)).toBeUndefined()
    expect(transition(missing, { type: "session.wake", sessionKey: key, takes: false }).state).toBe(missing)
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
    expect(transition(disposed.state, { type: "session.wake", sessionKey: key, takes: false }).state).toBe(disposed.state)
  })

  // The model reconciles the state into its store in place, so an object two attachments share carries one's change
  // into the other.
  test("attachments share no object, empty ones included", () => {
    // Every object an attachment holds.
    const objects = (value: Attachment | undefined) =>
      new Set<object>(
        value
          ? [
              value,
              value.phase,
              value.embeds,
              value.strip,
                value.strip.mirrored,
                value.unseen,
              value.addressFocus,
              ...(value.addressFocus.status === "opening" ? [value.addressFocus.known] : []),
              ...(value.browser ? [value.browser, value.browser.tabs, ...value.browser.tabs] : []),
            ]
          : [],
      )

    const states = [
      replay([...attach(), ...attach(other)]).state,
      replay([...attach(key, false), ...attach(other, false)]).state,
      replay([...attach(), ...attach(other)], createInitialState({ status: "pending" })).state,
    ]

    const both = states.flatMap((start) => {
      const alpha = ready(start)
      const lost = transition(alpha, { type: "ipc.changed", ipc: { status: "pending" } }).state

      return [start, alpha, transition(alpha, command(true)).state, lost]
    })

    for (const state of both) {
      const alpha = objects(attachment(state))
      expect([...objects(attachment(state, other))].filter((item) => alpha.has(item))).toEqual([])
    }
  })

  test("list absence suspends, reappearance restores, and only explicit deletion forgets", () => {
    const start = ready()
    const tabs = inventory(tab(tabA),tab(tabB))
    const listed = transition(start,paneState(start,tabs)).state
    const absent = transition(listed,{type:"session.presence",sessionKey:key,listed:false})
    expect(types(absent.effects)).toEqual(["close-registration"])
    expect(attachment(absent.state)?.browser).toEqual(tabs)
    const resumed = transition(absent.state,{type:"session.presence",sessionKey:key,listed:true})
    expect(resumed.effects).toContainEqual(expect.objectContaining({type:"open-registration",restore:tabs}))
    expect(transition(start, { type: "session.removed", sessionKeys: [key, other] }).effects).toEqual([
      { type: "close-registration", sessionKey: key, attempt: attempt(start) },
      { type:"forget-tabs",sessionKey:key },
      { type: "detach", sessionKey: key },
    ])
    expect(transition(start, { type: "session.removed", sessionKeys: [other] }).state).toBe(start)
  })
})
