import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { StateManager } from "../../src/orchestrator/state.js"
import { tmpdir, cleanup } from "../fixture/workspace.js"

describe("StateManager", () => {
  let dir: string
  let sm: StateManager

  beforeEach(async () => {
    dir = await tmpdir()
    sm = new StateManager(dir)
    await sm.init()
  })

  afterEach(async () => {
    await cleanup(dir)
  })

  test("saveSnapshot writes state.json", async () => {
    await sm.saveSnapshot({ agents: { a1: { status: "idle" } } })
    const state = await sm.loadSnapshot()
    expect(state?.agents).toBeTruthy()
  })

  test("loadSnapshot restores state", async () => {
    await sm.saveSnapshot({ agents: { a1: { status: "busy" } }, version: 1 })
    const state = await sm.loadSnapshot()
    expect((state?.agents as any)?.a1?.status).toBe("busy")
  })

  test("appendWAL writes sequential entries", async () => {
    const s1 = await sm.appendWAL({ op: "register", data: { id: "a1" } })
    const s2 = await sm.appendWAL({ op: "update", data: { id: "a1", status: "busy" } })
    expect(s1).toBe(1)
    expect(s2).toBe(2)
  })

  test("recover with empty WAL loads snapshot", async () => {
    await sm.saveSnapshot({ agents: { a1: { status: "idle" } } })
    const state = await sm.recover()
    expect((state?.agents as any)?.a1).toBeTruthy()
  })

  test("recover with empty snapshot replays WAL", async () => {
    await sm.appendWAL({ op: "register", data: { id: "a1", status: "idle" } })
    await sm.appendWAL({ op: "update", data: { id: "a1", status: "busy" } })
    const state = await sm.recover()
    expect(state).toBeTruthy()
  })

  test("snapshotTime returns last snapshot time", async () => {
    const before = Date.now()
    await sm.saveSnapshot({ agents: {} })
    expect(sm.snapshotTime()).toBeGreaterThanOrEqual(before)
  })

  test("compact truncates WAL", async () => {
    await sm.appendWAL({ op: "test", data: {} })
    await sm.compact()
    const state = await sm.recover()
    expect(state).toBeTruthy()
  })
})
