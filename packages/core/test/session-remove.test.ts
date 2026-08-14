import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { Bus } from "@opencode-ai/core/bus"
import { Location } from "@opencode-ai/core/location"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionModelTransport } from "@opencode-ai/core/session/model-transport"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { testEffect } from "./lib/effect"
import { globalProjectLayer } from "./lib/project"

const closed: Session.ID[] = []
const transport = Layer.succeed(
  SessionModelTransport.Service,
  SessionModelTransport.Service.of({
    bind: () => ({ execute: () => Effect.die("Unexpected WebSocket execution") }),
    close: (sessionID) => Effect.sync(() => closed.push(sessionID)),
    closeAll: Effect.void,
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      Session.node,
      LocationServiceMap.node,
    ]),
    [
      [Project.node, globalProjectLayer],
      [SessionExecution.node, SessionExecution.noopLayer],
      [SessionModelTransport.node, transport],
    ],
  ),
)
const location = Location.Ref.make({ directory: AbsolutePath.make(import.meta.dir) })

describe("Session.remove", () => {
  it.effect("removes a session and its children", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const parent = yield* session.create({ location })
      const child = yield* session.create({ parentID: parent.id })
      yield* (yield* LocationServiceMap.Service).contextEffect(location)
      closed.length = 0

      yield* session.remove(parent.id)

      expect((yield* session.list()).data).toEqual([])
      expect(closed).toEqual([parent.id, child.id])
      expect(yield* Effect.result(session.get(parent.id))).toMatchObject({ _tag: "Failure" })
      expect(yield* Effect.result(session.get(child.id))).toMatchObject({ _tag: "Failure" })
    }),
  )

  it.effect("fails when the session does not exist", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const sessionID = Session.ID.make("ses_missing")

      expect(yield* Effect.result(session.remove(sessionID))).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "Session.NotFoundError", sessionID },
      })
    }),
  )
})
