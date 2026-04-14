import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import fs from "fs"
import path from "path"
import { AuditLogger } from "../../src/orchestrator/audit.js"
import { tmpdir, cleanup } from "../fixture/workspace.js"

describe("AuditLogger", () => {
  let dir: string
  let logger: AuditLogger

  beforeEach(async () => {
    dir = await tmpdir()
    logger = new AuditLogger(dir)
    await logger.init()
  })

  afterEach(async () => {
    await cleanup(dir)
  })

  test("appends event as JSONL", async () => {
    await logger.append({ agent: "a1", action: "agent.spawn" })
    const events = await logger.read()
    expect(events.length).toBe(1)
    expect(events[0].agent).toBe("a1")
    expect(events[0].action).toBe("agent.spawn")
    expect(events[0].ts).toBeGreaterThan(0)
  })

  test("appends multiple events in order", async () => {
    await logger.append({ agent: "a1", action: "agent.spawn" })
    await logger.append({ agent: "a1", action: "message.sent" })
    const events = await logger.read()
    expect(events.length).toBe(2)
    expect(events[0].action).toBe("agent.spawn")
    expect(events[1].action).toBe("message.sent")
  })

  test("creates file and directory if not exist", async () => {
    const newDir = path.join(dir, "deep", "nested")
    const l = new AuditLogger(newDir)
    await l.init()
    await l.append({ agent: "a1", action: "test" })
    expect(fs.existsSync(path.join(newDir, "audit.jsonl"))).toBe(true)
  })

  test("reads with agent filter", async () => {
    await logger.append({ agent: "a1", action: "test1" })
    await logger.append({ agent: "a2", action: "test2" })
    const events = await logger.read({ agent: "a1" })
    expect(events.length).toBe(1)
    expect(events[0].agent).toBe("a1")
  })

  test("reads with action filter", async () => {
    await logger.append({ agent: "a1", action: "test1" })
    await logger.append({ agent: "a1", action: "test2" })
    const events = await logger.read({ action: "test1" })
    expect(events.length).toBe(1)
  })

  test("reads with time range filter", async () => {
    const before = Date.now()
    await logger.append({ agent: "a1", action: "old" })
    await logger.append({ agent: "a1", action: "new" })
    const events = await logger.read({ since: before })
    expect(events.length).toBe(2)
  })

  test("reads last n events", async () => {
    for (let i = 0; i < 10; i++) {
      await logger.append({ agent: "a1", action: `action-${i}` })
    }
    const events = await logger.read({ limit: 3 })
    expect(events.length).toBe(3)
    expect(events[0].action).toBe("action-7")
  })
})
