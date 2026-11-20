import { describe, expect, test } from "bun:test"
import { running, sessionStatus } from "./project-avatar-state"

type Job = { id: string; sessionID: string }

function setup() {
  const jobs: Job[] = []

  const permissions: Record<string, unknown[]> = {}

  const sessions = [
    { id: "root", parentID: undefined },
    { id: "child", parentID: "root" },
  ]

  const data = {
    job: {
      list: (id: string) => jobs.filter((job) => job.sessionID === id || (id === "root" && job.sessionID === "child")),
    },
    session: {
      list: () => sessions,
      get: (id: string) => sessions.find((session) => session.id === id),
      root: () => "root",
      family: () => ["child"],
      status: () => "idle",
      pending: { list: () => [] },
      permission: { list: (id: string) => permissions[id] ?? [] },
      form: { list: () => [] },
    },
  }

  const ctx = {
    data,
    autoApprove: { state: () => ({ status: "idle" }) },
    notification: { session: { unread: () => false } },
  }

  // SAFETY: the avatar state reads only these fields of the server data and context.
  return { jobs, permissions, data: data as never, ctx: ctx as never }
}

describe("session avatar running state", () => {
  test("a root runs while a child's job runs, and stops when it settles", () => {
    const state = setup()
    expect(running(state.data, "root", true)).toBe(false)
    state.jobs.push({ id: "job", sessionID: "child" })
    expect(running(state.data, "root", true)).toBe(true)
    expect(sessionStatus(state.ctx, "root", { root: true, autoApprove: false })).toBe("running")
    state.jobs.length = 0
    expect(running(state.data, "root", true)).toBe(false)
  })

  test("attention wins over running jobs", () => {
    const state = setup()
    state.jobs.push({ id: "job", sessionID: "child" })
    state.permissions.child = [{ id: "perm", sessionID: "child", time: { created: 0 } }]
    expect(sessionStatus(state.ctx, "root", { root: true, autoApprove: false })).toBe("input")
  })
})
