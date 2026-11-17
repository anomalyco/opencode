import { expect, test } from "bun:test"
import type { ProgramStatus } from "@opentui/core"
import { createRoot, createSignal } from "solid-js"
import { createProgramStatus, programStatusReports, type PendingSession } from "../../src/context/program-status"

function setup(initial: PendingSession[] = []) {
  return createRoot((dispose) => {
    const reports: ProgramStatus[] = []
    const [sessions, setSessions] = createSignal(initial)
    createProgramStatus({
      renderer: {
        setProgramStatus(status) {
          reports.push(status)
          return true
        },
      },
      sessions,
    })
    return { reports, setSessions, dispose }
  })
}

test("reports a blocked session on the root and its own record", () => {
  const status = setup()
  expect(status.reports).toEqual([{ state: "idle", app: "opencode" }])
  status.reports.length = 0

  status.setSessions([
    { id: "ses_a", title: "Fix\nbuild", state: "blocked", kind: "permission", message: "Allow bash?" },
  ])
  expect(status.reports).toEqual([
    { state: "blocked", kind: "permission", app: "opencode", title: "Fix build", message: "Allow bash?" },
    { state: "blocked", kind: "permission", id: "ses_a", app: "opencode", title: "Fix build", message: "Allow bash?" },
  ])
  status.dispose()
})

test("summarizes several pending sessions and clears resolved ones", () => {
  const status = setup([
    { id: "ses_a", state: "blocked", kind: "permission", message: "Allow bash?" },
    { id: "ses_b", state: "blocked", kind: "question", message: "Pick one" },
    { id: "ses_c", state: "working" },
  ])
  expect(status.reports[0]).toEqual({ state: "blocked", app: "opencode", message: "2 sessions need input" })
  status.reports.length = 0

  status.setSessions([{ id: "ses_c", state: "working" }])
  expect(status.reports).toEqual([
    { state: "clear", id: "ses_a" },
    { state: "clear", id: "ses_b" },
    { state: "working", app: "opencode" },
  ])
  status.reports.length = 0

  status.dispose()
  expect(status.reports).toEqual([{ state: "clear" }])
})

test("keeps record IDs within the protocol's name rules", () => {
  const ids = ["ses_a", `ses_panel_${"f".repeat(36)}`, "ses with spaces"]
  const records = programStatusReports(ids.map((id) => ({ id, state: "working" })))
  expect([...records.keys()].slice(1).map((id) => /^[\w.+-]{1,32}$/.test(id))).toEqual([true, true, true])
  expect(records.has("ses_a")).toBe(true)
  expect(records.size).toBe(4)
})

test("clips long titles to the protocol byte limit", () => {
  const status = setup([{ id: "ses_a", title: "é".repeat(200), state: "working" }])
  const title = status.reports[0].state === "working" ? status.reports[0].title : undefined
  expect(new TextEncoder().encode(title).byteLength).toBeLessThanOrEqual(192)
  expect(title?.endsWith("é…")).toBe(true)
  status.dispose()
})
