import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Config } from "@opencode-ai/schema/config"
import { Money } from "@opencode-ai/schema/money"
import {
  DateTime,
  Deferred,
  Duration,
  Effect,
  Equal,
  Exit,
  Fiber,
  Hash,
  Layer,
  LayerMap,
  Option,
  RcMap,
  Schema,
  Scope,
  Stream,
} from "effect"
import { TestClock } from "effect/testing"
import { Agent } from "@opencode-ai/core/agent"
import { Catalog } from "@opencode-ai/core/catalog"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Global } from "@opencode-ai/util/global"
import { LocationServiceMap, type LocationServices } from "@opencode-ai/core/location-services"
import { LocationActivity } from "@opencode-ai/core/location-activity"
import { Location } from "@opencode-ai/core/location"
import { LocationWatcher } from "@opencode-ai/core/filesystem/location-watcher"
import { Plugin } from "@opencode-ai/core/plugin"
import { Model } from "@opencode-ai/core/model"
import { Project } from "@opencode-ai/core/project"
import { Provider } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { Workspace } from "@opencode-ai/core/workspace"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { tmpdir, tmpdirScoped } from "./fixture/tmpdir"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { testEffect } from "./lib/effect"
import { toolDefinitions } from "./lib/tool"
import { Database } from "../src/database/database"
import { Bus } from "../src/bus"
import { Reference } from "../src/reference"
import { Tool } from "../src/tool"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, LocationServiceMap.node]), [
    Global.node.replace(tempGlobalLayer),
    offlineModels,
  ]),
)
const activityLocations = Layer.effect(
  LocationServiceMap.Service,
  LayerMap.make(
    (ref) =>
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      Layer.succeed(
        Location.Service,
        Location.Service.of({
          directory: ref.directory,
          workspaceID: ref.workspaceID,
          project: { id: Project.ID.global, directory: ref.directory, canonical: ref.directory },
        }),
      ) as unknown as Layer.Layer<LocationServices>,
    { idleTimeToLive: Duration.infinity },
  ),
)
const itWithActivity = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, LocationServiceMap.node, LocationActivity.node]), [
    LocationServiceMap.node.replace(activityLocations),
  ]),
)

describe("LocationServiceMap", () => {
  for (const failure of ["file", "permissions"] as const) {
    for (const invalidate of [false, true]) {
      // Windows does not enforce POSIX directory modes, and root bypasses them.
      const test =
        failure === "permissions" && (process.platform === "win32" || process.getuid?.() === 0) ? it.live.skip : it.live
      test(`retries after repairing ${failure}${invalidate ? " with explicit invalidation" : ""}`, () =>
        Effect.gen(function* () {
          const dir = yield* tmpdirScoped()
          const directory = path.join(dir.path, "repaired")
          const ref = Location.Ref.make({ directory: AbsolutePath.make(directory) })
          const locations = yield* LocationServiceMap.Service
          const load = Location.Service.pipe(Effect.provide(locations.get(ref)), Effect.scoped)

          if (failure === "file") yield* Effect.promise(() => fs.writeFile(directory, "file"))
          if (failure === "permissions") {
            yield* Effect.promise(() => fs.mkdir(directory, { mode: 0o000 }))
            yield* Effect.addFinalizer(() => Effect.promise(() => fs.chmod(directory, 0o755)))
          }
          expect(Exit.isFailure(yield* Effect.exit(load))).toBe(true)
          if (!invalidate) expect(yield* locations.contextEffectOption(ref).pipe(Effect.scoped)).toEqual(Option.none())

          if (failure === "file") {
            yield* Effect.promise(() => fs.rm(directory))
            yield* Effect.promise(() => fs.mkdir(directory))
          }
          if (failure === "permissions") yield* Effect.promise(() => fs.chmod(directory, 0o755))
          expect((yield* Effect.promise(() => fs.stat(directory))).isDirectory()).toBe(true)
          if (invalidate) yield* locations.invalidate(ref)
          const repaired = yield* Effect.exit(load)
          expect(Exit.isSuccess(repaired)).toBe(true)
          // A successful graph remains cached after its last borrower releases.
          expect(yield* load).toBe(yield* repaired)
        }))
    }
  }

  for (const failure of ["file", "missing"] as const) {
    it.live(`keeps the repaired graph after concurrent ${failure} failures release`, () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped()
        const directory = path.join(dir.path, "concurrent")
        const ref = Location.Ref.make({ directory: AbsolutePath.make(directory) })
        const locations = yield* LocationServiceMap.Service
        if (failure === "file") yield* Effect.promise(() => fs.writeFile(directory, "file"))

        const scopes = yield* Effect.forEach(Array.from({ length: 8 }), () =>
          Effect.acquireRelease(Scope.make(), (scope) => Scope.close(scope, Exit.void)),
        )
        const failures = yield* Effect.forEach(
          scopes,
          (scope) => locations.contextEffect(ref).pipe(Scope.provide(scope), Effect.exit),
          { concurrency: "unbounded" },
        )
        expect(failures.every(Exit.isFailure)).toBe(true)
        if (failure === "file") yield* Effect.promise(() => fs.rm(directory))
        yield* Effect.promise(() => fs.mkdir(directory))
        const repaired = yield* locations.contextEffect(ref)

        yield* Effect.forEach(scopes, (scope) => Scope.close(scope, Exit.void))
        expect(yield* locations.contextEffect(ref)).toBe(repaired)
        expect(Option.getOrThrow(yield* locations.contextEffectOption(ref))).toBe(repaired)
      }),
    )
  }

  for (const disposition of ["retry", "invalidate", "interrupt"] as const) {
    testEffect(Layer.empty).live(
      disposition === "invalidate"
        ? "does not let an invalidated boot failure evict its replacement"
        : disposition === "interrupt"
          ? "finishes a failed boot after its acquisition scopes close"
          : "shares a failed boot across acquisition APIs and retries",
      () =>
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const builds = { started: 0 }
          const finalized: number[] = []
          const layer = AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, LocationServiceMap.node]), [
            Global.node.replace(tempGlobalLayer),
            offlineModels,
            LocationWatcher.node.replace(
              LocationWatcher.node.mapLayer((layer) =>
                layer.pipe(
                  Layer.tap(() =>
                    Effect.gen(function* () {
                      const build = ++builds.started
                      yield* Effect.addFinalizer(() => Effect.sync(() => finalized.push(build)))
                      if (build !== 1) return
                      yield* Deferred.succeed(entered, undefined)
                      yield* Deferred.await(release)
                      yield* Effect.die("first boot failed")
                    }),
                  ),
                ),
              ),
            ),
          ])
          yield* Effect.gen(function* () {
            const dir = yield* tmpdirScoped()
            const ref = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
            const locations = yield* LocationServiceMap.Service
            const first = yield* locations.contextEffect(ref).pipe(Effect.scoped, Effect.exit, Effect.forkScoped)
            yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
            yield* Deferred.await(entered)
            const scope = yield* Effect.acquireRelease(Scope.make(), (scope) => Scope.close(scope, Exit.void))
            const second = yield* Location.Service.pipe(
              Effect.provide(locations.get(ref)),
              Effect.exit,
              Effect.forkScoped({ startImmediately: true }),
            )
            const third = yield* locations
              .contextEffectOption(ref)
              .pipe(Scope.provide(scope), Effect.exit, Effect.forkScoped({ startImmediately: true }))
            if (disposition === "invalidate") yield* locations.invalidate(ref)
            if (disposition === "interrupt") {
              yield* Fiber.interrupt(first)
              yield* Fiber.interrupt(second)
              yield* Scope.close(scope, Exit.void)
            }
            const replacement = disposition === "invalidate" ? yield* locations.contextEffect(ref) : undefined
            yield* Deferred.succeed(release, undefined)
            if (disposition !== "interrupt") {
              expect(Exit.isFailure(yield* Fiber.join(first))).toBe(true)
              expect(Exit.isFailure(yield* Fiber.join(second))).toBe(true)
            }
            expect(Exit.isFailure(yield* Fiber.join(third).pipe(Effect.timeout("2 seconds")))).toBe(true)
            expect(finalized).toEqual([1])
            expect(builds.started).toBe(disposition === "invalidate" ? 2 : 1)
            const recovered = yield* locations.contextEffect(ref)
            if (replacement) expect(recovered).toBe(replacement)
            yield* Scope.close(scope, Exit.void)
            expect(yield* locations.contextEffect(ref)).toBe(recovered)
            expect(builds.started).toBe(2)
          }).pipe(Effect.provide(layer))
          expect(finalized).toEqual([1, 2])
        }),
    )
  }

  itWithActivity.effect("does not refresh lifetime from inferred Session routing", () =>
    Effect.gen(function* () {
      const locations = yield* LocationServiceMap.Service
      const bus = yield* Bus.Service
      const ref = Location.Ref.make({ directory: AbsolutePath.make("/project") })
      const sessionID = Session.ID.make("ses_routing_activity")
      yield* Location.Service.pipe(Effect.provide(locations.get(ref)), Effect.scoped)
      yield* bus.publish(SessionEvent.Created, {
        sessionID,
        location: ref,
        projectID: Project.ID.global,
        slug: "routing",
        version: "test",
      })
      yield* TestClock.adjust("59 minutes")
      const event = yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID })
      expect(event).not.toHaveProperty("location")
      yield* TestClock.adjust("2 minutes")
      expect(Array.from(yield* RcMap.keys(locations.rcMap))).toEqual([])
    }),
  )

  itWithActivity.effect("refreshes lifetime from Session events only", () =>
    Effect.gen(function* () {
      const locations = yield* LocationServiceMap.Service
      const bus = yield* Bus.Service
      const ref = Location.Ref.make({ directory: AbsolutePath.make("/project") })
      const sessionID = Session.ID.make("ses_location_activity")
      const read = Location.Service.pipe(Effect.provide(locations.get(ref)), Effect.scoped)

      yield* read
      yield* TestClock.adjust("59 minutes")
      yield* bus.publish(Catalog.Event.Updated, {}, { location: ref })
      yield* TestClock.adjust("2 minutes")
      expect(Array.from(yield* RcMap.keys(locations.rcMap))).toEqual([])

      yield* read
      yield* bus.publish(SessionEvent.Execution.Started, { sessionID }, { location: ref })
      yield* TestClock.adjust("59 minutes")
      yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID }, { location: ref })
      yield* TestClock.adjust("1 minute")
      expect(Array.from(yield* RcMap.keys(locations.rcMap))).toEqual([ref])
      yield* TestClock.adjust("59 minutes")
      expect(Array.from(yield* RcMap.keys(locations.rcMap))).toEqual([])
    }),
  )

  it.live("retries a location after its missing directory is recreated", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const locations = yield* LocationServiceMap.Service
          const directory = path.join(dir.path, "recreated")
          const ref = Location.Ref.make({ directory: AbsolutePath.make(directory) })

          const first = yield* Location.Service.pipe(Effect.provide(locations.get(ref)), Effect.scoped, Effect.exit)
          expect(first._tag).toBe("Failure")

          yield* Effect.promise(() => fs.mkdir(directory))
          const location = yield* Location.Service.pipe(Effect.provide(locations.get(ref)), Effect.scoped)
          expect(location.directory).toBe(ref.directory)
        }),
      ),
    ),
  )

  it.live("keeps a workspace location admitted when its directory does not exist locally", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const locations = yield* LocationServiceMap.Service
          const directory = AbsolutePath.make(path.join(dir.path, "workspace-only"))
          const workspaceRef = Location.Ref.make({ directory, workspaceID: Workspace.ID.make("wrk_liveness") })
          const localRef = Location.Ref.make({ directory })

          // The directory only exists inside the workspace, so neither liveness
          // nor boot may consult the local filesystem: the full location graph
          // must construct and the entry must survive release instead of being
          // evicted by a zero idle time-to-live.
          const location = yield* Location.Service.pipe(Effect.provide(locations.get(workspaceRef)), Effect.scoped)
          expect(location.directory).toBe(directory)
          expect(Array.from(yield* RcMap.keys(locations.rcMap))).toEqual([workspaceRef])

          // A local ref with the same missing directory is dropped after its
          // boot failure so a retry can rebuild it.
          yield* Location.Service.pipe(Effect.provide(locations.get(localRef)), Effect.scoped, Effect.exit)
          expect(Array.from(yield* RcMap.keys(locations.rcMap))).toEqual([workspaceRef])
        }),
      ),
    ),
  )

  it.live("routes located events only to their location", () =>
    Effect.acquireRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      (dirs) => Effect.promise(() => Promise.all(dirs.map((dir) => dir[Symbol.asyncDispose]())).then(() => undefined)),
    ).pipe(
      Effect.flatMap(([first, second]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const locations = yield* LocationServiceMap.Service
            const bus = yield* Bus.Service
            const firstRef = Location.Ref.make({ directory: AbsolutePath.make(first.path) })
            const secondRef = Location.Ref.make({ directory: AbsolutePath.make(second.path) })
            const firstContext = yield* locations.contextEffect(firstRef)
            const secondContext = yield* locations.contextEffect(secondRef)
            const received = { first: 0, second: 0 }
            yield* bus.subscribe(Config.Event.Updated).pipe(
              Stream.runForEach(() => Effect.sync(() => received.first++)),
              Effect.provideContext(firstContext),
              Effect.forkScoped({ startImmediately: true }),
            )
            yield* bus.subscribe(Config.Event.Updated).pipe(
              Stream.runForEach(() => Effect.sync(() => received.second++)),
              Effect.provideContext(secondContext),
              Effect.forkScoped({ startImmediately: true }),
            )
            yield* Effect.sleep("10 millis")

            yield* bus.publish(Config.Event.Updated, {}, { location: firstRef })
            yield* Effect.sleep("10 millis")

            expect(received).toEqual({ first: 1, second: 0 })
          }),
        ),
      ),
    ),
  )

  it.live("reuses cached services for constructed and decoded location refs", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.scoped(
          Effect.gen(function* () {
            const locations = yield* LocationServiceMap.Service
            const directory = AbsolutePath.make(dir.path)
            const constructed = Location.Ref.make({ directory })
            const decoded = Schema.decodeUnknownSync(Location.Ref)({ directory })

            expect(constructed).toEqual({ directory, workspaceID: undefined })
            expect(decoded).toEqual(constructed)
            expect(Equal.equals(constructed, decoded)).toBe(true)
            expect(Hash.hash(constructed)).toBe(Hash.hash(decoded))
            expect(yield* locations.contextEffect(constructed)).toBe(yield* locations.contextEffect(decoded))
          }),
        ),
      ),
    ),
  )

  it.live("normalizes equivalent refs to one cached location graph", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.scoped(
          Effect.gen(function* () {
            const locations = yield* LocationServiceMap.Service
            const directory = AbsolutePath.make(dir.path)
            const alternate = AbsolutePath.make(directory.replaceAll("\\", "/"))
            const absent = Location.Ref.make({ directory: alternate })
            const present = Location.Ref.make({ directory, workspaceID: undefined })
            // The two shapes are not structurally Equal: own-key sets differ.
            expect(Object.keys(absent)).toEqual(["directory"])
            expect(Object.keys(present)).toEqual(["directory", "workspaceID"])
            expect(Equal.equals(absent, present)).toBe(false)
            if (process.platform === "win32") expect(absent.directory).not.toBe(present.directory)

            expect(yield* locations.contextEffectOption(absent)).toEqual(Option.none())
            expect(Array.from(yield* RcMap.keys(locations.rcMap))).toHaveLength(0)

            const first = yield* locations.contextEffect(absent)
            expect(yield* locations.contextEffect(present)).toBe(first)
            expect(Option.getOrThrow(yield* locations.contextEffectOption(absent))).toBe(first)
            expect(Option.getOrThrow(yield* locations.contextEffectOption(present))).toBe(first)
            expect(Array.from(yield* RcMap.keys(locations.rcMap))).toEqual([
              Location.Ref.make({ directory, workspaceID: undefined }),
            ])

            // Invalidating with the shape opposite to the one that booted must evict.
            yield* locations.invalidate(present)
            expect(yield* locations.contextEffectOption(absent)).toEqual(Option.none())
            expect(yield* locations.contextEffectOption(present)).toEqual(Option.none())
            expect(Array.from(yield* RcMap.keys(locations.rcMap))).toHaveLength(0)
          }),
        ),
      ),
    ),
  )

  it.live("isolates catalog state by location", () =>
    Effect.acquireRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      (dirs) => Effect.promise(() => Promise.all(dirs.map((dir) => dir[Symbol.asyncDispose]())).then(() => undefined)),
    ).pipe(
      Effect.flatMap(([blocked, allowed]) =>
        Effect.gen(function* () {
          const update = (directory: string, providerID: Provider.ID) =>
            Effect.gen(function* () {
              yield* Reference.Service
              const catalog = yield* Catalog.Service
              yield* catalog.transform((editor) => editor.provider.update(providerID, () => {}))
              const plugins = yield* Plugin.Service
              yield* plugins.awaitActivation
              const registry = yield* Tool.Service
              return {
                providers: yield* catalog.provider.all(),
                tools: yield* toolDefinitions(registry),
              }
            }).pipe(
              Effect.scoped,
              Effect.provide(
                LocationServiceMap.Service.get(Location.Ref.make({ directory: AbsolutePath.make(directory) })),
              ),
            )

          const blockedID = Provider.ID.make("blocked-location")
          const allowedID = Provider.ID.make("allowed-location")
          const blockedState = yield* update(blocked.path, blockedID)
          expect(blockedState.providers.some((provider) => provider.id === blockedID)).toBe(true)
          expect(blockedState.providers.some((provider) => provider.id === allowedID)).toBe(false)
          const blockedTools = blockedState.tools.map((tool) => tool.name)
          expect(blockedTools.filter((name) => name !== "execute").sort()).toEqual([
            "edit",
            "glob",
            "grep",
            "patch",
            "question",
            "read",
            "shell",
            "skill",
            "subagent",
            "webfetch",
            "websearch",
            "write",
          ])
          const allowedState = yield* update(allowed.path, allowedID)
          expect(allowedState.providers.some((provider) => provider.id === allowedID)).toBe(true)
          expect(allowedState.providers.some((provider) => provider.id === blockedID)).toBe(false)
          const allowedTools = allowedState.tools.map((tool) => tool.name)
          expect(blockedTools.includes("execute")).toBe(allowedTools.includes("execute"))
          expect(allowedTools.filter((name) => name !== "execute").sort()).toEqual([
            "edit",
            "glob",
            "grep",
            "patch",
            "question",
            "read",
            "shell",
            "skill",
            "subagent",
            "webfetch",
            "websearch",
            "write",
          ])
        }),
      ),
    ),
  )

  it.live("allows the built-in Plan agent to be disabled", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            fs.writeFile(
              path.join(dir.path, "opencode.json"),
              JSON.stringify({ agents: { plan: { disabled: true } } }),
            ),
          )
          yield* Effect.gen(function* () {
            const plugins = yield* Plugin.Service
            yield* plugins.awaitActivation
            const agents = yield* Agent.Service
            expect(yield* agents.get(Agent.ID.make("plan"))).toBeUndefined()
          }).pipe(
            Effect.provide(
              LocationServiceMap.Service.get(Location.Ref.make({ directory: AbsolutePath.make(dir.path) })),
            ),
          )
        }),
      ),
    ),
  )

  it.live("rejects an unavailable selected model during location model resolution", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          yield* Effect.promise(() =>
            fs.writeFile(
              path.join(dir.path, "opencode.json"),
              JSON.stringify({
                providers: {
                  unavailable: {
                    name: "Unavailable",
                    package: "test-provider",
                    models: { chat: { disabled: true } },
                  },
                },
              }),
            ),
          )
          const failure = yield* Effect.gen(function* () {
            const catalog = yield* Catalog.Service
            const models = yield* SessionRunnerModel.Service
            return yield* models.resolve(
              Session.Info.make({
                id: Session.ID.make("ses_unavailable_model"),
                projectID: Project.ID.global,
                title: "test",
                model: {
                  id: Model.ID.make("chat"),
                  providerID: Provider.ID.make("unavailable"),
                },
                cost: Money.USD.zero,
                tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
                location,
              }),
              catalog.model.available,
            )
          }).pipe(Effect.provide(LocationServiceMap.Service.get(location)), Effect.flip)

          expect(failure).toMatchObject({
            _tag: "SessionRunnerModel.ModelUnavailableError",
            providerID: "unavailable",
            modelID: "chat",
          })
        }),
      ),
    ),
  )

  it.live("explains replacements for unavailable legacy provider models", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          for (const [providerID, replacement] of [
            ["azure-cognitive-services", "azure"],
            ["google-vertex-anthropic", "google-vertex"],
          ] as const) {
            const failure = yield* Effect.gen(function* () {
              const catalog = yield* Catalog.Service
              const models = yield* SessionRunnerModel.Service
              return yield* models.resolve(
                Session.Info.make({
                  id: Session.ID.make(`ses_removed_${providerID}`),
                  projectID: Project.ID.global,
                  title: "test",
                  model: {
                    id: Model.ID.make("chat"),
                    providerID: Provider.ID.make(providerID),
                  },
                  cost: Money.USD.zero,
                  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                  time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
                  location,
                }),
                catalog.model.available,
              )
            }).pipe(Effect.provide(LocationServiceMap.Service.get(location)), Effect.flip)

            expect(failure).toMatchObject({
              _tag: "SessionRunnerModel.ModelUnavailableError",
              providerID,
              modelID: "chat",
            })
            expect(failure.message).toBe(
              `Model unavailable: ${providerID}/chat. This provider has been deprecated; use ${replacement}/chat instead.`,
            )
          }
        }),
      ),
    ),
  )

  it.live("preserves the selected catalog identity when the package model id differs", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          const resolved = yield* Effect.gen(function* () {
            const catalog = yield* Catalog.Service
            yield* catalog.transform((editor) => {
              editor.provider.update(Provider.ID.make("aliased"), (provider) => {
                provider.package = Provider.aisdk("@ai-sdk/openai")
              })
              editor.model.update(Provider.ID.make("aliased"), Model.ID.make("fast"), (model) => {
                // Catalog id and package model id intentionally differ, like gpt-5.5-fast -> gpt-5.5.
                model.modelID = Model.ID.make("base")
                model.variants = [{ id: Model.VariantID.make("high") }]
              })
            })
            const models = yield* SessionRunnerModel.Service
            return yield* models.resolve(
              Session.Info.make({
                id: Session.ID.make("ses_aliased_model"),
                projectID: Project.ID.global,
                title: "test",
                model: {
                  id: Model.ID.make("fast"),
                  providerID: Provider.ID.make("aliased"),
                  variant: Model.VariantID.make("high"),
                },
                cost: Money.USD.zero,
                tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
                location,
              }),
              catalog.model.available,
            )
          }).pipe(Effect.provide(LocationServiceMap.Service.get(location)))

          expect(resolved.ref).toEqual(
            Model.Ref.make({
              id: Model.ID.make("fast"),
              providerID: Provider.ID.make("aliased"),
              variant: Model.VariantID.make("high"),
            }),
          )
          expect(String(resolved.model.id)).toBe("base")
        }),
      ),
    ),
  )
})
