import { describe, expect, test } from "bun:test"
import { createTaskbarAttentionState, taskbarAttentionReady, taskbarUnreadSessions } from "./taskbar-attention"

describe("taskbar attention state", () => {
  test("waits for every server state before publishing attention", () => {
    expect(taskbarAttentionReady([{ ready: () => true }, { ready: () => false }])).toBe(false)
    expect(taskbarAttentionReady([{ ready: () => true }, { ready: () => true }])).toBe(true)
  })

  test("excludes global errors that have no session to open", () => {
    expect(taskbarUnreadSessions({ global: [{}], "session-1": [{}], "session-2": [] })).toEqual(["session-1"])
  })

  test("counts each session once across unread and pending attention", () => {
    const attention = createTaskbarAttentionState()

    attention.add("session-1")
    attention.add("session-1")
    attention.add("session-2")

    expect(attention.count(["session-1", "session-3"])).toBe(3)
  })

  test("removes a session when it is viewed", () => {
    const attention = createTaskbarAttentionState()
    attention.add("session-1")
    attention.add("session-2")

    attention.remove("session-1")

    expect(attention.count(["session-1"])).toBe(1)
    expect(attention.count([])).toBe(1)
    expect(attention.count(["session-1"])).toBe(2)
  })

  test("re-adds a synchronized request only when a request is added", () => {
    const attention = createTaskbarAttentionState()
    attention.sync([{ sessionID: "session-1", token: "question:a,b" }])
    attention.remove("session-1")

    expect(attention.count([])).toBe(0)

    attention.sync([{ sessionID: "session-1", token: "question:b" }])

    expect(attention.count([])).toBe(0)

    attention.sync([{ sessionID: "session-1", token: "question:b,c" }])

    expect(attention.count([])).toBe(1)
  })

  test("keeps a session pending while another live request remains", () => {
    const attention = createTaskbarAttentionState()
    attention.add("session-1", "permission:a")
    attention.add("session-1", "question:b")

    attention.removePending("session-1", "permission:a")

    expect(attention.count([])).toBe(1)

    attention.removePending("session-1", "question:b")

    expect(attention.count([])).toBe(0)
  })

  test("reconciles live requests removed by synchronized state", () => {
    const attention = createTaskbarAttentionState()
    attention.sync([{ sessionID: "session-1", token: "question:a" }])
    attention.add("session-1", "question:a")

    attention.sync([])

    expect(attention.count([])).toBe(0)
  })

  test("forgets dismissed sessions after synchronized requests clear", () => {
    const attention = createTaskbarAttentionState()
    attention.sync([{ sessionID: "session-1", token: "question:a" }])
    attention.remove("session-1")

    attention.sync([])
    attention.sync([{ sessionID: "session-1", token: "question:b" }])

    expect(attention.count([])).toBe(1)
  })
})
