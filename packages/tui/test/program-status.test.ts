import { describe, expect, test } from "bun:test"
import { createProgramStatus, sessionProgramID, sessionProgramState, type ProgramSession } from "../src/program-status"

function session(id = "session", values: Partial<ProgramSession> = {}): ProgramSession {
  return {
    id,
    time: { created: 0, updated: 0 },
    running: false,
    permission: false,
    forms: [],
    ...values,
  }
}

function setup() {
  const output: string[] = []
  const reporter = createProgramStatus((sequence) => output.push(sequence))
  const update = (sessions: ProgramSession[], auth = false, forms: ProgramSession["forms"] = []) =>
    reporter.update(sessions, (id) => sessions.find((session) => session.id === id), auth, forms)
  return { output, reporter, update }
}

describe("OSC 7501 program status", () => {
  test("reports complete ST-terminated records without prompt, tool, or error text", () => {
    const harness = setup()
    harness.update([session("session", { running: true })])
    expect(harness.output).toEqual([
      "\x1b]7501;state=idle:app=opencode:id=opencode\x1b\\",
      `\x1b]7501;state=working:app=opencode:id=${sessionProgramID("session", () => undefined)}\x1b\\`,
    ])
    harness.update([session("session", { running: true })])
    expect(harness.output).toHaveLength(2)
  })

  test("keeps completion and failure until viewed, but cancellation is idle", () => {
    const harness = setup()
    const completed = session("session", { outcome: "succeeded", time: { created: 0, updated: 10, idle: 10 } })
    harness.update([session("session", { running: true })])
    harness.update([completed])
    expect(harness.output.at(-1)).toContain("state=done:")
    harness.update([completed])
    expect(harness.output).toHaveLength(3)
    harness.update([{ ...completed, time: { ...completed.time, viewed: 10 } }])
    expect(harness.output.at(-1)).toContain("state=idle:")
    harness.update([{ ...completed, outcome: "failed" }])
    expect(harness.output.at(-1)).toContain("state=error:")
    harness.update([{ ...completed, outcome: "interrupted" }])
    expect(harness.output.at(-1)).toContain("state=idle:")
    harness.update([{ ...completed, running: true }])
    expect(harness.output.at(-1)).toContain("state=working:")
  })

  test("prioritizes pending permission and forms, and resumes after the last answer", () => {
    const running = session("session", { running: true })
    const question: ProgramSession["forms"] = [{ fields: [{ key: "answer", type: "string" }] }]
    const auth: ProgramSession["forms"] = [
      { fields: [{ key: "auth", type: "external", url: "https://example.com/secret" }] },
    ]
    expect(sessionProgramState({ ...running, forms: question, permission: true })).toEqual({
      state: "blocked",
      kind: "permission",
    })
    expect(sessionProgramState({ ...running, forms: question })).toEqual({ state: "blocked", kind: "question" })
    expect(sessionProgramState({ ...running, forms: [...question, ...auth] })).toEqual({
      state: "blocked",
      kind: "auth",
    })
    expect(sessionProgramState(running)).toEqual({ state: "working" })
    const harness = setup()
    harness.update([{ ...running, forms: question }])
    expect(harness.output.at(-1)).toContain(":kind=question")
    harness.update([{ ...running, forms: auth }])
    expect(harness.output.at(-1)).toContain(":kind=auth")
    expect(harness.output.join("")).not.toContain("secret")
    harness.update([running])
    expect(harness.output.at(-1)).toContain("state=working:")
    expect(harness.output.at(-1)).not.toContain("kind=")
  })

  test("reports parents and subagents independently with hierarchical IDs", () => {
    const harness = setup()
    const parent = session("parent", { running: true })
    const child = session("child", { parentID: "parent", running: true, permission: true })
    const other = session("other", { running: true })
    harness.update([parent, child, other])
    const parentID = sessionProgramID(parent.id, () => undefined)
    const childID = sessionProgramID(child.id, (id) => (id === child.id ? child : parent))
    expect(childID.startsWith(`${parentID}/`)).toBe(true)
    expect(harness.output[1]).toContain(`state=working:app=opencode:id=${parentID}`)
    expect(harness.output[2]).toContain(`state=blocked:app=opencode:id=${childID}:kind=permission`)
    const otherID = sessionProgramID(other.id, () => undefined)
    expect(otherID.startsWith(`${parentID}/`)).toBe(false)
  })

  test("rehydrates attached sessions directly from their projected state", () => {
    const harness = setup()
    harness.update([
      session("done", { outcome: "succeeded", time: { created: 0, updated: 1, idle: 1 } }),
      session("failed", { outcome: "failed", time: { created: 0, updated: 1, idle: 1 } }),
      session("blocked", { permission: true }),
    ])
    expect(harness.output[1]).toContain("state=done:")
    expect(harness.output[2]).toContain("state=error:")
    expect(harness.output[3]).toContain("state=blocked:")
  })

  test("clears closed records and re-emits surviving descendants after an ancestor clear", () => {
    const harness = setup()
    const parent = session("parent")
    const child = session("child", { parentID: "parent", running: true })
    harness.update([parent, child])
    harness.reporter.update([child], (id) => (id === parent.id ? parent : child))
    expect(harness.output.at(-2)).toContain("state=clear:")
    expect(harness.output.at(-1)).toContain("state=working:")
    harness.update([])
    expect(harness.output.at(-1)).toContain("state=clear:")
    harness.reporter.dispose()
    expect(harness.output.at(-1)).toBe("\x1b]7501;state=clear:app=opencode:id=opencode\x1b\\")
    const count = harness.output.length
    harness.reporter.dispose()
    harness.update([child])
    expect(harness.output).toHaveLength(count)
    expect(harness.output.join("")).not.toContain(";state=clear:app=opencode\x1b")
  })

  test("authentication and global elicitation have their own record", () => {
    const harness = setup()
    harness.update([], true)
    expect(harness.output.at(-1)).toBe("\x1b]7501;state=blocked:app=opencode:id=opencode/input:kind=auth\x1b\\")
    harness.update([], false, [{ fields: [{ key: "answer", type: "string" }] }])
    expect(harness.output.at(-1)).toContain("kind=question")
    harness.update([])
    expect(harness.output.at(-1)).toContain("state=clear:app=opencode:id=opencode/input")
  })

  test("bounds IDs for deep nesting and noncanonical session IDs", () => {
    const chain = Array.from({ length: 12 }, (_, index) =>
      session(`ses_${index}:\x1b]7501;${"long".repeat(10)}`, {
        parentID: index > 0 ? `ses_${index - 1}:\x1b]7501;${"long".repeat(10)}` : undefined,
      }),
    )
    const get = (id: string) => chain.find((session) => session.id === id)
    chain.forEach((session) => {
      const id = sessionProgramID(session.id, get)
      expect(id.length).toBeLessThanOrEqual(128)
      expect(id.split("/").length).toBeLessThanOrEqual(8)
      expect(id).toMatch(/^[A-Za-z0-9_.+-]{1,32}(\/[A-Za-z0-9_.+-]{1,32})*$/)
    })
    expect(new Set(chain.map((session) => sessionProgramID(session.id, get))).size).toBe(chain.length)
  })

  test("stays within the minimum supported terminal record cap", () => {
    const harness = setup()
    harness.update(
      Array.from({ length: 100 }, (_, index) => session(`session-${index}`)),
      true,
    )
    expect(harness.output).toHaveLength(64)
    harness.output.forEach((sequence) => expect(Buffer.byteLength(sequence)).toBeLessThanOrEqual(4096))
  })

  test("encodes single-line Unicode session labels within the title limits", () => {
    const harness = setup()
    harness.update([session("session", { title: "\x1b\n\t\x7f\u0085" + "🦀".repeat(100) })])
    const title = harness.output.at(-1)?.match(/:title=([^\x1b]+)/)?.[1]
    expect(title).toBeDefined()
    expect(title!.length).toBeLessThanOrEqual(256)
    const decoded = Buffer.from(title!, "base64").toString("utf8")
    expect(Buffer.byteLength(decoded)).toBeLessThanOrEqual(192)
    expect(decoded).toBe("🦀".repeat(48))
  })

  test("keeps active work when there are more sessions than terminal records", () => {
    const harness = setup()
    harness.update([
      ...Array.from({ length: 100 }, (_, index) => session(`idle-${index}`)),
      session("active", { running: true }),
    ])
    expect(harness.output.some((sequence) => sequence.includes("state=working:"))).toBe(true)
    expect(harness.output).toHaveLength(63)
  })
})
