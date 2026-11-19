/** Extraction scheduler (debounce, inflight, re-queue) — spec Part A §7.1. */
import type { NMessage } from "../../core/types"
import type { SessionState, RolloverConfig } from "../../core/types"
import type { MetricEvent, LedgerLine } from "../../core/types"
import type { LlmPort, StorePort } from "../../core/ports"
import { runExtraction, runConsolidation } from "./extraction"
import { activeRecords } from "../../core/ledger"
import { projectRollover } from "../../core/projection"
import { estimateTokens } from "../../core/tokens"
import { metricEvent } from "../../core/metrics"

export interface SchedulerDeps {
  store: StorePort & {
    withSessionLock: <T>(sid: string, fn: () => Promise<T>) => Promise<T>
    /** Lock-free variants: only for use inside a withSessionLock critical section. */
    readStateRaw?: (sid: string) => Promise<SessionState | null>
    writeStateRaw?: (sid: string, s: SessionState) => Promise<void>
    readLedgerRaw?: (sid: string) => Promise<LedgerLine[]>
    appendLedgerRaw?: (sid: string, lines: LedgerLine[]) => Promise<void>
  }
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
      // ledger: false keeps the pipeline swap-only — no extraction calls at all.
      if (cfg.ledger === false) return
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
        await deps.metric(sid, {
          ev: "extraction_failed",
          ts: Date.now(),
          sessionId: sid,
          epoch: st.epoch,
          detail: out.reason ?? "unknown",
        })
        return
      }
      // Cursor commit + ledger append + render refresh are one critical
      // section: a concurrent swap's epoch/rollover must not be reverted by
      // this run's stale snapshot (v2 runs extraction and swaps concurrently
      // by design; spec B §3.3).
      let enrichment: { changed: boolean; activeCount: number } = { changed: false, activeCount: 0 }
      await deps.store.withSessionLock(sid, async () => {
        const readRaw = deps.store.readStateRaw?.bind(deps.store) ?? deps.getState
        const current = await readRaw(sid)
        if (!current) return
        if (current.extractedUntilMessageId !== st.extractedUntilMessageId) return
        if (out.records.length > 0) {
          if (deps.store.appendLedgerRaw) await deps.store.appendLedgerRaw(sid, out.records)
          else await deps.store.appendLedger(sid, out.records)
        }
        const committed: SessionState = {
          ...current,
          extractedUntilMessageId: out.newCursor ?? current.extractedUntilMessageId,
        }
        if (deps.store.writeStateRaw) await deps.store.writeStateRaw(sid, committed)
        else await deps.setState(sid, committed)
        enrichment = await refreshInLock(deps, sid, cfg)
        // Inside the critical section metrics must not await the locked store
        // (appendMetric re-enqueues → deadlock); they self-serialize after us.
        void deps.metric(sid, {
          ev: "extraction_completed",
          ts: Date.now(),
          sessionId: sid,
          epoch: current.epoch,
          records: out.records.length,
        })
      })
      if (enrichment.changed) {
        await deps.metric(sid, metricEvent("ledger_enriched", sid, st.epoch, { records: enrichment.activeCount }))
      }

      if (out.shouldConsolidate) {
        await deps.metric(sid, { ev: "consolidation_started", ts: Date.now(), sessionId: sid, epoch: st.epoch })
        const st2 = await deps.getState(sid)
        if (st2) {
          const lines2 = await deps.store.readLedger(sid)
          const llm2 = deps.createLlm(sid)
          const cout = await runConsolidation({ sid, cfg, st: st2, lines: lines2, llm: llm2 })
          if (cout.ok && cout.invalidations.length > 0) {
            await deps.store.withSessionLock(sid, async () => {
              const readRaw = deps.store.readStateRaw?.bind(deps.store) ?? deps.getState
              const current = await readRaw(sid)
              if (!current) return
              if (current.extractedUntilMessageId !== st2.extractedUntilMessageId) return
              if (deps.store.appendLedgerRaw) await deps.store.appendLedgerRaw(sid, cout.invalidations)
              else await deps.store.appendLedger(sid, cout.invalidations)
              const linesNow = deps.store.readLedgerRaw
                ? await deps.store.readLedgerRaw(sid)
                : await deps.store.readLedger(sid)
              const committed: SessionState = {
                ...current,
                consolidatedAtRecordCount: activeRecords(linesNow).length,
              }
              if (deps.store.writeStateRaw) await deps.store.writeStateRaw(sid, committed)
              else await deps.setState(sid, committed)
              const after = await refreshInLock(deps, sid, cfg)
              // in-lock metrics: fire-and-forget (locked appendMetric would deadlock)
              if (after.changed)
                void deps.metric(
                  sid,
                  metricEvent("ledger_enriched", sid, current.epoch, { records: after.activeCount }),
                )
              void deps.metric(sid, {
                ev: "consolidation_completed",
                ts: Date.now(),
                sessionId: sid,
                epoch: current.epoch,
                invalidated: cout.invalidations.length,
              })
            })
          } else if (!cout.ok) {
            await deps.metric(sid, {
              ev: "consolidation_failed",
              ts: Date.now(),
              sessionId: sid,
              epoch: st2.epoch,
              detail: cout.reason ?? "unknown",
            })
          } else {
            await deps.metric(sid, {
              ev: "consolidation_completed",
              ts: Date.now(),
              sessionId: sid,
              epoch: st2.epoch,
              invalidated: 0,
            })
          }
        }
      }
    } catch (e) {
      const s2 = await deps.getState(sid).catch(() => null)
      await deps
        .metric(sid, { ev: "extraction_failed", ts: Date.now(), sessionId: sid, epoch: s2?.epoch, detail: String(e) })
        .catch(() => {})
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
   * The idle-hook entry point. v2: no scheduling gate — every completed turn
   * extracts (the scheduler's inflight coalescing bounds concurrency; the
   * delta cap bounds size). Extraction is background enrichment: its outcome
   * can only improve a frozen render, never block a swap.
   */
  async function onIdle(sid: string): Promise<void> {
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
    if (s.timer) {
      clearTimeout(s.timer)
      s.timer = null
    }
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

/**
 * Refresh-in-lock: re-renders the active frozen record in place with the
 * current ledger (same cutoff, same epoch — the mechanical parts rerender
 * byte-identically; only the ledger sections can change). Must be called
 * INSIDE the session's withSessionLock; uses the lock-free store variants.
 * Returns whether the render actually changed plus the active record count.
 */
async function refreshInLock(
  deps: Pick<SchedulerDeps, "store" | "getConfig" | "getMessages" | "getState" | "setState" | "metric">,
  sid: string,
  cfg: RolloverConfig,
): Promise<{ changed: boolean; activeCount: number }> {
  // Inside the session lock all reads must be raw: deps.getState enqueues a
  // second lock acquisition and would deadlock.
  const readState = deps.store.readStateRaw?.bind(deps.store) ?? deps.getState
  const st = await readState(sid)
  if (!st?.rollover) return { changed: false, activeCount: 0 }
  const rec = st.rollover
  const msgs = deps.getMessages(sid)
  if (!msgs || msgs.length === 0) return { changed: false, activeCount: 0 }
  if (!msgs.some((m) => m.id === rec.cutoffMessageId)) return { changed: false, activeCount: 0 }
  const lines = deps.store.readLedgerRaw ? await deps.store.readLedgerRaw(sid) : await deps.store.readLedger(sid)
  const activeCount = activeRecords(lines).length
  let tailLastReply: string | null = null
  for (let i = rec.tailMessageIds.length - 1; i >= 0; i--) {
    const m = msgs.find((x) => x.id === rec.tailMessageIds[i])
    if (m && m.role === "assistant") {
      tailLastReply = m.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text ?? "")
        .join("\n")
      break
    }
  }
  const rendered = projectRollover({
    msgs,
    cutoffId: rec.cutoffMessageId,
    epoch: rec.epochAtSwap,
    cfg,
    lines,
    touchedFiles: st.touchedFiles,
    tailLastReply,
  })
  if (rendered.renderText === rec.renderText) return { changed: false, activeCount }
  const current = await readState(sid)
  if (
    !current?.rollover ||
    current.rollover.epochAtSwap !== rec.epochAtSwap ||
    current.rollover.cutoffMessageId !== rec.cutoffMessageId
  )
    return { changed: false, activeCount }
  const tailTexts = rec.tailMessageIds
    .map((id) => msgs.find((m) => m.id === id))
    .filter((m): m is NMessage => !!m)
    .map((m) =>
      m.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text ?? "")
        .join("\n"),
    )
    .join("\n")
  const cutoffMsg = msgs.find((m) => m.id === rec.cutoffMessageId)
  const cutoffText = cutoffMsg
    ? cutoffMsg.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text ?? "")
        .join("\n")
    : ""
  const tokensAfter = estimateTokens(rendered.renderText) + estimateTokens(tailTexts) + estimateTokens(cutoffText)
  const committed: SessionState = {
    ...current,
    rollover: {
      ...rec,
      renderText: rendered.renderText,
      renderTruncated: rendered.truncated,
      tokensAfter,
    },
    ...(current.lastRollover ? { lastRollover: { ...current.lastRollover, after: tokensAfter } } : {}),
  }
  if (deps.store.writeStateRaw) await deps.store.writeStateRaw(sid, committed)
  else await deps.setState(sid, committed)
  return { changed: true, activeCount }
}
