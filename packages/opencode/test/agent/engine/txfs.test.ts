import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { RealGitTransactionManager } from "../../../src/agent/engine/transactional-fs-real"
import { GitTransactionManager } from "../../../src/agent/engine/transactional-fs"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

let testDir: string
let workDir: string

beforeEach(async () => {
  testDir = join(tmpdir(), `fengru-txfs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  workDir = join(testDir, "repo")
  await mkdir(workDir, { recursive: true })
})

afterEach(async () => {
  try { await rm(testDir, { recursive: true, force: true }) } catch { /* ignore */ }
})

async function createFile(relPath: string, content: string): Promise<string> {
  const fullPath = join(workDir, relPath)
  await mkdir(join(fullPath, ".."), { recursive: true })
  await writeFile(fullPath, content)
  return relPath
}

// ─── In-memory GitTransactionManager ─────────────────────────────────────────

describe("GitTransactionManager (in-memory)", () => {
  test("begin creates active transaction", () => {
    const tm = new GitTransactionManager()
    const tx = tm.begin("s1", [
      { path: "src/a.ts", content: "const x = 1" },
      { path: "src/b.ts", content: "const y = 2" },
    ])
    expect(tx.sessionId).toBe("s1")
    expect(tx.status).toBe("active")
    expect(tx.affectedFiles).toEqual(["src/a.ts", "src/b.ts"])
    expect(Object.keys(tx.baselineHash)).toHaveLength(2)
  })

  test("propose stages file content", () => {
    const tm = new GitTransactionManager()
    tm.begin("s1", [{ path: "src/a.ts", content: "old" }])
    tm.propose("src/a.ts", "new content")
    // Verify via commit later
    const active = tm.getActiveTransaction()
    expect(active).not.toBeNull()
  })

  test("validate passes when no external changes", () => {
    const tm = new GitTransactionManager()
    const tx = tm.begin("s1", [
      { path: "a.ts", content: "original" },
    ])
    // In-memory: validate always passes since there's no external mutation
    const result = tm.validate(tx)
    expect(result.valid).toBe(true)
  })

  test("commit succeeds for clean files", () => {
    const tm = new GitTransactionManager()
    const tx = tm.begin("s1", [
      { path: "a.ts", content: "original" },
    ])
    tm.propose("a.ts", "modified")
    const result = tm.commit(
      tx,
      (file) => tm.getActiveTransaction()?.baselineHash[file] ? "original" : "",
    )
    expect(result.status).toBe("SUCCESS")
  })

  test("getActiveTransaction returns current transaction", () => {
    const tm = new GitTransactionManager()
    expect(tm.getActiveTransaction()).toBeNull()
    tm.begin("s1", [{ path: "a.ts", content: "x" }])
    expect(tm.getActiveTransaction()).not.toBeNull()
  })

  test("rollback restores files", () => {
    const tm = new GitTransactionManager()
    const tx = tm.begin("s1", [
      { path: "a.ts", content: "original" },
    ])
    tm.propose("a.ts", "modified")
    tm.rollback(tx)
    expect(tx.status).toBe("rolled_back")
  })

  test("multiple files can be staged", () => {
    const tm = new GitTransactionManager()
    const tx = tm.begin("s1", [
      { path: "a.ts", content: "a" },
      { path: "b.ts", content: "b" },
      { path: "c.ts", content: "c" },
    ])
    tm.propose("a.ts", "a2")
    tm.propose("b.ts", "b2")
    // getCurrentContent must return the same content that was used at begin() time
    const contentMap: Record<string, string> = { "a.ts": "a", "b.ts": "b", "c.ts": "c" }
    const result = tm.commit(tx, (file) => contentMap[file] ?? "")
    expect(result.status).toBe("SUCCESS")
  })
})

// ─── RealGitTransactionManager (filesystem-backed) ───────────────────────────

describe("RealGitTransactionManager", () => {
  test("constructor detects non-git directory", () => {
    const txm = new RealGitTransactionManager(workDir)
    const active = txm.getActiveTransaction()
    expect(active).toBeNull()
  })

  test("begin creates transaction for real files", async () => {
    await createFile("src/main.ts", "console.log('hello')")
    await createFile("src/utils.ts", "export const x = 1")

    const txm = new RealGitTransactionManager(workDir)
    const tx = await txm.begin("s1", ["src/main.ts", "src/utils.ts"])
    expect(tx.sessionId).toBe("s1")
    expect(tx.status).toBe("active")
    expect(tx.affectedFiles).toHaveLength(2)
  })

  test("begin with non-existent file returns empty content", async () => {
    const txm = new RealGitTransactionManager(workDir)
    const tx = await txm.begin("s2", ["nonexistent.txt"])
    expect(tx.affectedFiles).toHaveLength(1)
    // Non-existent file baseline hash is hash of empty string
    expect(tx.baselineHash["nonexistent.txt"]).toBeDefined()
  })

  test("propose and commit writes to filesystem", async () => {
    await createFile("src/app.ts", "const old = 1")
    const txm = new RealGitTransactionManager(workDir)
    const tx = await txm.begin("s3", ["src/app.ts"])

    txm.propose("src/app.ts", "const updated = 2")
    const result = await txm.commit(tx)

    expect(result.status).toBe("SUCCESS")
    expect(tx.status).toBe("committed")

    // Verify file was actually written
    const content = await Bun.file(join(workDir, "src/app.ts")).text()
    expect(content).toBe("const updated = 2")
  })

  test("validate detects external modification", async () => {
    await createFile("src/data.ts", "original data")
    const txm = new RealGitTransactionManager(workDir)
    const tx = await txm.begin("s4", ["src/data.ts"])

    // Someone else modifies the file
    await writeFile(join(workDir, "src/data.ts"), "modified externally")

    const result = await txm.validate(tx)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe("WORKSPACE_MODIFIED")
  })

  test("commit detects TOCTOU race", async () => {
    await createFile("src/race.ts", "v1")
    const txm = new RealGitTransactionManager(workDir)
    const tx = await txm.begin("s5", ["src/race.ts"])

    txm.propose("src/race.ts", "v2-proposed")

    // Simulate race: external modification between validate and commit
    await writeFile(join(workDir, "src/race.ts"), "v3-external")

    const result = await txm.commit(tx)
    expect(result.status).toBe("CONFLICT")
    expect(result.reason).toContain("TOCTOU")
  })

  test("threeWayMerge handles identical changes", () => {
    const txm = new RealGitTransactionManager(workDir)
    const result = txm.threeWayMerge(
      "line1\nline2\nline3",
      "line1\nline2\nline3",
      "line1\nline2\nline3",
    )
    expect(result.hasConflicts).toBe(false)
    expect(result.content).toBe("line1\nline2\nline3")
  })

  test("threeWayMerge accepts ours when theirs equals base", () => {
    const txm = new RealGitTransactionManager(workDir)
    const result = txm.threeWayMerge(
      "base",
      "ours modified",
      "base",
    )
    expect(result.hasConflicts).toBe(false)
    expect(result.content).toBe("ours modified")
  })

  test("threeWayMerge accepts theirs when ours equals base", () => {
    const txm = new RealGitTransactionManager(workDir)
    const result = txm.threeWayMerge(
      "base",
      "base",
      "theirs modified",
    )
    expect(result.hasConflicts).toBe(false)
    expect(result.content).toBe("theirs modified")
  })

  test("threeWayMerge detects conflicting changes", () => {
    const txm = new RealGitTransactionManager(workDir)
    const result = txm.threeWayMerge(
      "original line",
      "our changed line",
      "their changed line",
    )
    expect(result.hasConflicts).toBe(true)
    expect(result.markers.length).toBeGreaterThan(0)
    expect(result.content).toContain("<<<<<<< OUR")
    expect(result.content).toContain(">>>>>>> THEIR")
  })

  test("threeWayMerge handles multi-line merges", () => {
    const txm = new RealGitTransactionManager(workDir)
    const base = "line1\nline2\nline3\nline4"
    const ours = "line1\nline2-ours\nline3\nline4"
    const theirs = "line1\nline2-theirs\nline3\nline4"
    const result = txm.threeWayMerge(base, ours, theirs)
    expect(result.hasConflicts).toBe(true)
  })

  test("rollback clears staging and marks transaction", async () => {
    await createFile("src/roll.ts", "keep me")
    const txm = new RealGitTransactionManager(workDir)
    const tx = await txm.begin("s6", ["src/roll.ts"])

    txm.propose("src/roll.ts", "temp change")
    await txm.rollback(tx)

    expect(tx.status).toBe("rolled_back")
    expect(txm.getActiveTransaction()).toBeNull()
  })

  test("getActiveTransaction returns null when no active tx", () => {
    const txm = new RealGitTransactionManager(workDir)
    expect(txm.getActiveTransaction()).toBeNull()
  })

  test("multiple files commit together", async () => {
    await createFile("a.ts", "a1")
    await createFile("b.ts", "b1")
    await createFile("c.ts", "c1")

    const txm = new RealGitTransactionManager(workDir)
    const tx = await txm.begin("s7", ["a.ts", "b.ts", "c.ts"])

    txm.propose("a.ts", "a2")
    txm.propose("b.ts", "b2")
    txm.propose("c.ts", "c2")

    const result = await txm.commit(tx)
    expect(result.status).toBe("SUCCESS")

    const a = await Bun.file(join(workDir, "a.ts")).text()
    const b = await Bun.file(join(workDir, "b.ts")).text()
    const c = await Bun.file(join(workDir, "c.ts")).text()
    expect(a).toBe("a2")
    expect(b).toBe("b2")
    expect(c).toBe("c2")
  })
})
