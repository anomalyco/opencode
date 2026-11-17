/**
 * Turkish replay of the deterministic extraction gate: the same 20-turn
 * conversation shape as the validated English experiment (see
 * tests/integration/gate-replay.test.ts), written in Turkish, run through the
 * ACTUAL implemented gate — the production scheduler onIdle path, the
 * production classify/shouldRun/deriveGateInputs, and the production
 * buildDelta (via runExtraction). Fixture:
 * tests/fixtures/gate/replay-turkish-20-turns.json.
 *
 * Required outcome: identical profile to the English experiment —
 * classification 8 SKIP / 11 EXTRACT / 1 DEFER, 7 extraction runs (−65%),
 * identical per-turn decisions, identical delta boundaries and cursor
 * progression, 32/32 meaningful record source coverage.
 */
import { describe, expect, test } from "bun:test"
import { createScheduler } from "../../src/adapter/opencode/scheduler"
import { createStore } from "../../src/adapter/opencode/store"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { MetricEvent, NMessage, SessionState } from "../../src/core/types"
import { DEFAULT_CONFIG } from "../../src/core/config"
import fixture from "../fixtures/gate/replay-turkish-20-turns.json"

const messages: string[] = fixture.messages

interface TurnRecord {
  turn: number
  classified?: MetricEvent & { cls: string; decision: string; urgent: boolean; rule: string }
  scheduled?: MetricEvent
  coalesced?: MetricEvent
  ran: boolean
  covers?: number[]
}

async function replay(): Promise<{ turns: TurnRecord[]; cursorHistory: Array<string | null> }> {
  const dir = mkdtempSync(path.join(tmpdir(), "gate-replay-tr-"))
  const store = createStore({ dataDir: dir })
  const sid = "ses_replay_tr"
  await store.writeState(sid, state(sid))
  const events: MetricEvent[] = []
  const prompts: string[] = []
  const turns: TurnRecord[] = []
  const cursorHistory: Array<string | null> = []
  const sched = createScheduler({
    store: store as Parameters<typeof createScheduler>[0]["store"],
    getConfig: async () => ({ ...DEFAULT_CONFIG, mode: "auto" }),
    getMessages: () => history(),
    getState: async () => store.readState(sid),
    setState: async (s, v) => store.writeState(s, v),
    getSmallModel: () => null,
    getSessionModel: async () => null,
    createLlm: () => ({
      async complete(req) {
        prompts.push(req.user)
        return { text: '{"records":[]}', usage: null, model: "m", latencyMs: 1 }
      },
    }),
    metric: async (s, ev) => {
      events.push(ev)
    },
    debounceMs: 5,
  })

  let completed = 0
  function history(): NMessage[] {
    const out: NMessage[] = []
    for (let t = 1; t <= completed; t++) {
      out.push({ id: `u${t}`, role: "user", parts: [{ type: "text", text: messages[t - 1] }], createdAt: t })
      out.push({ id: `a${t}`, role: "assistant", parts: [{ type: "text", text: `reply ${t}` }], createdAt: t })
    }
    return out
  }

  for (let t = 1; t <= messages.length; t++) {
    completed = t // the turn's own (user, assistant) pair is in the history when the idle hook fires
    const before = (await store.readState(sid))?.extractedUntilMessageId ?? null
    const classified = events.filter((e) => e.ev === "gate_classified").length
    await sched.onIdle(sid)
    const after = (await store.readState(sid))?.extractedUntilMessageId ?? null
    const newClassified = events.filter((e) => e.ev === "gate_classified")[classified] as TurnRecord["classified"]
    const scheduled = events.filter((e) => e.ev === "gate_scheduled").at(-1)
    const coalesced = events.filter((e) => e.ev === "gate_coalesced").at(-1)
    const ran = after !== before && after !== null
    const rec: TurnRecord = { turn: t, classified: newClassified, ran }
    if (scheduled) rec.scheduled = scheduled as MetricEvent
    if (coalesced) rec.coalesced = coalesced as MetricEvent
    if (ran) {
      // which user turns does this run's delta cover? (texts contained in the prompt)
      const prompt = prompts.at(-1)!
      rec.covers = []
      for (let k = 1; k <= t; k++) {
        if (prompt.includes(messages[k - 1])) rec.covers.push(k)
      }
      cursorHistory.push(after)
    }
    turns.push(rec)
  }
  rmSync(dir, { recursive: true, force: true })
  return { turns, cursorHistory }
}

function state(sid: string): SessionState {
  return {
    v: 1, sessionId: sid, settings: {}, epoch: 0, extractedUntilMessageId: null,
    lastContextTokens: 0, lastContextSource: "estimate", lastContextAt: 0, rollover: null,
    decidedUserMessageIds: [], consolidatedAtRecordCount: 0, touchedFiles: {},
  }
}

describe("Turkish replay (gate language independence)", () => {
  test("per-turn classification matches the Turkish fixture exactly", async () => {
    const { turns } = await replay()
    expect(turns.length).toBe(20)
    for (const expected of fixture.perTurn) {
      const rec = turns[expected.turn - 1]
      expect(rec.classified, `turn ${expected.turn} classified`).toBeDefined()
      expect(rec.classified!.cls).toBe(expected.cls)
      expect(rec.classified!.decision).toBe(expected.decision)
      expect(rec.classified!.urgent).toBe(expected.urgent)
      expect(rec.classified!.rule.startsWith(expected.rulePrefix)).toBe(true)
    }
  })

  test("classification totals: 8 SKIP / 11 EXTRACT / 1 DEFER", async () => {
    const { turns } = await replay()
    const counts = { EXTRACT: 0, SKIP: 0, DEFER: 0 }
    for (const rec of turns) counts[rec.classified!.decision as keyof typeof counts]++
    expect(counts.EXTRACT).toBe(fixture.expected.classification.extract)
    expect(counts.SKIP).toBe(fixture.expected.classification.skip)
    expect(counts.DEFER).toBe(fixture.expected.classification.defer)
  })

  test("scheduling decisions match turn-for-turn: 7 runs at the validated turns", async () => {
    const { turns } = await replay()
    const runTurns = turns.filter((t) => t.ran).map((t) => t.turn)
    const expectedRunTurns = fixture.perTurn.filter((p) => p.run).map((p) => p.turn)
    expect(runTurns).toEqual(expectedRunTurns)
    expect(runTurns.length).toBe(fixture.expected.runs)
    const avoided = turns.filter((t) => !t.ran).map((t) => t.turn)
    expect(avoided).toEqual(fixture.expected.avoidedTurns)
    // DEFER turn never runs alone; completion turns always run
    const deferTurn = turns.find((t) => t.classified!.decision === "DEFER")!
    expect(deferTurn.ran).toBe(false)
    for (const p of fixture.perTurn.filter((x) => x.cls === "completion")) {
      expect(turns[p.turn - 1].ran).toBe(true)
    }
  })

  test("delta boundaries and cursor progression match the coverage spans", async () => {
    const { turns } = await replay()
    const runs = turns.filter((t) => t.ran)
    expect(runs.length).toBe(fixture.expected.runs)
    const expectedSpans = fixture.expected.coverageSpans
    runs.forEach((rec, i) => {
      expect(rec.covers, `run ${i + 1} (turn ${rec.turn}) covers`).toEqual(expectedSpans[i])
    })
    // every user turn is covered exactly once across all runs (no loss, no duplication)
    const all = runs.flatMap((r) => r.covers ?? []).sort((a, b) => a - b)
    expect(all).toEqual(Array.from({ length: messages.length }, (_, i) => i + 1))
  })

  test("record coverage: 32/32 meaningful records covered, zero lost corrections/standing/open items", async () => {
    const { turns } = await replay()
    const covered = new Set(turns.flatMap((t) => (t.ran ? t.covers : [])))
    const entries = Object.entries(fixture.recordSourceTurns) as Array<[string, number]>
    expect(entries.length).toBe(32)
    const uncovered = entries.filter(([, turn]) => !covered.has(turn))
    expect(uncovered, "uncovered meaningful records").toEqual([])
    // explicit guarantees from the findings
    const lostCorrections = entries.filter(([id, turn]) => id.startsWith("c") && !covered.has(turn))
    const lostStanding = entries.filter(([id, turn]) => (id.startsWith("c") || id.startsWith("d")) && !covered.has(turn))
    const lostOpenItems = entries.filter(([id, turn]) => id.startsWith("i") && !covered.has(turn))
    expect(lostCorrections.length).toBe(0)
    expect(lostStanding.length).toBe(0)
    expect(lostOpenItems.length).toBe(0)
  })

  test("byte-deterministic: two replays produce identical outcomes", async () => {
    const a = await replay()
    const b = await replay()
    const shape = (r: Awaited<ReturnType<typeof replay>>) =>
      r.turns.map((t) => ({
        turn: t.turn,
        cls: t.classified?.cls,
        decision: t.classified?.decision,
        rule: t.classified?.rule,
        ran: t.ran,
        covers: t.covers,
      }))
    expect(shape(b)).toEqual(shape(a))
    expect(b.cursorHistory).toEqual(a.cursorHistory)
  })
})
