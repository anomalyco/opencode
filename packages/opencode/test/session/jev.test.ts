import { describe, expect, test } from "bun:test"
import { Jev } from "../../src/session/jev"

// ---------------------------------------------------------------------------
// Mock-first: every behavior provable without a key or network.
// ---------------------------------------------------------------------------

function mockEngine(answer: Jev.Answers | null) {
  let calls = 0
  let lastState: string | undefined
  let lastQuestions: Jev.Questions | undefined
  return {
    id: "mock",
    calls: () => calls,
    lastState: () => lastState,
    lastQuestions: () => lastQuestions,
    async isAvailable() {
      return true
    },
    async evaluate(state: string, questions: Jev.Questions) {
      calls++
      lastState = state
      lastQuestions = questions
      return answer
    },
  }
}

function tierAnswer(choice: string, confidence: number, complexity: number, complexityConfidence: number): Jev.Answers {
  return {
    tier: { type: "choice", choice, confidence },
    complexity: { type: "score", score: complexity, confidence: complexityConfidence },
  }
}

function adequacy(choice: "yes" | "no", confidence: number): Jev.Answers {
  return { adequate: { type: "choice", choice, confidence } }
}

const tier = (id: string, model: string, availability?: Jev.Availability): Jev.Tier => ({
  id,
  capability: `handles ${id} work`,
  model: { providerID: model.split("/")[0], modelID: model.split("/").slice(1).join("/") },
  availability,
})

const top = tier("top", "acme/top-model")
const mid = tier("mid", "acme/mid-model")
const cheap = tier("cheap", "acme/cheap-model")
const pool = [cheap, mid, top]

const config = (tiers = pool, thresholds?: Partial<Jev.RoutingPolicy>): Jev.RouterConfig => ({
  tiers,
  policy: { ...Jev.DEFAULT_POLICY, ...thresholds },
})

const input = (overrides: Partial<Jev.RouteInput> = {}): Jev.RouteInput => ({
  request: "fix the typo in README",
  defaultModel: top.model,
  ...overrides,
})

// ---------------------------------------------------------------------------
// Layer 0 — deterministic availability filter
// ---------------------------------------------------------------------------

describe("layer 0 availability", () => {
  test("excludes tiers outside their time window, including midnight wrap", () => {
    // 03:00 UTC+0 — inside a 22 -> 08 wrapping window, outside a 9 -> 17 window.
    const now = new Date("2026-09-20T03:00:00Z")
    const wrapping = tier("wrap", "acme/wrap", { window: { startHour: 22, endHour: 8, utcOffsetMinutes: 0 } })
    const daytime = tier("day", "acme/day", { window: { startHour: 9, endHour: 17, utcOffsetMinutes: 0 } })
    const result = Jev.filterAvailable([wrapping, daytime], { now })
    expect(result.available.map((t) => t.id)).toEqual(["wrap"])
    expect(result.excluded).toEqual([{ id: "day", reason: "outside-window" }])
  })

  test("respects the window utc offset", () => {
    // 22:30 UTC = 05:30 Hanoi (+420) — inside a 5 -> 12 window.
    const now = new Date("2026-09-20T22:30:00Z")
    const t = tier("hanoi", "acme/hanoi", { window: { startHour: 5, endHour: 12, utcOffsetMinutes: 420 } })
    expect(Jev.filterAvailable([t], { now }).available).toHaveLength(1)
  })

  test("excludes over context ceiling, exhausted quota and spent rate cap, in that order", () => {
    const now = new Date("2026-09-20T12:00:00Z")
    const ctx = { now, contextTokens: 50_000 }
    const t = tier("all", "acme/all", {
      window: { startHour: 0, endHour: 23, utcOffsetMinutes: 0 }, // passes
      maxContextTokens: 10_000, // fails -> context-too-large
      quota: { used: 10, limit: 10 },
      rate: { used: 10, limit: 10 },
    })
    expect(Jev.filterAvailable([t], ctx).excluded).toEqual([{ id: "all", reason: "context-too-large" }])

    const t2 = tier("q", "acme/q", { quota: { used: 5, limit: 5 }, rate: { used: 9, limit: 10 } })
    expect(Jev.filterAvailable([t2], ctx).excluded).toEqual([{ id: "q", reason: "quota-exhausted" }])

    const t3 = tier("r", "acme/r", { rate: { used: 10, limit: 10 } })
    expect(Jev.filterAvailable([t3], ctx).excluded).toEqual([{ id: "r", reason: "rate-limited" }])
  })

  test("context ceiling only applies when the turn size is known", () => {
    const t = tier("big", "acme/big", { maxContextTokens: 1_000 })
    expect(Jev.filterAvailable([t], {}).available).toHaveLength(1)
    expect(Jev.filterAvailable([t], { contextTokens: 1_001 }).available).toHaveLength(0)
    expect(Jev.filterAvailable([t], { contextTokens: 1_000 }).available).toHaveLength(1)
  })

  test("needsRouting is false for 0 and 1 available tiers, true for 2+", () => {
    const none = Jev.filterAvailable([], {})
    expect(Jev.needsRouting(none)).toBe(false)
    const one = Jev.filterAvailable([cheap], {})
    expect(Jev.needsRouting(one)).toBe(false)
    const two = Jev.filterAvailable([cheap, top], {})
    expect(Jev.needsRouting(two)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Config resolution — default OFF
// ---------------------------------------------------------------------------

describe("resolveConfig", () => {
  test("is disabled unless explicitly enabled", () => {
    expect(Jev.resolveConfig(undefined)).toBeUndefined()
    expect(Jev.resolveConfig({})).toBeUndefined()
    expect(Jev.resolveConfig({ enabled: false })).toBeUndefined()
  })

  test("requires at least two tiers to route", () => {
    expect(
      Jev.resolveConfig({
        enabled: true,
        tiers: [{ id: "top", model: "acme/top-model", capability: "everything" }],
      }),
    ).toBeUndefined()
    const cfg = Jev.resolveConfig({
      enabled: true,
      tiers: [
        { id: "cheap", model: "acme/cheap", capability: "mechanical edits" },
        { id: "top", model: "acme/top", capability: "everything" },
      ],
    })
    expect(cfg).toBeDefined()
    expect(cfg!.tiers.map((t) => t.id)).toEqual(["cheap", "top"])
    expect(cfg!.tiers[0].model).toEqual({ providerID: "acme", modelID: "cheap" })
  })

  test("parses model ids that themselves contain slashes", () => {
    const cfg = Jev.resolveConfig({
      enabled: true,
      tiers: [
        { id: "a", model: "acme/claude-3/20240229", capability: "x" },
        { id: "b", model: "acme/top", capability: "y" },
      ],
    })
    expect(cfg!.tiers[0].model.modelID).toBe("claude-3/20240229")
  })

  test("merges threshold overrides over the defaults", () => {
    const cfg = Jev.resolveConfig({
      enabled: true,
      thresholds: { minConfidenceToDegrade: 0.6, maxEscalationsPerTurn: 2 },
      tiers: [
        { id: "cheap", model: "acme/cheap", capability: "x" },
        { id: "top", model: "acme/top", capability: "y" },
      ],
    })
    expect(cfg!.policy.minConfidenceToDegrade).toBe(0.6)
    expect(cfg!.policy.maxEscalationsPerTurn).toBe(2)
    expect(cfg!.policy.maxComplexityForDegrade).toBe(Jev.DEFAULT_POLICY.maxComplexityForDegrade)
  })
})

// ---------------------------------------------------------------------------
// Routing — Layer 0 short-circuit, three gates, fail-open
// ---------------------------------------------------------------------------

describe("routeWith", () => {
  test("never calls Jev when the request is empty", async () => {
    const engine = mockEngine(tierAnswer("cheap", 0.99, 0, 0.99))
    expect(await Jev.routeWith(config(), input({ request: "   " }), engine)).toBeUndefined()
    expect(engine.calls()).toBe(0)
  })

  test("short-circuits when no tier is available — never guesses, never calls Jev", async () => {
    const engine = mockEngine(tierAnswer("cheap", 0.99, 0, 0.99))
    const cfg = config([tier("cheap", "acme/cheap", { quota: { used: 1, limit: 1 } }), top])
    expect(await Jev.routeWith(cfg, input(), engine)).toBeUndefined()
    expect(engine.calls()).toBe(0)
  })

  test("single available tier is decided by arithmetic alone — no Jev call", async () => {
    const engine = mockEngine(tierAnswer("cheap", 0.99, 0, 0.99))
    const cfg = config([cheap, tier("top", "acme/top", { rate: { used: 5, limit: 5 } })])
    const result = await Jev.routeWith(cfg, input(), engine)
    expect(engine.calls()).toBe(0)
    expect(result?.model).toEqual(cheap.model)
    expect(result?.decision.reason).toBe("layer-0")
  })

  test("single available tier equal to the default model yields no reroute", async () => {
    const engine = mockEngine(tierAnswer("cheap", 0.99, 0, 0.99))
    // only the default model itself survives Layer-0: decision already made, nothing to change
    const self = config([tier("other", "acme/other", { rate: { used: 5, limit: 5 } }), top])
    const r = await Jev.routeWith(self, input(), engine)
    expect(r).toBeUndefined()
    expect(engine.calls()).toBe(0)
  })

  test("routes down when all three gates pass", async () => {
    const engine = mockEngine(tierAnswer("cheap", 0.9, 0.1, 0.9))
    const result = await Jev.routeWith(config(), input(), engine)
    expect(engine.calls()).toBe(1)
    expect(result?.model).toEqual(cheap.model)
    expect(result?.decision).toMatchObject({ tier: "cheap", reason: "jev-confident", complexity: 0.05 }) // raw 0.1 → normalized 0.05
    // only AVAILABLE tiers are offered as criteria
    const question = engine.lastQuestions()!.tier
    if (question.type !== "choice") throw new Error("expected a choice question")
    expect(Object.keys(question.criteria)).toEqual(["cheap", "mid", "top"])
  })

  test("gate 1: low tier confidence keeps the default model", async () => {
    const engine = mockEngine(tierAnswer("cheap", 0.5, 0.1, 0.9))
    const result = await Jev.routeWith(config(), input(), engine)
    expect(result?.model).toEqual(top.model)
    expect(result?.decision.reason).toBe("low-confidence")
  })

  test("gate 2: high complexity keeps the default model", async () => {
    const engine = mockEngine(tierAnswer("cheap", 0.9, 1.6, 0.9)) // raw wire scale 0..2 → normalized 0.8 > 0.5
    const result = await Jev.routeWith(config(), input(), engine)
    expect(result?.model).toEqual(top.model)
    expect(result?.decision.reason).toBe("high-complexity")
  })

  test("gate 3: unconfident complexity score keeps the default model", async () => {
    const engine = mockEngine(tierAnswer("cheap", 0.9, 0.1, 0.2))
    const result = await Jev.routeWith(config(), input(), engine)
    expect(result?.model).toEqual(top.model)
    expect(result?.decision.reason).toBe("low-confidence")
  })

  test("unknown complexity defaults to HARD — fail expensive", async () => {
    const engine = mockEngine({ tier: { type: "choice", choice: "cheap", confidence: 0.9 } })
    const result = await Jev.routeWith(config(), input(), engine)
    expect(result?.model).toEqual(top.model)
    expect(result?.decision.complexity).toBe(1)
    expect(result?.decision.reason).toBe("high-complexity")
  })

  test("unknown tier id from Jev keeps the default model", async () => {
    const engine = mockEngine(tierAnswer("supercheap", 0.9, 0.1, 0.9))
    const result = await Jev.routeWith(config(), input(), engine)
    expect(result?.model).toEqual(top.model)
    expect(result?.decision.reason).toBe("low-confidence")
  })

  test("engine unavailable keeps the default model (fail-open = fail expensive)", async () => {
    const engine = mockEngine(null)
    const result = await Jev.routeWith(config(), input(), engine)
    expect(result?.model).toEqual(top.model)
    expect(result?.decision.reason).toBe("engine-unavailable")
  })

  test("clips the state payload to the hard cap", async () => {
    const engine = mockEngine(tierAnswer("cheap", 0.9, 0.1, 0.9))
    await Jev.routeWith(config(), input({ request: "x".repeat(Jev.STATE_CLIP_CHARS + 500) }), engine)
    expect(engine.lastState()!.length).toBe(Jev.STATE_CLIP_CHARS)
  })

  test("pool-specific thresholds are honored (flat pool can degrade at 0.6)", async () => {
    const engine = mockEngine(tierAnswer("cheap", 0.6, 0.4, 0.6))
    const strict = await Jev.routeWith(config(), input(), engine)
    expect(strict?.model).toEqual(top.model)
    const flat = await Jev.routeWith(config(pool, { minConfidenceToDegrade: 0.55, minComplexityConfidence: 0.5 }), input(), engine)
    expect(flat?.model).toEqual(cheap.model)
  })
})

// ---------------------------------------------------------------------------
// Verify-and-escalate
// ---------------------------------------------------------------------------

describe("verifyWith", () => {
  const downInput = (overrides: Partial<Jev.VerifyInput> = {}): Jev.VerifyInput => ({
    request: "fix the typo in README",
    output: "fixed it",
    model: cheap.model,
    escalations: 0,
    ...overrides,
  })

  test("does not verify outputs already on the top tier", async () => {
    const engine = mockEngine(adequacy("no", 0.99))
    const result = await Jev.verifyWith(config(), downInput({ model: top.model }), engine)
    expect(result.escalate).toBe(false)
    expect(engine.calls()).toBe(0)
  })

  test("does not verify models outside the pool", async () => {
    const engine = mockEngine(adequacy("no", 0.99))
    const result = await Jev.verifyWith(config(), downInput({ model: { providerID: "other", modelID: "m" } }), engine)
    expect(result.escalate).toBe(false)
    expect(engine.calls()).toBe(0)
  })

  test("budget spent: accepts the output rather than looping", async () => {
    const engine = mockEngine(adequacy("no", 0.99))
    const result = await Jev.verifyWith(config(), downInput({ escalations: 1 }), engine)
    expect(result.escalate).toBe(false)
    expect(engine.calls()).toBe(0)
  })

  test("allowVerify=false disables verification", async () => {
    const engine = mockEngine(adequacy("no", 0.99))
    const result = await Jev.verifyWith(config(pool, { allowVerify: false }), downInput(), engine)
    expect(result.escalate).toBe(false)
    expect(engine.calls()).toBe(0)
  })

  test("verifier unavailable or unsure -> accept", async () => {
    const down = await Jev.verifyWith(config(), downInput(), mockEngine(null))
    expect(down.escalate).toBe(false)

    const unsure = await Jev.verifyWith(config(), downInput(), mockEngine(adequacy("no", 0.3)))
    expect(unsure.escalate).toBe(false)

    const missing = await Jev.verifyWith(config(), downInput(), mockEngine({}))
    expect(missing.escalate).toBe(false)
  })

  test("adequate output is accepted", async () => {
    const engine = mockEngine(adequacy("yes", 0.9))
    const result = await Jev.verifyWith(config(), downInput(), engine)
    expect(result.escalate).toBe(false)
  })

  test("confident 'inadequate' escalates to the next stronger tier", async () => {
    const engine = mockEngine(adequacy("no", 0.9))
    const result = await Jev.verifyWith(config(), downInput(), engine)
    expect(result).toEqual({ escalate: true, tier: "mid", model: mid.model })
  })

  test("escalation target must satisfy Layer-0 availability", async () => {
    const engine = mockEngine(adequacy("no", 0.9))
    const cfg = config([cheap, tier("mid", "acme/mid", { quota: { used: 9, limit: 9 } }), top])
    const result = await Jev.verifyWith(cfg, downInput(), engine)
    expect(result).toEqual({ escalate: true, tier: "top", model: top.model })
  })

  test("escalates step by step, never skips tiers", async () => {
    const engine = mockEngine(adequacy("no", 0.9))
    const first = await Jev.verifyWith(config(), downInput(), engine)
    expect(first.tier).toBe("mid")
    const second = await Jev.verifyWith(config(), downInput({ model: mid.model }), engine)
    expect(second.tier).toBe("top")
  })
})

// ---------------------------------------------------------------------------
// Engine chain + TypesafeEngine (never throws; off terminates with null)
// ---------------------------------------------------------------------------

describe("engines", () => {
  const questions: Jev.Questions = { tier: { type: "choice", instructions: "?", criteria: { a: "b" } } }

  test("chain: first non-null answer wins, unavailable engines are skipped, off terminates with null", async () => {
    const off: Jev.JevEngine = new Jev.OffEngine()
    expect(await off.evaluate("s", questions)).toBeNull()

    const unavailable: Jev.JevEngine = {
      id: "never",
      isAvailable: async () => false,
      evaluate: async () => tierAnswer("cheap", 1, 0, 1),
    }
    const answering: Jev.JevEngine = {
      id: "yes",
      isAvailable: async () => true,
      evaluate: async () => tierAnswer("mid", 1, 0, 1),
    }
    const chain = new Jev.EngineChain([unavailable, answering, off])
    expect(await chain.evaluate("s", questions)).toEqual(tierAnswer("mid", 1, 0, 1))
    expect(await new Jev.EngineChain([off]).evaluate("s", questions)).toBeNull()
  })

  test("chain: an engine throwing is survived (contract: engines return null)", async () => {
    const throwing: Jev.JevEngine = {
      id: "boom",
      isAvailable: async () => true,
      evaluate: async () => {
        throw new Error("boom")
      },
    }
    const chain = new Jev.EngineChain([throwing, new Jev.OffEngine()])
    expect(await chain.evaluate("s", questions)).toBeNull()
  })

  test("typesafe engine without credentials is unavailable and returns null", async () => {
    const engine = new Jev.TypesafeEngine({ keyResolver: async () => undefined })
    expect(await engine.isAvailable()).toBe(false)
    expect(await engine.evaluate("s", questions)).toBeNull()
  })

  test("typesafe engine returns null on network failure, non-200 and malformed body", async () => {
    const boom: Jev.FetchImpl = async () => {
      throw new TypeError("network down")
    }
    expect(await new Jev.TypesafeEngine({ apiKey: "k", fetchImpl: boom }).evaluate("s", questions)).toBeNull()

    const bad: Jev.FetchImpl = async () => new Response("nope", { status: 429 })
    expect(await new Jev.TypesafeEngine({ apiKey: "k", fetchImpl: bad }).evaluate("s", questions)).toBeNull()

    const junk: Jev.FetchImpl = async () => new Response("{not json", { status: 200 })
    expect(await new Jev.TypesafeEngine({ apiKey: "k", fetchImpl: junk }).evaluate("s", questions)).toBeNull()
  })

  test("typesafe engine parses answers and clips state", async () => {
    let body: Record<string, unknown> | undefined
    const ok: Jev.FetchImpl = async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ answers: { tier: { type: "choice", choice: "cheap" } } }), { status: 200 })
    }
    const engine = new Jev.TypesafeEngine({ apiKey: "k", fetchImpl: ok })
    const answers = await engine.evaluate("x".repeat(30_000), questions)
    expect(answers?.tier.choice).toBe("cheap")
    expect((body!.state as string).length).toBe(Jev.STATE_CLIP_CHARS)
    expect((body!.model as string)).toBe("jev-latest")
  })

  test("typesafe engine enforces its own timeout", async () => {
    const hangs: Jev.FetchImpl = (_url, init) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))
      })
    const engine = new Jev.TypesafeEngine({ apiKey: "k", fetchImpl: hangs, timeoutMs: 20 })
    const answers = await engine.evaluate("s", questions)
    expect(answers).toBeNull()
  })

  test("typesafe engine honors an outer abort signal", async () => {
    const outer = new AbortController()
    const hangs: Jev.FetchImpl = (_url, init) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))
      })
    const engine = new Jev.TypesafeEngine({ apiKey: "k", fetchImpl: hangs, timeoutMs: 5_000 })
    const pending = engine.evaluate("s", questions, outer.signal)
    outer.abort()
    expect(await pending).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe("requestText", () => {
  test("joins real text parts, skipping synthetic and ignored ones", () => {
    const text = Jev.requestText([
      { type: "text", text: "fix the bug" },
      { type: "text", text: "queued continuation", synthetic: true },
      { type: "text", text: "superseded", ignored: true },
      { type: "tool" },
      { type: "file" },
    ])
    expect(text).toBe("fix the bug")
  })
})
