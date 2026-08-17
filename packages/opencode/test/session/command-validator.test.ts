import { describe, expect, test } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { AutoSummaryStore } from "@opencode-ai/core/session/auto-summary-store"
import { PermissionDecisionsStore } from "@opencode-ai/core/session/permission-decisions-store"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LLMEvent } from "@opencode-ai/llm"
import { Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect"
import * as Stream from "effect/Stream"
import { Agent } from "../../src/agent/agent"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Permission } from "../../src/permission"
import { PermissionValidator } from "../../src/permission/validator"
import { Provider } from "../../src/provider/provider"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { InstanceStore } from "../../src/project/instance-store"
import { LLM } from "../../src/session/llm"
import { Session as SessionNs } from "../../src/session/session"
import { SessionAutoSummary } from "../../src/session/auto-summary"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { MessageID, SessionID } from "../../src/session/schema"
import { ProviderTest } from "../fake/provider"
import { testEffect } from "../lib/effect"

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

const validatorAgent: Agent.Info = {
  name: "command-validator",
  mode: "primary",
  native: true,
  hidden: true,
  temperature: 0,
  permission: [{ permission: "*", pattern: "*", action: "deny" }],
  options: {},
}

const agents = Layer.succeed(
  Agent.Service,
  Agent.Service.of({
    get: Effect.fn("TestAgent.get")(() => Effect.succeed(validatorAgent)),
    list: () => Effect.succeed([validatorAgent]),
    defaultInfo: () => Effect.succeed(validatorAgent),
    defaultAgent: () => Effect.succeed("build"),
    generate: () => Effect.die(new Error("unexpected agent generate in validator tests")),
  }),
)

const summaryCalls: string[] = []
const autoSummary = Layer.succeed(
  SessionAutoSummary.Service,
  SessionAutoSummary.Service.of({
    update: () => Effect.void,
    ensure: (sessionID) =>
      Effect.sync(() => {
        summaryCalls.push(sessionID)
      }),
  }),
)

type Make = (input: LLM.StreamInput) => Stream.Stream<LLMEvent, unknown>

function llmStub() {
  const state = {
    queue: [] as Make[],
    hits: [] as LLM.StreamInput[],
    inFlight: 0,
    maxInFlight: 0,
  }
  return {
    state,
    reset() {
      state.queue = []
      state.hits = []
      state.inFlight = 0
      state.maxInFlight = 0
    },
    push(...make: Make[]) {
      state.queue.push(...make)
    },
    layer: Layer.succeed(
      LLM.Service,
      LLM.Service.of({
        stream: (input) => {
          state.hits.push(input)
          const make = state.queue.shift()
          if (!make) return Stream.empty
          return Stream.unwrap(
            Effect.sync(() => {
              state.inFlight += 1
              if (state.inFlight > state.maxInFlight) state.maxInFlight = state.inFlight
              return make(input).pipe(
                Stream.ensuring(
                  Effect.sync(() => {
                    state.inFlight -= 1
                  }),
                ),
              )
            }),
          )
        },
      }),
    ),
  }
}

const llm = llmStub()

const text =
  (value: string): Make =>
  () =>
    Stream.make(LLMEvent.textDelta({ id: "txt-0", text: value }))

const gated =
  (gate: Deferred.Deferred<void>, onStart: () => void): Make =>
  (input) =>
    Stream.unwrap(
      Effect.gen(function* () {
        void input
        onStart()
        yield* Deferred.await(gate)
        return Stream.make(LLMEvent.textDelta({ id: "txt-0", text: "ALLOW" }))
      }),
    )

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      SessionNs.node,
      SessionProjector.node,
      Permission.node,
      PermissionValidator.node,
      Database.node,
      AutoSummaryStore.node,
      PermissionDecisionsStore.node,
      EventV2Bridge.node,
      CrossSpawnSpawner.node,
      InstanceStore.node,
    ]),
    [
      [LLM.node, llm.layer],
      [Agent.node, agents],
      [
        Provider.node,
        ProviderTest.fake({ model: ProviderTest.model({ id: ref.modelID, providerID: ref.providerID }) }).layer,
      ],
      [SessionAutoSummary.node, autoSummary],
      [
        InstanceStore.bootstrapNode,
        Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void })),
      ],
    ],
  ),
)

// Same graph with bounded validator waits, so the ask-deadline and
// health-cache tests don't sit through production timeouts.
const itFast = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      SessionNs.node,
      SessionProjector.node,
      Permission.node,
      PermissionValidator.node,
      Database.node,
      AutoSummaryStore.node,
      PermissionDecisionsStore.node,
      EventV2Bridge.node,
      CrossSpawnSpawner.node,
      InstanceStore.node,
    ]),
    [
      [LLM.node, llm.layer],
      [Agent.node, agents],
      [
        Provider.node,
        ProviderTest.fake({ model: ProviderTest.model({ id: ref.modelID, providerID: ref.providerID }) }).layer,
      ],
      [SessionAutoSummary.node, autoSummary],
      [
        InstanceStore.bootstrapNode,
        Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void })),
      ],
      [PermissionValidator.node, PermissionValidator.nodeWith({ askTimeout: 1_000, healthCacheTtl: 600 })],
    ],
  ),
)

// Same graph as itFast, with the audit store broken: covers the
// allow-without-evidence degradation.
const brokenDecisions = Layer.succeed(
  PermissionDecisionsStore.Service,
  PermissionDecisionsStore.Service.of({
    insert: () => Effect.die(new Error("disk full")),
    listBySession: () => Effect.succeed([]),
  }),
)

const itBroken = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      SessionNs.node,
      SessionProjector.node,
      Permission.node,
      PermissionValidator.node,
      Database.node,
      AutoSummaryStore.node,
      PermissionDecisionsStore.node,
      EventV2Bridge.node,
      CrossSpawnSpawner.node,
      InstanceStore.node,
    ]),
    [
      [LLM.node, llm.layer],
      [Agent.node, agents],
      [
        Provider.node,
        ProviderTest.fake({ model: ProviderTest.model({ id: ref.modelID, providerID: ref.providerID }) }).layer,
      ],
      [SessionAutoSummary.node, autoSummary],
      [
        InstanceStore.bootstrapNode,
        Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void })),
      ],
      [PermissionDecisionsStore.node, brokenDecisions],
    ],
  ),
)

const ask = (input: Partial<PermissionV1.AskInput> & Pick<PermissionV1.AskInput, "sessionID">) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.ask({
      permission: "bash",
      patterns: ["ls -la"],
      metadata: {},
      always: [],
      ruleset: [],
      ...input,
    })
  })

const reply = (input: Parameters<Permission.Interface["reply"]>[0]) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.reply(input)
  })

const fail = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const exit = yield* self.pipe(Effect.exit)
    if (Exit.isFailure(exit)) return Cause.squash(exit.cause)
    throw new Error("expected permission effect to fail")
  })

const waitForPending = (count: number) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* Effect.gen(function* () {
      while (true) {
        const list = yield* permission.list()
        if (list.length === count) return list
        yield* Effect.sleep("10 millis")
      }
    }).pipe(
      Effect.timeoutOrElse({
        duration: "2 seconds",
        orElse: () => Effect.fail(new Error(`timed out waiting for ${count} pending permission request(s)`)),
      }),
    )
  })

const poll = (cond: () => boolean, message: string) =>
  Effect.gen(function* () {
    while (!cond()) {
      yield* Effect.sleep("10 millis")
    }
  }).pipe(
    Effect.timeoutOrElse({
      duration: "2 seconds",
      orElse: () => Effect.fail(new Error(message)),
    }),
  )

const seedAutoSession = Effect.fn("test.seedAutoSession")(function* () {
  const sessions = yield* SessionNs.Service
  const chat = yield* sessions.create({})
  yield* sessions.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: chat.id,
    agent: "auto",
    model: ref,
    time: { created: Date.now() },
  })
  return chat
})

describe("command-validator parseVerdict", () => {
  const cases: Array<[string, ReturnType<typeof PermissionValidator.parseVerdict>]> = [
    ["ALLOW", { verdict: "allow" }],
    ["allow", { verdict: "allow" }],
    ["DENY apaga o home do usuário", { verdict: "deny", reason: "apaga o home do usuário" }],
    ["deny força destrutiva", { verdict: "deny", reason: "força destrutiva" }],
    ["UNCERTAIN comando ambíguo", { verdict: "uncertain", reason: "comando ambíguo" }],
    ["<think>some reasoning</think>\nALLOW", { verdict: "allow" }],
    [
      "<think>multi\nline\nreasoning</think>\nUNCERTAIN preciso de contexto",
      { verdict: "uncertain", reason: "preciso de contexto" },
    ],
    ["UNCERTAIN dúvida\nALLOW", { verdict: "uncertain", reason: "dúvida" }],
    ["\n\nDENY perigoso\n", { verdict: "deny", reason: "perigoso" }],
    ["ALLOW now", undefined],
    ["DENY", undefined],
    ["UNCERTAIN", undefined],
    ["I think you should ALLOW", undefined],
    ["", undefined],
    ["<think>only reasoning</think>", undefined],
  ]
  for (const [input, expected] of cases) {
    test(JSON.stringify(input), () => {
      expect(PermissionValidator.parseVerdict(input)).toEqual(expected)
    })
  }
})

it.instance(
  "static deny never calls the validator",
  () =>
    Effect.gen(function* () {
      llm.reset()
      summaryCalls.length = 0
      const err = yield* fail(
        ask({
          sessionID: SessionID.make("ses_static_deny"),
          agent: "auto",
          ruleset: [{ permission: "bash", pattern: "*", action: "deny" }],
        }),
      )
      expect(err).toBeInstanceOf(PermissionV1.DeniedError)
      expect(llm.state.hits).toHaveLength(0)
      expect(summaryCalls).toHaveLength(0)
    }),
  { git: true },
)

it.instance(
  "static allow never calls the validator",
  () =>
    Effect.gen(function* () {
      llm.reset()
      summaryCalls.length = 0
      yield* ask({
        sessionID: SessionID.make("ses_static_allow"),
        agent: "auto",
        ruleset: [{ permission: "bash", pattern: "*", action: "allow" }],
      })
      expect(llm.state.hits).toHaveLength(0)
      expect(summaryCalls).toHaveLength(0)
    }),
  { git: true },
)

it.instance(
  "build mode opens the human flow without the validator or audit rows",
  () =>
    Effect.gen(function* () {
      llm.reset()
      summaryCalls.length = 0
      const decisions = yield* PermissionDecisionsStore.Service
      const fiber = yield* ask({
        id: PermissionV1.ID.make("per_build_mode"),
        sessionID: SessionID.make("ses_build_mode"),
        agent: "build",
      }).pipe(Effect.forkScoped)

      const items = yield* waitForPending(1)
      expect(items[0].auto).toBeUndefined()
      expect(llm.state.hits).toHaveLength(0)
      expect(summaryCalls).toHaveLength(0)
      yield* reply({ requestID: PermissionV1.ID.make("per_build_mode"), reply: "once" })
      yield* Fiber.join(fiber)
      expect(yield* decisions.listBySession(SessionID.make("ses_build_mode"))).toHaveLength(0)
    }),
  { git: true },
)

it.instance(
  "ALLOW executes the tool and audits the decision",
  () =>
    Effect.gen(function* () {
      llm.reset()
      summaryCalls.length = 0
      const summaries = yield* AutoSummaryStore.Service
      const decisions = yield* PermissionDecisionsStore.Service
      const chat = yield* seedAutoSession()
      yield* summaries.upsert({
        sessionID: chat.id,
        summary: "WORK SO FAR",
        model: "test/test-model",
        turnCount: 1,
      })
      llm.push(text("ALLOW"))

      yield* ask({ sessionID: chat.id, agent: "auto", patterns: ["ls -la"], metadata: { command: "ls -la" } })

      expect(llm.state.hits).toHaveLength(1)
      const body = JSON.stringify(llm.state.hits[0].messages)
      expect(body).toContain("ls -la")
      expect(body).toContain("WORK SO FAR")
      expect(summaryCalls).toEqual([chat.id])

      const rows = yield* decisions.listBySession(chat.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        sessionID: chat.id,
        permission: "bash",
        patterns: ["ls -la"],
        metadata: { command: "ls -la" },
        verdict: "allow",
        model: "test/test-model",
      })
      expect(rows[0].latencyMs).toBeGreaterThanOrEqual(0)
      expect(rows[0].createdAt).toBeGreaterThan(0)
      expect(rows[0].id.length).toBeGreaterThan(0)
      expect(rows[0].prompt).toContain("ls -la")
      expect(rows[0].prompt).toContain("WORK SO FAR")
    }),
  { git: true },
)

it.instance(
  "uses a persisted session validator model without changing the session model",
  () =>
    Effect.gen(function* () {
      llm.reset()
      const sessions = yield* SessionNs.Service
      const decisions = yield* PermissionDecisionsStore.Service
      const chat = yield* seedAutoSession()
      yield* sessions.setPermissionValidator({
        sessionID: chat.id,
        config: { mode: "model", model: "test/test-model" },
      })
      llm.push(text("ALLOW"))

      yield* ask({ sessionID: chat.id, agent: "auto" })

      expect(llm.state.hits[0]?.model).toMatchObject({
        providerID: "test",
        id: "test-model",
      })
      expect((yield* sessions.get(chat.id)).model).toEqual(undefined)
      expect((yield* decisions.listBySession(chat.id))[0]?.model).toBe("test/test-model")
    }),
  { git: true },
)

it.instance(
  "disabled session validator skips the LLM and keeps the human permission flow",
  () =>
    Effect.gen(function* () {
      llm.reset()
      const sessions = yield* SessionNs.Service
      const decisions = yield* PermissionDecisionsStore.Service
      const chat = yield* seedAutoSession()
      yield* sessions.setPermissionValidator({
        sessionID: chat.id,
        config: { mode: "disabled" },
      })

      const fiber = yield* ask({ sessionID: chat.id, agent: "auto" }).pipe(Effect.forkScoped)
      const items = yield* waitForPending(1)

      expect(items[0].auto).toBeUndefined()
      expect(llm.state.hits).toHaveLength(0)
      expect(yield* decisions.listBySession(chat.id)).toHaveLength(0)
      yield* reply({ requestID: items[0].id, reply: "once" })
      yield* Fiber.join(fiber)
    }),
  { git: true },
)

it.instance(
  "audits the tool callID in metadata for transcript correlation",
  () =>
    Effect.gen(function* () {
      llm.reset()
      summaryCalls.length = 0
      const decisions = yield* PermissionDecisionsStore.Service
      const chat = yield* seedAutoSession()
      llm.push(text("ALLOW"))

      yield* ask({
        sessionID: chat.id,
        agent: "auto",
        metadata: { command: "ls" },
        tool: { messageID: "msg_test", callID: "call_test" },
      })

      const rows = yield* decisions.listBySession(chat.id)
      expect(rows).toHaveLength(1)
      expect(rows[0].metadata).toEqual({ command: "ls", callID: "call_test" })
    }),
  { git: true },
)

it.instance(
  "ALLOW learns the exact pattern: an identical ask skips the validator and writes no new audit row",
  () =>
    Effect.gen(function* () {
      llm.reset()
      summaryCalls.length = 0
      const decisions = yield* PermissionDecisionsStore.Service
      const chat = yield* seedAutoSession()
      llm.push(text("ALLOW"))

      yield* ask({ sessionID: chat.id, agent: "auto", patterns: ["ls -la"], metadata: { command: "ls -la" } })
      expect(llm.state.hits).toHaveLength(1)

      yield* ask({ sessionID: chat.id, agent: "auto", patterns: ["ls -la"], metadata: { command: "ls -la" } })
      expect(llm.state.hits).toHaveLength(1)
      expect(yield* decisions.listBySession(chat.id)).toHaveLength(1)
    }),
  { git: true },
)

it.instance(
  "ALLOW does not learn wildcard patterns: the validator runs again",
  () =>
    Effect.gen(function* () {
      llm.reset()
      summaryCalls.length = 0
      const chat = yield* seedAutoSession()
      llm.push(text("ALLOW"))

      yield* ask({ sessionID: chat.id, agent: "auto", patterns: ["ls *.ts"], metadata: { command: "ls *.ts" } })
      expect(llm.state.hits).toHaveLength(1)

      llm.push(text("ALLOW"))
      yield* ask({ sessionID: chat.id, agent: "auto", patterns: ["ls *.ts"], metadata: { command: "ls *.ts" } })
      expect(llm.state.hits).toHaveLength(2)
    }),
  { git: true },
)

it.instance(
  "ALLOW does not broaden: a different command still reaches the validator",
  () =>
    Effect.gen(function* () {
      llm.reset()
      summaryCalls.length = 0
      const chat = yield* seedAutoSession()
      llm.push(text("ALLOW"))

      yield* ask({ sessionID: chat.id, agent: "auto", patterns: ["ls -la"], metadata: { command: "ls -la" } })
      expect(llm.state.hits).toHaveLength(1)

      llm.push(text("ALLOW"))
      yield* ask({ sessionID: chat.id, agent: "auto", patterns: ["ls -la src"], metadata: { command: "ls -la src" } })
      expect(llm.state.hits).toHaveLength(2)
    }),
  { git: true },
)

it.instance(
  "DENY fails with CorrectedError carrying the reason",
  () =>
    Effect.gen(function* () {
      llm.reset()
      summaryCalls.length = 0
      const permission = yield* Permission.Service
      const decisions = yield* PermissionDecisionsStore.Service
      const chat = yield* seedAutoSession()
      llm.push(text("DENY apaga o home do usuário"))

      const err = yield* fail(ask({ sessionID: chat.id, agent: "auto", patterns: ["rm -rf ~"] }))

      expect(err).toBeInstanceOf(PermissionV1.CorrectedError)
      expect(String(err)).toContain("apaga o home do usuário")
      expect(yield* permission.list()).toHaveLength(0)
      const rows = yield* decisions.listBySession(chat.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ verdict: "deny", reason: "apaga o home do usuário", model: "test/test-model" })
    }),
  { git: true },
)

it.instance(
  "UNCERTAIN escalates to the human flow with the reason attached",
  () =>
    Effect.gen(function* () {
      llm.reset()
      summaryCalls.length = 0
      const decisions = yield* PermissionDecisionsStore.Service
      const chat = yield* seedAutoSession()
      llm.push(text("UNCERTAIN comando ambíguo"))

      const fiber = yield* ask({ sessionID: chat.id, agent: "auto", patterns: ["git push --force"] }).pipe(
        Effect.forkScoped,
      )

      const items = yield* waitForPending(1)
      expect(items[0].auto).toEqual({
        verdict: "uncertain",
        reason: "comando ambíguo",
        model: "test/test-model",
      })
      const rows = yield* decisions.listBySession(chat.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ verdict: "uncertain", reason: "comando ambíguo" })

      yield* reply({ requestID: items[0].id, reply: "once" })
      yield* Fiber.join(fiber)
    }),
  { git: true },
)

it.instance(
  "stream error falls back to the human flow and audits fallback",
  () =>
    Effect.gen(function* () {
      llm.reset()
      summaryCalls.length = 0
      const decisions = yield* PermissionDecisionsStore.Service
      const chat = yield* seedAutoSession()
      llm.push(() => Stream.fail(new Error("boom")))

      const fiber = yield* ask({ sessionID: chat.id, agent: "auto" }).pipe(Effect.forkScoped)

      const items = yield* waitForPending(1)
      expect(items[0].auto).toEqual({ verdict: "fallback", reason: "error", model: "test/test-model" })
      const rows = yield* decisions.listBySession(chat.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ verdict: "fallback", reason: "error" })

      yield* reply({ requestID: items[0].id, reply: "once" })
      yield* Fiber.join(fiber)
    }),
  { git: true },
)

it.instance(
  "invalid verdict output falls back to the human flow",
  () =>
    Effect.gen(function* () {
      llm.reset()
      summaryCalls.length = 0
      const decisions = yield* PermissionDecisionsStore.Service
      const chat = yield* seedAutoSession()
      llm.push(text("I cannot decide about this command"))

      const fiber = yield* ask({ sessionID: chat.id, agent: "auto" }).pipe(Effect.forkScoped)

      const items = yield* waitForPending(1)
      expect(items[0].auto?.verdict).toBe("fallback")
      expect(items[0].auto?.reason).toBe("invalid")
      const rows = yield* decisions.listBySession(chat.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ verdict: "fallback", reason: "invalid" })

      yield* reply({ requestID: items[0].id, reply: "once" })
      yield* Fiber.join(fiber)
    }),
  { git: true },
)

it.instance(
  "think blocks and trailing lines parse through the stream",
  () =>
    Effect.gen(function* () {
      llm.reset()
      summaryCalls.length = 0
      const decisions = yield* PermissionDecisionsStore.Service
      const chat = yield* seedAutoSession()
      llm.push(text("<think>let me analyze this command</think>\nALLOW\nALLOW is my answer"))

      yield* ask({ sessionID: chat.id, agent: "auto" })

      const rows = yield* decisions.listBySession(chat.id)
      expect(rows).toHaveLength(1)
      expect(rows[0].verdict).toBe("allow")
    }),
  { git: true },
)

it.instance(
  "validations run serially per session and audit in arrival order",
  () =>
    Effect.gen(function* () {
      llm.reset()
      summaryCalls.length = 0
      const decisions = yield* PermissionDecisionsStore.Service
      const chat = yield* seedAutoSession()
      const started: string[] = []
      const one = yield* Deferred.make<void>()
      const two = yield* Deferred.make<void>()
      const three = yield* Deferred.make<void>()
      llm.push(
        gated(one, () => started.push("one")),
        gated(two, () => started.push("two")),
        gated(three, () => started.push("three")),
      )

      const a = yield* ask({ sessionID: chat.id, agent: "auto", patterns: ["cmd-one"] }).pipe(Effect.forkScoped)
      yield* poll(() => started.length === 1, "first validation never started")
      const b = yield* ask({ sessionID: chat.id, agent: "auto", patterns: ["cmd-two"] }).pipe(Effect.forkScoped)
      yield* Effect.sleep("50 millis")
      const c = yield* ask({ sessionID: chat.id, agent: "auto", patterns: ["cmd-three"] }).pipe(Effect.forkScoped)
      yield* Effect.sleep("50 millis")
      expect(started).toEqual(["one"])

      yield* Deferred.succeed(one, undefined)
      yield* poll(() => started.length === 2, "second validation never started")
      expect(started).toEqual(["one", "two"])
      yield* Deferred.succeed(two, undefined)
      yield* poll(() => started.length === 3, "third validation never started")
      expect(started).toEqual(["one", "two", "three"])
      yield* Deferred.succeed(three, undefined)

      yield* Effect.all([Fiber.join(a), Fiber.join(b), Fiber.join(c)])
      expect(llm.state.maxInFlight).toBe(1)
      const rows = yield* decisions.listBySession(chat.id)
      expect(rows.map((row) => row.patterns[0])).toEqual(["cmd-one", "cmd-two", "cmd-three"])
    }),
  { git: true },
)

it.instance(
  "a truncated payload escalates to uncertain without calling the model",
  () =>
    Effect.gen(function* () {
      llm.reset()
      summaryCalls.length = 0
      const decisions = yield* PermissionDecisionsStore.Service
      const chat = yield* seedAutoSession()
      // Benign prefix, destructive suffix past the per-pattern cap: the model
      // would only see the safe part, so the validator must not call it.
      const command = `echo ${"harmless ".repeat(300)} && rm -rf ~`

      const fiber = yield* ask({ sessionID: chat.id, agent: "auto", patterns: [command], metadata: { command } }).pipe(
        Effect.forkScoped,
      )

      const items = yield* waitForPending(1)
      expect(items[0].auto).toEqual({ verdict: "uncertain", reason: "payload truncated", model: "test/test-model" })
      expect(llm.state.hits).toHaveLength(0)
      const rows = yield* decisions.listBySession(chat.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ verdict: "uncertain", reason: "payload truncated", model: "test/test-model" })

      yield* reply({ requestID: items[0].id, reply: "once" })
      yield* Fiber.join(fiber)
    }),
  { git: true },
)

itBroken.instance(
  "an ALLOW without its audit row degrades to the human flow",
  () =>
    Effect.gen(function* () {
      llm.reset()
      summaryCalls.length = 0
      const chat = yield* seedAutoSession()
      llm.push(text("ALLOW"))

      const fiber = yield* ask({ sessionID: chat.id, agent: "auto" }).pipe(Effect.forkScoped)

      const items = yield* waitForPending(1)
      expect(items[0].auto).toEqual({ verdict: "fallback", reason: "audit", model: "test/test-model" })

      yield* reply({ requestID: items[0].id, reply: "once" })
      yield* Fiber.join(fiber)
    }),
  { git: true },
)
itFast.instance(
  "an ask that exceeds the total deadline falls back and the queue keeps draining",
  () =>
    Effect.gen(function* () {
      llm.reset()
      summaryCalls.length = 0
      const decisions = yield* PermissionDecisionsStore.Service
      const chat = yield* seedAutoSession()
      const started: string[] = []
      const one = yield* Deferred.make<void>()
      const two = yield* Deferred.make<void>()
      // Pre-succeeded so the third stub records its start and emits at once.
      const three = yield* Deferred.make<void>()
      yield* Deferred.succeed(three, undefined)
      llm.push(
        gated(one, () => started.push("one")),
        gated(two, () => started.push("two")),
        gated(three, () => started.push("three")),
      )

      const a = yield* ask({ sessionID: chat.id, agent: "auto", patterns: ["cmd-one"] }).pipe(Effect.forkScoped)
      yield* poll(() => started.length === 1, "first validation never started")
      const b = yield* ask({ sessionID: chat.id, agent: "auto", patterns: ["cmd-two"] }).pipe(Effect.forkScoped)
      yield* Effect.sleep("100 millis")
      expect(started).toEqual(["one"])
      const c = yield* ask({ sessionID: chat.id, agent: "auto", patterns: ["cmd-three"] }).pipe(Effect.forkScoped)
      yield* Effect.sleep("100 millis")
      expect(started).toEqual(["one"])

      // a finishes well inside its deadline; b stalls on the model until its
      // total budget (queue wait + validation) expires ~1s after entry.
      yield* Deferred.succeed(one, undefined)
      yield* poll(() => started.length === 2, "second validation never started")

      // c is queued behind b's tail; b's expiry must release it, not hang it.
      yield* poll(() => started.length === 3, "third validation never ran after the second expired")
      yield* Effect.all([Fiber.join(a), Fiber.join(c)])

      const items = yield* waitForPending(1)
      expect(items[0].auto).toEqual({ verdict: "fallback", reason: "timeout", model: "unknown" })
      yield* reply({ requestID: items[0].id, reply: "once" })
      yield* Fiber.join(b)

      expect(llm.state.maxInFlight).toBe(1)
      // b's expiry audit is fire-and-forget (it must not extend the
      // deadline), so poll until it lands.
      const rows = yield* Effect.gen(function* () {
        while (true) {
          const rows = yield* decisions.listBySession(chat.id)
          if (rows.length === 3) return rows
          yield* Effect.sleep("10 millis")
        }
      }).pipe(
        Effect.timeoutOrElse({
          duration: "2 seconds",
          orElse: () => Effect.fail(new Error("expired ask's audit row never landed")),
        }),
      )
      // b's expiry audit and c's audit race at the deadline, so compare by
      // pattern rather than row order.
      const byPattern = new Map(rows.map((row) => [row.patterns[0], row]))
      expect(byPattern.get("cmd-one")?.verdict).toBe("allow")
      expect(byPattern.get("cmd-two")).toMatchObject({ verdict: "fallback", reason: "timeout", model: "unknown" })
      expect(byPattern.get("cmd-three")?.verdict).toBe("allow")
    }),
  { git: true },
)

itFast.instance(
  "health caches the probe within the TTL and re-probes after it",
  () =>
    Effect.gen(function* () {
      llm.reset()
      const validator = yield* PermissionValidator.Service

      llm.push(text("ALLOW"))
      const first = yield* validator.health()
      expect(first).toEqual({ ok: true, model: "test/test-model" })
      expect(llm.state.hits[0].sessionID).toBe("ses_validator_health")

      // Inside the TTL the cached answer rides again — no new model call.
      const second = yield* validator.health()
      expect(second).toEqual(first)
      expect(llm.state.hits).toHaveLength(1)

      // Past the TTL the next call probes again and caches the failure too.
      yield* Effect.sleep("700 millis")
      llm.push(() => Stream.fail(new Error("down")))
      const third = yield* validator.health()
      expect(third).toEqual({ ok: false, model: "test/test-model", reason: "down" })
      expect(llm.state.hits).toHaveLength(2)
    }),
  { git: true },
)

itFast.instance(
  "health demands a parseable verdict, not just any stream",
  () =>
    Effect.gen(function* () {
      llm.reset()
      const validator = yield* PermissionValidator.Service

      llm.push(text("I cannot decide about this"))
      const garbage = yield* validator.health()
      expect(garbage).toEqual({ ok: false, model: "test/test-model", reason: "unparseable verdict" })

      // Past the cache TTL: an empty stream is not healthy either.
      yield* Effect.sleep("700 millis")
      llm.push(() => Stream.empty)
      const empty = yield* validator.health()
      expect(empty.ok).toBe(false)
      expect(empty.reason).toBe("unparseable verdict")
      expect(llm.state.hits).toHaveLength(2)
    }),
  { git: true },
)
