import { afterEach, describe, expect, mock } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect, Layer } from "effect"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionCompaction } from "@/session/compaction"
import { SessionHandoff } from "@/session/handoff"
import { SessionPrompt } from "@/session/prompt"
import { MessageID, PartID, type SessionID } from "@/session/schema"
import { Session as SessionNs } from "@/session/session"
import { testEffect } from "../lib/effect"

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

const handoffNode = LayerNode.group([
  SessionHandoff.node,
  SessionNs.node,
  SessionCompaction.node,
  SessionProjector.node,
  Database.node,
  EventV2Bridge.node,
  CrossSpawnSpawner.node,
])

// Handoff reads the summary back from storage and ignores what loop returns, so the
// stub only needs a well-formed placeholder here.
const loopResult = (sessionID: SessionID): SessionV1.WithParts => ({
  info: {
    id: MessageID.ascending(),
    sessionID,
    role: "user",
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  },
  parts: [],
})

// SessionPrompt.loop drives the whole provider stack, so tests stub the single call
// handoff makes. The stub stands in for compaction's model turn and writes whatever
// summary the scenario needs.
function env(onLoop: (sessionID: SessionID) => Effect.Effect<void>) {
  const stub = Layer.mock(SessionPrompt.Service)({
    loop: (input) => onLoop(input.sessionID).pipe(Effect.orDie, Effect.as(loopResult(input.sessionID))),
  })
  return AppNodeBuilder.build(handoffNode, [
    [RuntimeFlags.node, RuntimeFlags.layer({ experimentalEventSystem: true })],
    [SessionPrompt.node, stub],
  ])
}

const addUser = Effect.fn("Test.addUser")(function* (sessionID: SessionID, text: string) {
  const sessions = yield* SessionNs.Service
  const message = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: message.id,
    sessionID,
    type: "text",
    text,
  })
  return message.id
})

const addCompaction = Effect.fn("Test.addCompaction")(function* (input: {
  sessionID: SessionID
  tailStartID?: MessageID
}) {
  const sessions = yield* SessionNs.Service
  const message = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: input.sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: message.id,
    sessionID: input.sessionID,
    type: "compaction",
    auto: false,
    tail_start_id: input.tailStartID,
  } satisfies SessionV1.CompactionPart)
  return message.id
})

const addSummary = Effect.fn("Test.addSummary")(function* (sessionID: SessionID, parentID: MessageID, text: string) {
  const sessions = yield* SessionNs.Service
  const message = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    role: "assistant",
    sessionID,
    mode: "compaction",
    agent: "compaction",
    path: { cwd: "/tmp", root: "/tmp" },
    cost: 0,
    tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    parentID,
    summary: true,
    finish: "end_turn",
    time: { created: Date.now() },
  })
  yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: message.id,
    sessionID,
    type: "text",
    text,
  })
  return message.id
})

// Stands in for a real compaction turn: the marker user message already exists by the
// time loop runs, so the stub only has to attach the summary assistant reply. The
// service is resolved through the shared runtime so the stub writes to the same store.
const writeSummaryOnLoop = (text: string) => (sessionID: SessionID) =>
  Effect.gen(function* () {
    const sessions = yield* SessionNs.Service
    const messages = yield* sessions.messages({ sessionID })
    const marker = messages.findLast((message) => message.parts.some((part) => part.type === "compaction"))
    if (!marker) throw new Error("expected a compaction marker before the summary turn")
    yield* addSummary(sessionID, marker.info.id, text)
  }).pipe(Effect.provide(LayerNode.compile(SessionNs.node)), Effect.orDie)

const textOf = (message: SessionV1.WithParts) =>
  message.parts
    .filter((part): part is SessionV1.TextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n")

afterEach(() => {
  mock.restore()
})

describe("session handoff", () => {
  const it = testEffect(env(writeSummaryOnLoop("## Objective\n- ship the handoff command")))

  it.instance("seeds the new session with the summary as a visible message", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionNs.Service
      const handoff = yield* SessionHandoff.Service
      const created = yield* sessions.create({ title: "original" })
      yield* addUser(created.id, "please build the thing")

      const next = yield* handoff.create({ sessionID: created.id, ...ref })

      expect(next.id).not.toBe(created.id)
      // parentID means subagent, and a handoff is a sibling.
      expect(next.parentID).toBeUndefined()
      expect(next.title).toBe("original (handoff #1)")

      const seeded = yield* sessions.messages({ sessionID: next.id })
      expect(seeded).toHaveLength(1)
      expect(seeded[0].info.role).toBe("user")
      expect(textOf(seeded[0])).toContain("ship the handoff command")
      expect(textOf(seeded[0])).toContain(created.id)

      // A synthetic part renders nowhere, so the summary has to stay non-synthetic.
      const parts = seeded[0].parts.filter((part): part is SessionV1.TextPart => part.type === "text")
      expect(parts).not.toHaveLength(0)
      for (const part of parts) expect(part.synthetic).toBeFalsy()

      const original = yield* sessions.messages({ sessionID: created.id })
      expect(textOf(original.at(-1)!)).toContain(next.id)
    }),
  )

  it.instance("carries the agent and model of the handed-off session", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionNs.Service
      const handoff = yield* SessionHandoff.Service
      const created = yield* sessions.create({ title: "inherits" })
      yield* addUser(created.id, "work")

      const next = yield* handoff.create({ sessionID: created.id, ...ref })

      expect(next.agent).toBe("build")
      expect(next.model).toEqual({ id: ref.modelID, providerID: ref.providerID, variant: undefined })
    }),
  )

  it.instance("increments the handoff counter when handing off twice", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionNs.Service
      const handoff = yield* SessionHandoff.Service
      const created = yield* sessions.create({ title: "chained" })
      yield* addUser(created.id, "work")

      const first = yield* handoff.create({ sessionID: created.id, ...ref })
      expect(first.title).toBe("chained (handoff #1)")

      yield* addUser(first.id, "more work")
      const second = yield* handoff.create({ sessionID: first.id, ...ref })
      expect(second.title).toBe("chained (handoff #2)")
    }),
  )
})

describe("session handoff reuses a current summary", () => {
  const it = testEffect(env(() => Effect.die("handoff should not compact when the newest summary is already current")))

  it.instance("skips compaction when nothing happened after the newest summary", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionNs.Service
      const handoff = yield* SessionHandoff.Service
      const created = yield* sessions.create({ title: "fresh" })
      const marker = yield* addUser(created.id, "work")
      yield* addSummary(created.id, marker, "## Objective\n- already summarized")

      const next = yield* handoff.create({ sessionID: created.id, ...ref })

      const seeded = yield* sessions.messages({ sessionID: next.id })
      expect(textOf(seeded[0])).toContain("already summarized")
    }),
  )
})

describe("session handoff with retained context", () => {
  const it = testEffect(env(() => Effect.die("handoff should not compact when the newest summary is current")))

  it.instance("includes the recent transcript retained by compaction", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionNs.Service
      const handoff = yield* SessionHandoff.Service
      const created = yield* sessions.create({ title: "retained" })
      yield* addUser(created.id, "finished work")
      const current = yield* addUser(created.id, "continue the active investigation")
      const assistant = yield* sessions.updateMessage({
        id: MessageID.ascending(),
        role: "assistant",
        sessionID: created.id,
        mode: "build",
        agent: "build",
        path: { cwd: "/tmp", root: "/tmp" },
        cost: 0,
        tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: ref.modelID,
        providerID: ref.providerID,
        parentID: current,
        finish: "end_turn",
        time: { created: Date.now() },
      })
      yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: assistant.id,
        sessionID: created.id,
        type: "tool",
        callID: "call_recent",
        tool: "read",
        state: {
          status: "completed",
          input: {},
          output: "the current file contains the relevant implementation",
          title: "Read file",
          metadata: {},
          time: { start: Date.now(), end: Date.now() },
        },
      } satisfies SessionV1.ToolPart)
      const marker = yield* addCompaction({ sessionID: created.id, tailStartID: current })
      yield* addSummary(created.id, marker, "## Objective\n- continue the work")

      const next = yield* handoff.create({ sessionID: created.id, ...ref })

      const seeded = yield* sessions.messages({ sessionID: next.id })
      expect(textOf(seeded[0])).toContain("continue the work")
      expect(textOf(seeded[0])).toContain("## Recent Context")
      expect(textOf(seeded[0])).toContain("continue the active investigation")
      expect(textOf(seeded[0])).toContain("the current file contains the relevant implementation")
    }),
  )
})

describe("session handoff without a summary", () => {
  // Compaction fails on its own when history still exceeds the context window, in which
  // case loop returns without writing a summary.
  const it = testEffect(env(() => Effect.void))

  it.instance("fails and leaves no new session behind", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionNs.Service
      const handoff = yield* SessionHandoff.Service
      const created = yield* sessions.create({ title: "unsummarizable" })
      yield* addUser(created.id, "work")
      const before = yield* sessions.list({})

      const result = yield* handoff.create({ sessionID: created.id, ...ref }).pipe(Effect.result)

      expect(result._tag).toBe("Failure")
      const after = yield* sessions.list({})
      expect(after.map((item) => item.id).sort()).toEqual(before.map((item) => item.id).sort())
    }),
  )
})
