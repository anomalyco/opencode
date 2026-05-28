import { afterAll, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import crypto from "node:crypto"

// Import the actual plugin
import { GoalPlugin } from "../../src/plugin/goal/goal"

// ── Test setup ──

let tmpDir: string

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "goal-int-"))
}

function teardown() {
  if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true })
}

function readGoalsFile(): Record<string, any> {
  const p = path.join(tmpDir, ".opencode", "goals.json")
  try { return JSON.parse(fs.readFileSync(p, "utf-8")) } catch { return {} }
}

function createMockClient() {
  const calls: Array<{ method: string; args: any }> = []
  return {
    calls,
    client: {
      promptAsync: async (opts: any) => {
        calls.push({ method: "promptAsync", args: opts })
      },
      prompt: async (opts: any) => {
        calls.push({ method: "prompt", args: opts })
      },
      messages: async () => ({ data: [] }),
    },
  }
}

// Helper: ToolResult is string | object, narrow to object for assertions
function r<T>(result: T): T & Record<string, any> {
  return result as any
}

// ── Integration tests ──

setup()

test("plugin returns hooks with all expected keys", async () => {
  const mock = createMockClient()
  const hooks = await GoalPlugin({ client: mock.client as any, directory: tmpDir } as any)
  expect(hooks).toHaveProperty("event")
  expect(hooks).toHaveProperty("tool")
  expect(hooks["command.execute.before"]).toBeDefined()
  expect(hooks.tool).toHaveProperty("create_goal")
  expect(hooks.tool).toHaveProperty("update_goal")
  expect(hooks.tool).toHaveProperty("get_goal")
})

test("create_goal tool writes to goals.json", async () => {
  const mock = createMockClient()
  const hooks = await GoalPlugin({ client: mock.client as any, directory: tmpDir } as any)
  const result = await hooks.tool!.create_goal.execute({ objective: "fix the login" }, {
    sessionID: "s1",
    messageID: "m1",
    agent: "build",
    directory: tmpDir,
    worktree: tmpDir,
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  })

  expect(r(result).title).toContain("fix the login")
  const goals = readGoalsFile()
  expect(goals["s1"].objective).toBe("fix the login")
  expect(goals["s1"].status).toBe("active")
  expect(goals["s1"].goalID).toBeTruthy()
  expect(goals["s1"].iterationCount).toBe(0)
})

test("create_goal idempotent on same objective", async () => {
  const mock = createMockClient()
  const hooks = await GoalPlugin({ client: mock.client as any, directory: tmpDir } as any)
  const ctx = { sessionID: "s2", messageID: "m2", agent: "build", directory: tmpDir, worktree: tmpDir, abort: new AbortController().signal, metadata: () => {}, ask: async () => {} }

  await hooks.tool!.create_goal.execute({ objective: "same task" }, ctx)
  await hooks.tool!.create_goal.execute({ objective: "same task" }, ctx)

  const goals = readGoalsFile()
  expect(Object.keys(goals)).toHaveLength(2) // s1 from previous + s2
  expect(goals["s2"].iterationCount).toBe(0) // reset
})

test("get_goal returns info for active goal", async () => {
  const mock = createMockClient()
  const hooks = await GoalPlugin({ client: mock.client as any, directory: tmpDir } as any)
  // Pre-populate via create
  await hooks.tool!.create_goal.execute({ objective: "refactor" }, {
    sessionID: "s3", messageID: "m3", agent: "build", directory: tmpDir, worktree: tmpDir,
    abort: new AbortController().signal, metadata: () => {}, ask: async () => {},
  })

  const result = await hooks.tool!.get_goal.execute({}, {
    sessionID: "s3", messageID: "m4", agent: "build", directory: tmpDir, worktree: tmpDir,
    abort: new AbortController().signal, metadata: () => {}, ask: async () => {},
  })
  expect(r(result).title).toContain("refactor")
  expect(r(result).output).toContain("Status: active")
})

test("get_goal returns no-goal for unknown session", async () => {
  const mock = createMockClient()
  const hooks = await GoalPlugin({ client: mock.client as any, directory: tmpDir } as any)
  const result = await hooks.tool!.get_goal.execute({}, {
    sessionID: "nonexistent", messageID: "mx", agent: "build", directory: tmpDir, worktree: tmpDir,
    abort: new AbortController().signal, metadata: () => {}, ask: async () => {},
  })
  expect(r(result).title).toBe("No goal")
})

test("update_goal changes status to complete", async () => {
  const mock = createMockClient()
  const hooks = await GoalPlugin({ client: mock.client as any, directory: tmpDir } as any)
  await hooks.tool!.create_goal.execute({ objective: "done task" }, {
    sessionID: "s4", messageID: "m4", agent: "build", directory: tmpDir, worktree: tmpDir,
    abort: new AbortController().signal, metadata: () => {}, ask: async () => {},
  })

  const result = await hooks.tool!.update_goal.execute({ status: "complete" }, {
    sessionID: "s4", messageID: "m5", agent: "build", directory: tmpDir, worktree: tmpDir,
    abort: new AbortController().signal, metadata: () => {}, ask: async () => {},
  })
  expect(r(result).title).toBe("Goal status: complete")
  expect(readGoalsFile()["s4"].status).toBe("complete")
})

test("update_goal on non-existent goal returns no active", async () => {
  const mock = createMockClient()
  const hooks = await GoalPlugin({ client: mock.client as any, directory: tmpDir } as any)
  const result = await hooks.tool!.update_goal.execute({ status: "blocked" }, {
    sessionID: "nx", messageID: "mx", agent: "build", directory: tmpDir, worktree: tmpDir,
    abort: new AbortController().signal, metadata: () => {}, ask: async () => {},
  })
  expect(r(result).title).toBe("No active goal")
})

test("command.execute.before handles /goal pause", async () => {
  const mock = createMockClient()
  const hooks = await GoalPlugin({ client: mock.client as any, directory: tmpDir } as any)
  // Pre-populate goal
  await hooks.tool!.create_goal.execute({ objective: "pausable" }, {
    sessionID: "s5", messageID: "m5", agent: "build", directory: tmpDir, worktree: tmpDir,
    abort: new AbortController().signal, metadata: () => {}, ask: async () => {},
  })

  const output: any = { parts: [] }
  await hooks["command.execute.before"]!(
    { command: "goal", sessionID: "s5", arguments: "pause" } as any,
    output,
  )
  expect(output.parts[0].text).toContain("Goal paused")
  expect(readGoalsFile()["s5"].status).toBe("paused")
})

test("command.execute.before handles /goal resume", async () => {
  const mock = createMockClient()
  const hooks = await GoalPlugin({ client: mock.client as any, directory: tmpDir } as any)
  // s5 is paused from previous test
  const output: any = { parts: [] }
  await hooks["command.execute.before"]!(
    { command: "goal", sessionID: "s5", arguments: "resume" } as any,
    output,
  )
  expect(output.parts[0].text).toContain("Goal resumed")
  expect(readGoalsFile()["s5"].status).toBe("active")
})

test("command.execute.before handles /goal clear", async () => {
  const mock = createMockClient()
  const hooks = await GoalPlugin({ client: mock.client as any, directory: tmpDir } as any)
  await hooks.tool!.create_goal.execute({ objective: "temporary" }, {
    sessionID: "s6", messageID: "m6", agent: "build", directory: tmpDir, worktree: tmpDir,
    abort: new AbortController().signal, metadata: () => {}, ask: async () => {},
  })

  const output: any = { parts: [] }
  await hooks["command.execute.before"]!(
    { command: "goal", sessionID: "s6", arguments: "clear" } as any,
    output,
  )
  expect(output.parts[0].text).toBe("Goal cleared.")
  expect(readGoalsFile()).not.toHaveProperty("s6")
})

test("command.execute.before handles /goal with template", async () => {
  const mock = createMockClient()
  const hooks = await GoalPlugin({ client: mock.client as any, directory: tmpDir } as any)
  const output: any = { parts: [] }
  await hooks["command.execute.before"]!(
    { command: "goal", sessionID: "s7", arguments: "fix the login button" } as any,
    output,
  )
  expect(output.parts[0].type).toBe("text")
  expect(output.parts[0].text).toContain("fix the login button")
  expect(output.parts[0].text).toContain("get_goal")
})

test("command.execute.before ignores non-goal commands", async () => {
  const mock = createMockClient()
  const hooks = await GoalPlugin({ client: mock.client as any, directory: tmpDir } as any)
  const output: any = { parts: [{ type: "text", text: "original" }] }
  await hooks["command.execute.before"]!(
    { command: "review", sessionID: "s8", arguments: "HEAD" } as any,
    output,
  )
  expect(output.parts[0].text).toBe("original") // unchanged
})

test("event hook triggers continuation for active goal", async () => {
  const mock = createMockClient()
  const hooks = await GoalPlugin({ client: mock.client as any, directory: tmpDir } as any)
  // Pre-populate goal
  await hooks.tool!.create_goal.execute({ objective: "auto task" }, {
    sessionID: "s9", messageID: "m9", agent: "build", directory: tmpDir, worktree: tmpDir,
    abort: new AbortController().signal, metadata: () => {}, ask: async () => {},
  })

  // Simulate idle event
  await hooks.event!({
    event: {
      type: "session.status",
      properties: { status: { type: "idle" }, sessionID: "s9" },
    },
  } as any)

  // Should have called promptAsync
  expect(mock.calls.length).toBeGreaterThanOrEqual(1)
  expect(mock.calls[0].method).toMatch(/prompt/)
  expect(mock.calls[0].args.path.id).toBe("s9")

  // Check iteration count incremented
  expect(readGoalsFile()["s9"].iterationCount).toBeGreaterThanOrEqual(1)
})

test("event hook skips when goal is complete", async () => {
  const mock = createMockClient()
  const hooks = await GoalPlugin({ client: mock.client as any, directory: tmpDir } as any)
  await hooks.tool!.create_goal.execute({ objective: "done" }, {
    sessionID: "s10", messageID: "m10", agent: "build", directory: tmpDir, worktree: tmpDir,
    abort: new AbortController().signal, metadata: () => {}, ask: async () => {},
  })
  await hooks.tool!.update_goal.execute({ status: "complete" }, {
    sessionID: "s10", messageID: "m11", agent: "build", directory: tmpDir, worktree: tmpDir,
    abort: new AbortController().signal, metadata: () => {}, ask: async () => {},
  })

  const before = mock.calls.length
  await hooks.event!({
    event: {
      type: "session.status",
      properties: { status: { type: "idle" }, sessionID: "s10" },
    },
  } as any)
  expect(mock.calls.length).toBe(before) // No new calls
})

test("event hook skips non-idle status", async () => {
  const mock = createMockClient()
  const hooks = await GoalPlugin({ client: mock.client as any, directory: tmpDir } as any)
  const before = mock.calls.length
  await hooks.event!({
    event: {
      type: "session.status",
      properties: { status: { type: "busy" }, sessionID: "s9" },
    },
  } as any)
  expect(mock.calls.length).toBe(before)
})

test("event hook skips non-status events", async () => {
  const mock = createMockClient()
  const hooks = await GoalPlugin({ client: mock.client as any, directory: tmpDir } as any)
  const before = mock.calls.length
  await hooks.event!({
    event: { type: "session.error", properties: { error: "test" } },
  } as any)
  expect(mock.calls.length).toBe(before)
})

afterAll(teardown)
