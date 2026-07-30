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
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { testEffect } from "./lib/effect"

const projects = Layer.succeed(
  Project.Service,
  Project.Service.of({
    list: () => Effect.succeed([]),
    resolve: (directory) => Effect.succeed({ id: Project.ID.global, directory, canonical: directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
    [
      [Project.node, projects],
      [SessionExecution.node, SessionExecution.noopLayer],
    ],
  ),
)
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

describe("Session.remove", () => {
  it.effect("removes a session and its children", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const parent = yield* session.create({ location })
      const child = yield* session.create({ parentID: parent.id })

      yield* session.remove(parent.id)

      expect((yield* session.list()).data).toEqual([])
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
