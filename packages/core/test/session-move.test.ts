import { describe, expect } from "bun:test"
import path from "path"
import { mkdir, rm } from "fs/promises"
import { Effect, Layer, LayerMap } from "effect"
import { Worktree } from "@opencode-ai/schema/worktree"
import { Bus } from "@opencode-ai/core/bus"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import type { LocationServices } from "@opencode-ai/core/location-services"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { globalProjectLayer } from "./lib/project"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
    [
      [Project.node, globalProjectLayer],
      [SessionExecution.node, SessionExecution.noopLayer],
    ],
  ),
)
const unavailableLocations = Layer.effect(
  LocationServiceMap.Service,
  LayerMap.make(
    () => Layer.effectDiscard(Effect.fail(new Error("broken location"))) as unknown as Layer.Layer<LocationServices>,
  ),
)
const itWithUnavailableDestination = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
    [
      [Project.node, globalProjectLayer],
      [SessionExecution.node, SessionExecution.noopLayer],
      [LocationServiceMap.node, unavailableLocations],
    ],
  ),
)

describe("Session.move", () => {
  itWithUnavailableDestination.effect("rejects an unavailable destination before admitting the move", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const session = yield* Session.Service
          const source = AbsolutePath.make(path.join(tmp.path, "source"))
          const destination = AbsolutePath.make(path.join(tmp.path, "destination"))
          yield* Effect.promise(() => Promise.all([mkdir(source), mkdir(destination)]))
          const created = yield* session.create({ location: Location.Ref.make({ directory: source }) })

          const error = yield* session.move({ sessionID: created.id, directory: destination }).pipe(Effect.flip)

          expect(error).toEqual(new Session.DestinationUnavailableError({ directory: destination }))
          expect((yield* session.get(created.id)).location.directory).toBe(source)
          expect(yield* session.inbox(created.id)).toEqual([])
        }),
      ),
    ),
  )

  it.effect("applies a move immediately when the source directory no longer exists", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const session = yield* Session.Service
          const destination = AbsolutePath.make(tmp.path)
          const source = path.join(tmp.path, "source")
          yield* Effect.promise(() => mkdir(source))
          const created = yield* session.create({
            location: Location.Ref.make({ directory: AbsolutePath.make(source) }),
          })

          yield* session.move({ sessionID: created.id, directory: destination })
          expect((yield* session.get(created.id)).location.directory).toBe(AbsolutePath.make(source))
          expect(yield* session.inbox(created.id)).toHaveLength(1)

          yield* Effect.promise(() => rm(source, { recursive: true }))
          yield* session.move({ sessionID: created.id, directory: destination })

          expect((yield* session.get(created.id)).location.directory).toBe(destination)
          expect(yield* session.inbox(created.id)).toEqual([])

          yield* session.move({ sessionID: created.id, directory: destination })
          expect(yield* session.inbox(created.id)).toHaveLength(1)

          yield* Effect.promise(() => mkdir(path.join(tmp.path, "other")))
          const steered = yield* session.create({
            location: Location.Ref.make({ directory: AbsolutePath.make(path.join(tmp.path, "other")) }),
          })
          yield* session.move({ sessionID: steered.id, directory: destination, delivery: "queue" })
          expect(yield* session.inbox(steered.id)).toMatchObject([{ type: "move", delivery: "queue" }])
        }),
      ),
    ),
  )

  it.effect("keeps a moved session out of its former directory's new identity", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const session = yield* Session.Service
          const bus = yield* Bus.Service
          const previous = AbsolutePath.make(path.join(tmp.path, "previous"))
          const destination = AbsolutePath.make(tmp.path)
          const created = yield* session.create({ location: Location.Ref.make({ directory: previous }) })

          // Moves are admitted through the inbox and applied by the drain;
          // publish the applied move directly since execution is a no-op here.
          yield* bus.publish(SessionEvent.Moved, {
            sessionID: created.id,
            location: Location.Ref.make({ directory: destination }),
            projectID: Project.ID.global,
          })
          // The former directory becomes a project after the session left it.
          yield* bus.publish(Worktree.Event.Resolved, {
            projectID: Project.ID.make("adopting"),
            directory: previous,
            previous: Project.ID.global,
          })

          expect(yield* session.get(created.id)).toMatchObject({
            projectID: Project.ID.global,
            location: { directory: destination },
            subpath: undefined,
          })
        }),
      ),
    ),
  )
})
