import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"
import fs from "fs/promises"
import path from "path"
import os from "os"

let tmpdir: string

function makeTool(fn) {
  return { execute: fn }
}

mock.module("@opencode-ai/plugin", () => ({
  tool: makeTool,
}))

const GoalLoopPlugin = (await import("./goal-loop.js")).default

function createTestPlugin() {
  const hooks = GoalLoopPlugin.server({ directory: tmpdir, project: null, user: null })
  return hooks.tool
}

beforeEach(async () => {
  tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), "goal-loop-test-"))
})

afterEach(async () => {
  await fs.rm(tmpdir, { recursive: true, force: true })
})

describe("goal tool", () => {
  test("set and clear round-trips", async () => {
    const { goal } = createTestPlugin()
    const result = await goal.execute({ action: "set", condition: "say hello" })
    expect(result).toContain("say hello")

    const state = JSON.parse(await fs.readFile(path.join(tmpdir, ".opencode/harness/goal.json"), "utf-8"))
    expect(state.active).toBe(true)
    expect(state.condition).toBe("say hello")
    expect(state.turns).toBe(0)

    const clear = await goal.execute({ action: "clear" })
    expect(clear).toBe("Goal cleared.")
  })

  test("status shows active goal", async () => {
    const { goal } = createTestPlugin()
    await goal.execute({ action: "set", condition: "check tests" })
    const status = await goal.execute({ action: "status" })
    expect(status).toContain("check tests")
    expect(status).toContain("Turns: 0")
  })

  test("status when no goal", async () => {
    const { goal } = createTestPlugin()
    const status = await goal.execute({ action: "status" })
    expect(status).toBe("No active goal.")
  })

  test("set without condition fails", async () => {
    const { goal } = createTestPlugin()
    const result = await goal.execute({ action: "set" })
    expect(result).toBe("Provide a condition.")
  })

  test("set with maxTurns", async () => {
    const { goal } = createTestPlugin()
    const result = await goal.execute({ action: "set", condition: "fix bug", maxTurns: 10 })
    expect(result).toContain("max 10 turns")

    const state = JSON.parse(await fs.readFile(path.join(tmpdir, ".opencode/harness/goal.json"), "utf-8"))
    expect(state.maxTurns).toBe(10)

    const status = await goal.execute({ action: "status" })
    expect(status).toContain("Max: 10")
  })

  test("set with oneTaskPerTurn", async () => {
    const { goal } = createTestPlugin()
    const result = await goal.execute({ action: "set", condition: "write tests", oneTaskPerTurn: true })
    expect(result).toContain("one task per turn")

    const state = JSON.parse(await fs.readFile(path.join(tmpdir, ".opencode/harness/goal.json"), "utf-8"))
    expect(state.oneTaskPerTurn).toBe(true)

    const status = await goal.execute({ action: "status" })
    expect(status).toContain("One task/turn")
  })
})

describe("loop tool", () => {
  test("add and list round-trips", async () => {
    const { loop } = createTestPlugin()
    const result = await loop.execute({ action: "add", prompt: "check status", interval: "5m" })
    expect(result).toContain("check status")
    expect(result).toContain("5m")

    const list = await loop.execute({ action: "list" })
    expect(list).toContain("check status")
  })

  test("remove loop", async () => {
    const { loop } = createTestPlugin()
    await loop.execute({ action: "add", prompt: "check status", interval: "5m" })
    const list = await loop.execute({ action: "list" })
    const id = list.match(/\[(\w+)\]/)?.[1]
    expect(id).toBeTruthy()

    const removed = await loop.execute({ action: "remove", loopId: id })
    expect(removed).toContain(id)

    const afterRemove = await loop.execute({ action: "list" })
    expect(afterRemove).toBe("No active loops.")
  })

  test("list when no loops", async () => {
    const { loop } = createTestPlugin()
    const list = await loop.execute({ action: "list" })
    expect(list).toBe("No active loops.")
  })

  test("add without prompt fails", async () => {
    const { loop } = createTestPlugin()
    const result = await loop.execute({ action: "add" })
    expect(result).toBe("Provide a prompt.")
  })
})
