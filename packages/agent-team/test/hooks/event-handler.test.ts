import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createEventHandlerHook } from "../../src/hooks/event-handler.js"
import { Orchestrator } from "../../src/orchestrator/index.js"
import { tmpdir, cleanup } from "../fixture/workspace.js"

describe("event handler hook", () => {
  let dir: string
  let orch: Orchestrator

  beforeEach(async () => {
    dir = await tmpdir()
    orch = new Orchestrator(dir)
    await orch.start()
    await orch.spawn({ agent_id: "coder", role: "coder", capabilities: {} })
  })

  afterEach(async () => {
    orch.stop()
    await cleanup(dir)
  })

  test("session.idle triggers inbox drain", async () => {
    orch.registry.updateStatus("coder", "busy")
    const hook = createEventHandlerHook(orch)
    await hook({ event: { type: "session.idle", properties: { sessionID: "coder" } } })
    expect(orch.getInfo("coder")?.status).toBe("idle")
  })

  test("file.watcher.updated logged to audit", async () => {
    const hook = createEventHandlerHook(orch)
    await hook({ event: { type: "file.watcher.updated", properties: { file: "/test/file.ts", event: "change" } } })
    const events = await orch.audit.read({ action: "file.watcher.updated" })
    expect(events.length).toBe(1)
  })

  test("session.error logged to audit", async () => {
    const hook = createEventHandlerHook(orch)
    await hook({ event: { type: "session.error", properties: { sessionID: "coder", error: { message: "crash" } } } })
    const events = await orch.audit.read({ action: "session.error" })
    expect(events.length).toBe(1)
  })
})
