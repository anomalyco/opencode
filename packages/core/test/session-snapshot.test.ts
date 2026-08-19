import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Bus } from "@opencode-ai/core/bus"
import { Location } from "@opencode-ai/core/location"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { Event } from "@opencode-ai/schema/event"
import { testEffect } from "./lib/effect"
import { globalProjectLayer } from "./lib/project"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
    [
      [Bus.node, Bus.configured({ persist: true })],
      [Project.node, globalProjectLayer],
      [SessionExecution.node, SessionExecution.noopLayer],
    ],
  ),
)
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

describe("Session.snapshot", () => {
  it.effect("returns an empty projected session at its aggregate watermark", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const created = yield* sessions.create({ location })

      expect(yield* sessions.snapshot({ sessionID: created.id })).toEqual({
        session: created,
        children: [],
        inbox: [],
        messages: [],
        seq: Event.Seq.make(0),
      })
    }),
  )

  it.effect("returns the most recent messages in aggregate order", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const bus = yield* Bus.Service
      const created = yield* sessions.create({ location })
      yield* Effect.forEach(["first", "second", "third"], (text) =>
        bus.publish(SessionEvent.Synthetic, { sessionID: created.id, text }),
      )

      const snapshot = yield* sessions.snapshot({ sessionID: created.id, recent: 2 })

      expect(snapshot.messages.map((message) => (message.type === "synthetic" ? message.text : message.type))).toEqual([
        "second",
        "third",
      ])
      expect(snapshot.seq).toBe(Event.Seq.make(3))
    }),
  )

  it.effect("keeps rows and watermark consistent during concurrent publication", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const bus = yield* Bus.Service
      const created = yield* sessions.create({ location })
      const publish = Effect.forEach(
        Array.from({ length: 40 }, (_, index) => index + 1),
        (index) => bus.publish(SessionEvent.Synthetic, { sessionID: created.id, text: String(index) }),
      )
      const read = Effect.forEach(Array.from({ length: 40 }), () => sessions.snapshot({ sessionID: created.id }))

      const [, snapshots] = yield* Effect.all([publish, read], { concurrency: "unbounded" })

      snapshots.forEach((snapshot) => {
        expect(snapshot.messages).toHaveLength(snapshot.seq)
        expect(
          snapshot.messages.map((message) => (message.type === "synthetic" ? Number(message.text) : -1)),
        ).toEqual(Array.from({ length: snapshot.seq }, (_, index) => index + 1))
      })
    }),
  )
})
