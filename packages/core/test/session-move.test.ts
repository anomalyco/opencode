import { describe, expect } from "bun:test"
import path from "path"
import { mkdir, rm } from "fs/promises"
import { $ } from "bun"
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
const liveIt = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, Project.node, SessionProjector.node, SessionStore.node, Session.node]),
    [[SessionExecution.node, SessionExecution.noopLayer]],
  ),
)

describe("Session.move", () => {
  liveIt.live("reconciles a queued markerless move through an unborn repository", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const session = yield* Session.Service
          const projects = yield* Project.Service
          const source = path.join(tmp.path, "source")
          const root = path.join(tmp.path, "destination")
          const destination = AbsolutePath.make(path.join(root, "packages", "app"))
          yield* Effect.promise(() => Promise.all([mkdir(source), mkdir(destination, { recursive: true })]))
          const created = yield* session.create({
            location: Location.Ref.make({ directory: AbsolutePath.make(source) }),
          })

          yield* session.move({ sessionID: created.id, directory: destination, delivery: "queue" })
          const queued = (yield* session.inbox(created.id))[0]
          if (queued?.type !== "move") return yield* Effect.die(new Error("queued move not found"))

          yield* Effect.promise(async () => {
            await $`git init -q`.cwd(root)
            await $`git config user.email test@example.com`.cwd(root)
            await $`git config user.name Test`.cwd(root)
          })
          const unborn = yield* projects.resolve(destination)
          const provisional = (yield* session.inbox(created.id))[0]
          expect(unborn.id).toBe(Project.ID.global)
          expect(provisional).toMatchObject({ type: "move", payload: { projectID: Project.ID.global } })

          yield* Effect.promise(() => $`git commit --allow-empty -qm initial`.cwd(root).quiet())
          const project = yield* projects.resolve(destination)
          const reconciled = (yield* session.inbox(created.id))[0]

          expect(queued.payload.projectID).not.toBe(project.id)
          expect(reconciled).toMatchObject({
            type: "move",
            payload: { projectID: project.id, subpath: "packages/app" },
          })
        }),
      ),
    ),
  )

  liveIt.live("does not retarget a queued move from a nested repository to its repository ancestor", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const session = yield* Session.Service
          const projects = yield* Project.Service
          const source = path.join(tmp.path, "source")
          const root = path.join(tmp.path, "outer")
          const nested = path.join(root, "nested")
          const destination = AbsolutePath.make(path.join(nested, "packages", "app"))
          yield* Effect.promise(() => Promise.all([mkdir(source), mkdir(destination, { recursive: true })]))
          yield* Effect.promise(async () => {
            await $`git init -q`.cwd(nested)
            await $`git config user.email test@example.com`.cwd(nested)
            await $`git config user.name Test`.cwd(nested)
            await $`git commit --allow-empty -qm initial`.cwd(nested)
            await $`git remote add origin git@example.test:nested/repository.git`.cwd(nested)
          })
          const created = yield* session.create({
            location: Location.Ref.make({ directory: AbsolutePath.make(source) }),
          })

          yield* session.move({ sessionID: created.id, directory: destination, delivery: "queue" })
          const queued = (yield* session.inbox(created.id))[0]
          if (queued?.type !== "move") return yield* Effect.die(new Error("queued move not found"))

          yield* Effect.promise(async () => {
            await $`git init -q`.cwd(root)
            await $`git config user.email test@example.com`.cwd(root)
            await $`git config user.name Test`.cwd(root)
            await $`git commit --allow-empty -qm initial`.cwd(root)
            await $`git remote add origin git@example.test:outer/repository.git`.cwd(root)
          })
          const outer = yield* projects.resolve(AbsolutePath.make(root))
          const preserved = (yield* session.inbox(created.id))[0]

          expect(queued.payload.projectID).not.toBe(outer.id)
          expect(preserved).toMatchObject({
            type: "move",
            payload: { projectID: queued.payload.projectID, subpath: "packages/app" },
          })
        }),
      ),
    ),
  )

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
