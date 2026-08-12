import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { Bus } from "@opencode-ai/core/bus"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Location } from "@opencode-ai/core/location"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const projects = Layer.succeed(
  Project.Service,
  Project.Service.of({
    list: () => Effect.succeed([]),
    resolve: (directory) => Effect.succeed({ id: Project.ID.global, directory, canonical: directory }),
    directories: () => Effect.succeed([]),
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

describe("Session.move", () => {
  it.effect("enqueues one move when the source directory no longer exists", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const session = yield* Session.Service
          const destination = AbsolutePath.make(tmp.path)
          const created = yield* session.create({
            location: Location.Ref.make({ directory: AbsolutePath.make(path.join(tmp.path, "deleted")) }),
          })

          yield* session.move({ sessionID: created.id, directory: destination })

          expect((yield* session.get(created.id)).location.directory).toBe(
            AbsolutePath.make(path.join(tmp.path, "deleted")),
          )
          expect(yield* session.inbox(created.id)).toMatchObject([
            {
              type: "move",
              delivery: "queue",
              payload: {
                location: { directory: destination },
                projectID: Project.ID.global,
              },
            },
          ])

          yield* session.move({ sessionID: created.id, directory: destination })
          expect(yield* session.inbox(created.id)).toHaveLength(2)

          const steered = yield* session.create({
            location: Location.Ref.make({ directory: AbsolutePath.make(path.join(tmp.path, "other")) }),
          })
          yield* session.move({ sessionID: steered.id, directory: destination, delivery: "steer" })
          expect(yield* session.inbox(steered.id)).toMatchObject([{ type: "move", delivery: "steer" }])
        }),
      ),
    ),
  )
})
