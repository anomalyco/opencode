import { expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client/promise"
import { ServerConnection } from "@/runtime/server/registry"
import {
  INITIAL_SESSION_UI_NAVIGATE_STATE,
  transitionSessionUINavigate,
  type SessionUINavigateEvent,
  type SessionUINavigateTransition,
} from "./session-ui-navigate-machine"

const server = ServerConnection.Key.make("sidecar")

const parent = { server, sessionID: "ses_parent" }

/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- the machine passes the session through untouched */
const linked = { id: "ses_linked", time: { created: 1 } } as SessionInfo

function replay(events: SessionUINavigateEvent[]) {
  return events.reduce<SessionUINavigateTransition[]>((steps, event) => {
    steps.push(transitionSessionUINavigate(steps.at(-1)?.state ?? INITIAL_SESSION_UI_NAVIGATE_STATE, event))

    return steps
  }, [])
}

test("clicking subagent A, then B, lands on B whenever A's sync settles", () => {
  const clicks: SessionUINavigateEvent[] = [
    { type: "child.requested", origin: parent, targetSessionID: "ses_a" },
    { type: "child.requested", origin: parent, targetSessionID: "ses_b" },
  ]

  const [a, b, syncedB, lateA] = replay([
    ...clicks,
    { type: "child.synced", attempt: 2 },
    { type: "child.synced", attempt: 1 },
  ])

  const [, resolvingB, earlyA, thenB] = replay([
    ...clicks,
    { type: "child.synced", attempt: 1 },
    { type: "child.synced", attempt: 2 },
  ])

  // Nothing touches the tab or the route until the sync settles.
  expect(a?.effects).toEqual([{ type: "child.sync", attempt: 1, targetSessionID: "ses_a" }])
  expect(b?.effects).toEqual([{ type: "child.sync", attempt: 2, targetSessionID: "ses_b" }])
  expect(syncedB?.effects).toEqual([{ type: "child.navigate", origin: parent, targetSessionID: "ses_b" }])
  expect(lateA?.state).toBe(syncedB!.state)
  expect(lateA?.effects).toEqual([])
  expect(earlyA?.state).toBe(resolvingB!.state)
  expect(earlyA?.effects).toEqual([])
  expect(thenB?.effects).toEqual([{ type: "child.navigate", origin: parent, targetSessionID: "ses_b" }])
})

test.each<[string, SessionUINavigateEvent]>([
  ["switching tabs", { type: "origin.changed", origin: { server, sessionID: "ses_other" } }],
  ["leaving the session screen", { type: "disposed" }],
])("%s while a child syncs or a link resolves drops the late result", (_name, leave) => {
  const [, left, lateChild] = replay([
    { type: "child.requested", origin: parent, targetSessionID: "ses_a" },
    leave,
    { type: "child.synced", attempt: 1 },
  ])

  const [, abort, lateLink] = replay([
    { type: "referenced.requested", origin: parent, targetSessionID: linked.id },
    leave,
    { type: "referenced.resolved", attempt: 1, session: linked },
  ])

  expect(left?.effects).toEqual([])
  expect(lateChild?.state).toBe(left!.state)
  expect(lateChild?.effects).toEqual([])
  expect(abort?.effects).toEqual([{ type: "referenced.abort", attempt: 1 }])
  expect(lateLink?.state).toBe(abort!.state)
  expect(lateLink?.effects).toEqual([])
})

test("a repeat click joins the request in flight, and the session on screen needs none", () => {
  const [first, repeat, linkFirst, linkRepeat] = replay([
    { type: "child.requested", origin: parent, targetSessionID: "ses_a" },
    { type: "child.requested", origin: { ...parent }, targetSessionID: "ses_a" },
    { type: "referenced.requested", origin: parent, targetSessionID: linked.id },
    { type: "referenced.requested", origin: parent, targetSessionID: linked.id },
  ])

  const [self] = replay([{ type: "child.requested", origin: parent, targetSessionID: parent.sessionID }])

  expect(repeat?.state).toBe(first!.state)
  expect(repeat?.effects).toEqual([])
  // A link replaces the child sync; the late sync no longer navigates.
  expect(linkFirst?.effects).toEqual([{ type: "referenced.lookup", attempt: 2, targetSessionID: linked.id }])
  expect(linkRepeat?.state).toBe(linkFirst!.state)
  expect(transitionSessionUINavigate(linkFirst!.state, { type: "child.synced", attempt: 1 }).effects).toEqual([])
  expect(self?.state).toBe(INITIAL_SESSION_UI_NAVIGATE_STATE)
})

test("a newer link aborts the older lookup", () => {
  const [, second] = replay([
    { type: "referenced.requested", origin: parent, targetSessionID: "ses_old" },
    { type: "referenced.requested", origin: parent, targetSessionID: linked.id },
  ])

  expect(second?.effects).toEqual([
    { type: "referenced.abort", attempt: 1 },
    { type: "referenced.lookup", attempt: 2, targetSessionID: linked.id },
  ])
})

test("a link opens a found session, says not found for a missing one, and reports a failed request", () => {
  const requested: SessionUINavigateEvent = { type: "referenced.requested", origin: parent, targetSessionID: linked.id }
  const [, opened] = replay([requested, { type: "referenced.resolved", attempt: 1, session: linked }])
  const [, missing] = replay([requested, { type: "referenced.missing", attempt: 1 }])
  const [, failed] = replay([requested, { type: "referenced.failed", attempt: 1, cause: "500" }])

  expect(opened?.effects).toEqual([{ type: "referenced.open", server, session: linked }])
  expect(missing?.effects).toEqual([{ type: "toast.not-found" }])
  expect(failed?.effects).toEqual([{ type: "toast.request-failed", cause: "500" }])
  expect([opened, missing, failed].map((step) => step?.state)).toEqual([
    { status: "idle", attempt: 1 },
    { status: "idle", attempt: 1 },
    { status: "idle", attempt: 1 },
  ])
})
