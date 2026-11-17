import { describe, expect, test } from "bun:test"
import { runExtraction, runConsolidation } from "../../src/adapter/opencode/extraction"
import { activeRecords } from "../../src/core/ledger"
import { createStore } from "../../src/adapter/opencode/store"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { NMessage } from "../../src/core/types"
import type { SessionState, RolloverConfig } from "../../src/core/types"
import type { LlmPort } from "../../src/core/ports"
import { DEFAULT_CONFIG } from "../../src/core/config"

const cfg: RolloverConfig = { ...DEFAULT_CONFIG, consolidateAfterRecords: 2, extractionDeltaMaxTokens: 12000 }

function msg(id: string, role: "user" | "assistant", text: string): NMessage {
  return { id, role, parts: [{ type: "text", text }], createdAt: 0 }
}

function state(sid: string, cursor: string | null = null): SessionState {
  return {
    v: 1, sessionId: sid, settings: {}, epoch: 0,
    extractedUntilMessageId: cursor, lastContextTokens: 0, lastContextSource: "estimate", lastContextAt: 0,
    rollover: null, decidedUserMessageIds: [], consolidatedAtRecordCount: 0, touchedFiles: {},
  }
}

function makeLlm(responses: string[]): LlmPort {
  let i = 0
  return {
    async complete() {
      const text = responses[i] ?? responses[responses.length - 1]
      i++
      return { text, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, model: "m", latencyMs: 1 }
    },
  }
}

describe("runExtraction", () => {
  test("successful extraction appends records and advances cursor", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ext-"))
    const store = createStore({ dataDir: dir })
    const sid = "s1"
    const st = state(sid, null)
    const msgs = [msg("u1", "user", "use cookies not jwt"), msg("a1", "assistant", "done")]
    const lines: any[] = []
    const llm = makeLlm(['{"records":[{"type":"decision","text":"Use cookies for auth."}]}'])
    const out = await runExtraction({ sid, cfg, st, msgs, lines, llm, smallModel: null, sessionModel: null })
    expect(out.ok).toBe(true)
    expect(out.records.length).toBe(1)
    expect(out.newCursor).toBe("a1")
    // simulate caller
    await store.appendLedger(sid, out.records as any)
    await store.writeState(sid, { ...st, extractedUntilMessageId: out.newCursor! })
    const stored = await store.readLedger(sid)
    expect(activeRecords(stored).length).toBe(1)
    expect((await store.readState(sid))?.extractedUntilMessageId).toBe("a1")
    rmSync(dir, { recursive: true, force: true })
  })

  test("invalid JSON then valid → 2 LLM calls, cursor advanced", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ext-"))
    const sid = "s1"
    const st = state(sid, null)
    const msgs = [msg("u1", "user", "hi"), msg("a1", "assistant", "ok")]
    const lines: any[] = []
    let calls = 0
    const llm: LlmPort = {
      async complete() {
        calls++
        const text = calls === 1 ? "not json" : '{"records":[{"type":"objective","text":"did hi"}]}'
        return { text, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, model: "m", latencyMs: 1 }
      },
    }
    const out = await runExtraction({ sid, cfg, st, msgs, lines, llm, smallModel: null, sessionModel: null })
    expect(out.ok).toBe(true)
    expect(calls).toBe(2)
    expect(out.newCursor).toBe("a1")
    rmSync(dir, { recursive: true, force: true })
  })

  test("invalid twice → ok false, no records, cursor null", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ext-"))
    const sid = "s1"
    const st = state(sid, null)
    const msgs = [msg("u1", "user", "hi"), msg("a1", "assistant", "ok")]
    const lines: any[] = []
    const llm = makeLlm(["not json", "still not json"])
    const out = await runExtraction({ sid, cfg, st, msgs, lines, llm, smallModel: null, sessionModel: null })
    expect(out.ok).toBe(false)
    expect(out.records).toEqual([])
    expect(out.newCursor).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  test("truncated JSON (model hit its output cap) → salvage keeps the complete records", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ext-"))
    const sid = "s1"
    const st = state(sid, null)
    const msgs = [msg("u1", "user", "hi"), msg("a1", "assistant", "ok")]
    // The model hit its output cap mid-record: the first record is complete, the second is cut.
    const truncated = '{"records":[{"type":"decision","text":"Use cookies for auth."},{"type":"objective","text":"Auth migra'
    const llm = makeLlm([truncated])
    const out = await runExtraction({ sid, cfg, st, msgs, lines: [], llm, smallModel: null, sessionModel: null })
    expect(out.ok).toBe(true)
    expect(out.records.length).toBe(1)
    expect(out.records[0].type).toBe("decision")
    expect(out.records[0].text).toBe("Use cookies for auth.")
    expect(out.newCursor).toBe("a1")
    rmSync(dir, { recursive: true, force: true })
  })

  test("dedupe skips duplicate records", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ext-"))
    const sid = "s1"
    const st = state(sid, null)
    const msgs = [msg("u1", "user", "hi"), msg("a1", "assistant", "ok")]
    const lines: any[] = [{ kind: "record", id: "o1", type: "objective", text: "did hi", epoch: 0, userMessageId: "u", turnMessageId: "t", createdAt: 0 }]
    const llm = makeLlm(['{"records":[{"type":"objective","text":"did hi"}]}'])
    const out = await runExtraction({ sid, cfg, st, msgs, lines, llm, smallModel: null, sessionModel: null })
    expect(out.ok).toBe(true)
    expect(out.records.length).toBe(0)
    rmSync(dir, { recursive: true, force: true })
  })

  test("redacts secrets in records", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ext-"))
    const sid = "s1"
    const st = state(sid, null)
    const msgs = [msg("u1", "user", "hi"), msg("a1", "assistant", "ok")]
    const lines: any[] = []
    const llm = makeLlm(['{"records":[{"type":"decision","text":"token sk-abcdefghijklmnopqrstuvwxyz1234"}]}'])
    const out = await runExtraction({ sid, cfg, st, msgs, lines, llm, smallModel: null, sessionModel: null })
    expect(out.records[0].text).toContain("[redacted]")
    expect(out.records[0].text).not.toContain("sk-")
    rmSync(dir, { recursive: true, force: true })
  })

  test("shouldConsolidate flag", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ext-"))
    const sid = "s1"
    const st = state(sid, null)
    const msgs = [msg("u1", "user", "hi"), msg("a1", "assistant", "ok")]
    const lines: any[] = [
      { kind: "record", id: "o1", type: "objective", text: "x", epoch: 0, userMessageId: "u", turnMessageId: "t", createdAt: 0 },
      { kind: "record", id: "o2", type: "objective", text: "y", epoch: 0, userMessageId: "u", turnMessageId: "t", createdAt: 0 },
    ]
    const llm = makeLlm(['{"records":[{"type":"objective","text":"new one"}]}'])
    const out = await runExtraction({ sid, cfg, st, msgs, lines, llm, smallModel: null, sessionModel: null })
    // active (2 existing + 1 new = 3) - consolidatedAt (0) = 3 >= 2 → true
    expect(out.shouldConsolidate).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe("runConsolidation", () => {
  test("happy path returns invalidations", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ext-"))
    const sid = "s1"
    const st = state(sid, null)
    const lines: any[] = [
      { kind: "record", id: "d1", type: "decision", text: "use jwt", epoch: 0, userMessageId: "u", turnMessageId: "t", createdAt: 1 },
      { kind: "record", id: "d2", type: "decision", text: "use cookies", epoch: 0, userMessageId: "u", turnMessageId: "t", createdAt: 2 },
    ]
    const llm = makeLlm(['{"invalidate":[{"id":"d1","reason":"superseded","by":"d2"}]}'])
    const out = await runConsolidation({ sid, cfg, st, lines, llm })
    expect(out.ok).toBe(true)
    expect(out.invalidations.length).toBe(1)
    expect((out.invalidations[0] as { id: string }).id).toBe("d1")
    rmSync(dir, { recursive: true, force: true })
  })

  test("invalid json → ok false", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ext-"))
    const sid = "s1"
    const st = state(sid, null)
    const lines: any[] = [{ kind: "record", id: "d1", type: "decision", text: "x", epoch: 0, userMessageId: "u", turnMessageId: "t", createdAt: 1 }]
    const llm = makeLlm(["bad"])
    const out = await runConsolidation({ sid, cfg, st, lines, llm })
    expect(out.ok).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  test("unknown by → ok false", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ext-"))
    const sid = "s1"
    const st = state(sid, null)
    const lines: any[] = [{ kind: "record", id: "d1", type: "decision", text: "x", epoch: 0, userMessageId: "u", turnMessageId: "t", createdAt: 1 }]
    const llm = makeLlm(['{"invalidate":[{"id":"d1","reason":"superseded","by":"zz"}]}'])
    const out = await runConsolidation({ sid, cfg, st, lines, llm })
    expect(out.ok).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })
})
