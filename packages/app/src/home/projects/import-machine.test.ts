import { expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client/promise"
import type { ServerConnection } from "@/runtime/server/registry"
import {
  INITIAL_PROJECT_IMPORT_STATE,
  selectProjectImporting,
  transitionProjectImport,
  type ProjectImportEvent,
  type ProjectImportTransition,
} from "./import-machine"

const conn: ServerConnection.Any = { type: "sidecar", variant: "base", http: { url: "http://127.0.0.1:4096" } }

const target = { conn, worktree: "/repo", originPath: "/" }

const file = new File(["{}"], "transcript.json")

/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- the machine passes the session through untouched */
const imported = { id: "ses_imported" } as SessionInfo

function replay(events: ProjectImportEvent[]) {
  return events.reduce<ProjectImportTransition[]>((steps, event) => {
    steps.push(transitionProjectImport(steps.at(-1)?.state ?? INITIAL_PROJECT_IMPORT_STATE, event))

    return steps
  }, [])
}

const picked: ProjectImportEvent[] = [
  { type: "import.requested", target },
  { type: "picker.closed", attempt: 1, file },
]

test("an upload that lands after the user opened another session does not switch tabs", () => {
  const [, uploading, moved] = replay([
    ...picked,
    { type: "import.succeeded", attempt: 1, target, session: imported, currentPath: "/server/a/session/ses_other" },
  ])

  const [, , stayed] = replay([
    ...picked,
    { type: "import.succeeded", attempt: 1, target, session: imported, currentPath: "/" },
  ])

  expect(uploading?.effects).toEqual([
    { type: "toast.pending.show" },
    { type: "upload.start", attempt: 1, target, file },
  ])
  expect(moved?.effects).toEqual([
    { type: "toast.pending.dismiss" },
    { type: "session.remember", target, session: imported },
  ])
  expect(stayed?.effects).toEqual([
    { type: "toast.pending.dismiss" },
    { type: "session.open", target, session: imported },
  ])
  expect(moved?.state).toEqual({ status: "idle", attempt: 1 })
})

test("an upload that outlives Home still lands and reports, without taking over the window", () => {
  const [, , disposed, succeeded] = replay([
    ...picked,
    { type: "disposed" },
    { type: "import.succeeded", attempt: 1, target, session: imported, currentPath: "/" },
  ])

  const [, , , failed] = replay([...picked, { type: "disposed" }, { type: "import.failed", attempt: 1, cause: "500" }])

  expect(disposed?.effects).toEqual([])
  expect(succeeded?.state).toBe(disposed!.state)
  expect(succeeded?.effects).toEqual([
    { type: "toast.pending.dismiss" },
    { type: "session.remember", target, session: imported },
  ])
  expect(failed?.effects).toEqual([{ type: "toast.pending.dismiss" }, { type: "toast.failed", cause: "500" }])
})

test("Import session again while the picker is open or a transcript uploads starts nothing", () => {
  const [picking, again, uploading, onceMore] = replay([
    { type: "import.requested", target },
    { type: "import.requested", target },
    { type: "picker.closed", attempt: 1, file },
    { type: "import.requested", target },
  ])

  expect(picking?.effects).toEqual([{ type: "picker.open", attempt: 1 }])
  expect(selectProjectImporting(picking!.state)).toBe(true)
  expect(again?.state).toBe(picking!.state)
  expect(again?.effects).toEqual([])
  expect(selectProjectImporting(uploading!.state)).toBe(true)
  expect(onceMore?.state).toBe(uploading!.state)
  expect(onceMore?.effects).toEqual([])
})

test("a cancelled picker is quiet, failures toast, and the next import starts a new attempt", () => {
  const [, cancelled, retried, stale] = replay([
    { type: "import.requested", target },
    { type: "picker.closed", attempt: 1, file: undefined },
    { type: "import.requested", target },
    { type: "picker.closed", attempt: 1, file },
  ])

  const [, pickerFailed] = replay([
    { type: "import.requested", target },
    { type: "picker.failed", attempt: 1, cause: "denied" },
  ])

  const [, , uploadFailed] = replay([...picked, { type: "import.failed", attempt: 1, cause: "invalid" }])

  expect(cancelled?.effects).toEqual([])
  expect(selectProjectImporting(cancelled!.state)).toBe(false)
  expect(retried?.effects).toEqual([{ type: "picker.open", attempt: 2 }])
  expect(stale?.state).toBe(retried!.state)
  expect(pickerFailed?.effects).toEqual([{ type: "toast.failed", cause: "denied" }])
  expect(uploadFailed?.effects).toEqual([{ type: "toast.pending.dismiss" }, { type: "toast.failed", cause: "invalid" }])
  expect(selectProjectImporting(uploadFailed!.state)).toBe(false)
})
