import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import path from "path"
import fs from "fs"
import { AuditLogger } from "../../src/orchestrator/audit.js"
import { GC } from "../../src/orchestrator/gc.js"
import { tmpdir, cleanup } from "../fixture/workspace.js"

describe("GC", () => {
  let dir: string
  let audit: AuditLogger
  let gc: GC

  beforeEach(async () => {
    dir = await tmpdir()
    audit = new AuditLogger(dir)
    await audit.init()
    gc = new GC(dir, audit, { cleanupTimeoutMs: 1000, gcIntervalMs: 60000, deadLetterRetentionDays: 0 })
  })

  afterEach(async () => {
    await cleanup(dir)
  })

  test("tick cleans up old worktrees", async () => {
    const wtDir = path.join(dir, "worktree-test")
    await fs.promises.mkdir(wtDir, { recursive: true })
    await fs.promises.writeFile(path.join(wtDir, "file.txt"), "old")
    const oldTime = Date.now() - 5000
    await fs.promises.utimes(wtDir, new Date(oldTime), new Date(oldTime))
    const worktrees = new Map([["a1", [wtDir]]])
    const { cleaned } = await gc.tick(worktrees)
    expect(cleaned.length).toBe(1)
  })

  test("tick does not touch fresh worktrees", async () => {
    const wtDir = path.join(dir, "worktree-fresh")
    await fs.promises.mkdir(wtDir, { recursive: true })
    const worktrees = new Map([["a1", [wtDir]]])
    const { cleaned } = await gc.tick(worktrees)
    expect(cleaned.length).toBe(0)
  })

  test("cleanDeadLetters removes old files", async () => {
    const deadDir = path.join(dir, "dead-letter")
    await fs.promises.mkdir(deadDir, { recursive: true })
    const oldFile = path.join(deadDir, "old.jsonl")
    await fs.promises.writeFile(oldFile, "test")
    const oldTime = Date.now() - 86400000 * 10
    await fs.promises.utimes(oldFile, new Date(oldTime), new Date(oldTime))
    const removed = await gc.cleanDeadLetters()
    expect(removed).toBe(1)
  })

  test("calculateDiskUsage returns bytes", async () => {
    const sub = path.join(dir, "subdir")
    await fs.promises.mkdir(sub)
    await fs.promises.writeFile(path.join(sub, "file.txt"), "hello")
    const bytes = await gc.calculateDiskUsage(sub)
    expect(bytes).toBe(5)
  })
})
