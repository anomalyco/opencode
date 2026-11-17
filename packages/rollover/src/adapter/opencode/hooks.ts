/** OpenCode adapter: transform + idle + usage + file tracking glue. */
import path from "node:path"
import os from "node:os"
import { Effect, Option } from "effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { NMessage, RolloverConfig, SessionState } from "../../core/types"
import type { StorePort } from "../../core/ports"
import { normalizeMessages } from "./normalize"
import { applyPlan } from "./applyPlan"
import { decideSwap } from "../../core/swapDecision"
import { freezeRollover, buildViewPlan, hasOpenTools } from "../../core/view"
import { effectiveThreshold } from "../../core/threshold"
import { estimateTokens, estimateMessageTokens } from "../../core/tokens"
import { loadConfig, withSessionSettings } from "../../core/config"
import { metricEvent } from "../../core/metrics"
import { rolloverToast } from "../../core/messages"
import { createScheduler, isCaughtUp } from "./scheduler"
import { createLlm } from "./llm"
import { createStore } from "./store"

export interface HookDeps {
  store: StorePort & { withSessionLock: <T>(sid: string, fn: () => Promise<T>) => Promise<T> }
  dataDir: string
  homeConfigDir: string
  projectDir: string
  env: Record<string, string | undefined>
  modelLimits: Map<string, number>
  extractionInflight: Map<string, Promise<void>>
  lastMessages: Map<string, NMessage[]>
  scheduler: ReturnType<typeof createScheduler>
  log: (m: string) => void
}

export function defaultSessionState(sid: string): SessionState {
  return {
    v: 1,
    sessionId: sid,
    settings: {},
    epoch: 0,
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

const bootstraps = new Map<string, Promise<SessionState>>()

/** Create the spec-default state only when the session has none yet. */
export async function ensureState(
  store: Pick<StorePort, "readState" | "writeState">,
  sid: string,
): Promise<SessionState> {
  const existing = await store.readState(sid)
  if (existing) return existing
  const pending = bootstraps.get(sid)
  if (pending) return pending

  const started = (async () => {
    // Another process may have written it between our first read and now.
    const again = await store.readState(sid)
    if (again) return again
    const created = defaultSessionState(sid)
    await store.writeState(sid, created)
    return created
  })()
  const tracked = started.finally(() => {
    bootstraps.delete(sid)
  })
  bootstraps.set(sid, tracked)
  return tracked
}

export function shouldIgnore(sid: string, mode: RolloverConfig["mode"]): boolean {
  // mode off handled by caller; parentID check is in plugin-entry via session info (not available here).
  return mode === "off"
}

export function getConfig(deps: HookDeps, sid: string): RolloverConfig {
  return loadConfig({ homeConfigDir: deps.homeConfigDir, projectDir: deps.projectDir, env: deps.env })
}

export async function readState(deps: HookDeps, sid: string): Promise<SessionState | null> {
  return deps.store.readState(sid)
}

export async function writeState(deps: HookDeps, sid: string, s: SessionState): Promise<void> {
  return deps.store.writeState(sid, s)
}

export async function handleUsage(deps: HookDeps, ev: unknown): Promise<void> {
  const e = ev as {
    type?: string
    data?: {
      sessionID?: string
      tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
      cost?: number
    }
  }
  const sid = e?.data?.sessionID
  if (!sid) return
  const tokens = e?.data?.tokens
  if (!tokens) return
  // Rollover that is off for this session tracks nothing: no context counter,
  // no state materialization (2026-11-17 bugfix — background steps like title
  // generation used to grow the "Current context" of chats where rollover was
  // never activated).
  try {
    const st = await deps.store.readState(sid)
    const cfg = withSessionSettings(
      loadConfig({ homeConfigDir: deps.homeConfigDir, projectDir: deps.projectDir, env: deps.env }),
      st,
    )
    if (cfg.mode === "off") return
    const current = st ?? (await ensureState(deps.store, sid))
    await deps.store.writeState(sid, {
      ...current,
      lastContextTokens: tokens.input + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0),
      lastContextSource: "usage",
      lastContextAt: Date.now(),
    })
  } catch (error) {
    // Fail-open (spec §1.3): a usage-tracking write must never disturb the
    // harness event stream; the next usage event simply retries.
    deps.log(`[rollover] usage tracking write failed: ${String(error)}`)
  }
}

export async function trackTouchedFile(deps: HookDeps, ev: unknown): Promise<void> {
  const e = ev as { tool?: string; sessionID?: string; input?: unknown }
  const tool = e?.tool
  if (tool !== "edit" && tool !== "write" && tool !== "patch") return
  const sid = e?.sessionID
  if (!sid) return
  const input = e?.input as { path?: string } | undefined
  const rawPath = input?.path
  if (!rawPath) return
  try {
    // Rollover that is off for this session tracks nothing: no touched-file
    // bookkeeping, no state materialization (2026-11-17 bugfix).
    const st = await deps.store.readState(sid)
    if (!st) return
    const cfg = withSessionSettings(loadConfig({ homeConfigDir: deps.homeConfigDir, projectDir: deps.projectDir, env: deps.env }), st)
    if (cfg.mode === "off") return
    const rel = rawPath.startsWith(deps.projectDir) ? rawPath.slice(deps.projectDir.length + 1) : rawPath
    const turn = Object.values(st.touchedFiles).reduce((a, v) => Math.max(a, v.turn), 0) + 1
    await deps.store.writeState(sid, {
      ...st,
      touchedFiles: { ...st.touchedFiles, [rel]: { epoch: st.epoch, turn } },
    })
  } catch (error) {
    // Fail-open (spec §1.3): touched-file bookkeeping must never disturb the
    // tool flow; losing one touched-file note is acceptable.
    deps.log(`[rollover] touched-file tracking failed: ${String(error)}`)
  }
}

export interface ContextInfo {
  tokens: number
  source: "usage" | "estimate"
}

export function contextInfoFor(st: SessionState, msgs: NMessage[]): ContextInfo {
  if (st.lastContextSource === "usage" && st.lastContextTokens > 0) {
    return { tokens: st.lastContextTokens, source: "usage" }
  }
  return {
    tokens: msgs.reduce((a, m) => a + estimateMessageTokens(m), 0),
    source: "estimate",
  }
}

export async function runTransform(deps: HookDeps, event: { messages: unknown[]; sessionID?: string }): Promise<void> {
  const raw = event.messages as unknown[]
  if (!raw || raw.length === 0) return
  const sid = (event.sessionID as string) ?? (raw[0] as { id?: string })?.id ?? ""
  // sid from messages if missing
  const sidResolved = sid || (raw[0] as any)?.sessionID || (raw[0] as any)?.info?.sessionID
  if (!sidResolved) return
  const t0 = Date.now()
  try {
    // Per-session opt-in (2026-11-17): the session's `enabled` toggle
    // (/rollover on|off) wins over every config layer; a session that never
    // toggled falls back to them — and the built-in default is now off.
    // Fresh sessions are only materialized when active.
    const st0 = await deps.store.readState(sidResolved)
    const cfg = withSessionSettings(getConfig(deps, sidResolved), st0)
    const msgs = normalizeMessages(raw)
    deps.lastMessages.set(sidResolved, msgs)

    if (cfg.mode === "auto") {
      const st = st0 ?? (await ensureState(deps.store, sidResolved))

      const extractionCaughtUp = isCaughtUp(st, msgs)
      const toolsOpen = hasOpenTools(msgs)
      const context = contextInfoFor(st, msgs)

      const threshold = effectiveThreshold({ cfg, sessionOverride: st.settings.thresholdTokens, modelLimit: deps.modelLimits.get(sidResolved) })

      const d = decideSwap({
        msgs,
        st,
        thresholdValue: threshold.value,
        extractionCaughtUp,
        toolsOpen,
        contextTokens: context.tokens,
      })

      if (d.action === "swap") {
        await executeSwap(deps, sidResolved, msgs, st, cfg, context, d.userMessageId, t0)
      } else if (d.action === "none" && d.markDecided) {
        const updated: SessionState = {
          ...st,
          decidedUserMessageIds: [...st.decidedUserMessageIds, d.userMessageId].slice(-50),
        }
        await deps.store.writeState(sidResolved, updated)
      } else if (d.action === "defer") {
        await deps.store.appendMetric(sidResolved, metricEvent("swap_deferred", sidResolved, st.epoch, { reason: d.reason }))
      }
    }

    // The view projection runs in every mode: once a rollover exists, the
    // compacted view must keep being applied — dropping it would silently
    // revert the session's context to the full history.
    const finalState = (await deps.store.readState(sidResolved)) ?? st0
    if (finalState?.rollover) {
      const plan = buildViewPlan(msgs, finalState.rollover)
      if (!plan) {
        await deps.store.writeState(sidResolved, { ...finalState, rollover: null })
        await deps.store.appendMetric(sidResolved, metricEvent("cutoff_missing", sidResolved, finalState.epoch, {
          nmsgs: msgs.length,
          cutoff: finalState.rollover.cutoffMessageId,
          hasRC: msgs.some((m) => m.parts.some((p) => p.type === "text" && (p.text ?? "").trimStart().startsWith("<rollover_context"))),
        }))
        return
      }
      const next = applyPlan(raw, plan, { sessionID: sidResolved }) as unknown[]
      // single splice
      raw.splice(0, raw.length, ...next)
    }
  } catch (e) {
    const st = await deps.store.readState(sidResolved).catch(() => null)
    await deps.store.appendMetric(sidResolved, metricEvent("rollover_error", sidResolved, st?.epoch, { detail: String(e) })).catch(() => {})
    // leave messages untouched
  }
}

/**
 * Freezes the rollover for `userMessageId` and writes the new epoch's state.
 * Shared by the context hook and the /rollover command's immediate path.
 */
export async function executeSwap(
  deps: HookDeps,
  sid: string,
  msgs: NMessage[],
  st: SessionState,
  cfg: RolloverConfig,
  context: ContextInfo,
  userMessageId: string,
  t0: number,
): Promise<SessionState> {
  const lines = await deps.store.readLedger(sid)
  const decisionState = { ...st, lastContextTokens: context.tokens, lastContextSource: context.source }
  const rec = freezeRollover({ msgs, st: decisionState, cfg, lines, userMessageId })
  const newEpoch = st.epoch + 1
  const renderTokens = estimateTokens(rec.renderText)
  const tailTokens = estimateTokens(
    msgs
      .filter((m) => rec.tailMessageIds.includes(m.id))
      .map((m) => m.parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n"))
      .join("\n"),
  )
  const updated: SessionState = {
    ...st,
    rollover: rec,
    epoch: newEpoch,
    lastRollover: { at: Date.now(), before: rec.tokensBefore, after: rec.tokensAfter, epoch: newEpoch, renderTokens, tailTokens },
    decidedUserMessageIds: [...st.decidedUserMessageIds, userMessageId].slice(-50),
    lastContextTokens: rec.tokensAfter,
    lastContextSource: context.source,
  }
  await deps.store.writeState(sid, updated)
  await deps.store.appendMetric(
    sid,
    metricEvent("swap", sid, newEpoch, {
      tokensBefore: rec.tokensBefore,
      tokensAfter: rec.tokensAfter,
      renderTokens,
      tailTokens,
      swapMs: Date.now() - t0,
      contextSource: context.source,
    }),
  )
  return updated
}

/**
 * The /rollover command's immediate path: when the current context already
 * exceeds the effective threshold, run extraction to catch up and swap at
 * once instead of waiting for the next turn. Reports the outcome through
 * `notify`; returns the note appended to the command's own reply ("" when the
 * automatic path still owns the timing).
 */
export async function runImmediateSwap(
  deps: HookDeps,
  sid: string,
  notify: (text: string) => Promise<void>,
): Promise<string> {
  const st = await deps.store.readState(sid)
  const cfg = withSessionSettings(getConfig(deps, sid), st)
  if (cfg.mode !== "auto") return ""
  if (!st) return ""
  const msgs = deps.lastMessages.get(sid)
  if (!msgs || msgs.length === 0) return ""
  const context = contextInfoFor(st, msgs)
  const threshold = effectiveThreshold({ cfg, sessionOverride: st.settings.thresholdTokens, modelLimit: deps.modelLimits.get(sid) })
  if (context.tokens < threshold.value) return ""

  // Fire and forget: the command replies at once; the outcome arrives on its
  // own toast. notify failures must not crash the pipeline.
  void (async () => {
    try {
      await deps.scheduler.runNow(sid)
      const st2 = await deps.store.readState(sid)
      const msgs2 = deps.lastMessages.get(sid) ?? msgs
      if (!st2) return
      const d = decideSwap({
        msgs: msgs2,
        st: st2,
        thresholdValue: threshold.value,
        extractionCaughtUp: isCaughtUp(st2, msgs2),
        toolsOpen: hasOpenTools(msgs2),
        contextTokens: context.tokens,
        anchor: "lastUser",
      })
      if (d.action !== "swap") {
        await notify(`Rollover did not complete: ${d.action === "defer" ? d.reason : "conditions not met"}. The automatic mechanism will retry on later turns.`)
        return
      }
      const updated = await executeSwap(deps, sid, msgs2, st2, cfg, context, d.userMessageId, Date.now())
      await notify(
        rolloverToast({
          tokensBefore: updated.lastRollover?.before ?? context.tokens,
          tokensAfter: updated.lastRollover?.after ?? 0,
          renderTokens: updated.lastRollover?.renderTokens ?? 0,
          tailTokens: updated.lastRollover?.tailTokens ?? 0,
        }) + " It will take effect on your next message.",
      )
    } catch (error) {
      await notify(`Rollover error: ${error instanceof Error ? error.message : String(error)}`).catch(() => {})
    }
  })()
  return " Threshold exceeded — rollover is running now; I'll notify you when it finishes."
}

export function createHookDeps(ctx: Context): HookDeps {
  const projectDir = ctx.location.directory
  const homeConfigDir = path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "opencode")
  const dataDir = path.join(projectDir, ".opencode", "rollover")
  const env = process.env as Record<string, string | undefined>
  const store = createStore({ dataDir })
  const modelLimits = new Map<string, number>()
  const lastMessages = new Map<string, NMessage[]>()
  const extractionInflight = new Map<string, Promise<void>>()
  const scheduler = createScheduler({
    store,
    getConfig: async (sid) => {
      const cfg = loadConfig({ homeConfigDir, projectDir, env })
      // Session-aware mode: the per-session `/rollover on|off` toggle wins
      // over the config layers (fresh sessions fall back to them — off).
      const st = await store.readState(sid).catch(() => null)
      return withSessionSettings(cfg, st)
    },
    getMessages: (sid) => lastMessages.get(sid),
    getState: (sid) => store.readState(sid),
    setState: (sid, s) => store.writeState(sid, s),
    getSmallModel: () => null,
    // Extraction's model fallback: the session's own model, which is known to
    // resolve and be authorized (the user is chatting with it). Without this
    // the generate call goes model-less and the server's default model may
    // fail (e.g. an OpenRouter model whose max output exceeds the credits).
    getSessionModel: (sid) =>
      Effect.runPromise(
        // SAFETY: scheduler sids come from session events and state files, always canonical `ses_…` ids.
        Effect.option(ctx.session.get({ sessionID: sid as Parameters<typeof ctx.session.get>[0]["sessionID"] })),
      )
        .then((option) =>
          Option.isSome(option) && option.value.model
            ? { providerID: option.value.model.providerID, id: option.value.model.id }
            : null,
        )
        .catch(() => null),
    createLlm: (sid) =>
      createLlm({
        host: ctx as unknown as Parameters<typeof createLlm>[0]["host"],
        resolveModel: () => null,
        onCall: (info) => {
          // The llm_call metric: one event per LLM attempt, usage reported as
          // unavailable (null) because the generate host exposes none. A
          // metric write failure must never break the extraction.
          void store.appendMetric(sid, metricEvent("llm_call", sid, undefined, { ...info })).catch(() => {})
        },
      }),
    metric: (sid, ev) => store.appendMetric(sid, ev),
    debounceMs: 300,
  })
  return {
    store,
    dataDir,
    homeConfigDir,
    projectDir,
    env,
    modelLimits,
    extractionInflight,
    lastMessages,
    scheduler,
    log: (m: string) => console.error(`[rollover] ${m}`),
  }
}
