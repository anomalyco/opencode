import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionV1 } from "@opencode-ai/schema/session-v1"
import { Database } from "@opencode-ai/core/database/database"
import { Session } from "@opencode-ai/schema/session"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(
    location({ directory: AbsolutePath.make("project"), workspaceID: WorkspaceV2.ID.make("wrk_test") }),
  ),
)
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, Location.node]), [[Location.node, locationLayer]]),
)

const part = (sid: Session.ID, mid: SessionV1.MessageID, text: string): SessionV1.TextPart => ({
  id: SessionV1.PartID.ascending(),
  messageID: mid,
  sessionID: sid,
  type: "text",
  text,
  time: { start: 0 },
})

const N = 200

describe("EventV2.publish benchmark", () => {
  it.effect("durable (persist:true) vs local-only (persist:false) write cost", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const sid = Session.ID.create()
      const mid = SessionV1.MessageID.ascending()
      // ~20KB part, typical mid-length tool output page
      const payload = "x".repeat(20 * 1024)

      const t0 = Date.now()
      for (let i = 0; i < N; i++) {
        yield* events.publish(SessionV1.Event.PartUpdated, {
          sessionID: sid,
          part: part(sid, mid, payload),
          time: i,
        })
      }
      const durableMs = Date.now() - t0

      const t1 = Date.now()
      for (let i = 0; i < N; i++) {
        yield* events.publish(
          SessionV1.Event.PartUpdated,
          { sessionID: sid, part: part(sid, mid, payload), time: i },
          { persist: false },
        )
      }
      const localMs = Date.now() - t1

      console.log(`[bench] 200 x ${payload.length}b part: durable=${durableMs}ms local=${localMs}ms`)
      expect(localMs).toBeLessThan(durableMs)
    }),
  )
})