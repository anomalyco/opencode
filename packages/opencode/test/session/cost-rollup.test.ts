import { describe, expect } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect } from "effect"
import { Session as SessionNs } from "@/session/session"
import { MessageID, PartID, type SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { InstanceStore } from "@/project/instance-store"
import { InstanceBootstrap } from "@/project/bootstrap"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Layer } from "effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      SessionNs.node,
      EventV2Bridge.node,
      SessionProjector.node,
      CrossSpawnSpawner.node,
      InstanceStore.node,
    ]),
    [
      [RuntimeFlags.node, RuntimeFlags.layer({ experimentalWorkspaces: false })],
      [
        InstanceBootstrap.node,
        Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void })),
      ],
    ],
  ),
)

function makeUserMessage(sessionID: SessionID) {
  return {
    id: MessageID.ascending(),
    sessionID,
    role: "user" as const,
    time: { created: Date.now() },
    agent: "user",
    model: { providerID: "test", modelID: "test" },
    tools: {},
    mode: "",
  } as unknown as SessionV1.Info
}

function makeStepFinishPart(sessionID: SessionID, messageID: string, cost = 0.01) {
  return {
    id: PartID.ascending(),
    messageID,
    sessionID,
    type: "step-finish" as const,
    reason: "stop",
    cost,
    tokens: { total: 300, input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
  }
}

function setupSessionWithCost(session: SessionNs.Service, sessionID: SessionID, cost = 0.01) {
  return Effect.gen(function* () {
    const userMsg = makeUserMessage(sessionID)
    yield* session.updateMessage(userMsg)
    yield* session.updatePart(makeStepFinishPart(sessionID, userMsg.id, cost))
  })
}

describe("fork cost double-counting", () => {
  it.instance("fork zeroes cost on cloned step-finish parts", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const created = yield* Effect.acquireRelease(session.create({}), (info) =>
        session.remove(info.id).pipe(Effect.ignore),
      )

      yield* setupSessionWithCost(session, created.id, 0.05)

      const fork = yield* Effect.acquireRelease(session.fork({ sessionID: created.id }), (info) =>
        session.remove(info.id).pipe(Effect.ignore),
      )

      const forkedMessages = yield* session.messages({ sessionID: fork.id })
      const stepFinishPart = forkedMessages
        .flatMap((m) => m.parts)
        .find((p) => p.type === "step-finish")
      expect(stepFinishPart).toBeDefined()
      expect(stepFinishPart!.cost).toBe(0)
    }),
  )

  it.instance("fork does not inflate session.cost beyond post-fork spend", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const created = yield* Effect.acquireRelease(session.create({}), (info) =>
        session.remove(info.id).pipe(Effect.ignore),
      )

      yield* setupSessionWithCost(session, created.id, 0.05)

      const fork = yield* Effect.acquireRelease(session.fork({ sessionID: created.id }), (info) =>
        session.remove(info.id).pipe(Effect.ignore),
      )

      const forkInfo = yield* session.get(fork.id)
      expect(forkInfo.cost ?? 0).toBe(0)
    }),
  )
})

describe("totalCost rollup", () => {
  it.instance("returns own cost when no children exist", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const created = yield* Effect.acquireRelease(session.create({}), (info) =>
        session.remove(info.id).pipe(Effect.ignore),
      )

      yield* setupSessionWithCost(session, created.id, 0.03)

      const result = yield* session.totalCost(created.id)
      expect(result.cost).toBe(0.03)
    }),
  )

  it.instance("includes child session costs", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const parent = yield* Effect.acquireRelease(session.create({}), (info) =>
        session.remove(info.id).pipe(Effect.ignore),
      )

      yield* setupSessionWithCost(session, parent.id, 0.02)

      const child = yield* Effect.acquireRelease(
        session.create({ parentID: parent.id }),
        (info) => session.remove(info.id).pipe(Effect.ignore),
      )

      yield* setupSessionWithCost(session, child.id, 0.04)

      const result = yield* session.totalCost(parent.id)
      expect(result.cost).toBeCloseTo(0.06, 10)
    }),
  )

  it.instance("includes nested child session costs", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const root = yield* Effect.acquireRelease(session.create({}), (info) =>
        session.remove(info.id).pipe(Effect.ignore),
      )

      yield* setupSessionWithCost(session, root.id, 0.01)

      const child = yield* Effect.acquireRelease(
        session.create({ parentID: root.id }),
        (info) => session.remove(info.id).pipe(Effect.ignore),
      )

      yield* setupSessionWithCost(session, child.id, 0.02)

      const grandchild = yield* Effect.acquireRelease(
        session.create({ parentID: child.id }),
        (info) => session.remove(info.id).pipe(Effect.ignore),
      )

      yield* setupSessionWithCost(session, grandchild.id, 0.03)

      const result = yield* session.totalCost(root.id)
      expect(result.cost).toBeCloseTo(0.06, 10)
    }),
  )
})

describe("e2e: subagent cost rollup via session hierarchy", () => {
  it.instance("totalCost includes costs from multiple child sessions (subagent scenario)", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const parent = yield* Effect.acquireRelease(session.create({}), (info) =>
        session.remove(info.id).pipe(Effect.ignore),
      )

      yield* setupSessionWithCost(session, parent.id, 0.01)

      const child1 = yield* Effect.acquireRelease(
        session.create({ parentID: parent.id, title: "subagent 1" }),
        (info) => session.remove(info.id).pipe(Effect.ignore),
      )
      yield* setupSessionWithCost(session, child1.id, 0.03)

      const child2 = yield* Effect.acquireRelease(
        session.create({ parentID: parent.id, title: "subagent 2" }),
        (info) => session.remove(info.id).pipe(Effect.ignore),
      )
      yield* setupSessionWithCost(session, child2.id, 0.05)

      const result = yield* session.totalCost(parent.id)
      expect(result.cost).toBeCloseTo(0.09, 10)

      const tokens = result.tokens
      expect(tokens.input).toBe(300)
      expect(tokens.output).toBe(600)
    }),
  )

  it.instance("totalCost tokens accumulate across child sessions", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const parent = yield* Effect.acquireRelease(session.create({}), (info) =>
        session.remove(info.id).pipe(Effect.ignore),
      )
      yield* setupSessionWithCost(session, parent.id, 0.01)

      const child = yield* Effect.acquireRelease(
        session.create({ parentID: parent.id }),
        (info) => session.remove(info.id).pipe(Effect.ignore),
      )
      yield* setupSessionWithCost(session, child.id, 0.02)

      const result = yield* session.totalCost(parent.id)
      expect(result.tokens.input).toBe(200)
      expect(result.tokens.output).toBe(400)
      expect(result.tokens.cache.read).toBe(0)
      expect(result.tokens.cache.write).toBe(0)
    }),
  )
})

describe("e2e: fork with subagent history", () => {
  it.instance("fork of a session with child subagent costs does not double-count", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const parent = yield* Effect.acquireRelease(session.create({}), (info) =>
        session.remove(info.id).pipe(Effect.ignore),
      )

      yield* setupSessionWithCost(session, parent.id, 0.01)

      const child = yield* Effect.acquireRelease(
        session.create({ parentID: parent.id }),
        (info) => session.remove(info.id).pipe(Effect.ignore),
      )
      yield* setupSessionWithCost(session, child.id, 0.04)

      const fork = yield* Effect.acquireRelease(session.fork({ sessionID: parent.id }), (info) =>
        session.remove(info.id).pipe(Effect.ignore),
      )

      const forkInfo = yield* session.get(fork.id)
      expect(forkInfo.cost ?? 0).toBe(0)

      const forkTotal = yield* session.totalCost(fork.id)
      expect(forkTotal.cost).toBe(0)

      const parentTotal = yield* session.totalCost(parent.id)
      expect(parentTotal.cost).toBeCloseTo(0.05, 10)
    }),
  )

  it.instance("fork then add subagent: fork total only includes own + new children", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const original = yield* Effect.acquireRelease(session.create({}), (info) =>
        session.remove(info.id).pipe(Effect.ignore),
      )
      yield* setupSessionWithCost(session, original.id, 0.02)

      const fork = yield* Effect.acquireRelease(session.fork({ sessionID: original.id }), (info) =>
        session.remove(info.id).pipe(Effect.ignore),
      )

      const forkChild = yield* Effect.acquireRelease(
        session.create({ parentID: fork.id }),
        (info) => session.remove(info.id).pipe(Effect.ignore),
      )
      yield* setupSessionWithCost(session, forkChild.id, 0.03)

      const originalTotal = yield* session.totalCost(original.id)
      expect(originalTotal.cost).toBeCloseTo(0.02, 10)

      const forkTotal = yield* session.totalCost(fork.id)
      expect(forkTotal.cost).toBeCloseTo(0.03, 10)
    }),
  )
})
