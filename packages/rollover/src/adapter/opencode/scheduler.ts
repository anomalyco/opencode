/** Extraction scheduler (debounce, inflight, re-queue) — spec Part A §7.1. */
import type { NMessage } from "../../core/types"
import type { SessionState, RolloverConfig } from "../../core/types"
import type { MetricEvent } from "../../core/types"
import type { LlmPort, StorePort } from "../../core/ports"
import { runExtraction, runConsolidation } from "./extraction"
import { activeRecords } from "../../core/ledger"
import { classify, deriveGateInputs, shouldRun } from "../../core/gate"
import { metricEvent } from "../../core/metrics"

export interface SchedulerDeps {
  store: StorePort & { withSessionLock: <T>(sid: string, fn: () => Promise<T>) => Promise<T> }
  getConfig: (sid: string) => Promise<RolloverConfig>
  getMessages: (sid: string) => NMessage[] | undefined
  getState: (sid: string) => Promise<SessionState | null>
  setState: (sid: string, s: SessionState) => Promise<void>
  getSmallModel: () => string | null
  getSessionModel: (sid: string) => Promise<{ providerID: string; id: string } | null>
  createLlm: (sid: string) => LlmPort
  metric: (sid: string, ev: MetricEvent) => Promise<void>
  debounceMs?: number
}

export function lastCompletedAssistantId(msgs: NMessage[]): string | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m.role !== "assistant") continue
    if (m.parts.some((p) => p.type === "tool" && (p.status === "pending" || p.status === "running"))) continue
    return m.id
  }
  return null
}

export function isCaughtUp(st: SessionState, msgs: NMessage[]): boolean {
  const lastId = lastCompletedAssistantId(msgs)
  return lastId !== null && st.extractedUntilMessageId === lastId
}

export function createScheduler(deps: SchedulerDeps) {
  const debounceMs = deps.debounceMs ?? 300
  const inflight = new Map<string, Promise<void>>()
  const state = new Map<string, { timer: ReturnType<typeof setTimeout> | null; pending: boolean; running: boolean }>()

  function getSessionState(sid: string) {
    let s = state.get(sid)
    if (!s) {
      s = { timer: null, pending: false, running: false }
      state.set(sid, s)
    }
    return s
  }

  async function doRun(sid: string): Promise<void> {
    const s = getSessionState(sid)
    s.running = true
    s.pending = false
    try {
      const cfg = await deps.getConfig(sid)
      if (cfg.mode !== "auto") return
      const msgs = deps.getMessages(sid)
      if (!msgs || msgs.length === 0) return
      const st = await deps.getState(sid)
      if (!st) return
      const lines = await deps.store.readLedger(sid)
      await deps.metric(sid, { ev: "extraction_started", ts: Date.now(), sessionId: sid, epoch: st.epoch })
      const llm = deps.createLlm(sid)
      const out = await runExtraction({
        sid,
        cfg,
        st,
        msgs,
        lines,
        llm,
        smallModel: deps.getSmallModel(),
        sessionModel: await deps.getSessionModel(sid),
      })
      if (!out.ok) {
        await deps.metric(sid, { ev: "extraction_failed", ts: Date.now(), sessionId: sid, epoch: st.epoch, detail: out.reason ?? "unknown" })
        return
      }
      const current = await deps.getState(sid)
      if (!current) return
      if (current.extractedUntilMessageId !== st.extractedUntilMessageId) return
      if (out.records.length > 0) await deps.store.appendLedger(sid, out.records)
      await deps.store.writeState(sid, { ...current, extractedUntilMessageId: out.newCursor ?? current.extractedUntilMessageId })
      await deps.metric(sid, { ev: "extraction_completed", ts: Date.now(), sessionId: sid, epoch: st.epoch, records: out.records.length })

      if (out.shouldConsolidate) {
        await deps.metric(sid, { ev: "consolidation_started", ts: Date.now(), sessionId: sid, epoch: st.epoch })
        const st2 = await deps.getState(sid)
        if (st2) {
          const lines2 = await deps.store.readLedger(sid)
          const llm2 = deps.createLlm(sid)
          const cout = await runConsolidation({ sid, cfg, st: st2, lines: lines2, llm: llm2 })
          if (cout.ok && cout.invalidations.length > 0) {
              const current = await deps.getState(sid)
              if (!current) return
              if (current.extractedUntilMessageId !== st2.extractedUntilMessageId) return
              await deps.store.appendLedger(sid, cout.invalidations)
              await deps.store.writeState(sid, { ...current, consolidatedAtRecordCount: activeRecords(await deps.store.readLedger(sid)).length })
            await deps.metric(sid, { ev: "consolidation_completed", ts: Date.now(), sessionId: sid, epoch: st2.epoch, invalidated: cout.invalidations.length })
          } else if (!cout.ok) {
            await deps.metric(sid, { ev: "consolidation_failed", ts: Date.now(), sessionId: sid, epoch: st2.epoch, detail: cout.reason ?? "unknown" })
          }
        }
      }
    } catch (e) {
      const s2 = await deps.getState(sid).catch(() => null)
      await deps.metric(sid, { ev: "extraction_failed", ts: Date.now(), sessionId: sid, epoch: s2?.epoch, detail: String(e) }).catch(() => {})
    } finally {
      s.running = false
      inflight.delete(sid)
      if (s.pending) {
        s.pending = false
        schedule(sid)
      }
    }
  }

  function schedule(sid: string): void {
    const s = getSessionState(sid)
    if (s.running) {
      s.pending = true
      return
    }
    if (s.timer) clearTimeout(s.timer)
    s.timer = setTimeout(() => {
      s.timer = null
      const p = doRun(sid)
      inflight.set(sid, p)
      p.finally(() => {
        if (inflight.get(sid) === p) inflight.delete(sid)
      })
    }, debounceMs)
  }

  /**
   * The idle-hook entry point. Classifies the pending turn with the
   * deterministic gate (zero LLM calls) and only schedules the extraction
   * when the validated policy says to run. Any gate error falls back to the
   * pre-gate behavior — extraction runs as before; the gate never turns into
   * a silent skip. With the gate disabled this is exactly the old runNow path.
   */
  async function onIdle(sid: string): Promise<void> {
    try {
      const cfg = await deps.getConfig(sid)
      if (cfg.mode === "auto" && cfg.extractionGate) {
        const st = await deps.getState(sid)
        const msgs = deps.getMessages(sid)
        if (st && msgs && msgs.length > 0) {
          // A run already in flight or a debounced run pending owns this
          // session's extraction: the candidate coalesces into it (its delta
          // or the follow-up run covers the content). A second concurrent
          // idle must never schedule a duplicate run.
          const s = getSessionState(sid)
          if (s.running || s.timer) {
            await deps.metric(sid, metricEvent("gate_coalesced", sid, st.epoch, { reason: "extraction already in flight or scheduled" }))
            return
          }
          const inputs = deriveGateInputs(msgs, st.extractedUntilMessageId)
          if (inputs) {
            const c = classify(inputs.userText)
            await deps.metric(sid, metricEvent("gate_classified", sid, st.epoch, {
              cls: c.cls,
              decision: c.decision,
              urgent: c.urgent,
              rule: c.rule,
              matched: c.matched,
              pendingMessages: inputs.pendingMessages,
              pendingTokens: inputs.pendingTokens,
            }))
            if (c.decision !== "EXTRACT") {
              // SKIP/DEFER: not a candidate. The content stays pending — the
              // cursor does not move, so the next run's delta accumulates it.
              return
            }
            const sched = shouldRun(c.cls, c.decision, c.urgent, inputs.counter, inputs.lastRunWasPreviousTurn)
            if (!sched.run) {
              await deps.metric(sid, metricEvent("gate_coalesced", sid, st.epoch, { cls: c.cls, reason: sched.reason }))
              return
            }
            await deps.metric(sid, metricEvent("gate_scheduled", sid, st.epoch, { cls: c.cls, reason: sched.reason }))
          }
        }
      }
    } catch (error) {
      const st = await deps.getState(sid).catch(() => null)
      await deps
        .metric(sid, metricEvent("gate_fallback", sid, st?.epoch, { detail: String(error) }))
        .catch(() => {})
    }
    await runNow(sid)
  }

  async function runNow(sid: string): Promise<void> {
    const s = getSessionState(sid)
    // Coalesce with an in-flight run instead of racing a second doRun; the
    // pending-requeue in doRun's finally covers anything queued meanwhile.
    if (s.running) {
      const p = inflight.get(sid)
      if (p) await p
      return
    }
    if (s.timer) { clearTimeout(s.timer); s.timer = null }
    const p = doRun(sid)
    inflight.set(sid, p)
    await p
  }

  return {
    schedule,
    onIdle,
    runNow,
    inflight,
  }
}
