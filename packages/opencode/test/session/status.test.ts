import { describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([SessionStatus.node, EventV2Bridge.node, CrossSpawnSpawner.node])))

describe("SessionStatus", () => {
  it.instance("does not republish idle when a session is already idle", () =>
    Effect.gen(function* () {
      const events = yield* EventV2Bridge.Service
      const status = yield* SessionStatus.Service
      const sessionID = SessionID.make("session-status-idle-dedupe")
      const statuses: string[] = []
      const idleEvents: string[] = []
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === SessionStatus.Event.Status.type) {
            const data = Schema.decodeUnknownSync(SessionStatus.Event.Status.data)(event.data)
            if (data.sessionID === sessionID) statuses.push(data.status.type)
          }
          if (event.type === SessionStatus.Event.Idle.type) {
            const data = Schema.decodeUnknownSync(SessionStatus.Event.Idle.data)(event.data)
            if (data.sessionID === sessionID) idleEvents.push(data.sessionID)
          }
        }),
      )

      yield* status.set(sessionID, { type: "busy" })
      yield* status.set(sessionID, { type: "idle" })
      yield* status.set(sessionID, { type: "idle" })
      yield* unsubscribe

      expect(statuses).toEqual(["busy", "idle"])
      expect(idleEvents).toEqual([sessionID])
      expect(yield* status.get(sessionID)).toEqual({ type: "idle" })
    }),
  )
})
