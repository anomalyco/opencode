/**
 * Alert engine — Effect service that subscribes to the bus, evaluates
 * rules, records fired events, and fans them out to webhook channels.
 *
 * Per `packages/opencode/AGENTS.md`:
 *   - Bus subscription is `forkScoped` so it dies with the Instance.
 *   - No fibers / started flag — `InstanceState`'s ScopedCache gives us
 *     run-once semantics per Instance directory.
 *
 * The engine owns:
 *
 *   1. A per-Instance in-memory rule cache + cooldown map.
 *   2. A 60s inactivity sweep on top of the live event stream.
 *   3. Token totals per session, fed by `message.updated` events.
 *   4. Fan-out: every fired event is delivered to every enabled channel
 *      whose `enabled = true`. Channel delivery is detached — see
 *      `./webhook.ts`.
 *
 * The engine does not itself mutate user-visible state in any way that
 * can't be re-derived; on restart it rebuilds the rule cache from
 * `monitor_alert_rule` and re-subscribes to the bus.
 */

/**
 * Effect Service: monitor engine.
 *
 * Long-lived bus subscription that drives rule evaluation + fan-out.
 * Per the pattern in `packages/opencode/AGENTS.md`, the engine holds its
 * mutable state in a `WeakMap<object, EngineState>` keyed by the
 * directory object — opencode's `Instance` system exposes exactly one
 * singleton directory per scope, so this gives us per-Instance state
 * without leaking across directories.
 *
 * Lifecycle: `init()` runs once per Instance. The bus subscription is
 * unsubscribed when the Instance is disposed via `Effect.addFinalizer`.
 */

import { Context, Effect, Layer } from "effect"
import { Bus } from "@/bus"
import { Database, sql, desc } from "@/storage"
import { InstanceState } from "@/effect"
import { Log } from "@/util"
import { AlertRuleTable, AlertChannelTable } from "./monitor.sql"
import {
  AlertRule as AlertRuleSchema,
  type AlertRule,
  evaluate,
  cooldownKey,
  inCooldown,
  type RuleEvent,
  type TokenTotals,
} from "./alerts"
import { recordEvent } from "./repo"
import { getProvider, delivery } from "./webhook"

const log = Log.create({ service: "monitor.engine" })

const SWEEP_INTERVAL_MS = 60_000

interface EngineState {
  rules: Map<string, AlertRule>
  cooldowns: Map<string, number>
  sessionLastEventAt: Map<string, number>
  sessionLastStatus: Map<string, string>
  sessionTokens: Map<string, TokenTotals>
  sweptAt: number
  /** 60s-rolling counters that get flushed to `monitor_metric`. */
  metrics: MetricCounters
}

interface MetricCounters {
  tool_calls: Map<string, number>
  assistant_messages: number
  error_messages: number
  cache_read_tokens: number
  cache_write_tokens: number
  input_tokens: number
  output_tokens: number
  windowStart: number
}

function freshCounters(): MetricCounters {
  return {
    tool_calls: new Map(),
    assistant_messages: 0,
    error_messages: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    input_tokens: 0,
    output_tokens: 0,
    windowStart: Date.now(),
  }
}

/**
 * Per-Instance state, keyed by an opaque singleton per directory. The
 * key object is created lazily the first time `init()` is invoked.
 */
let nextKey = 0
const states = new Map<number, EngineState>()

export interface Interface {
  readonly init: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MonitorEngine") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const slot = yield* InstanceState.make<true, never, never>(
      Effect.fn("MonitorEngine.state")(function* () {
        const state: EngineState = {
          rules: new Map(),
          cooldowns: new Map(),
          sessionLastEventAt: new Map(),
          sessionLastStatus: new Map(),
          sessionTokens: new Map(),
          sweptAt: 0,
          metrics: freshCounters(),
        }
        const key = nextKey++
        states.set(key, state)
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            states.delete(key)
          }),
        )
        refreshRules(state)
        yield* forkEvaluator(state)
        yield* forkSweeper(state)
        return true as const
      }),
    )

    return Service.of({
      init: Effect.fn("MonitorEngine.init")(function* () {
        yield* InstanceState.get(slot)
      }),
    })
  }),
)

/** Convenience namespace projection. */
export const defaultLayer = layer
export * as MonitorEngine from "./engine"

/** Reload rules from the DB into the in-memory map. */
function refreshRules(s: EngineState) {
  const rows = Database.use((db) =>
    db.select().from(AlertRuleTable).orderBy(desc(AlertRuleTable.time_created)).all() as AlertRule[],
  )
  s.rules.clear()
  for (const row of rows) {
    const parsed = AlertRuleSchema.safeParse(row)
    if (parsed.success) s.rules.set(parsed.data.id, parsed.data)
    else log.warn("invalid rule row", { id: row.id })
  }
  log.info("rules refreshed", { count: s.rules.size })
}

/** Load enabled channels once for delivery fan-out. */
function loadEnabledChannels(): Array<{
  id: string
  type: string
  url: string | null
  credentials: Record<string, string>
  secret: string | null
}> {
  return Database.use((db) =>
    db
      .select()
      .from(AlertChannelTable)
      .all()
      .filter((c) => c.enabled)
      .map((c) => ({
        id: c.id,
        type: c.type,
        url: c.url,
        credentials: (c.credentials ?? {}) as Record<string, string>,
        secret: c.secret,
      })),
  )
}

/** Fork the bus subscription onto a scoped fiber that lives for the Instance. */
function forkEvaluator(s: EngineState) {
  return Effect.forkScoped(
    Effect.gen(function* () {
      const unsub = Bus.subscribeAll((evt) => {
        try {
          handleEvent(s, evt).catch((err) => log.error("event handler failed", { err: String(err) }))
        } catch (err) {
          log.error("event handler threw", { err: String(err) })
        }
      })
      yield* Effect.addFinalizer(() => Effect.sync(unsub))
    }),
  )
}

/** Periodic 60s sweep — fires inactivity + stuck-agent rules. */
function forkSweeper(s: EngineState) {
  return Effect.forkScoped(
    Effect.gen(function* () {
      while (true) {
        yield* Effect.sleep(SWEEP_INTERVAL_MS)
        yield* Effect.tryPromise({
          try: () => sweep(s),
          catch: (err) => log.error("sweep failed", { err: String(err) }),
        }).pipe(Effect.ignore)
      }
    }),
  )
}

async function handleEvent(s: EngineState, raw: any): Promise<void> {
  const type = String(raw?.type ?? "")
  const properties = raw?.properties ?? {}
  const at = Date.now()
  const sessionId = stringOrNull(properties?.sessionID ?? properties?.session_id ?? null)
  const evt: RuleEvent = { type, payload: properties, at }
  if (sessionId) {
    s.sessionLastEventAt.set(sessionId, at)
    if (properties?.status) s.sessionLastStatus.set(sessionId, String(properties.status))
  }
  // Metric counters — sampled for the current 60s window. The sweep
  // writes the row to `monitor_metric` and resets them.
  if (type === "tool" || (type === "message.part.updated" && properties?.part?.type === "tool")) {
    const tool = String(properties?.part?.tool ?? properties?.tool ?? "unknown")
    s.metrics.tool_calls.set(tool, (s.metrics.tool_calls.get(tool) ?? 0) + 1)
  }
  if (type === "message.updated" && sessionId) {
    const info = properties?.info
    if (info && typeof info === "object") {
      const role = (info as { role?: string }).role
      if (role === "assistant") {
        s.metrics.assistant_messages++
        if ((info as { error?: unknown }).error) s.metrics.error_messages++
      }
      const tokens = info.tokens as
        | { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
        | undefined
      if (tokens) {
        s.sessionTokens.set(sessionId, {
          input: Number(tokens.input ?? 0),
          output: Number(tokens.output ?? 0),
          "cache.read": Number(tokens.cache?.read ?? 0),
          "cache.write": Number(tokens.cache?.write ?? 0),
          total:
            Number(tokens.input ?? 0) +
            Number(tokens.output ?? 0) +
            Number(tokens.cache?.read ?? 0) +
            Number(tokens.cache?.write ?? 0),
        })
        s.metrics.input_tokens += Number(tokens.input ?? 0)
        s.metrics.output_tokens += Number(tokens.output ?? 0)
        s.metrics.cache_read_tokens += Number(tokens.cache?.read ?? 0)
        s.metrics.cache_write_tokens += Number(tokens.cache?.write ?? 0)
      }
    }
  }
  // Event-driven rules.
  await evaluateAndFire(s, evt, sessionId)
}

async function sweep(s: EngineState): Promise<void> {
  const now = Date.now()
  s.sweptAt = now
  await flushMetrics(s, now)
  for (const [, rule] of s.rules) {
    if (!rule.enabled) continue
    if (rule.type === "inactivity" || rule.type === "stuck-agent") {
      for (const [sessionId, lastAt] of s.sessionLastEventAt) {
        const status = s.sessionLastStatus.get(sessionId) ?? ""
        const tokens = s.sessionTokens.get(sessionId)
        const evt: RuleEvent = {
          type: rule.type === "stuck-agent" ? "session.status" : "session.idle",
          payload: { sessionID: sessionId, status },
          at: lastAt,
        }
        const payload = evaluate(rule, { now, event: evt, tokens })
        if (payload) await fire(s, rule, sessionId, payload)
      }
    }
  }
}

/**
 * Flush the 60s window of metric counters to `monitor_metric`, then reset.
 * The bucket is keyed by minute (`@60s`) so the analytics layer can
 * later build hour / day rollups via SQL group-by.
 */
async function flushMetrics(s: EngineState, now: number): Promise<void> {
  const windowEnd = now
  const windowStart = s.metrics.windowStart
  if (windowStart === windowEnd) return
  const bucket = "@60s"
  const row = (kind: string, value: number, dimensions: Record<string, unknown> = {}) => ({
    id: `met-${kind}-${windowStart}-${Math.random().toString(36).slice(2, 8)}`,
    project_id: "default",
    session_id: null,
    kind,
    value,
    dimensions: JSON.stringify(dimensions),
    bucket,
    bucket_start: windowStart,
    time_created: now,
    time_updated: now,
  })
  const rows: Array<ReturnType<typeof row>> = [
    row("assistant_messages", s.metrics.assistant_messages),
    row("error_messages", s.metrics.error_messages),
    row("cache_read_tokens", s.metrics.cache_read_tokens),
    row("cache_write_tokens", s.metrics.cache_write_tokens),
    row("input_tokens", s.metrics.input_tokens),
    row("output_tokens", s.metrics.output_tokens),
  ]
  for (const [tool, count] of s.metrics.tool_calls) {
    rows.push(row("tool_calls", count, { tool }))
  }
  try {
    Database.use((db) => {
      for (const r of rows) {
        db.run(
          sql`INSERT INTO monitor_metric (id, project_id, session_id, kind, value, dimensions, bucket, bucket_start, time_created, time_updated)
              VALUES (${r.id}, ${r.project_id}, ${r.session_id}, ${r.kind}, ${r.value}, ${r.dimensions}, ${r.bucket}, ${r.bucket_start}, ${r.time_created}, ${r.time_updated})`,
        )
      }
    })
  } catch (err) {
    log.warn("metric flush failed", { err: String(err) })
  }
  s.metrics = freshCounters()
  void windowEnd
}

async function evaluateAndFire(s: EngineState, evt: RuleEvent, sessionId: string | null): Promise<void> {
  const now = Date.now()
  for (const [, rule] of s.rules) {
    if (!rule.enabled) continue
    if (rule.type !== "event-pattern") continue
    const payload = evaluate(rule, {
      now,
      event: evt,
      tokens: sessionId ? s.sessionTokens.get(sessionId) : undefined,
      sessionEventCount: (ruleId, sinceMs) => sessionEventCount(s, ruleId, sinceMs),
    })
    if (payload) await fire(s, rule, sessionId, payload)
  }
}

function sessionEventCount(s: EngineState, _ruleId: string, sinceMs: number): number {
  let n = 0
  for (const t of s.sessionLastEventAt.values()) if (t >= sinceMs) n++
  return n
}

async function fire(
  s: EngineState,
  rule: AlertRule,
  sessionId: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  const now = Date.now()
  const key = cooldownKey(rule.id, sessionId)
  const lastFire = s.cooldowns.get(key) ?? 0
  if (inCooldown(lastFire, now, rule.cooldown_sec)) return
  s.cooldowns.set(key, now)
  try {
    const id = recordEventSync({ rule_id: rule.id, session_id: sessionId, payload })
    log.info("alert fired", { rule: rule.name, session: sessionId, event: id })
    void fanOut(rule, id, payload)
  } catch (err) {
    log.error("failed to record / fan out alert", { err: String(err) })
  }
}

/**
 * Synchronous insert into `monitor_alert_event` using the underlying
 * bun:sqlite client. We bypass Drizzle's typed builder here because the
 * engine runs detached from any Effect scope and needs to stay
 * non-blocking — pulling `Effect.runSync` in the bus subscriber would
 * stall every other subscriber on this channel.
 */
function recordEventSync(input: {
  rule_id: string
  session_id: string | null
  payload: Record<string, unknown>
}): string {
  const id = `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const now = Date.now()
  Database.use((db) =>
    db.run(
      sql`INSERT INTO monitor_alert_event (id, rule_id, session_id, payload, status, time_created, time_updated, acked_at)
          VALUES (${id}, ${input.rule_id}, ${input.session_id}, ${JSON.stringify(input.payload)}, 'fired', ${now}, ${now}, NULL)`,
    ),
  )
  return id
}

async function fanOut(rule: AlertRule, eventId: string, payload: Record<string, unknown>): Promise<void> {
  const channels = loadEnabledChannels()
  const envelope = {
    id: eventId,
    rule: { id: rule.id, name: rule.name },
    fired_at: Date.now(),
    project_id: rule.project_id,
    session_id: (payload["session_id"] as string | null) ?? null,
    payload,
  }
  await Promise.allSettled(
    channels.map(async (ch) => {
      try {
        const provider = getProvider(ch.type as Parameters<typeof getProvider>[0])
        const url = provider.resolveURL({ credentials: ch.credentials, explicitURL: ch.url ?? undefined })
        if (!url) return
        const formatted = provider.format(envelope)
        const result = await delivery({
          url,
          body: formatted.body,
          headers: formatted.headers,
          hmacSecret: ch.secret ?? undefined,
        })
        if (!result.ok) log.warn("delivery failed", { channel: ch.id, error: result.error })
      } catch (err) {
        log.warn("fan-out error", { channel: ch.id, err: String(err) })
      }
    }),
  )
}

function stringOrNull(v: unknown): string | null {
  if (typeof v === "string") return v
  return null
}
