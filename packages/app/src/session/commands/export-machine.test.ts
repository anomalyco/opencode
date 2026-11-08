import { expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client/promise"
import { ServerConnection } from "@/runtime/server/registry"
import {
  createSessionExportState,
  selectSessionExporting,
  transitionSessionExport,
  type SessionExportEvent,
  type SessionExportState,
  type SessionExportTransition,
} from "./export-machine"

/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- the machine passes export data through untouched */
const exported = { info: { id: "ses_1" } as SessionInfo, messages: [] }

const server = ServerConnection.Key.make("srv_1")

const target = { server, sessionID: "ses_1" }

function replay(events: SessionExportEvent[], from: SessionExportState = createSessionExportState()) {
  return events.reduce<SessionExportTransition[]>((steps, event) => {
    steps.push(transitionSessionExport(steps.at(-1)?.state ?? from, event))

    return steps
  }, [])
}

test("Export from the header menu while /export runs, or a second click on a Home row, fetches and saves once", () => {
  const [first, repeat, fetched, again, saved] = replay([
    { type: "export.requested", target },
    { type: "export.requested", target: { ...target } },
    { type: "export.fetched", attempt: 1, target, data: exported },
    { type: "export.requested", target },
    { type: "export.saved", attempt: 1, target, filename: "ses_1.json", saved: true },
  ])

  expect(first?.effects).toEqual([{ type: "export.fetch", attempt: 1, target }])
  expect(repeat?.state).toBe(first!.state)
  expect(repeat?.effects).toEqual([])
  // The save dialog may stay open a long time; the export still holds the session until it answers.
  expect(fetched?.state).toBe(first!.state)
  expect(fetched?.effects).toEqual([{ type: "export.save", attempt: 1, target, data: exported }])
  expect(selectSessionExporting(fetched!.state, target)).toBe(true)
  expect(again?.effects).toEqual([])
  expect(saved?.effects).toEqual([{ type: "toast.exported", filename: "ses_1.json" }])
  expect(selectSessionExporting(saved!.state, target)).toBe(false)
})

test("another session, or the same session on another server, exports alongside", () => {
  const [, otherSession, otherServer] = replay([
    { type: "export.requested", target },
    { type: "export.requested", target: { server, sessionID: "ses_2" } },
    { type: "export.requested", target: { server: ServerConnection.Key.make("srv_2"), sessionID: "ses_1" } },
  ])

  expect(otherSession?.effects).toEqual([{ type: "export.fetch", attempt: 2, target: { server, sessionID: "ses_2" } }])
  expect(otherServer?.effects).toMatchObject([{ type: "export.fetch", attempt: 3 }])
})

test("a cancelled save is quiet, a failure toasts, and a stale result is dropped", () => {
  const [, , cancelled] = replay([
    { type: "export.requested", target },
    { type: "export.fetched", attempt: 1, target, data: exported },
    { type: "export.saved", attempt: 1, target, filename: "ses_1.json", saved: false },
  ])

  const [, failed, retried, stale] = replay([
    { type: "export.requested", target },
    { type: "export.failed", attempt: 1, target, message: "timed out" },
    { type: "export.requested", target },
    { type: "export.fetched", attempt: 1, target, data: exported },
  ])

  expect(cancelled?.effects).toEqual([])
  expect(selectSessionExporting(cancelled!.state, target)).toBe(false)
  expect(failed?.effects).toEqual([{ type: "toast.export-failed", message: "timed out" }])
  expect(retried?.effects).toEqual([{ type: "export.fetch", attempt: 2, target }])
  expect(stale?.state).toBe(retried!.state)
  expect(stale?.effects).toEqual([])
})

test("leaving the screen aborts the fetches still paging, and no save dialog or toast follows", () => {
  const [, , disposed, lateFetch, lateFailure] = replay([
    { type: "export.requested", target },
    { type: "export.requested", target: { server, sessionID: "ses_2" } },
    { type: "disposed" },
    { type: "export.fetched", attempt: 1, target, data: exported },
    { type: "export.failed", attempt: 2, target: { server, sessionID: "ses_2" }, message: "aborted" },
  ])

  expect(disposed?.state).toEqual({ status: "disposed" })
  expect(disposed?.effects).toEqual([
    { type: "export.abort", attempt: 1 },
    { type: "export.abort", attempt: 2 },
  ])
  expect(lateFetch?.state).toBe(disposed!.state)
  expect(lateFetch?.effects).toEqual([])
  expect(lateFailure?.effects).toEqual([])
})
