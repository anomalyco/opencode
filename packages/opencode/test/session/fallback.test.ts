import { describe, expect, test } from "bun:test"
import { Cause, Effect, Layer, Stream } from "effect"
import * as TestClock from "effect/testing/TestClock"
import {
  CooldownManager,
  DEFAULT_COOLDOWN_SECONDS,
  FALLBACK_NOTICE_ID,
  FALLBACK_RESUME_ID,
  FALLBACK_USING_ID,
  FallbackTriggered,
  FallbackUsed,
  NOTICE_REASON_MAX_LENGTH,
  QUOTA_COOLDOWN_MS,
  SessionFallbackState,
  WAIT_CAP_MS,
  withFallback,
  type ClassifiedError,
  type FallbackDeps,
  type FallbackInput,
  type ProviderStreamResult,
  type StreamChunk,
} from "../../src/session/fallback"

// ---------------------------------------------------------------------------
// CooldownManager
// ---------------------------------------------------------------------------

describe("CooldownManager", () => {
  test("isCooledDown returns false when no cooldown has been set", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const cm = new CooldownManager()
        expect(yield* cm.isCooledDown("a", "x")).toBe(false)
      }),
    ))

  test("isCooledDown returns true after put", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const cm = new CooldownManager()
        yield* cm.put("a", "x", 60_000)
        expect(yield* cm.isCooledDown("a", "x")).toBe(true)
      }),
    ))

  test("isCooledDown returns false after expiry and cleans up the entry", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const cm = new CooldownManager()
        yield* cm.put("a", "x", 100)
        yield* TestClock.adjust("150 millis")
        expect(yield* cm.isCooledDown("a", "x")).toBe(false)
        expect(yield* cm.remaining("a", "x")).toBeUndefined()
      }).pipe(Effect.provide(Layer.empty)),
    ))

  test("clear removes an active cooldown", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const cm = new CooldownManager()
        yield* cm.put("a", "x", 60_000)
        cm.clear("a", "x")
        expect(yield* cm.isCooledDown("a", "x")).toBe(false)
      }),
    ))

  test("put overwrites existing expiry with the new shorter value", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const cm = new CooldownManager()
        yield* cm.put("a", "x", 60_000)
        yield* cm.put("a", "x", 100)
        yield* TestClock.adjust("150 millis")
        expect(yield* cm.isCooledDown("a", "x")).toBe(false)
      }).pipe(Effect.provide(Layer.empty)),
    ))

  test("remaining returns ms left when active", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const cm = new CooldownManager()
        yield* cm.put("a", "x", 60_000)
        const left = yield* cm.remaining("a", "x")
        expect(left).toBeGreaterThan(59_000)
        expect(left!).toBeLessThanOrEqual(60_000)
      }),
    ))
})

// ---------------------------------------------------------------------------
// SessionFallbackState
// ---------------------------------------------------------------------------

describe("SessionFallbackState", () => {
  test("isOnFallback is false by default", () => {
    const s = new SessionFallbackState()
    expect(s.isOnFallback("sess")).toBe(false)
  })

  test("markOnFallback then isOnFallback returns true", () => {
    const s = new SessionFallbackState()
    s.markOnFallback("sess")
    expect(s.isOnFallback("sess")).toBe(true)
  })

  test("clear removes only the targeted session", () => {
    const s = new SessionFallbackState()
    s.markOnFallback("a")
    s.markOnFallback("b")
    s.clear("a")
    expect(s.isOnFallback("a")).toBe(false)
    expect(s.isOnFallback("b")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("fallback constants", () => {
  test("notice ids are stable strings", () => {
    expect(FALLBACK_NOTICE_ID).toBe("fallback-notice")
    expect(FALLBACK_RESUME_ID).toBe("fallback-resume")
    expect(FALLBACK_USING_ID).toBe("fallback-using")
  })
  test("QUOTA_COOLDOWN_MS is 6 hours", () => expect(QUOTA_COOLDOWN_MS).toBe(6 * 60 * 60 * 1000))
  test("DEFAULT_COOLDOWN_SECONDS is 300", () => expect(DEFAULT_COOLDOWN_SECONDS).toBe(300))
  test("NOTICE_REASON_MAX_LENGTH is 40", () => expect(NOTICE_REASON_MAX_LENGTH).toBe(40))
  test("WAIT_CAP_MS is 30 seconds", () => expect(WAIT_CAP_MS).toBe(30_000))
})

// ---------------------------------------------------------------------------
// withFallback — mock harness
// ---------------------------------------------------------------------------

type PublishedEvent = { type: "triggered" | "used"; properties: Record<string, string> }

function makeStream(chunks: StreamChunk[]): ProviderStreamResult {
  return {
    fullStream: (async function* () {
      for (const c of chunks) yield c
    })(),
  }
}

function errorStream(message: string): ProviderStreamResult {
  return {
    fullStream: (async function* () {
      yield { type: "error", error: new Error(message) }
    })(),
  }
}

function makeDeps(overrides: Partial<FallbackDeps> & { events?: PublishedEvent[] } = {}): FallbackDeps {
  const events = overrides.events ?? []
  const baseModel = { name: "Mock", id: "mock", providerID: "mock" } as any
  const baseProvider = { name: "Mock Provider", id: "mock" } as any
  return {
    provider: {
      getModel: (p, m) =>
        Effect.succeed({ ...baseModel, providerID: p, id: m, name: `${p}:${m}` } as any) as Effect.Effect<
          any,
          unknown
        >,
      getProvider: (p) => Effect.succeed({ ...baseProvider, id: p, name: `${p}-name` } as any),
      ...overrides.provider,
    },
    bus: {
      publish: (def: any, properties: any) =>
        Effect.sync(() => {
          if (def.type === "llm.fallback.triggered") events.push({ type: "triggered", properties })
          if (def.type === "llm.fallback.used") events.push({ type: "used", properties })
        }),
    } as any,
    config: {
      get: () => Effect.succeed({ cooldown_seconds: 60 }) as Effect.Effect<{ cooldown_seconds?: number }, unknown>,
      ...overrides.config,
    },
    classifyError: ((_cause: Cause.Cause<unknown>) => ({
      error: new Error("classified"),
      isRetryable: true,
      retryInfo: undefined,
      reason: "test error",
    })) satisfies FallbackDeps["classifyError"],
    call: ((_model: any) =>
      Effect.succeed(makeStream([{ type: "text-delta", id: "1", text: "ok" }]))) as FallbackDeps["call"],
    log: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      clone() {
        return this
      },
      tag() {
        return this
      },
      time: () => ({
        stop() {},
        [Symbol.dispose]() {},
      }),
    } as any,
    cooldown: new CooldownManager(),
    sessionFallbackState: new SessionFallbackState(),
    ...overrides,
  }
}

const primaryModel = { providerID: "primary", id: "primary-model", name: "Primary" } as any

const collect = <A>(stream: Stream.Stream<A, unknown>) =>
  Effect.runPromise(stream.pipe(Stream.runCollect, Effect.map((c) => Array.from(c))))

// ---------------------------------------------------------------------------
// withFallback behaviour
// ---------------------------------------------------------------------------

describe("withFallback", () => {
  test("returns primary stream as-is when no fallbacks are configured", async () => {
    const events: PublishedEvent[] = []
    const deps = makeDeps({ events })
    const input: FallbackInput = {
      sessionID: "s",
      model: primaryModel,
      abort: new AbortController().signal,
    }
    const stream = await Effect.runPromise(withFallback(input, deps) as Effect.Effect<any>)
    const chunks = await collect(stream)
    expect(chunks).toEqual([{ type: "text-delta", id: "1", text: "ok" }])
    expect(events).toEqual([])
    expect(deps.sessionFallbackState.isOnFallback("s")).toBe(false)
  })

  test("primary succeeds → fallbacks are wrapped but not invoked, no events emitted", async () => {
    const events: PublishedEvent[] = []
    const callTargets: string[] = []
    const deps = makeDeps({
      events,
      call: (model: any, p, m) => {
        callTargets.push(`${p}/${m}`)
        return Effect.succeed(makeStream([{ type: "text-delta", id: "p", text: "primary-ok" }])) as any
      },
    })
    const input: FallbackInput = {
      sessionID: "s",
      model: primaryModel,
      fallbacks: [{ providerID: "fb", modelID: "fb-model" }],
      abort: new AbortController().signal,
    }
    const stream = await Effect.runPromise(withFallback(input, deps) as Effect.Effect<any>)
    const chunks = await collect(stream)
    expect(chunks).toEqual([{ type: "text-delta", id: "p", text: "primary-ok" }])
    expect(callTargets).toEqual(["primary/primary-model"])
    expect(events).toEqual([])
  })

  test("primary errors mid-stream → falls back, prepends switch notice, emits both events", async () => {
    const events: PublishedEvent[] = []
    const callTargets: string[] = []
    const deps = makeDeps({
      events,
      call: (model: any, p, m) => {
        callTargets.push(`${p}/${m}`)
        if (p === "primary") {
          return Effect.succeed(errorStream("primary boom")) as any
        }
        return Effect.succeed(makeStream([{ type: "text-delta", id: "f", text: "fallback-ok" }])) as any
      },
    })
    const input: FallbackInput = {
      sessionID: "s",
      model: primaryModel,
      fallbacks: [{ providerID: "fb", modelID: "fb-model" }],
      abort: new AbortController().signal,
    }
    const stream = await Effect.runPromise(withFallback(input, deps) as Effect.Effect<any>)
    const chunks = await collect(stream)
    const noticeStart = chunks.find((c) => c.type === "text-start" && c.id === FALLBACK_NOTICE_ID)
    const noticeDelta = chunks.find((c) => c.type === "text-delta" && c.id === FALLBACK_NOTICE_ID)
    expect(noticeStart).toBeDefined()
    expect(noticeDelta?.text).toContain("Switching to")
    expect(chunks.some((c) => c.type === "text-delta" && c.id === "f")).toBe(true)

    expect(callTargets).toEqual(["primary/primary-model", "fb/fb-model"])
    expect(events.map((e) => e.type)).toEqual(["triggered", "used"])
    expect(events[1].properties.modelID).toBe("fb-model")
    expect(deps.sessionFallbackState.isOnFallback("s")).toBe(true)
  })

  test("primary on cooldown → cold-starts on fallback with 'using' notice, only FallbackUsed event", async () => {
    const events: PublishedEvent[] = []
    const callTargets: string[] = []
    const cm = new CooldownManager()
    await Effect.runPromise(cm.put("primary", "primary-model", 60_000))
    const deps = makeDeps({
      events,
      cooldown: cm,
      call: (model: any, p, m) => {
        callTargets.push(`${p}/${m}`)
        return Effect.succeed(makeStream([{ type: "text-delta", id: "f", text: "fb" }])) as any
      },
    })
    const input: FallbackInput = {
      sessionID: "s",
      model: primaryModel,
      fallbacks: [{ providerID: "fb", modelID: "fb-model" }],
      abort: new AbortController().signal,
    }
    const stream = await Effect.runPromise(withFallback(input, deps) as Effect.Effect<any>)
    const chunks = await collect(stream)
    const usingNotice = chunks.find((c) => c.type === "text-delta" && c.id === FALLBACK_USING_ID)
    expect(usingNotice).toBeDefined()
    expect(usingNotice?.text).toContain("Using")
    expect(callTargets).toEqual(["fb/fb-model"])
    // Cold-start on cooldown does NOT publish FallbackTriggered (that is for
    // mid-stream errors only) but DOES publish FallbackUsed so the processor
    // can update the assistant message model.
    expect(events.map((e) => e.type)).toEqual(["used"])
    expect(deps.sessionFallbackState.isOnFallback("s")).toBe(true)
  })

  test("primary recovers after previous fallback → prepends resume notice, clears session state", async () => {
    const events: PublishedEvent[] = []
    const state = new SessionFallbackState()
    state.markOnFallback("s")
    const deps = makeDeps({ events, sessionFallbackState: state })
    const input: FallbackInput = {
      sessionID: "s",
      model: primaryModel,
      fallbacks: [{ providerID: "fb", modelID: "fb-model" }],
      abort: new AbortController().signal,
    }
    const stream = await Effect.runPromise(withFallback(input, deps) as Effect.Effect<any>)
    const chunks = await collect(stream)
    const resumeDelta = chunks.find((c) => c.type === "text-delta" && c.id === FALLBACK_RESUME_ID)
    expect(resumeDelta).toBeDefined()
    expect(resumeDelta?.text).toContain("Switched back to")
    expect(state.isOnFallback("s")).toBe(false)
    expect(events.map((e) => e.type)).toEqual(["used"])
    expect(events[0].properties.modelID).toBe("primary-model")
  })

  test("all models on cooldown → bounded wait, then takes whichever expires first", async () => {
    const events: PublishedEvent[] = []
    const callTargets: string[] = []
    const cm = new CooldownManager()
    // Primary cools down sooner than fallback so after the wait we should
    // start on primary, not fallback.
    await Effect.runPromise(cm.put("primary", "primary-model", 200))
    await Effect.runPromise(cm.put("fb", "fb-model", 60_000))
    const deps = makeDeps({
      events,
      cooldown: cm,
      call: (model: any, p, m) => {
        callTargets.push(`${p}/${m}`)
        return Effect.succeed(makeStream([{ type: "text-delta", id: "p", text: "ok" }])) as any
      },
    })
    const input: FallbackInput = {
      sessionID: "s",
      model: primaryModel,
      fallbacks: [{ providerID: "fb", modelID: "fb-model" }],
      abort: new AbortController().signal,
    }
    const program = Effect.gen(function* () {
      const fiber = yield* Effect.fork(withFallback(input, deps) as Effect.Effect<any>)
      // Move past the soonest expiry; the implementation caps the wait at
      // WAIT_CAP_MS so this also exercises the cap-respect path.
      yield* TestClock.adjust("300 millis")
      return yield* fiber
    }).pipe(Effect.provide(Layer.empty))
    const stream = await Effect.runPromise(program)
    const chunks = await collect(stream)
    expect(chunks.some((c) => c.type === "text-delta" && c.id === "p")).toBe(true)
    // Primary expired first, so we should have started on primary, not fb.
    expect(callTargets[0]).toBe("primary/primary-model")
  })

  test("non-retryable error from primary is not caught — propagates as failure", async () => {
    const deps = makeDeps({
      classifyError: () => null,
      call: (_model: any, p) =>
        p === "primary"
          ? (Effect.succeed(errorStream("auth fail")) as any)
          : (Effect.succeed(makeStream([{ type: "text-delta", id: "f", text: "fb" }])) as any),
    })
    const input: FallbackInput = {
      sessionID: "s",
      model: primaryModel,
      fallbacks: [{ providerID: "fb", modelID: "fb-model" }],
      abort: new AbortController().signal,
    }
    const stream = await Effect.runPromise(withFallback(input, deps) as Effect.Effect<any>)
    const exit = await Effect.runPromise(stream.pipe(Stream.runCollect, Effect.exit))
    expect(exit._tag).toBe("Failure")
  })

  test("FallbackTriggered / FallbackUsed events are defined and have stable types", () => {
    expect(FallbackTriggered.type).toBe("llm.fallback.triggered")
    expect(FallbackUsed.type).toBe("llm.fallback.used")
  })
})
