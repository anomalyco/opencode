import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@Mackery6969/core/database/database"
import { AppNodeBuilder } from "@Mackery6969/core/effect/app-node-builder"
import { LayerNode } from "@Mackery6969/util/effect/layer-node"
import { Bus } from "@Mackery6969/core/bus"
import { Location } from "@Mackery6969/core/location"
import { Project } from "@Mackery6969/core/project"
import { AbsolutePath } from "@Mackery6969/core/schema"
import { Session } from "@Mackery6969/core/session"
import { SessionProjector } from "@Mackery6969/core/session/projector"
import { SessionExecution } from "@Mackery6969/core/session/execution"
import { SessionStore } from "@Mackery6969/core/session/store"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const awaited: Session.ID[] = []
const execution = Layer.mock(SessionExecution.Service, {
  awaitIdle: (sessionID) => Effect.sync(() => awaited.push(sessionID)),
})
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
    [Project.node.replace(globalProjectNode), SessionExecution.node.replace(execution)],
  ),
)

describe("Session.wait", () => {
  it.effect("delegates to SessionExecution.awaitIdle", () =>
    Effect.gen(function* () {
      awaited.length = 0
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ location })

      yield* sessions.wait(session.id)

      expect(awaited).toEqual([session.id])
    }),
  )
})
