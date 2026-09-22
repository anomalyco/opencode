import z from "zod"
import { Log } from "../util/log"
import { Auth } from "../auth"
import { Config } from "../config/config"

export namespace Jev {
  const log = Log.create({ service: "session.jev" })

  // ---------------------------------------------------------------------------
  // Wire protocol (TypeSafe "System One")
  //
  // One call may carry multiple questions (speculative fan-out — extra questions
  // are ~free). `state` is the ONLY input the model sees: no tools, no transcript
  // access. Answers carry a calibrated `confidence` (P(answer correct)) and, for
  // choice/score questions, a `probabilities` distribution. Both may be absent
  // and are treated as 0.
  // ---------------------------------------------------------------------------

  export type Question =
    | { type: "choice"; instructions: string; criteria: Record<string, string> }
    | { type: "score"; instructions: string; criteria: string[] }
    | { type: "noul"; instructions: string }

  export type Questions = Record<string, Question>

  export type Answer = {
    type: "choice" | "score" | "noul"
    choice?: string
    score?: number
    noul?: number
    probabilities?: Record<string, number>
    confidence?: number
  }

  export type Answers = Record<string, Answer>

  // ---------------------------------------------------------------------------
  // Tiers
  //
  // `capability` is a free-text eligibility test handed to Jev as the criteria
  // entry for this tier — THAT is how the router learns the pool. Write it as a
  // capability spec, never a model name. Order is cheapest -> most capable and
  // is load-bearing: the last tier is the fail-open default.
  // ---------------------------------------------------------------------------

  export interface ModelRef {
    providerID: string
    modelID: string
  }

  export interface Tier {
    id: string
    capability: string
    model: ModelRef
    /** Reporting only; the router never optimizes cost directly. */
    costHintUsdPerMTokOut?: number
    availability?: Availability
  }

  export interface Window {
    /** Local hour the window opens, 0-23. May be > endHour (wraps midnight). */
    startHour: number
    /** Local hour the window closes, 0-23. */
    endHour: number
    /** Offset from UTC in minutes. */
    utcOffsetMinutes: number
  }

  export interface Quota {
    used: number
    limit: number
  }

  export interface Availability {
    /** Tier is only eligible inside this local-time window. */
    window?: Window
    /** Requests above this context size are ineligible. */
    maxContextTokens?: number
    /** Budget for the current period. Omit for unmetered tiers. */
    quota?: Quota
    /** Rolling request cap. */
    rate?: Quota
  }

  export type TierCandidate = Tier

  export type ExclusionReason = "outside-window" | "context-too-large" | "quota-exhausted" | "rate-limited"

  export interface Excluded {
    id: string
    reason: ExclusionReason
  }

  export interface AvailabilityResult {
    available: TierCandidate[]
    excluded: Excluded[]
  }

  // ---------------------------------------------------------------------------
  // Layer 0 — deterministic availability filter. Runs BEFORE Jev. Costs $0.
  // Never ask a decision model a question arithmetic can answer: time windows,
  // context ceilings, quotas and rate caps are FACTS. The filter resolves most
  // turns; Jev only sees the genuinely ambiguous remainder.
  // ---------------------------------------------------------------------------

  export function localHour(now: Date, utcOffsetMinutes: number): number {
    const shifted = new Date(now.getTime() + utcOffsetMinutes * 60_000)
    return shifted.getUTCHours() + shifted.getUTCMinutes() / 60
  }

  export function isWithinWindow(win: Window, now: Date): boolean {
    const h = localHour(now, win.utcOffsetMinutes)
    // Wrapping window (e.g. 22:00 -> 08:00): open if at/after start OR before end.
    if (win.startHour > win.endHour) return h >= win.startHour || h < win.endHour
    return h >= win.startHour && h < win.endHour
  }

  export interface AvailabilityContext {
    now?: Date
    /** Estimated context size for this step, including history. */
    contextTokens?: number
  }

  export function filterAvailable(tiers: TierCandidate[], ctx: AvailabilityContext = {}): AvailabilityResult {
    const now = ctx.now ?? new Date()
    const available: TierCandidate[] = []
    const excluded: Excluded[] = []

    for (const t of tiers) {
      const a = t.availability
      let reason: ExclusionReason | undefined

      if (a?.window && !isWithinWindow(a.window, now)) reason = "outside-window"
      else if (a?.maxContextTokens !== undefined && ctx.contextTokens !== undefined && ctx.contextTokens > a.maxContextTokens)
        reason = "context-too-large"
      else if (a?.quota && a.quota.used >= a.quota.limit) reason = "quota-exhausted"
      else if (a?.rate && a.rate.used >= a.rate.limit) reason = "rate-limited"

      if (reason) excluded.push({ id: t.id, reason })
      else available.push(t)
    }

    return { available, excluded }
  }

  /**
   * The point of Layer 0: if this returns false, do NOT call Jev.
   * 0 available -> never guess. 1 available -> the decision was made by arithmetic.
   */
  export function needsRouting(result: AvailabilityResult): boolean {
    return result.available.length > 1
  }

  // ---------------------------------------------------------------------------
  // Routing policy
  //
  // Router errors are ASYMMETRIC: under-route (hard task -> cheap model) loses
  // trust; over-route loses only money. So the default is the MOST CAPABLE tier
  // and we route DOWN only when Jev is confident. Fail-open means fail EXPENSIVE.
  //
  // Thresholds are pool-specific (never global-defaulted in spirit): on a flat
  // pool a wrong down-route costs little (0.55-0.65 confidence harvests savings);
  // on a mixed pool a wrong down-route is a quality regression (0.85). All knobs
  // are exposed via config `jev.thresholds`.
  // ---------------------------------------------------------------------------

  export interface RoutingPolicy {
    /** Confidence required before we route DOWN to a cheaper tier. */
    minConfidenceToDegrade: number
    /** Complexity score (normalized 0..1; the raw wire score is a weighted level index) at or below which degrading is allowed. */
    maxComplexityForDegrade: number
    /** If we can't trust the complexity score, treat the task as hard. */
    minComplexityConfidence: number
    allowVerify: boolean
    /** Confidence required before we act on a "not adequate" verdict. */
    minConfidenceToEscalate: number
    maxEscalationsPerTurn: number
  }

  export const DEFAULT_POLICY: RoutingPolicy = {
    minConfidenceToDegrade: 0.85,
    maxComplexityForDegrade: 0.5,
    minComplexityConfidence: 0.5,
    allowVerify: true,
    minConfidenceToEscalate: 0.7,
    maxEscalationsPerTurn: 1,
  }

  export type RouteReason =
    | "layer-0" // decided by deterministic availability (single tier left)
    | "jev-confident" // routed down: Jev confident AND complexity low
    | "low-confidence" // Jev unsure -> stayed at default
    | "high-complexity" // Jev says it's hard -> stayed at default
    | "engine-unavailable" // no router at all -> stayed at default
    | "verification-failed" // post-hoc check rejected the cheap output

  export interface RouteDecision {
    tier: string
    reason: RouteReason
    intent?: string
    complexity?: number
    confidence?: number
  }

  // ---------------------------------------------------------------------------
  // Routing questions — two axes, THREE independent gates. The choice says
  // "who"; the score independently says "how hard". Requiring both to agree
  // (each with its own confidence gate) is what keeps Jev's error rate from
  // turning into a quality regression.
  // Complexity levels for the score question. The decision API answers with a
  // weighted level index over these — raw 0..n-1 (routing-spec v1.1: measured
  // 0..2 on the wire).
  const COMPLEXITY_CRITERIA = [
    "Mechanical: single location, known pattern, no design decision",
    "Moderate: several locations, or requires some judgment",
    "Hard: architectural, ambiguous, or getting it wrong is expensive",
  ]

  // Policy thresholds and the decision's `complexity` metadata speak 0..1;
  // normalize the raw level index before either.
  const normalizeComplexity = (raw: number): number => raw / (COMPLEXITY_CRITERIA.length - 1)

  export function routingQuestions(tiers: TierSpec[]): Questions {
    const criteria: Record<string, string> = {}
    for (const t of tiers) criteria[t.id] = t.capability

    return {
      tier: {
        type: "choice",
        instructions: "Which capability tier is sufficient to handle this request well?",
        criteria,
      },
      complexity: {
        type: "score",
        instructions: "How demanding is this request to carry out correctly?",
        criteria: COMPLEXITY_CRITERIA,
      },
    }
  }

  /** Minimal tier shape the question builder needs (id + capability text). */
  export interface TierSpec {
    id: string
    capability: string
  }

  export function decide(answers: Answers, tiers: TierSpec[], fallback: string, policy: RoutingPolicy): RouteDecision {
    const choice = answers.tier
    const complexity = answers.complexity

    if (!choice?.choice) return { tier: fallback, reason: "engine-unavailable" }

    const confidence = choice.confidence ?? 0
    // Unknown complexity defaults to HARD, not easy. Fail expensive. The wire
    // score is a raw weighted level index (0..n-1); gates and policy speak 0..1.
    // `== null` also catches an explicit JSON null, which would otherwise
    // normalize to 0 and read as trivially easy.
    const rawScore = complexity?.score
    const score = rawScore == null ? 1 : normalizeComplexity(rawScore)
    const complexityConfidence = complexity?.confidence ?? 0

    const meta = { intent: choice.choice, complexity: score, confidence }

    // Three independent gates. Any one failing sends the step to the fallback.
    if (confidence < policy.minConfidenceToDegrade) return { tier: fallback, reason: "low-confidence", ...meta }
    if (score > policy.maxComplexityForDegrade) return { tier: fallback, reason: "high-complexity", ...meta }
    if (complexityConfidence < policy.minComplexityConfidence)
      return { tier: fallback, reason: "low-confidence", ...meta }

    // Jev can only name tiers we actually offered; an unknown id stays on fallback.
    const chosen = tiers.find((t) => t.id === choice.choice)
    if (!chosen) return { tier: fallback, reason: "low-confidence", ...meta }
    return { tier: chosen.id, reason: "jev-confident", ...meta }
  }

  // ---------------------------------------------------------------------------
  // Engines
  //
  // An engine MUST return null instead of throwing. The chain walks engines in
  // priority order, first non-null answer wins, and `off` is the mandatory
  // terminal null-engine. That is what makes fail-open structural instead of a
  // try/catch convention.
  // ---------------------------------------------------------------------------

  export interface JevEngine {
    readonly id: string
    /** False when credentials or a runtime are missing. */
    isAvailable(): Promise<boolean>
    /** MUST return null rather than throw. */
    evaluate(state: string, questions: Questions, signal?: AbortSignal): Promise<Answers | null>
  }

  const ENDPOINT = "https://api.typesafe.ai/v1/systemone"
  const MODEL = "jev-latest"
  const DEFAULT_TIMEOUT_MS = 1_500
  /** Hard cap on the `state` payload — never send raw transcripts. */
  export const STATE_CLIP_CHARS = 24_000

  /** Minimal fetch surface the engine needs (tests inject mocks here). */
  export type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

  export function clipState(state: string): string {
    return state.length <= STATE_CLIP_CHARS ? state : state.slice(0, STATE_CLIP_CHARS)
  }

  export class TypesafeEngine implements JevEngine {
    readonly id = "typesafe"

    #key?: string
    #keyResolver?: () => Promise<string | undefined>
    #timeoutMs: number
    #fetch: FetchImpl

    constructor(input: {
      apiKey?: string
      keyResolver?: () => Promise<string | undefined>
      timeoutMs?: number
      fetchImpl?: FetchImpl
    } = {}) {
      this.#key = input.apiKey
      this.#keyResolver = input.keyResolver
      this.#timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
      this.#fetch = input.fetchImpl ?? globalThis.fetch
    }

    async isAvailable(): Promise<boolean> {
      return Boolean(await this.key())
    }

    async key(): Promise<string | undefined> {
      if (this.#key) return this.#key
      if (this.#keyResolver) this.#key = await this.#keyResolver()
      return this.#key
    }

    async evaluate(state: string, questions: Questions, signal?: AbortSignal): Promise<Answers | null> {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.#timeoutMs)
      // Attach the outer-abort bridge BEFORE any await, so an abort landing
      // mid-setup is still honored; re-check for the already-aborted case.
      const onOuterAbort = () => controller.abort()
      signal?.addEventListener("abort", onOuterAbort, { once: true })

      try {
        if (signal?.aborted) return null
        const apiKey = await this.key()
        if (!apiKey || controller.signal.aborted) return null

        const res = await this.#fetch(ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model: MODEL, state: clipState(state), questions }),
          signal: controller.signal,
        })
        if (!res.ok) return null
        const body = (await res.json()) as { answers?: Answers }
        return body.answers ?? null
      } catch {
        // Timeout, network failure, rate limit, malformed body — all non-fatal.
        return null
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener("abort", onOuterAbort)
      }
    }
  }

  export class OffEngine implements JevEngine {
    readonly id = "off"
    async isAvailable(): Promise<boolean> {
      return true
    }
    async evaluate(): Promise<Answers | null> {
      return null
    }
  }

  export class EngineChain {
    constructor(private engines: JevEngine[]) {}

    /**
     * Walk the chain. First non-null answer wins. Returns null only when the
     * terminal `off` engine is reached — i.e. "no opinion, keep the default".
     */
    async evaluate(state: string, questions: Questions, signal?: AbortSignal): Promise<Answers | null> {
      for (const engine of this.engines) {
        const ok = await engine.isAvailable().catch(() => false)
        if (!ok) continue
        const answers = await engine.evaluate(state, questions, signal).catch(() => null)
        if (answers) return answers
      }
      return null
    }
  }

  /** What routing actually needs from an engine or chain. */
  export interface Evaluator {
    evaluate(state: string, questions: Questions, signal?: AbortSignal): Promise<Answers | null>
  }

  /** Chain: typesafe -> off. `off` always terminates with null. */
  export function engine(input: { timeoutMs?: number; keyResolver?: () => Promise<string | undefined> } = {}): EngineChain {
    return new EngineChain([new TypesafeEngine({ timeoutMs: input.timeoutMs, keyResolver: input.keyResolver }), new OffEngine()])
  }

  /**
   * Credential resolution — three existing routes, in order:
   * 1. `TYPESAFE_API_KEY` environment variable
   * 2. `auth.json` entry for provider id `typesafe` (opencode credential store)
   * 3. a custom `provider.typesafe` config entry's `options.apiKey`
   */
  export async function defaultKey(): Promise<string | undefined> {
    if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY
    const stored = await Auth.get("typesafe").catch(() => undefined)
    if (stored?.type === "api") return stored.key
    const cfg = await Config.get().catch(() => undefined)
    const option = cfg?.provider?.["typesafe"]?.options?.apiKey
    if (typeof option === "string" && option) return option
    return undefined
  }

  // ---------------------------------------------------------------------------
  // Config mapping. `jev` is disabled unless explicitly enabled in config.
  // ---------------------------------------------------------------------------

  export interface RouterConfig {
    tiers: Tier[]
    policy: RoutingPolicy
    timeoutMs?: number
  }

  export function resolveConfig(input: Config.Info["jev"]): RouterConfig | undefined {
    if (!input?.enabled) return undefined
    const tiers = (input.tiers ?? []).map((t) => ({
      id: t.id,
      capability: t.capability,
      model: parseModelRef(t.model),
      costHintUsdPerMTokOut: t.costHintUsdPerMTokOut,
      availability: t.window
        ? {
            window: t.window,
            maxContextTokens: t.maxContextTokens,
            quota: t.quota,
            rate: t.rate,
          }
        : t.maxContextTokens !== undefined || t.quota || t.rate
          ? {
              maxContextTokens: t.maxContextTokens,
              quota: t.quota,
              rate: t.rate,
            }
          : undefined,
    }))
    // A pool of zero or one tiers needs no router.
    if (tiers.length < 2) return undefined
    return {
      tiers,
      policy: { ...DEFAULT_POLICY, ...input.thresholds },
      timeoutMs: input.timeoutMs,
    }
  }

  function parseModelRef(model: string): ModelRef {
    const [providerID, ...rest] = model.split("/")
    return { providerID, modelID: rest.join("/") }
  }

  // ---------------------------------------------------------------------------
  // Routing — the entry points used by the session loop.
  // ---------------------------------------------------------------------------

  export interface RouteInput {
    /** The turn's request text — the ONLY state Jev sees. */
    request: string
    /** Model the loop would use anyway; also the fail-open target. */
    defaultModel: ModelRef
    /** Tier id of the default model within `cfg.tiers`, when it is in the pool. */
    defaultTier?: string
    contextTokens?: number
    now?: Date
    signal?: AbortSignal
  }

  export interface RouteResult {
    model: ModelRef
    decision: RouteDecision
  }

  /**
   * Route one step. Layer 0 first (free, deterministic); Jev only on the
   * ambiguous residue. Every failure mode — disabled, no tiers, all excluded,
   * Jev down, Jev unsure, task hard — yields `undefined` or the default model.
   * A missing router can never degrade output.
   */
  export async function routeWith(
    cfg: RouterConfig,
    input: RouteInput,
    chain: Evaluator,
  ): Promise<RouteResult | undefined> {
    const request = input.request.trim()
    if (!request) return undefined

    const { available, excluded } = filterAvailable(cfg.tiers, {
      now: input.now,
      contextTokens: input.contextTokens,
    })
    if (excluded.length > 0) log.info("layer0", { excluded: Object.fromEntries(excluded.map((e) => [e.id, e.reason])) })

    // 0 available -> never guess, keep the default model.
    if (available.length === 0) {
      log.warn("no tiers available", { defaultModel: input.defaultModel })
      return undefined
    }

    // 1 available -> the decision is already made by arithmetic. Skip Jev.
    if (available.length === 1) {
      const only = available[0]
      if (only.model.providerID === input.defaultModel.providerID && only.model.modelID === input.defaultModel.modelID)
        return undefined
      return {
        model: only.model,
        decision: { tier: only.id, reason: "layer-0", intent: only.id },
      }
    }

    const fallbackTier = input.defaultTier ?? available[available.length - 1].id
    const answers = await chain.evaluate(clipState(request), routingQuestions(available), input.signal)
    if (!answers) return { model: input.defaultModel, decision: { tier: fallbackTier, reason: "engine-unavailable" } }

    const decision = decide(answers, available, fallbackTier, cfg.policy)
    if (decision.reason !== "jev-confident") return { model: input.defaultModel, decision }
    const chosen = available.find((t) => t.id === decision.tier)
    if (!chosen) return { model: input.defaultModel, decision }
    return { model: chosen.model, decision }
  }

  /** Config-reading wrapper used by the session loop. */
  export async function route(input: RouteInput): Promise<RouteResult | undefined> {
    const cfg = resolveConfig((await Config.get().catch(() => undefined))?.jev)
    if (!cfg) return undefined
    return routeWith(cfg, input, engine({ timeoutMs: cfg.timeoutMs, keyResolver: defaultKey }))
  }

  // ---------------------------------------------------------------------------
  // Verify-and-escalate (post-hoc). Escalating means RE-RUNNING the turn from
  // the original state on a stronger tier — the cheap attempt is discarded, not
  // continued. Wall-clock and user trust are the binding constraint, hence
  // `maxEscalationsPerTurn` and: verifier unavailable/unsure -> ACCEPT.
  // ---------------------------------------------------------------------------

  const adequacyQuestion: Questions = {
    adequate: {
      type: "choice",
      instructions:
        "Is this response adequate for the request? Answer 'no' if it is incomplete, " +
        "contradicts itself, ignores part of the request, or appears to have guessed.",
      criteria: {
        yes: "Adequate — a careful reviewer would accept this without rework",
        no: "Inadequate — needs to be redone by a stronger model",
      },
    },
  }

  export interface VerifyInput {
    request: string
    output: string
    /** The model that produced `output` — mapped back to its tier. */
    model: ModelRef
    /** How many escalations this turn has already spent. */
    escalations: number
    contextTokens?: number
    now?: Date
    signal?: AbortSignal
  }

  export interface VerifyResult {
    escalate: boolean
    /** Tier id + model to re-run on, when escalating. */
    tier?: string
    model?: ModelRef
  }

  /** Tier id for a model ref, when it is a declared pool member. */
  export function tierFor(cfg: RouterConfig, model: ModelRef): string | undefined {
    return cfg.tiers.find(
      (t) => t.model.providerID === model.providerID && t.model.modelID === model.modelID,
    )?.id
  }

  export async function verifyWith(
    cfg: RouterConfig,
    input: VerifyInput,
    chain: Evaluator,
  ): Promise<VerifyResult> {
    const tier = tierFor(cfg, input.model)
    // Outputs from models outside the pool (explicit user choice) are not verified.
    if (!tier) return { escalate: false }

    const top = cfg.tiers[cfg.tiers.length - 1]
    if (!cfg.policy.allowVerify) return { escalate: false }
    // Nothing to escalate to when the output already came from the top tier.
    if (tier === top.id) return { escalate: false }
    if (input.escalations >= cfg.policy.maxEscalationsPerTurn) return { escalate: false }

    const { available } = filterAvailable(cfg.tiers, { now: input.now, contextTokens: input.contextTokens })
    const idx = cfg.tiers.findIndex((t) => t.id === tier)
    // Escalation target must itself be available (Layer-0 facts still hold).
    const next = available.find((t) => cfg.tiers.findIndex((x) => x.id === t.id) > idx)
    if (!next) return { escalate: false }

    const state = clipState(`REQUEST:\n${input.request}\n\nRESPONSE:\n${input.output}`)
    const answers = await chain.evaluate(state, adequacyQuestion, input.signal)

    // Verifier unavailable or unsure -> ACCEPT. A flaky verifier must never
    // trigger unbounded re-runs.
    if (!answers?.adequate?.choice) return { escalate: false }
    if (answers.adequate.choice === "yes") return { escalate: false }
    if ((answers.adequate.confidence ?? 0) < cfg.policy.minConfidenceToEscalate) return { escalate: false }

    return { escalate: true, tier: next.id, model: next.model }
  }

  /** Config-reading wrapper used by the session loop. */
  export async function verify(input: VerifyInput): Promise<VerifyResult> {
    const cfg = resolveConfig((await Config.get().catch(() => undefined))?.jev)
    if (!cfg) return { escalate: false }
    return verifyWith(cfg, input, engine({ timeoutMs: cfg.timeoutMs, keyResolver: defaultKey }))
  }

  // ---------------------------------------------------------------------------
  // Helpers used by the session loop.
  // ---------------------------------------------------------------------------

  /** Extract the request text of a turn from its user-message parts. */
  export function requestText(parts: { type: string; text?: string; synthetic?: boolean; ignored?: boolean }[]): string {
    return parts
      .filter((p) => p.type === "text" && !p.synthetic && !p.ignored)
      .map((p) => p.text ?? "")
      .join("\n")
      .trim()
  }

  /** Per-turn routing state, held in the session run state by the loop. */
  export interface TurnState {
    /** Escalations spent this turn. */
    escalations: number
    /** Forced model after an escalation — overrides further routing. */
    override?: ModelRef
  }
}
