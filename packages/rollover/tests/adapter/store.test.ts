import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createStore } from "../../src/adapter/opencode/store"
import type { SessionState } from "../../src/core/types"

function sandbox(): string {
  return mkdtempSync(path.join(tmpdir(), "opencode-rollover-store-"))
}

function state(sid: string, epoch = 0): SessionState {
  return {
    v: 1,
    sessionId: sid,
    settings: {},
    epoch,
    extractedUntilMessageId: null,
    lastContextTokens: 0,
    lastContextSource: "estimate",
    lastContextAt: 0,
    rollover: null,
    decidedUserMessageIds: [],
    consolidatedAtRecordCount: 0,
    touchedFiles: {},
  }
}

describe("store", () => {
  test("state round-trip", async () => {
    const dir = sandbox()
    const store = createStore({ dataDir: dir })
    const s = state("s1")
    await store.writeState("s1", s)
    const got = await store.readState("s1")
    expect(got).toEqual(s)
    rmSync(dir, { recursive: true, force: true })
  })

  test("readState returns null for missing session", async () => {
    const dir = sandbox()
    const store = createStore({ dataDir: dir })
    expect(await store.readState("nope")).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  test("concurrent writes serialized", async () => {
    const dir = sandbox()
    const store = createStore({ dataDir: dir })
    await Promise.all(Array.from({ length: 10 }, (_, i) => store.writeState("s1", state("s1", i))))
    const got = await store.readState("s1")
    expect(got?.epoch).toBe(9)
    rmSync(dir, { recursive: true, force: true })
  })

  test("appendLedger preserves prior lines", async () => {
    const dir = sandbox()
    const store = createStore({ dataDir: dir })
    await store.appendLedger("s1", [{ kind: "record", id: "o1", type: "objective", text: "a", epoch: 0, userMessageId: "u", turnMessageId: "t", createdAt: 1 } as never])
    await store.appendLedger("s1", [{ kind: "record", id: "o2", type: "objective", text: "b", epoch: 0, userMessageId: "u", turnMessageId: "t", createdAt: 2 } as never])
    const lines = await store.readLedger("s1")
    expect(lines.length).toBe(2)
    expect((lines[0] as { id: string }).id).toBe("o1")
    expect((lines[1] as { id: string }).id).toBe("o2")
    rmSync(dir, { recursive: true, force: true })
  })

  test("corrupt final line skipped, earlier lines intact", async () => {
    const dir = sandbox()
    const store = createStore({ dataDir: dir })
    await store.appendLedger("s1", [{ kind: "record", id: "o1", type: "objective", text: "a", epoch: 0, userMessageId: "u", turnMessageId: "t", createdAt: 1 } as never])
    // append a corrupt trailing line directly
    const { appendFileSync } = await import("node:fs")
    appendFileSync(path.join(dir, "s1", "ledger.jsonl"), "{not json\n")
    const lines = await store.readLedger("s1")
    expect(lines.length).toBe(1)
    rmSync(dir, { recursive: true, force: true })
  })

  test("corrupt middle line skipped, rest kept", async () => {
    const dir = sandbox()
    const store = createStore({ dataDir: dir })
    const { appendFileSync, mkdirSync } = await import("node:fs")
    mkdirSync(path.join(dir, "s1"), { recursive: true })
    appendFileSync(path.join(dir, "s1", "ledger.jsonl"), JSON.stringify({ kind: "record", id: "o1", type: "objective", text: "a", epoch: 0, userMessageId: "u", turnMessageId: "t", createdAt: 1 }) + "\n")
    appendFileSync(path.join(dir, "s1", "ledger.jsonl"), "{bad}\n")
    appendFileSync(path.join(dir, "s1", "ledger.jsonl"), JSON.stringify({ kind: "record", id: "o2", type: "objective", text: "b", epoch: 0, userMessageId: "u", turnMessageId: "t", createdAt: 2 }) + "\n")
    const lines = await store.readLedger("s1")
    expect(lines.length).toBe(2)
    rmSync(dir, { recursive: true, force: true })
  })

  test("path traversal in sid rejected", async () => {
    const dir = sandbox()
    const store = createStore({ dataDir: dir })
    await expect(store.readState("../etc")).rejects.toThrow()
    rmSync(dir, { recursive: true, force: true })
  })

  test("state v:2 → null + log", async () => {
    const dir = sandbox()
    const { mkdirSync, writeFileSync } = await import("node:fs")
    mkdirSync(path.join(dir, "s1"), { recursive: true })
    writeFileSync(path.join(dir, "s1", "state.json"), JSON.stringify({ v: 2, sessionId: "s1" }))
    const logs: string[] = []
    const store2 = createStore({ dataDir: dir, log: (m) => logs.push(m) })
    const got = await store2.readState("s1")
    expect(got).toBeNull()
    expect(logs.some((l) => l.includes("version"))).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test("withSessionLock serializes", async () => {
    const dir = sandbox()
    const store = createStore({ dataDir: dir })
    const order: number[] = []
    await Promise.all([
      store.withSessionLock("s1", async () => { await new Promise((r) => setTimeout(r, 30)); order.push(1) }),
      store.withSessionLock("s1", async () => { order.push(2) }),
    ])
    expect(order).toEqual([1, 2])
    rmSync(dir, { recursive: true, force: true })
  })

  test("markGitignore idempotent", async () => {
    const dir = sandbox()
    const projectDir = path.join(dir, "project")
    const { mkdirSync } = await import("node:fs")
    mkdirSync(projectDir, { recursive: true })
    const store = createStore({ dataDir: path.join(projectDir, ".opencode", "rollover") })
    await store.markGitignore(projectDir)
    await store.markGitignore(projectDir)
    const { readFileSync } = await import("node:fs")
    const content = readFileSync(path.join(projectDir, ".gitignore"), "utf8")
    const count = content.split("\n").filter((l) => l.includes("rollover")).length
    expect(count).toBe(1)
    rmSync(dir, { recursive: true, force: true })
  })

  test("metrics append", async () => {
    const dir = sandbox()
    const store = createStore({ dataDir: dir })
    await store.appendMetric("s1", { ev: "swap", ts: 1, sessionId: "s1" })
    const { readFileSync } = await import("node:fs")
    const raw = readFileSync(path.join(dir, "s1", "metrics.jsonl"), "utf8")
    expect(raw.trim().split("\n").length).toBe(1)
    rmSync(dir, { recursive: true, force: true })
  })
})
