import { describe, expect, test } from "bun:test"
import { Session } from "@opencode/schema/session"
import { Schema } from "effect"
import { BrowserMachine } from "../src/machine.js"
import { Browser } from "../src/rpc.js"

const sessionID = Session.ID.make("ses_browser")
const other = Session.ID.make("ses_other")
const tabID = Browser.TabID.make(`tab_${crypto.randomUUID()}`)
const tab = {
  id: tabID,
  url: "https://example.com/",
  title: "Example",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  generation: 1,
}
const command: Browser.Command = { action: { type: "tabs.list" }, files: [] }
const success = Schema.decodeUnknownSync(Browser.Outcome)({
  type: "success",
  result: { value: { ok: true }, files: [] },
})
const failure = Schema.decodeUnknownSync(Browser.Outcome)({ type: "failure", code: "navigation", message: "Blocked" })

type Event = BrowserMachine.ConnectionEvent

function run(state: BrowserMachine.ConnectionState, ...events: Event[]) {
  return events.reduce(
    (result, event) => {
      const next = BrowserMachine.transitionConnection(result.state, event)
      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] as BrowserMachine.ConnectionEffect[] },
  )
}

/** `attach.started` with the attempt the driver reads from `selectNextAttempt` at that moment. */
function attach(state: BrowserMachine.ConnectionState, connectionID: string, id = sessionID): Event {
  return { type: "attach.started", sessionID: id, attempt: BrowserMachine.selectNextAttempt(state), connectionID }
}

function entry(state: BrowserMachine.ConnectionState, id = sessionID) {
  return state.sessions.get(id)
}

function syncs(effects: readonly BrowserMachine.ConnectionEffect[]) {
  return effects.flatMap((effect) => (effect.type === "sync-permissions" ? [effect] : []))
}

function lastSync(effects: readonly BrowserMachine.ConnectionEffect[]) {
  const sync = syncs(effects).at(-1)
  if (!sync) throw new Error("expected a permission sync")
  return sync
}

function synced(attempt: number, id = sessionID): Event {
  return { type: "permissions.synced", sessionID: id, attempt }
}

function controls(effects: readonly BrowserMachine.ConnectionEffect[]) {
  return effects.flatMap((effect) => (effect.type === "emit-control" ? [effect.control] : []))
}

function settlements(effects: readonly BrowserMachine.ConnectionEffect[]) {
  return effects.flatMap((effect) => (effect.type === "settle-request" ? [effect] : []))
}

function message(settlement: BrowserMachine.RequestSettlement) {
  return settlement.ok ? undefined : settlement.error.message
}

/** An attached `conn_1`, as the desktop sees it once its grant succeeded. */
function attached(connectionID = "conn_1") {
  const initial = BrowserMachine.createConnectionState()
  const started = run(initial, attach(initial, connectionID))
  return run(started.state, synced(lastSync(started.effects).attempt)).state
}

function started(requestID: string, connectionID = "conn_1"): Event {
  return { type: "request.started", sessionID, connectionID, requestID, command }
}

describe("attachment replace", () => {
  test("a replaced attachment never revokes its replacement's grant", () => {
    const first = attached()
    const replace = run(first, attach(first, "conn_2"))
    expect(replace.effects).toContainEqual({ type: "close-attachment", attempt: 1, outcome: "replaced" })
    expect(entry(replace.state)?.status).toBe("attaching")

    // conn_1's RPC scope ends after the replace; that must not touch the session.
    const closed = BrowserMachine.transitionConnection(replace.state, {
      type: "attach.closed",
      sessionID,
      attempt: 1,
    })
    expect(closed.state).toBe(replace.state)
    expect(closed.effects).toEqual([])

    const done = run(replace.state, synced(lastSync(replace.effects).attempt))
    expect(controls(done.effects)).toEqual([{ type: "attached", connectionID: "conn_2", version: 4 }])
    expect(syncs([...replace.effects, ...done.effects]).every((sync) => sync.allow)).toBe(true)
    expect(entry(done.state)).toMatchObject({ status: "attached", connectionID: "conn_2" })
  })

  test("a re-attach waits for the revoke in flight, then grants", () => {
    const closed = run(attached(), { type: "attach.closed", sessionID, attempt: 1 })
    const revoke = lastSync(closed.effects)
    expect(revoke).toMatchObject({ allow: false })

    const reattach = run(closed.state, attach(closed.state, "conn_2"))
    expect(reattach.effects).toEqual([])
    expect(entry(reattach.state)).toMatchObject({
      status: "attaching",
      sync: { attempt: revoke.attempt, allow: false },
    })

    const revoked = run(reattach.state, synced(revoke.attempt))
    const grant = lastSync(revoked.effects)
    expect(grant).toMatchObject({ allow: true })
    expect(controls(revoked.effects)).toEqual([])

    const done = run(revoked.state, synced(grant.attempt))
    expect(controls(done.effects)).toEqual([{ type: "attached", connectionID: "conn_2", version: 4 }])
  })

  test("a replace while attaching reuses the grant in flight and hands `attached` only to the replacement", () => {
    const initial = BrowserMachine.createConnectionState()
    const first = run(initial, attach(initial, "conn_1"))
    const grant = lastSync(first.effects)
    const replace = run(first.state, attach(first.state, "conn_2"))
    expect(replace.effects).toEqual([{ type: "close-attachment", attempt: 1, outcome: "replaced" }])

    const done = run(replace.state, synced(grant.attempt))
    expect(controls(done.effects)).toEqual([{ type: "attached", connectionID: "conn_2", version: 4 }])
  })
})

describe("handshake", () => {
  test("no tool reaches an attachment before its grant succeeds", () => {
    const initial = BrowserMachine.createConnectionState()
    const first = run(initial, attach(initial, "conn_1"))
    expect(controls(first.effects)).toEqual([])
    expect(BrowserMachine.selectTarget(first.state, sessionID, { type: "tabs.list" })).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("still connecting") },
    })

    const early = BrowserMachine.transitionConnection(first.state, started("req_1"))
    expect(early.state).toBe(first.state)
    expect(early.effects).toEqual([
      { type: "settle-request", requestID: "req_1", settlement: { ok: false, error: expect.anything() } },
    ])

    const report = BrowserMachine.transitionConnection(first.state, {
      type: "state.updated",
      sessionID,
      connectionID: "conn_1",
      browserState: { tabs: [tab], focusedTabID: tabID },
    })
    expect(report.state).toBe(first.state)

    const done = run(first.state, synced(lastSync(first.effects).attempt))
    expect(controls(done.effects)).toEqual([{ type: "attached", connectionID: "conn_1", version: 4 }])
    expect(BrowserMachine.selectTarget(done.state, sessionID, { type: "tabs.list" })).toMatchObject({
      ok: true,
      connectionID: "conn_1",
    })
  })

  test.each(["attach.closed", "session.moved"] as const)(
    "%s while attaching never sends `attached` and revokes after the grant settles",
    (type) => {
      const initial = BrowserMachine.createConnectionState()
      const first = run(initial, attach(initial, "conn_1"))
      const grant = lastSync(first.effects)
      const closed = run(first.state, type === "attach.closed" ? { type, sessionID, attempt: 1 } : { type, sessionID })
      expect(closed.effects).toEqual([{ type: "close-attachment", attempt: 1, outcome: "closed" }])

      const settled = run(closed.state, synced(grant.attempt))
      expect(controls(settled.effects)).toEqual([])
      const revoke = lastSync(settled.effects)
      expect(revoke).toMatchObject({ allow: false })

      const done = run(settled.state, synced(revoke.attempt))
      expect(entry(done.state)).toBeUndefined()
      expect(done.effects).toEqual([])
    },
  )

  test("a request for an attachment that closed after the tool selected it is never sent", () => {
    const first = attached()
    expect(BrowserMachine.selectTarget(first, sessionID, { type: "tabs.list" })).toMatchObject({
      ok: true,
      connectionID: "conn_1",
    })
    const replaced = run(first, attach(first, "conn_2"))
    const synced2 = run(replaced.state, synced(lastSync(replaced.effects).attempt)).state

    const late = BrowserMachine.transitionConnection(synced2, started("req_1", "conn_1"))
    expect(late.state).toBe(synced2)
    expect(late.effects).toHaveLength(1)
    expect(message(settlements(late.effects)[0]!.settlement)).toContain("no action ran")
  })
})

describe("permission syncs", () => {
  test.each([
    { type: "permissions.failed" as const, error: new Error("session gone") },
    { type: "permissions.timed-out" as const },
  ])("a grant that ends with $type fails the attach and revokes what it may have written", (failed) => {
    const initial = BrowserMachine.createConnectionState()
    const first = run(initial, attach(initial, "conn_1"))
    const grant = lastSync(first.effects)
    const next = run(first.state, { ...failed, sessionID, attempt: grant.attempt })
    expect(next.effects).toContainEqual({ type: "close-attachment", attempt: 1, outcome: "unavailable" })
    expect(next.effects.some((effect) => effect.type === "warn")).toBe(true)
    expect(controls(next.effects)).toEqual([])
    const revoke = lastSync(next.effects)
    expect(revoke).toMatchObject({ allow: false })

    const done = run(next.state, { type: "permissions.failed", sessionID, attempt: revoke.attempt, error: undefined })
    expect(entry(done.state)).toBeUndefined()
    expect(syncs(done.effects)).toEqual([])
  })

  test("a failed revoke before a re-attach still grants the new attachment", () => {
    const closed = run(attached(), { type: "attach.closed", sessionID, attempt: 1 })
    const reattach = run(closed.state, attach(closed.state, "conn_2"))
    const next = run(reattach.state, {
      type: "permissions.timed-out",
      sessionID,
      attempt: lastSync(closed.effects).attempt,
    })
    expect(lastSync(next.effects)).toMatchObject({ allow: true })
    expect(entry(next.state)).toMatchObject({ status: "attaching", connectionID: "conn_2" })
  })

  test("stale sync results and stale attach events change nothing", () => {
    const initial = BrowserMachine.createConnectionState()
    const first = run(initial, attach(initial, "conn_1"))
    for (const event of [
      synced(99),
      { type: "permissions.failed", sessionID, attempt: 99, error: undefined },
      { type: "permissions.timed-out", sessionID, attempt: 99 },
      synced(lastSync(first.effects).attempt, other),
      { type: "attach.closed", sessionID, attempt: 99 },
      { type: "attach.started", sessionID, attempt: 1, connectionID: "conn_9" },
    ] satisfies Event[]) {
      const next = BrowserMachine.transitionConnection(first.state, event)
      expect(next.state).toBe(first.state)
      expect(next.effects).toEqual([])
    }
  })
})

describe("reconcileBrowserPermissions", () => {
  const user = { action: "bash", resource: "*", effect: "ask" } as const
  const allows = BrowserMachine.ACCESS.map((rule) => ({ ...rule, effect: "allow" as const }))

  test("granting what is already granted writes nothing", () => {
    expect(BrowserMachine.reconcileBrowserPermissions([user, ...allows], true)).toBeUndefined()
    expect(BrowserMachine.reconcileBrowserPermissions([user], false)).toBeUndefined()
    expect(BrowserMachine.reconcileBrowserPermissions(undefined, false)).toBeUndefined()
  })

  test("revoking removes every duplicate and keeps the user's rules in order", () => {
    expect(BrowserMachine.reconcileBrowserPermissions([...allows, user, ...allows], false)).toEqual([user])
    expect(BrowserMachine.reconcileBrowserPermissions([...allows, user, ...allows], true)).toEqual([user, ...allows])
    expect(BrowserMachine.reconcileBrowserPermissions(undefined, true)).toEqual(allows)
  })

  test("browser denies are not browser allows", () => {
    const deny = { action: "browser", resource: "*", effect: "deny" } as const
    expect(BrowserMachine.reconcileBrowserPermissions([deny], false)).toBeUndefined()
  })
})

describe("requests", () => {
  const live = () => {
    const state = attached()
    return run(state, started("req_1"))
  }

  test("a started request dispatches once and keeps its command for the desktop", () => {
    const next = live()
    expect(next.effects).toEqual([{ type: "dispatch-command", sessionID, connectionID: "conn_1", requestID: "req_1" }])
    expect(BrowserMachine.selectPendingCommand(next.state, sessionID, "conn_1", "req_1")).toBe(command)
    expect(BrowserMachine.selectPendingCommand(next.state, sessionID, "conn_2", "req_1")).toBeUndefined()
  })

  test.each([
    { outcome: success, expected: { ok: true, result: { value: { ok: true }, files: [] } } },
    {
      outcome: failure,
      expected: { ok: false, error: expect.objectContaining({ message: "[browser.navigation] Blocked" }) },
    },
  ])("a result settles the request ($outcome.type)", ({ outcome, expected }) => {
    const next = run(live().state, {
      type: "request.settled",
      sessionID,
      connectionID: "conn_1",
      requestID: "req_1",
      outcome,
    })
    expect(next.effects).toEqual([{ type: "settle-request", requestID: "req_1", settlement: expected }])
    expect(BrowserMachine.selectPendingCommand(next.state, sessionID, "conn_1", "req_1")).toBeUndefined()
  })

  test("a failed dispatch settles without a cancel", () => {
    const next = run(live().state, {
      type: "request.dispatch-failed",
      sessionID,
      connectionID: "conn_1",
      requestID: "req_1",
      error: new Error("bus closed"),
    })
    expect(controls(next.effects)).toEqual([])
    expect(message(settlements(next.effects)[0]!.settlement)).toContain("Could not dispatch browser.tabs.list")
  })

  test("a timeout settles and cancels on the desktop", () => {
    const next = run(live().state, { type: "request.timed-out", sessionID, connectionID: "conn_1", requestID: "req_1" })
    expect(message(settlements(next.effects)[0]!.settlement)).toContain("[browser.timeout]")
    expect(controls(next.effects)).toEqual([{ type: "cancel", connectionID: "conn_1", requestID: "req_1" }])
  })

  test("an interrupted caller cancels on the desktop without a settlement", () => {
    const next = run(live().state, { type: "request.cancelled", sessionID, connectionID: "conn_1", requestID: "req_1" })
    expect(next.effects).toEqual([
      { type: "emit-control", control: { type: "cancel", connectionID: "conn_1", requestID: "req_1" } },
    ])
  })

  test("a close fails pending requests as possibly run, without a cancel", () => {
    const next = run(live().state, { type: "attach.closed", sessionID, attempt: 1 })
    expect(controls(next.effects)).toEqual([])
    expect(message(settlements(next.effects)[0]!.settlement)).toContain("the action may already have run")
  })

  test("late results after a settlement change nothing", () => {
    const settled = run(live().state, {
      type: "request.settled",
      sessionID,
      connectionID: "conn_1",
      requestID: "req_1",
      outcome: success,
    }).state
    for (const event of [
      { type: "request.settled", sessionID, connectionID: "conn_1", requestID: "req_1", outcome: success },
      { type: "request.timed-out", sessionID, connectionID: "conn_1", requestID: "req_1" },
      { type: "request.cancelled", sessionID, connectionID: "conn_1", requestID: "req_1" },
      { type: "request.dispatch-failed", sessionID, connectionID: "conn_1", requestID: "req_1", error: undefined },
    ] satisfies Event[]) {
      const next = BrowserMachine.transitionConnection(settled, event)
      expect(next.state).toBe(settled)
      expect(next.effects).toEqual([])
    }
  })
})

describe("browser state", () => {
  test("the reported inventory resolves tab targets; another connection's report is ignored", () => {
    const state = attached()
    const browserState = { tabs: [tab], focusedTabID: tabID }
    const stale = BrowserMachine.transitionConnection(state, {
      type: "state.updated",
      sessionID,
      connectionID: "conn_2",
      browserState,
    })
    expect(stale.state).toBe(state)
    expect(BrowserMachine.selectTarget(state, sessionID, { type: "back", tabID })).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("[browser.tab_unavailable]") },
    })

    const next = run(state, { type: "state.updated", sessionID, connectionID: "conn_1", browserState })
    expect(BrowserMachine.selectTarget(next.state, sessionID, { type: "back", tabID })).toMatchObject({ ok: true, tab })
  })
})

describe("session lifecycle", () => {
  test("deleting an attached session closes it without a revoke", () => {
    const next = run(attached(), { type: "session.deleted", sessionID })
    expect(next.effects).toEqual([{ type: "close-attachment", attempt: 1, outcome: "closed" }])
    expect(entry(next.state)).toBeUndefined()
  })

  test("deleting an attaching session ends after its grant settles, without a revoke", () => {
    const initial = BrowserMachine.createConnectionState()
    const first = run(initial, attach(initial, "conn_1"))
    const deleted = run(first.state, { type: "session.deleted", sessionID })
    expect(entry(deleted.state)).toMatchObject({ status: "revoking", deleted: true })

    const done = run(deleted.state, synced(lastSync(first.effects).attempt))
    expect(entry(done.state)).toBeUndefined()
    expect(done.effects).toEqual([])
  })

  test("moving an attached session revokes its grant", () => {
    const next = run(attached(), { type: "session.moved", sessionID })
    expect(next.effects).toContainEqual({ type: "close-attachment", attempt: 1, outcome: "closed" })
    expect(lastSync(next.effects)).toMatchObject({ allow: false })
  })
})

describe("disposal", () => {
  test("an idle plugin drains at once", () => {
    const next = run(BrowserMachine.createConnectionState(), { type: "disposed" })
    expect(next.effects).toEqual([{ type: "notify-drained" }])
    expect(BrowserMachine.isConnectionDisposed(next.state)).toBe(true)
  })

  test("disposal closes every attachment at once and drains only when the last revoke settles", () => {
    const first = attached()
    const withOther = run(first, attach(first, "conn_other", other))
    const otherGrant = lastSync(withOther.effects)
    const disposed = run(withOther.state, { type: "disposed" })
    expect(disposed.effects).toContainEqual({ type: "close-attachment", attempt: 1, outcome: "closed" })
    expect(disposed.effects).toContainEqual({ type: "close-attachment", attempt: 3, outcome: "closed" })
    expect(disposed.effects).not.toContainEqual({ type: "notify-drained" })
    expect(BrowserMachine.selectTarget(disposed.state, sessionID, { type: "tabs.list" }).ok).toBe(false)
    expect(BrowserMachine.selectAttachment(disposed.state, sessionID, "conn_1")).toBeUndefined()

    const revoke = lastSync(disposed.effects)
    const firstDone = run(disposed.state, synced(revoke.attempt))
    expect(firstDone.effects).toEqual([])

    // The other session's grant was still in flight; it is revoked before the plugin drains.
    const otherSettled = run(firstDone.state, synced(otherGrant.attempt, other))
    const otherRevoke = lastSync(otherSettled.effects)
    expect(otherRevoke).toMatchObject({ sessionID: other, allow: false })
    expect(otherSettled.effects).not.toContainEqual({ type: "notify-drained" })

    const drained = run(otherSettled.state, synced(otherRevoke.attempt, other))
    expect(drained.effects).toEqual([{ type: "notify-drained" }])
    expect(drained.state.sessions.size).toBe(0)
  })

  test("a disposed plugin rejects requests and ignores attachments", () => {
    const disposed = run(BrowserMachine.createConnectionState(), { type: "disposed" }).state
    const request = BrowserMachine.transitionConnection(disposed, started("req_1"))
    expect(request.state).toBe(disposed)
    expect(message(settlements(request.effects)[0]!.settlement)).toContain("no action ran")
    const late = BrowserMachine.transitionConnection(disposed, attach(disposed, "conn_1"))
    expect(late.state).toBe(disposed)
    expect(late.effects).toEqual([])
  })
})
