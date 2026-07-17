import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Effect, Layer } from "effect"
import { Config } from "@/config/config"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Session } from "@/session/session"
import { MessageID, PartID } from "@/session/schema"
import { SessionSummary } from "@/session/summary"
import { Snapshot } from "@/snapshot"
import { testEffect } from "../lib/effect"

const calls: Array<[string, string]> = []
const secondDiff = {
  file: "second.ts",
  patch: "second patch",
  additions: 3,
  deletions: 4,
  status: "modified" as const,
}

const it = testEffect(
  LayerNode.compile(LayerNode.group([Session.node, SessionProjector.node, SessionSummary.node, EventV2Bridge.node]), [
    [
      Snapshot.node,
      Layer.mock(Snapshot.Service, {
        diffFull: (from, to) =>
          Effect.sync(() => {
            calls.push([from, to])
            return [secondDiff]
          }),
      }),
    ],
    [
      Config.node,
      Layer.mock(Config.Service, {
        get: () => Effect.succeed({ snapshot: true }),
      }),
    ],
  ]),
)

it.instance("aggregates stored turn diffs without recomputing the full session diff", () =>
  Effect.gen(function* () {
    calls.length = 0
    const sessions = yield* Session.Service
    const summary = yield* SessionSummary.Service
    const events = yield* EventV2Bridge.Service
    const session = yield* sessions.create({})
    const firstDiff = {
      file: "first.ts",
      patch: "first patch",
      additions: 2,
      deletions: 1,
      status: "modified" as const,
    }

    const turn = Effect.fn("test.turn")(function* (input: {
      before: string
      after: string
      diffs?: (typeof firstDiff)[]
    }) {
      const user = yield* sessions.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        sessionID: session.id,
        agent: "build",
        model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
        time: { created: Date.now() },
        summary: input.diffs ? { diffs: input.diffs } : undefined,
      })
      const assistant = yield* sessions.updateMessage({
        id: MessageID.ascending(),
        role: "assistant",
        sessionID: session.id,
        parentID: user.id,
        mode: "build",
        agent: "build",
        path: { cwd: "/tmp", root: "/tmp" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: ModelV2.ID.make("test"),
        providerID: ProviderV2.ID.make("test"),
        time: { created: Date.now() },
      })
      yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: assistant.id,
        sessionID: session.id,
        type: "step-start",
        snapshot: input.before,
      })
      yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: assistant.id,
        sessionID: session.id,
        type: "step-finish",
        reason: "stop",
        snapshot: input.after,
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      })
      return user
    })

    yield* turn({ before: "turn-1-before", after: "turn-1-after", diffs: [firstDiff] })
    const second = yield* turn({ before: "turn-2-before", after: "turn-2-after" })
    const seen: (typeof firstDiff)[][] = []
    const off = yield* events.listen((event) => {
      if (event.type === Session.Event.Diff.type) seen.push((event.data as { diff: (typeof firstDiff)[] }).diff)
      return Effect.void
    })

    yield* summary.summarize({ sessionID: session.id, messageID: second.id })
    yield* off

    expect(calls).toEqual([["turn-2-before", "turn-2-after"]])
    expect((yield* sessions.get(session.id)).summary).toEqual({
      additions: 5,
      deletions: 5,
      files: 2,
      diffs: [firstDiff, secondDiff],
    })
    expect(seen).toEqual([[firstDiff, secondDiff]])
    expect(yield* summary.diff({ sessionID: session.id, messageID: second.id })).toEqual([secondDiff])
  }),
)
