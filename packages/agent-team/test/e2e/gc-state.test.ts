import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import path from "path"
import fs from "fs"
import { Orchestrator } from "../../src/orchestrator/index.js"
import { tmpdir, cleanup } from "../fixture/workspace.js"

describe("E2E: GC and state management", () => {
  let dir: string
  let orch: Orchestrator

  beforeEach(async () => {
    dir = await tmpdir()
    orch = new Orchestrator(dir)
    await orch.start()
  })

  afterEach(async () => {
    orch.stop()
    await cleanup(dir)
  })

  test("state save and recover preserves agents", async () => {
    await orch.spawn({ agent_id: "coder", role: "coder", capabilities: {} })
    orch.registry.updateStatus("coder", "busy")
    await orch.state.saveSnapshot({ agents: orch.registry.toSnapshot() })

    const orch2 = new Orchestrator(dir)
    await orch2.start()
    expect(orch2.getInfo("coder")).toBeTruthy()
    expect(orch2.getInfo("coder")?.role).toBe("coder")
    expect(orch2.getInfo("coder")?.status).toBe("busy")
    orch2.stop()
  })

  test("state recover with no snapshot returns empty", async () => {
    const recovered = await orch.state.recover()
    expect(recovered).toEqual({})
  })

  test("WAL entries applied on recover", async () => {
    await orch.spawn({ agent_id: "coder", role: "coder", capabilities: {} })
    await orch.state.saveSnapshot({ agents: orch.registry.toSnapshot() })
    await new Promise((r) => setTimeout(r, 10))
    await orch.state.appendWAL({ op: "extra", data: { foo: "bar" } })

    const recovered = await orch.state.recover()
    expect((recovered as any)?.extra).toEqual({ foo: "bar" })
  })

  test("WAL compacted after recover", async () => {
    await orch.state.appendWAL({ op: "test", data: 1 })
    await orch.state.appendWAL({ op: "test", data: 2 })
    await orch.state.recover()
    const walPath = path.join(dir, ".opencode", "team", "wal.jsonl")
    const content = await fs.promises.readFile(walPath, "utf-8").catch(() => "")
    expect(content.trim()).toBe("")
  })

  test("snapshotTime returns last snapshot timestamp", async () => {
    const before = Date.now()
    await orch.state.saveSnapshot({ agents: {} })
    expect(orch.state.snapshotTime()).toBeGreaterThanOrEqual(before)
  })

  test("GC cleans up old worktrees", async () => {
    await orch.spawn({ agent_id: "coder", role: "coder", capabilities: {} })
    const wtPath = path.join(dir, "old-worktree")
    await fs.promises.mkdir(wtPath, { recursive: true })
    const worktrees = new Map([["coder", [wtPath]]])
    const gc = new (await import("../../src/orchestrator/gc.js")).GC(orch.dir, orch.audit, { cleanupTimeoutMs: 1 })
    await new Promise((r) => setTimeout(r, 5))
    const { cleaned } = await gc.tick(worktrees)
    expect(cleaned.length).toBe(1)
    expect(cleaned[0]).toBe(wtPath)
    const exists = await fs.promises
      .access(wtPath)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(false)
  })

  test("GC logs audit on worktree cleanup", async () => {
    await orch.spawn({ agent_id: "coder", role: "coder", capabilities: {} })
    const wtPath = path.join(dir, "stale-wt")
    await fs.promises.mkdir(wtPath, { recursive: true })
    const worktrees = new Map([["coder", [wtPath]]])
    const gc = new (await import("../../src/orchestrator/gc.js")).GC(orch.dir, orch.audit, { cleanupTimeoutMs: 1 })
    await new Promise((r) => setTimeout(r, 5))
    await gc.tick(worktrees)
    const audit = await orch.audit.read({ action: "gc.worktree.cleanup" })
    expect(audit.length).toBe(1)
    expect(audit[0].target).toBe(wtPath)
  })

  test("GC cleans old dead letters", async () => {
    const deadDir = path.join(orch.dir, "dead-letter")
    await fs.promises.mkdir(deadDir, { recursive: true })
    const oldFile = path.join(deadDir, "old.jsonl")
    await fs.promises.writeFile(oldFile, '{"test":true}\n')
    const oldTime = Date.now() - 10 * 86400000
    await fs.promises.utimes(oldFile, new Date(oldTime), new Date(oldTime))

    const gc = new (await import("../../src/orchestrator/gc.js")).GC(orch.dir, orch.audit, {
      deadLetterRetentionDays: 7,
    })
    const removed = await gc.cleanDeadLetters()
    expect(removed).toBe(1)
    const exists = await fs.promises
      .access(oldFile)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(false)
  })

  test("GC keeps recent dead letters", async () => {
    const deadDir = path.join(orch.dir, "dead-letter")
    await fs.promises.mkdir(deadDir, { recursive: true })
    const recentFile = path.join(deadDir, "recent.jsonl")
    await fs.promises.writeFile(recentFile, '{"test":true}\n')

    const gc = new (await import("../../src/orchestrator/gc.js")).GC(orch.dir, orch.audit, {
      deadLetterRetentionDays: 7,
    })
    const removed = await gc.cleanDeadLetters()
    expect(removed).toBe(0)
  })

  test("disk quota check", async () => {
    await orch.spawn({ agent_id: "coder", role: "coder", capabilities: {} })
    const wsPath = orch.getInfo("coder")!.workspace_path
    await fs.promises.mkdir(wsPath, { recursive: true })
    await fs.promises.writeFile(path.join(wsPath, "file.txt"), "x".repeat(1024))
    const withinQuota = await orch.gc.checkDiskQuota("coder", wsPath, 1)
    expect(withinQuota).toBe(true)
    const overQuota = await orch.gc.checkDiskQuota("coder", wsPath, 0)
    expect(overQuota).toBe(false)
  })

  test("state survives multiple save/recover cycles", async () => {
    await orch.spawn({ agent_id: "a", role: "coder", capabilities: {} })
    await orch.state.saveSnapshot({ agents: orch.registry.toSnapshot() })

    const orch2 = new Orchestrator(dir)
    await orch2.start()
    await orch2.spawn({ agent_id: "b", role: "reviewer", capabilities: {} })
    await orch2.state.saveSnapshot({ agents: orch2.registry.toSnapshot() })
    orch2.stop()

    const orch3 = new Orchestrator(dir)
    await orch3.start()
    expect(orch3.getInfo("a")).toBeTruthy()
    expect(orch3.getInfo("b")).toBeTruthy()
    orch3.stop()
  })
})
