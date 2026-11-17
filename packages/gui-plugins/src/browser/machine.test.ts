import { describe, expect, test } from "bun:test"
import { Browser } from "@opencode/plugin-browser/rpc"
import {
  addressFocusTab,
  createInitialState,
  REGISTER_TIMEOUT_MS,
  sessionSupported,
  sessionError,
  sessionFailure,
  sessionPending,
  sessionRegistration,
  revealGuard,
  sessionSuspended,
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
  // A preview of tab A for the routed session, in a window with room, with the pane closed.
  const activity = (state: State) => ({ type: "pane.activity" as const, sessionKey: key, attempt: attempt(state),
    tabID: tabA, reveal: "tab" as const, room: true, enabled: true, onScreen: true, opened: false, visible: false })

  const side = (open: boolean): Event => ({ type: "side.changed", sessionKey: key, open, running: true })

  // "open": the tab is selected behind the click guard. "select": selected and marked, with no guard, as nobody is
  // looking. "mark": only the unseen mark. "none": nothing.
  test.each([
    ["a preview with the pane closed", {}, "open"],
    ["a preview with another browser tab, Review or Files selected", { opened: true }, "open"],
    ["a focused new tab with the pane closed", { reveal: "pane" }, "open"],
    ["a focused new tab with another tab selected", { reveal: "pane", opened: true }, "mark"],
    ["target already visible", { opened: true, visible: true }, "none"],
    ["a preview of the tab a closed pane has selected", { visible: true }, "open"],
    ["a preview for a session off screen or in a hidden window", { onScreen: false }, "select"],
    ["a preview off screen with the setting turned off", { onScreen: false, enabled: false }, "mark"],
    ["a focused new tab off screen", { onScreen: false, reveal: "pane" }, "none"],
    ["the setting turned off", { enabled: false }, "mark"],
    ["open pane with the setting turned off", { enabled: false, opened: true }, "mark"],
    ["no room beside the chat", { room: false }, "mark"],
    ["navigate, popup, focus, implicit open or quiet tab", { reveal: "none" }, "mark"],
    ["superseded binding", { attempt: -1 }, "none"],
    ["since-closed tab", { tabID: tabB }, "none"],
  ] as const)("agent navigation, preview or new tab: %s", (_label, input, expected) => {
    const start = ready()
    const next = transition(start, { ...activity(start), ...input })
    expect(types(next.effects)).toEqual(expected === "open" || expected === "select" ? ["focus-strip-tab"] : [])
    expect(attachment(next.state)?.unseen).toEqual(expected === "mark" || expected === "select" ? [tabA] : [])
    expect(revealGuard(next.state, key, tabA) !== undefined).toBe(expected === "open")
  })

  test("closing the pane the agent showed its page in wins until reopening it or finishing the run", () => {
    const start = ready()
    const shown = transition(start, activity(start)).state
    const hidden = replay([side(true), side(false)], shown).state
    expect(attachment(hidden)?.side).toBe("dismissed")
    expect(transition(hidden, activity(hidden)).effects).toEqual([])
    const nextRun = transition(hidden, { type: "execution.ended", sessionKey: key }).state
    expect(types(transition(nextRun, activity(nextRun)).effects)).toEqual(["focus-strip-tab"])
    const mark = replay([side(true), { ...activity(hidden), reveal: "pane", opened: true }], hidden).state
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

  test("a show request that arrives before its tab's inventory lands with it, after the strip has the tab", () => {
    const start = ready()
    const early = transition(start, { ...activity(start), tabID: tabB })
    expect(early.effects).toEqual([])
    const landed = transition(early.state, paneState(early.state, inventory(tab(tabA), tab(tabB))))

    expect(landed.effects).toEqual([
      { type: "sync-strip", sessionKey: key, keep: [tabA, tabB], open: [tabB] },
      { type: "record-history", sessionKey: key },
      { type: "focus-strip-tab", sessionKey: key, tabID: tabB },
    ])
    expect(revealGuard(landed.state, key, tabB)).toBeDefined()
    // It lands once.
    expect(types(transition(landed.state, paneState(landed.state, inventory(tab(tabA), tab(tabB)))).effects)).not.toContain("focus-strip-tab")
  })

  test("a show request that arrives before the strip can be written lands when it can", () => {
    const start = replay(attach(key, false)).state
    const listed = transition(start, paneState(start, inventory(tab(tabA)))).state
    const early = transition(listed, activity(listed))
    expect(early.effects).toEqual([])
    const located = transition(early.state, { type: "session.located", sessionKey: key, located: true })

    expect(located.effects).toEqual([
      { type: "sync-strip", sessionKey: key, keep: [tabA], open: [tabA] },
      { type: "focus-strip-tab", sessionKey: key, tabID: tabA },
    ])
    expect(revealGuard(located.state, key, tabA)).toBeDefined()
  })

  test("a newer request replaces a kept one, and a kept mark lands as a mark", () => {
    const start = ready()

    const kept = replay(
      [{ ...activity(start), tabID: tabB }, { ...activity(start), tabID: tabC, reveal: "none" }],
      start,
    ).state

    const landed = transition(kept, paneState(kept, inventory(tab(tabA), tab(tabB), tab(tabC))))
    expect(types(landed.effects)).not.toContain("focus-strip-tab")
    expect(attachment(landed.state)?.unseen).toEqual([tabC])
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
