import { describe, expect } from "bun:test"
import path from "path"
import { chmod, mkdir, readdir, rm } from "fs/promises"
import { Cause, Context, Deferred, Duration, Effect, Exit, Fiber, Layer, LayerMap, Queue } from "effect"
import { Worktree } from "@opencode-ai/schema/worktree"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Bus } from "@opencode-ai/core/bus"
import { Config } from "@opencode-ai/core/config"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Instance } from "@opencode-ai/core/instance"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import type { LocationServices } from "@opencode-ai/core/location-services"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionMove } from "@opencode-ai/core/session/move"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionRunner } from "@opencode-ai/core/session/runner/index"
import { SessionStore } from "@opencode-ai/core/session/store"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Global } from "@opencode-ai/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
    [Project.node.replace(globalProjectNode), SessionExecution.node.replace(SessionExecution.noopLayer), offlineModels],
  ),
)
const itWithActiveExecution = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      SessionExecution.node,
      Session.node,
    ]),
    [
      Project.node.replace(globalProjectNode),
      LocationServiceMap.node.replace(
        Layer.effect(
          LocationServiceMap.Service,
          LayerMap.make(
            (ref: Location.Ref) =>
              Layer.merge(
                LayerNode.compile(Location.boundNode(ref), {
                  replacements: [Project.node.replace(globalProjectNode), offlineModels],
                }),
                Layer.succeed(SessionRunner.Service, { drain: () => Effect.never }),
              ) as unknown as Layer.Layer<LocationServices>,
          ),
        ),
      ),
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
      Project.node.replace(globalProjectNode),
      SessionExecution.node.replace(SessionExecution.noopLayer),
      LocationServiceMap.node.replace(unavailableLocations),
    ],
  ),
)
const itWithExecution = testEffect(
  AppNodeBuilder.build(LayerNode.group([Session.node, SessionExecution.node]), [
    Global.node.replace(tempGlobalLayer),
    offlineModels,
  ]),
)
// Windows does not enforce POSIX mode bits, and root can traverse mode-000 directories.
const itWithPermissions =
  process.platform === "win32" || process.getuid?.() === 0 ? itWithExecution.live.skip : itWithExecution.live
const itWithInstance = testEffect(Layer.empty)
const sourceProbe = (options: { execution?: boolean } = {}) =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const source = AbsolutePath.make(path.join(tmp.path, "source"))
    const destination = AbsolutePath.make(tmp.path)
    yield* Effect.promise(() => mkdir(source))
    const probes = yield* Queue.unbounded<Deferred.Deferred<void>>()
    const context = yield* Layer.build(
      AppNodeBuilder.build(LayerNode.group([Session.node, Bus.node, SessionExecution.node]), [
        Global.node.replace(tempGlobalLayer),
        ...(options.execution ? [] : [SessionExecution.node.replace(SessionExecution.noopLayer)]),
        offlineModels,
        Instance.node.replace(
          makeGlobalNode({
            service: Instance.Service,
            deps: [LocationServiceMap.node],
            layer: Layer.effect(
              Instance.Service,
              Effect.gen(function* () {
                const locations = yield* LocationServiceMap.Service
                return Instance.Service.of({
                  provide: (session) => (effect) =>
                    Effect.gen(function* () {
                      if (session.location.directory === source) {
                        const release = yield* Deferred.make<void>()
                        yield* Queue.offer(probes, release)
                        yield* Deferred.await(release)
                      }
                      return yield* effect.pipe(Effect.provide(locations.get(session.location)))
                    }),
                })
              }),
            ),
          }),
        ),
      ]),
    )
    return {
      source,
      destination,
      probes,
      session: Context.get(context, Session.Service),
      bus: Context.get(context, Bus.Service),
      execution: Context.get(context, SessionExecution.Service),
    }
  })

describe("Session.move", () => {
  itWithInstance.live("binds move preparation dependencies in the service implementation", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const directory = AbsolutePath.make(tmp.path)
      const context = yield* Layer.build(
        AppNodeBuilder.build(LayerNode.group([Session.node, SessionMove.node]), [
          Global.node.replace(tempGlobalLayer),
          Project.node.replace(globalProjectNode),
          SessionExecution.node.replace(SessionExecution.noopLayer),
          offlineModels,
        ]),
      )
      const sessions = Context.get(context, Session.Service)
      const moves = Context.get(context, SessionMove.Service)
      const session = yield* sessions.create({ location: Location.Ref.make({ directory }) })

      // Call the bound service outside its construction context: no leaf services are provided here.
      expect(yield* moves.prepare({ session, directory })).toMatchObject({
        location: { directory },
        projectID: Project.ID.global,
      })
    }),
  )

  itWithInstance.live("uses the provided move preparation service", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const directory = AbsolutePath.make(tmp.path)
      const rejection = new Session.DestinationUnavailableError({ directory })
      const context = yield* Layer.build(
        AppNodeBuilder.build(Session.node, [
          Global.node.replace(tempGlobalLayer),
          Project.node.replace(globalProjectNode),
          SessionExecution.node.replace(SessionExecution.noopLayer),
          SessionMove.node.replace(Layer.succeed(SessionMove.Service, { prepare: () => Effect.fail(rejection) })),
          offlineModels,
        ]),
      )
      const sessions = Context.get(context, Session.Service)
      const created = yield* sessions.create({ location: Location.Ref.make({ directory }) })

      expect(yield* sessions.move({ sessionID: created.id, directory }).pipe(Effect.flip)).toBe(rejection)
      expect(yield* sessions.inbox(created.id)).toEqual([])
    }),
  )

  for (const broken of [false, true]) {
    itWithExecution.live(
      `moves an idle session from ${broken ? "broken" : "healthy"} source configuration`,
      () =>
        Effect.gen(function* () {
          const tmp = yield* tmpdirScoped()
          const source = AbsolutePath.make(path.join(tmp.path, "source"))
          const destination = AbsolutePath.make(path.join(tmp.path, "destination"))
          yield* Effect.promise(() => Promise.all([mkdir(source), mkdir(destination)]))
          if (broken)
            yield* Effect.promise(() =>
              Bun.write(path.join(source, "opencode.json"), JSON.stringify({ instructions: ["{file:./missing.txt}"] })),
            )
          const session = yield* Session.Service
          const execution = yield* SessionExecution.Service
          const created = yield* session.create({ location: Location.Ref.make({ directory: source }) })

          yield* session.move({ sessionID: created.id, directory: destination })
          yield* execution.awaitIdle(created.id)

          expect((yield* session.get(created.id)).location.directory).toBe(destination)
          expect(yield* session.inbox(created.id)).toEqual([])
        }),
      { timeout: 15_000 },
    )
  }

  itWithPermissions(
    "recovers an idle session from an unreadable source directory",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const source = AbsolutePath.make(path.join(tmp.path, "source"))
        const destination = AbsolutePath.make(path.join(tmp.path, "destination"))
        yield* Effect.promise(() => Promise.all([mkdir(source), mkdir(destination)]))
        const session = yield* Session.Service
        const execution = yield* SessionExecution.Service
        const created = yield* session.create({ location: Location.Ref.make({ directory: source }) })
        yield* Effect.addFinalizer(() => Effect.promise(() => chmod(source, 0o755)))
        yield* Effect.promise(() => chmod(source, 0o000))
        expect(
          yield* Effect.promise(() =>
            readdir(source).then(
              () => false,
              () => true,
            ),
          ),
        ).toBe(true)

        yield* session.move({ sessionID: created.id, directory: destination })
        yield* execution.awaitIdle(created.id)

        expect((yield* session.get(created.id)).location.directory).toBe(destination)
        expect(yield* session.inbox(created.id)).toEqual([])
      }),
    { timeout: 15_000 },
  )

  for (const broken of [false, true]) {
    itWithInstance.live(
      `uses the ${broken ? "broken" : "healthy discovery-disabled"} selected instance rather than the default Location`,
      () =>
        Effect.gen(function* () {
          const tmp = yield* tmpdirScoped()
          const source = Location.Ref.make({ directory: AbsolutePath.make(path.join(tmp.path, "source")) })
          const destination = AbsolutePath.make(path.join(tmp.path, "destination"))
          yield* Effect.promise(() => Promise.all([mkdir(source.directory), mkdir(destination)]))
          const config = JSON.stringify({ instructions: ["{file:./missing.txt}"] })
          if (!broken) yield* Effect.promise(() => Bun.write(path.join(source.directory, "opencode.json"), config))
          const selectedID = Session.ID.create()
          const replacements: LayerNode.Replacements = [
            Global.node.replace(tempGlobalLayer),
            SessionExecution.node.replace(SessionExecution.noopLayer),
            offlineModels,
            Instance.node.replace(
              makeGlobalNode({
                service: Instance.Service,
                deps: [LocationServiceMap.node],
                layer: Layer.effect(
                  Instance.Service,
                  Effect.gen(function* () {
                    const locations = yield* LocationServiceMap.Service
                    const privateInstances = yield* LayerMap.make(
                      () =>
                        Instance.layer(source, {
                          discovery: false,
                          replacements: [
                            ...bindings,
                            ...(broken
                              ? [
                                  Config.node.replace(
                                    Config.configured({ project: false, global: false, content: config }),
                                  ),
                                ]
                              : []),
                          ],
                        }),
                      { idleTimeToLive: Duration.infinity },
                    )
                    const selector = Instance.Service.of({
                      provide: (session) =>
                        Effect.provide(
                          session.id === selectedID && session.location.directory === source.directory
                            ? privateInstances.get(session.id)
                            : locations.get(session.location),
                        ),
                    })
                    const bindings: LayerNode.Replacements = [
                      ...replacements,
                      Instance.node.replace(Layer.succeed(Instance.Service, selector)),
                      LocationServiceMap.node.replace(Layer.succeed(LocationServiceMap.Service, locations)),
                    ]
                    return selector
                  }),
                ),
              }),
            ),
          ]
          const context = yield* Layer.build(AppNodeBuilder.build(Session.node, replacements))
          const session = Context.get(context, Session.Service)
          const created = yield* session.create({ id: selectedID, location: source })
          const pending = yield* session.synthetic({
            sessionID: created.id,
            text: "Keep pending",
            delivery: "queue",
            resume: false,
          })

          yield* session.move({ sessionID: created.id, directory: destination, delivery: "queue" })

          expect((yield* session.get(created.id)).location.directory).toBe(broken ? destination : source.directory)
          const inbox = yield* session.inbox(created.id)
          expect(inbox[0]).toEqual(pending)
          if (broken) expect(inbox).toEqual([pending])
          if (!broken) expect(inbox.slice(1)).toMatchObject([{ type: "move", delivery: "queue" }])
        }),
      { timeout: 15_000 },
    )
  }

  for (const interrupt of ["source", "caller"] as const) {
    itWithInstance.live(`does not recover or enqueue a move when the ${interrupt} interrupts the probe`, () =>
      Effect.gen(function* () {
        const fixture = yield* sourceProbe()
        const created = yield* fixture.session.create({ location: Location.Ref.make({ directory: fixture.source }) })
        const pending = yield* fixture.session.synthetic({ sessionID: created.id, text: "Keep pending", resume: false })
        const moving = yield* fixture.session
          .move({ sessionID: created.id, directory: fixture.destination })
          .pipe(Effect.forkScoped)
        const release = yield* Queue.take(fixture.probes)

        if (interrupt === "source") yield* Deferred.interrupt(release)
        if (interrupt === "caller") yield* Fiber.interrupt(moving)
        const exit = yield* Fiber.await(moving)

        expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
        expect((yield* fixture.session.get(created.id)).location.directory).toBe(fixture.source)
        expect(yield* fixture.session.inbox(created.id)).toEqual([pending])
      }).pipe(Effect.timeout("5 seconds")),
    )
  }

  itWithInstance.live("does not recover if execution starts during the source probe", () =>
    Effect.gen(function* () {
      const fixture = yield* sourceProbe({ execution: true })
      const created = yield* fixture.session.create({ location: Location.Ref.make({ directory: fixture.source }) })
      const moving = yield* fixture.session
        .move({ sessionID: created.id, directory: fixture.destination })
        .pipe(Effect.forkScoped)
      const release = yield* Queue.take(fixture.probes)

      yield* fixture.execution.wake(created.id)
      // The real coordinator now owns execution; its separate instance acquisition stays suspended.
      yield* Queue.take(fixture.probes)
      expect(yield* fixture.execution.isActive(created.id)).toBe(true)
      yield* Deferred.die(release, new Error("source unavailable"))
      yield* Fiber.join(moving)

      expect((yield* fixture.session.get(created.id)).location.directory).toBe(fixture.source)
      expect(yield* fixture.session.inbox(created.id)).toMatchObject([{ type: "move", delivery: "steer" }])
      expect(yield* fixture.execution.isActive(created.id)).toBe(true)
      yield* fixture.execution.interrupt(created.id)
      yield* fixture.execution.awaitIdle(created.id)
    }).pipe(Effect.timeout("5 seconds")),
  )

  itWithInstance.live(
    "recovers a missing source without initializing its instance and retains destination workspace identity",
    () =>
      Effect.gen(function* () {
        const fixture = yield* sourceProbe()
        const created = yield* fixture.session.create({
          location: Location.Ref.make({ directory: fixture.source, workspaceID: Workspace.ID.create() }),
        })
        yield* Effect.promise(() => rm(fixture.source, { recursive: true }))
        const workspaceID = Workspace.ID.create()

        yield* fixture.session.move({ sessionID: created.id, directory: fixture.destination, workspaceID })

        expect((yield* fixture.session.get(created.id)).location).toEqual(
          Location.Ref.make({ directory: fixture.destination, workspaceID }),
        )
        expect(yield* fixture.session.inbox(created.id)).toEqual([])
        expect(yield* Queue.size(fixture.probes)).toBe(0)
      }).pipe(Effect.timeout("5 seconds")),
  )

  for (const changed of ["directory", "workspace"] as const) {
    itWithInstance.live(`allows inbox cancellation during a source probe and rejects stale ${changed} recovery`, () =>
      Effect.gen(function* () {
        const fixture = yield* sourceProbe()
        const created = yield* fixture.session.create({ location: Location.Ref.make({ directory: fixture.source }) })
        const pending = yield* fixture.session.synthetic({
          sessionID: created.id,
          text: "Cancel pending",
          resume: false,
        })
        const moving = yield* fixture.session
          .move({ sessionID: created.id, directory: fixture.destination })
          .pipe(Effect.exit, Effect.forkScoped)
        const release = yield* Queue.take(fixture.probes)

        yield* fixture.session.cancelInbox({ sessionID: created.id, inboxID: pending.id }).pipe(
          Effect.timeout("2 seconds"),
          Effect.onError(() => Deferred.interrupt(release)),
        )
        expect(yield* fixture.session.inbox(created.id)).toEqual([])
        expect(moving.pollUnsafe()).toBeUndefined()
        const location = Location.Ref.make({
          directory: changed === "directory" ? fixture.destination : fixture.source,
          workspaceID: changed === "workspace" ? Workspace.ID.create() : undefined,
        })
        yield* fixture.bus.publish(SessionEvent.Moved, {
          sessionID: created.id,
          location,
          projectID: created.projectID,
        })
        yield* Deferred.die(release, new Error("source unavailable"))
        expect(Exit.isSuccess(yield* Fiber.join(moving))).toBe(true)

        expect((yield* fixture.session.get(created.id)).location).toEqual(location)
        expect(yield* fixture.session.inbox(created.id)).toMatchObject([
          { type: "move", payload: { location: { directory: fixture.destination } } },
        ])
      }).pipe(Effect.timeout("5 seconds")),
    )
  }

  itWithUnavailableDestination.effect("rejects an unavailable destination before admitting the move", () =>
    tmpdirScoped().pipe(
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
    tmpdirScoped().pipe(
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
          const pending = yield* session.synthetic({
            sessionID: created.id,
            text: "Keep queued",
            delivery: "queue",
            resume: false,
          })
          yield* session.move({ sessionID: created.id, directory: destination, delivery: "queue" })
          expect(yield* session.inbox(created.id)).toHaveLength(3)

          yield* Effect.promise(() => rm(source, { recursive: true }))
          yield* session.move({ sessionID: created.id, directory: destination })

          expect((yield* session.get(created.id)).location.directory).toBe(destination)
          expect(yield* session.inbox(created.id)).toEqual([pending])

          yield* session.move({ sessionID: created.id, directory: destination })
          expect(yield* session.inbox(created.id)).toHaveLength(2)

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

  itWithActiveExecution.live("defers an active move when the source directory no longer exists", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const session = yield* Session.Service
          const execution = yield* SessionExecution.Service
          const source = AbsolutePath.make(path.join(tmp.path, "source"))
          const destination = AbsolutePath.make(tmp.path)
          yield* Effect.promise(() => mkdir(source))
          const created = yield* session.create({ location: Location.Ref.make({ directory: source }) })

          // Hold real execution open so the move cannot be consumed before admission is checked.
          yield* execution.wake(created.id)
          expect(yield* execution.isActive(created.id)).toBe(true)
          yield* Effect.promise(() => rm(source, { recursive: true }))

          yield* session.move({ sessionID: created.id, directory: destination })

          expect((yield* session.get(created.id)).location.directory).toBe(source)
          expect(yield* session.inbox(created.id)).toMatchObject([
            {
              type: "move",
              delivery: "steer",
              payload: { location: { directory: destination } },
            },
          ])
          expect(yield* execution.isActive(created.id)).toBe(true)

          yield* execution.interrupt(created.id)
          yield* execution.awaitIdle(created.id)
        }),
      ),
    ),
  )

  it.effect("keeps a moved session out of its former directory's new identity", () =>
    tmpdirScoped().pipe(
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
