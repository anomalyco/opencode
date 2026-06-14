/**
 * @spec-handoff
 * @interface ReloadSkillsTool — must publish Command.Event.CatalogUpdated after refresh()
 * @behavior
 *   - execute() calls events.publish("command.catalog.updated") exactly once, after refresh() returns
 *   - if refresh() throws, publish() is NOT called
 * @edge-cases
 *   - publish is called even if the skill list is empty after refresh
 *   - publish is called AFTER the Ref is updated (ordering guarantee)
 * @see packages/opencode/src/tool/skill.ts
 * @see packages/opencode/src/command/index.ts
 */

import { describe, expect } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Skill } from "@/skill"
import { Command } from "@/command"
import { Tool } from "@/tool/tool"
import { Agent } from "@/agent/agent"
import { Truncate } from "@/tool/truncate"
import { ReloadSkillsTool } from "@/tool/skill"
import { isCatalogUpdateForDirectory } from "@/cli/cmd/run/stream.transport"
import { it } from "../lib/effect"

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/**
 * Minimal EventV2Bridge mock that records the type of every publish() call.
 * The published array is mutated in place so callers can assert after execute().
 */
const makeEventBridgeMock = (published: string[]) =>
  Layer.succeed(
    EventV2Bridge.Service,
    EventV2Bridge.Service.of({
      publish: (def, _data, _opts) =>
        Effect.sync(() => {
          published.push(def.type)
          return {} as any
        }),
      subscribe: () => Stream.empty,
      all: () => Stream.empty,
      aggregateEvents: () => Stream.empty,
      sync: () => Effect.succeed(Effect.void),
      listen: () => Effect.succeed(Effect.void),
      beforeCommit: () => Effect.void,
      project: () => Effect.void,
      replay: () => Effect.void,
      replayAll: () => Effect.succeed(undefined),
      remove: () => Effect.void,
      claim: () => Effect.void,
    }),
  )

/**
 * Minimal Skill mock where refresh() behaviour is supplied by the caller.
 * All other methods are stubs — they should not be reached by the tool execute path.
 */
const makeSkillMock = (refresh: () => Effect.Effect<Skill.Info[]>) =>
  Layer.succeed(
    Skill.Service,
    Skill.Service.of({
      get: () => Effect.succeed(undefined),
      require: () => Effect.die("not needed"),
      all: () => Effect.succeed([]),
      dirs: () => Effect.succeed([]),
      available: () => Effect.succeed([]),
      refresh,
    }),
  )

/** Truncate stub: returns output unchanged, never truncates. */
const truncateMockLayer = Layer.succeed(
  Truncate.Service,
  Truncate.Service.of({
    cleanup: () => Effect.void,
    write: (text) => Effect.succeed(text),
    output: (text, _opts?, _agent?) => Effect.succeed({ content: text, truncated: false }),
    limits: () => Effect.succeed({ maxLines: 10_000, maxBytes: 1_000_000 }),
  }),
)

/** Agent stub: returns a minimal Info record, never invoked in the execute path. */
const minimalAgentInfo: Agent.Info = {
  name: "test-agent",
  mode: "primary",
  permission: [],
  options: {},
}

const agentMockLayer = Layer.succeed(
  Agent.Service,
  Agent.Service.of({
    get: () => Effect.succeed(minimalAgentInfo),
    list: () => Effect.succeed([]),
    defaultInfo: () => Effect.succeed(minimalAgentInfo),
    defaultAgent: () => Effect.succeed("test-agent"),
    generate: () => Effect.die("not needed"),
  }),
)

/** Minimal Tool.Context required by the execute wrapper. */
const fakeCtx: Tool.Context = {
  sessionID: "test-session" as any,
  messageID: "test-message" as any,
  agent: "test-agent",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ReloadSkillsTool.execute() — catalog event", () => {
  // E1 — execute() publishes command.catalog.updated exactly once on success
  it.effect(
    "E1: execute() publishes command.catalog.updated exactly once when refresh() succeeds",
    () =>
      Effect.gen(function* () {
        const published: string[] = []

        const testLayer = Layer.mergeAll(
          makeEventBridgeMock(published),
          makeSkillMock(() => Effect.succeed([])), // empty list — publish must still fire
          truncateMockLayer,
          agentMockLayer,
        )

        // ReloadSkillsTool captures Skill.Service (and, after implementation, EventV2Bridge.Service)
        // at init time. Provide the full mock layer at this step.
        const info = yield* ReloadSkillsTool.pipe(Effect.provide(testLayer))
        const def = yield* Tool.init(info)

        yield* def.execute({}, fakeCtx)

        // ── Red-phase contract ──────────────────────────────────────────────
        // Command.Event.CatalogUpdated does not exist yet in command/index.ts.
        // Accessing .type on undefined throws TypeError → test fails immediately.
        // Even if the property existed, published is empty (no publish call in
        // current implementation) so the assertion would still fail.
        expect(published).toContain(Command.Event.CatalogUpdated.type)
        expect(published.filter((t) => t === Command.Event.CatalogUpdated.type)).toHaveLength(1)
      }),
  )

  // E2 — execute() must NOT publish when refresh() fails
  it.effect(
    "E2: execute() does NOT call publish when refresh() fails",
    () =>
      Effect.gen(function* () {
        const published: string[] = []

        const testLayer = Layer.mergeAll(
          makeEventBridgeMock(published),
          // Simulate a disk/IO failure returned from refresh().
          // Cast required: Skill.Interface.refresh is typed Effect<Info[], never>
          // but we intentionally inject a typed failure to drive the failure path.
          makeSkillMock(
            () => Effect.fail(new Error("disk error")) as unknown as Effect.Effect<Skill.Info[]>,
          ),
          truncateMockLayer,
          agentMockLayer,
        )

        const info = yield* ReloadSkillsTool.pipe(Effect.provide(testLayer))
        const def = yield* Tool.init(info)

        // Capture the exit so the defect from refresh() does not propagate
        // out of the test Effect (Effect.orDie in the tool wrapper converts the
        // typed failure to a defect).
        yield* def.execute({}, fakeCtx).pipe(Effect.exit)

        // ── Red-phase contract ──────────────────────────────────────────────
        // Eagerly dereference Command.Event.CatalogUpdated.type outside the
        // filter callback so the TypeError fires even when published is empty
        // (an empty-array filter never calls its predicate).
        // Red phase: Command.Event.CatalogUpdated is undefined → TypeError here.
        // Green phase: the type resolves and published is empty because refresh()
        // failed before publish() could be called.
        const catalogType = Command.Event.CatalogUpdated.type
        expect(published.filter((t) => t === catalogType)).toHaveLength(0)
      }),
  )

  // E3 — transport filter: wrong directory must not trigger onCatalogUpdated
  //
  // `createSessionTransport` is too deeply coupled to a live SDK event stream
  // (bootstrap calls, real async iterable) to unit-test inline. Instead we
  // test the extracted predicate `isCatalogUpdateForDirectory` directly —
  // the transport calls it in the watch loop, so testing the predicate is
  // equivalent to testing the callback guard.
  it.effect(
    "E3: isCatalogUpdateForDirectory returns false when event directory differs from transport directory",
    () =>
      Effect.gen(function* () {
        // Correct type, wrong directory — must not fire.
        const wrongDir = { payload: { type: Command.Event.CatalogUpdated.type }, directory: "/project/b" }
        expect(isCatalogUpdateForDirectory(wrongDir, "/project/a")).toBe(false)

        // Positive witness: same directory must return true.
        const correct = { payload: { type: Command.Event.CatalogUpdated.type }, directory: "/project/a" }
        expect(isCatalogUpdateForDirectory(correct, "/project/a")).toBe(true)
      }),
  )

  // E4 — transport filter: unrelated event type must not trigger onCatalogUpdated
  it.effect(
    "E4: isCatalogUpdateForDirectory returns false for an unrelated event type",
    () =>
      Effect.gen(function* () {
        const wrongType = { payload: { type: "something.else" }, directory: "/project/a" }
        expect(isCatalogUpdateForDirectory(wrongType, "/project/a")).toBe(false)
      }),
  )
})
