import { describe, expect, test } from "bun:test"
import { createProgramStatus, sessionProgramID, sessionProgramState, type ProgramSession } from "../src/program-status"

function session(id = "session", values: Partial<ProgramSession> = {}): ProgramSession {
  return { id, time: { created: 0, updated: 0 }, running: false, permission: false, forms: [], ...values }
}

function setup() {
  const output: Record<string, string>[] = []
  const reporter = createProgramStatus((sequence) => {
    expect(sequence).toStartWith("\x1b]7501;")
    expect(sequence).toEndWith("\x1b\\")
    output.push(
      Object.fromEntries(
        sequence
          .slice(7, -2)
          .split(":")
          .map((field) => {
            const separator = field.indexOf("=")
            return [field.slice(0, separator), field.slice(separator + 1)]
          }),
      ),
    )
  })
  const update = (sessions: ProgramSession[], auth = false, forms: ProgramSession["forms"] = []) =>
    reporter.update(sessions, (id) => sessions.find((session) => session.id === id), auth, forms)
  return { reporter, update, take: () => output.splice(0) }
}

describe("OSC 7501 program status", () => {
  test("maps projected session state and pending input", () => {
    const idle = { created: 0, updated: 10, idle: 10 }
    const question: ProgramSession["forms"] = [{ fields: [{ key: "answer", type: "string" }] }]
    const auth: ProgramSession["forms"] = [{ fields: [{ key: "auth", type: "external", url: "https://example.com" }] }]
    const cases: [Partial<ProgramSession>, ReturnType<typeof sessionProgramState>][] = [
      [{}, { state: "idle" }],
      [{ outcome: "succeeded", time: idle }, { state: "done" }],
      [{ outcome: "failed", time: idle }, { state: "error" }],
      [{ outcome: "interrupted", time: idle }, { state: "idle" }],
      [{ outcome: "succeeded", time: { ...idle, viewed: 10 } }, { state: "idle" }],
      [{ running: true, outcome: "failed", time: idle }, { state: "working" }],
      [
        { running: true, forms: question },
        { state: "blocked", kind: "question" },
      ],
      [
        { running: true, forms: [...question, ...auth] },
        { state: "blocked", kind: "auth" },
      ],
      [
        { running: true, forms: auth, permission: true },
        { state: "blocked", kind: "permission" },
      ],
    ]
    cases.forEach(([values, expected]) => expect(sessionProgramState(session("session", values))).toEqual(expected))
  })

  test("summarizes urgency on the root and namespace, including mixed sessions and global input", () => {
    const harness = setup()
    const tracked = [
      session("idle"),
      session("done", { outcome: "succeeded", time: { created: 0, updated: 1, idle: 1 } }),
      session("error", { outcome: "failed", time: { created: 0, updated: 1, idle: 1 } }),
      session("working", { running: true }),
      session("blocked", { running: true, permission: true }),
    ]
    const summary = (state: string, kind?: string) => {
      const records = harness.take()
      ;[undefined, "opencode"].forEach((id) => {
        const record = records.find((record) => record.id === id)
        expect(record).toMatchObject({ state, app: "opencode" })
        expect(record?.kind).toBe(kind)
      })
      return records
    }
    harness.update(tracked.toReversed())
    const records = summary("blocked", "permission")
    ;["working", "blocked"].forEach((id) =>
      expect(records.find((record) => record.id === sessionProgramID(id, () => undefined))?.state).toBe(id),
    )
    ;["working", "error", "done", "idle"].forEach((state, index) => {
      harness.update(tracked.slice(0, 4 - index))
      summary(state)
    })
    harness.update([], true)
    summary("blocked", "auth")
    harness.update([], false, [{ fields: [{ key: "answer", type: "string" }] }])
    summary("blocked", "question")
    harness.update([])
    summary("idle")
  })

  test("clears removed records and re-emits retained descendants without an unscoped clear", () => {
    const harness = setup()
    const parent = session("parent")
    const child = session("child", { parentID: parent.id, running: true })
    const get = (id: string) => [parent, child].find((session) => session.id === id)
    const parentID = sessionProgramID(parent.id, get)
    const childID = sessionProgramID(child.id, get)
    expect(childID).toStartWith(`${parentID}/`)
    harness.update([parent, child])
    harness.take()
    harness.reporter.update([child], get)
    expect(harness.take()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: parentID, state: "clear" }),
        expect.objectContaining({ id: childID, state: "working" }),
      ]),
    )
    harness.update([])
    expect(harness.take()).toContainEqual(expect.objectContaining({ id: childID, state: "clear" }))
    harness.reporter.dispose()
    expect(harness.take().filter((record) => record.state === "clear")).toEqual([
      { state: "clear", app: "opencode", id: "opencode" },
    ])
  })

  test("bounds hierarchical IDs, record count and control-free Unicode titles", () => {
    const chain = Array.from({ length: 12 }, (_, index) =>
      session(`session:${index}\x1b`, {
        parentID: index > 0 ? `session:${index - 1}\x1b` : undefined,
      }),
    )
    const ids = chain.map((session) => sessionProgramID(session.id, (id) => chain.find((session) => session.id === id)))
    ids.forEach((id) => {
      expect(id.length).toBeLessThanOrEqual(128)
      expect(id.split("/").length).toBeLessThanOrEqual(8)
      expect(id).toMatch(/^opencode(\/[a-f0-9]{16})+$/)
    })
    expect(new Set(ids).size).toBe(chain.length)
    const harness = setup()
    harness.update(
      [
        session("active", { running: true, title: "\x1b\n\t\x7f\u0085" + "🦀".repeat(100) }),
        ...Array.from({ length: 100 }, (_, index) => session(`idle-${index}`)),
      ],
      true,
    )
    const records = harness.take()
    expect(records.length).toBeLessThanOrEqual(64)
    const title = records.find((record) => record.id === sessionProgramID("active", () => undefined))?.title
    expect(title).toBeDefined()
    expect(title!.length).toBeLessThanOrEqual(256)
    const decoded = Buffer.from(title!, "base64").toString("utf8")
    expect(Buffer.byteLength(decoded)).toBeLessThanOrEqual(192)
    expect(decoded).toBe("🦀".repeat(48))
  })

  test("honors terminal title and status settings, including changes while running", () => {
    const harness = setup()
    const sessions = [session("session", { running: true, title: "Private title" })]
    const get = () => sessions[0]
    harness.reporter.update(sessions, get, false, [], { status: false })
    expect(harness.take()).toBeEmpty()
    harness.update(sessions)
    expect(harness.take()).toContainEqual(
      expect.objectContaining({ title: Buffer.from("Private title").toString("base64") }),
    )
    harness.reporter.update(sessions, get, false, [], { title: false })
    const records = harness.take()
    expect(records).toContainEqual(expect.objectContaining({ state: "working", id: sessionProgramID("session", get) }))
    expect(records.every((record) => record.title === undefined)).toBe(true)
    harness.reporter.update(sessions, get, false, [], { status: false })
    expect(harness.take()).toEqual(
      expect.arrayContaining([
        { state: "idle", app: "opencode" },
        { state: "clear", app: "opencode", id: "opencode" },
      ]),
    )
    harness.reporter.update(sessions, get, false, [], { status: false })
    expect(harness.take()).toBeEmpty()
    harness.reporter.update(sessions, get, false, [], { title: false })
    expect(harness.take()).toContainEqual(expect.objectContaining({ state: "working", id: "opencode" }))
  })
})
