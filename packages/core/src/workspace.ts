export * as Workspace from "./workspace.js"

import { Workspace } from "@opencode-ai/schema/workspace"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { eq } from "drizzle-orm"
import { Clock, Context, Deferred, Duration, Effect, Exit, FiberSet, Layer, Ref, Schedule, Schema, Scope } from "effect"
import { systemError } from "effect/PlatformError"
import { make } from "effect/unstable/process/ChildProcessSpawner"
import type { Driver as EnvironmentDriver } from "./environment/driver.js"
import { Database } from "./database/database.js"
import { KeyedMutex } from "./effect/keyed-mutex.js"
import { WorkspaceDriver } from "./workspace/driver.js"
import { WorkspaceTable } from "./workspace/sql.js"

export const ID = Workspace.ID
export type ID = Workspace.ID

export class Info extends Schema.Class<Info>("Workspace.Info")({
  id: ID,
  provider: Schema.String,
  binding: WorkspaceDriver.Binding,
  createdAt: Schema.Number,
  lastUsedAt: Schema.Number,
}) {}

export class Reservation extends Schema.Class<Reservation>("Workspace.Reservation")({
  id: ID,
}) {}

export class NotFound extends Schema.TaggedError<NotFound>()("Workspace.NotFound", { workspaceID: ID }) {}

export interface Interface {
  readonly reserve: (provider: string) => Effect.Effect<Reservation, WorkspaceDriver.ProviderNotFound>
  readonly reconcile: (
    workspaceID: ID,
  ) => Effect.Effect<Info, NotFound | WorkspaceDriver.Error | WorkspaceDriver.ProviderNotFound>
  readonly create: (provider: string) => Effect.Effect<Info, WorkspaceDriver.Error | WorkspaceDriver.ProviderNotFound>
  readonly connect: (
    workspaceID: ID,
  ) => Effect.Effect<EnvironmentDriver, NotFound | WorkspaceDriver.Error | WorkspaceDriver.ProviderNotFound>
  readonly destroy: (
    workspaceID: ID,
  ) => Effect.Effect<void, NotFound | WorkspaceDriver.Error | WorkspaceDriver.ProviderNotFound>
}

export interface Options {
  readonly idleThreshold?: Duration.Input
  readonly pollInterval?: Duration.Input
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Workspace") {}

interface Connection {
  readonly driver: WorkspaceDriver.Interface
  readonly environment: EnvironmentDriver
  readonly saveBinding: (binding: WorkspaceDriver.Binding) => Effect.Effect<void>
  readonly lastActivity: Ref.Ref<number>
  readonly active: Ref.Ref<number>
  readonly scope: Scope.Closeable
}

type ReadinessError = NotFound | WorkspaceDriver.Error | WorkspaceDriver.ProviderNotFound

export const configured = (options: Options = {}) =>
  makeGlobalNode({
    service: Service,
    layer: layer(options),
    deps: [Database.node, WorkspaceDriver.node],
  })

const layer = (options: Options) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const registry = yield* WorkspaceDriver.RegistryService
      const lifetime = yield* Scope.Scope
      const connections = new Map<ID, Connection>()
      const attempts = new Map<ID, Deferred.Deferred<Info, ReadinessError>>()
      const locks = KeyedMutex.makeUnsafe<ID>()
      const fork = yield* FiberSet.makeRuntime<never, void, never>()
      const idleThreshold = Duration.toMillis(options.idleThreshold ?? Duration.minutes(20))

      const load = Effect.fn("Workspace.load")(function* (workspaceID: ID) {
        const row = yield* db
          .select()
          .from(WorkspaceTable)
          .where(eq(WorkspaceTable.id, workspaceID))
          .get()
          .pipe(Effect.orDie)
        if (!row) return yield* new NotFound({ workspaceID })
        return row
      })

      const saveBinding = (workspaceID: ID, binding: WorkspaceDriver.Binding) =>
        db.update(WorkspaceTable).set({ binding }).where(eq(WorkspaceTable.id, workspaceID)).run().pipe(Effect.orDie)

      const info = (row: typeof WorkspaceTable.$inferSelect, binding: WorkspaceDriver.Binding) =>
        new Info({
          id: row.id,
          provider: row.provider,
          binding,
          createdAt: row.created_at,
          lastUsedAt: row.last_used_at,
        })

      const provision = Effect.fn("Workspace.provision")((workspaceID: ID) =>
        locks.withLock(workspaceID)(
          Effect.gen(function* () {
            const row = yield* load(workspaceID)
            if (row.binding) return info(row, row.binding)
            const driver = yield* registry.get(row.provider)
            const result = yield* driver.create({ workspaceID })
            yield* saveBinding(workspaceID, result.binding)
            return info(row, result.binding)
          }),
        ),
      )

      const reconcile = Effect.fn("Workspace.reconcile")((workspaceID: ID) =>
        Effect.suspend(() => {
          const existing = attempts.get(workspaceID)
          if (existing) return Deferred.await(existing)

          const attempt = Deferred.makeUnsafe<Info, ReadinessError>()
          attempts.set(workspaceID, attempt)
          fork(
            provision(workspaceID).pipe(
              Effect.onExit((exit) =>
                Effect.sync(() => {
                  if (attempts.get(workspaceID) === attempt) attempts.delete(workspaceID)
                  Deferred.doneUnsafe(attempt, exit)
                }),
              ),
              Effect.exit,
              Effect.asVoid,
            ),
          )
          return Deferred.await(attempt)
        }),
      )

      const open = Effect.fn("Workspace.open")(function* (workspaceID: ID) {
        const existing = connections.get(workspaceID)
        if (existing) return existing

        const row = yield* load(workspaceID)
        if (!row.binding) return yield* new WorkspaceDriver.Error({ message: `Workspace ${workspaceID} is not ready` })
        const driver = yield* registry.get(row.provider)
        const persistBinding = (binding: WorkspaceDriver.Binding) => saveBinding(workspaceID, binding)
        const scope = yield* Scope.fork(lifetime)
        const environment = yield* driver
          .connect({ workspaceID, binding: row.binding, saveBinding: persistBinding })
          .pipe(
            Effect.provideService(Scope.Scope, scope),
            Effect.onError((cause) => Scope.close(scope, Exit.failCause(cause))),
          )
        const now = yield* Clock.currentTimeMillis
        const connection: Connection = {
          driver,
          environment,
          saveBinding: persistBinding,
          lastActivity: yield* Ref.make(now),
          active: yield* Ref.make(0),
          scope,
        }
        connections.set(workspaceID, connection)
        yield* db
          .update(WorkspaceTable)
          .set({ last_used_at: now })
          .where(eq(WorkspaceTable.id, workspaceID))
          .run()
          .pipe(Effect.orDie)
        return connection
      })

      yield* Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        yield* Effect.forEach(
          [...connections.entries()],
          ([workspaceID, expected]) =>
            locks.withLock(workspaceID)(
              Effect.gen(function* () {
                const connection = connections.get(workspaceID)
                if (connection !== expected || (yield* Ref.get(connection.active)) > 0) return
                const lastActivity = yield* Ref.get(connection.lastActivity)
                if (now - lastActivity < idleThreshold) return
                const row = yield* load(workspaceID)
                if (!row.binding) return
                // Deliberate: a racing spawn blocks, then wakes cleanly. Unlocking mid-suspend could reattach a sandbox being terminated.
                yield* connection.driver.suspendForIdle({
                  workspaceID,
                  binding: row.binding,
                  saveBinding: connection.saveBinding,
                })
                yield* db
                  .update(WorkspaceTable)
                  .set({ last_used_at: lastActivity })
                  .where(eq(WorkspaceTable.id, workspaceID))
                  .run()
                  .pipe(Effect.orDie)
                connections.delete(workspaceID)
                yield* Scope.close(connection.scope, Exit.void)
              }).pipe(Effect.catchCause((cause) => Effect.logError("workspace idle suspension failed", cause))),
            ),
          { concurrency: "unbounded", discard: true },
        )
      }).pipe(Effect.repeat(Schedule.spaced(options.pollInterval ?? Duration.minutes(1))), Effect.forkScoped)

      const reserve = Effect.fn("Workspace.reserve")(function* (provider: string) {
        yield* registry.get(provider)
        const workspaceID = ID.create()
        const now = yield* Clock.currentTimeMillis
        yield* db
          .insert(WorkspaceTable)
          .values({ id: workspaceID, provider, binding: null, created_at: now, last_used_at: now })
          .run()
          .pipe(Effect.orDie)
        return new Reservation({ id: workspaceID })
      })

      return Service.of({
        reserve,
        reconcile,
        create: Effect.fn("Workspace.create")(function* (provider) {
          const reservation = yield* reserve(provider)
          return yield* reconcile(reservation.id).pipe(Effect.catchTag("Workspace.NotFound", Effect.die))
        }),
        connect: Effect.fn("Workspace.connect")(function* (workspaceID) {
          const spawner = make((command) =>
            Effect.acquireRelease(
              reconcile(workspaceID).pipe(
                Effect.andThen(
                  locks.withLock(workspaceID)(
                    Effect.gen(function* () {
                      const connection = yield* open(workspaceID)
                      yield* Ref.set(connection.lastActivity, yield* Clock.currentTimeMillis)
                      yield* Ref.update(connection.active, (active) => active + 1)
                      return connection
                    }),
                  ),
                ),
                Effect.mapError((cause) =>
                  systemError({
                    _tag: "Unknown",
                    module: "Workspace",
                    method: "spawn",
                    description: `Failed to wake workspace ${workspaceID}`,
                    cause,
                  }),
                ),
              ),
              (connection) =>
                locks.withLock(workspaceID)(
                  Effect.gen(function* () {
                    yield* Ref.update(connection.active, (active) => active - 1)
                    yield* Ref.set(connection.lastActivity, yield* Clock.currentTimeMillis)
                  }),
                ),
            ).pipe(Effect.flatMap((connection) => connection.environment.spawner.spawn(command))),
          )
          // Overrides are connection-bound; per-spawn routing is required before any driver ships them, so they are deliberately omitted.
          return { spawner }
        }),
        destroy: Effect.fn("Workspace.destroy")(function* (workspaceID) {
          yield* locks.withLock(workspaceID)(
            Effect.gen(function* () {
              const row = yield* load(workspaceID)
              const connection = connections.get(workspaceID)
              connections.delete(workspaceID)
              if (connection) yield* Scope.close(connection.scope, Exit.void)
              if (row.binding) {
                const driver = yield* registry.get(row.provider)
                yield* driver.destroy({ workspaceID, binding: row.binding })
              }
              yield* db.delete(WorkspaceTable).where(eq(WorkspaceTable.id, workspaceID)).run().pipe(Effect.orDie)
            }),
          )
        }),
      })
    }),
  )

export const node = configured()

// TODO(workspace-plan): add the boot janitor and ~23h safety snapshot rotation in a later PR.
// TODO(workspace-plan): make cold wake interruptible with a re-pin loop against janitor races.
// TODO(workspace-plan): consider RcMap at end-of-series consolidation; idle suspend and destroy need distinct finalizers.
