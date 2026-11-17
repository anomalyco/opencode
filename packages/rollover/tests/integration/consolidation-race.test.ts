import { describe, expect, test } from "bun:test"
import { runConsolidation } from "../../src/adapter/opencode/extraction"
import type { SessionState } from "../../src/core/types"
import { DEFAULT_CONFIG } from "../../src/core/config"

const cfg = { ...DEFAULT_CONFIG, consolidateAfterRecords: 100 }

function state(sid: string): SessionState {
  return { v: 1, sessionId: sid, settings: {}, epoch: 0, extractedUntilMessageId: null, lastContextTokens: 0, lastContextSource: "estimate", lastContextAt: 0, rollover: null, decidedUserMessageIds: [], consolidatedAtRecordCount: 0, touchedFiles: {} }
}

describe("consolidation race (T8)", () => {
  test("only snapshot records invalidated; newly appended survive", async () => {
    const sid = "s1"
    const st = state(sid)
    const snapshotLines = [
      { kind: "record", id: "d1", type: "decision", text: "use jwt", epoch: 0, userMessageId: "u", turnMessageId: "t", createdAt: 1 },
      { kind: "record", id: "d2", type: "decision", text: "use cookies", epoch: 0, userMessageId: "u", turnMessageId: "t", createdAt: 2 },
    ] as any[]
    // consolidation sees only the snapshot; d3 (appended later) is invisible to it.
    const llm = { async complete() { return { text: '{"invalidate":[{"id":"d1","reason":"superseded","by":"d2"}]}', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, model: "m", latencyMs: 1 } } }
    const out = await runConsolidation({ sid, cfg, st, lines: snapshotLines, llm: llm as any })
    expect(out.ok).toBe(true)
    expect(out.invalidations.length).toBe(1)
    expect((out.invalidations[0] as { id: string }).id).toBe("d1")
  })
})
