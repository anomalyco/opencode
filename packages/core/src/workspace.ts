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

export class NotFound extends Schema.TaggedError<NotFound>()("Workspace.NotFound", { workspaceID: ID }) {}

export class CreateConflict extends Schema.TaggedError<CreateConflict>()("Workspace.CreateConflict", {
  workspaceID: ID,
  provider: Schema.String,
  existingProvider: Schema.String,
}) {}

export interface Interface {
  /** Instantly commits a logical workspace ID. No provider work happens here. */
  readonly create: (input: {
    readonly id?: ID
    readonly provider: string
  }) => Effect.Effect<ID, CreateConflict | WorkspaceDriver.ProviderNotFound>
  /** Starts or joins the shared attempt that makes the backing resource real, then returns it. */
  readonly provision: (
    workspaceID: ID,
  ) => Effect.Effect<Info, NotFound | WorkspaceDriver.Error | WorkspaceDriver.ProviderNotFound>
  readonly connect: (
    workspaceID: ID,
  ) => Effect.Effect<EnvironmentDriver, NotFound | WorkspaceDriver.Error | WorkspaceDriver.ProviderNotFound>
  /** Makes the workspace absent; reports whether this call destroyed an existing workspace. */
  readonly destroy: (workspaceID: ID) => Effect.Effect<
    Workspace.DestroyResult,
    WorkspaceDriver.Error | WorkspaceDriver.ProviderNotFound
  >
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
      // Destroy cancels the racing provision body by settling the deferred.
      const attempts = new Map<ID, Deferred.Deferred<Info, ReadinessError>>()
      const locks = KeyedMutex.makeUnsafe<ID>()
      const fork = yield* FiberSet.makeRuntime<never, void, never>()
      const idleThreshold = Duration.toMillis(options.idleThreshold ?? Duration.minutes(20))

      const find = (workspaceID: ID) =>
        db
          .select()
          .from(WorkspaceTable)
          .where(eq(WorkspaceTable.id, workspaceID))
          .get()
          .pipe(Effect.orDie)

      const load = Effect.fn("Workspace.load")(function* (workspaceID: ID) {
        const row = yield* find(workspaceID)
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
        Effect.suspend(() => {
          const existing = attempts.get(workspaceID)
          if (existing) return Deferred.await(existing)

          const attempt = Deferred.makeUnsafe<Info, ReadinessError>()
          attempts.set(workspaceID, attempt)
          fork(
            locks
              .withLock(workspaceID)(
                Effect.gen(function* () {
                  const row = yield* load(workspaceID)
                  if (row.binding) return info(row, row.binding)
                  const driver = yield* registry.get(row.provider)
                  const result = yield* driver.create({ workspaceID })
                  yield* saveBinding(workspaceID, result.binding)
                  return info(row, result.binding)
                }),
              )
              .pipe(
                Effect.raceFirst(Deferred.await(attempt)),
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
        // Bindings are persisted before provision resolves and never nulled; a raced
        // destroy deletes the whole row and surfaces as NotFound from load above.
        if (!row.binding) return yield* Effect.die(`workspace ${workspaceID} has no binding after provision`)
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

      return Service.of({
        create: Effect.fn("Workspace.create")(function* (input) {
          const workspaceID = input.id ?? ID.create()
          const existing = yield* db
            .select({ provider: WorkspaceTable.provider })
            .from(WorkspaceTable)
            .where(eq(WorkspaceTable.id, workspaceID))
            .get()
            .pipe(Effect.orDie)
          if (existing) {
            if (existing.provider === input.provider) return workspaceID
            return yield* new CreateConflict({
              workspaceID,
              provider: input.provider,
              existingProvider: existing.provider,
            })
          }
          yield* registry.get(input.provider)
          const now = yield* Clock.currentTimeMillis
          const inserted = yield* db
            .insert(WorkspaceTable)
            .values({ id: workspaceID, provider: input.provider, binding: null, created_at: now, last_used_at: now })
            .onConflictDoNothing()
            .returning({ id: WorkspaceTable.id })
            .get()
            .pipe(Effect.orDie)
          if (inserted) return workspaceID
          const row = yield* load(workspaceID).pipe(Effect.orDie)
          if (row.provider !== input.provider)
            return yield* new CreateConflict({
              workspaceID,
              provider: input.provider,
              existingProvider: row.provider,
            })
          return workspaceID
        }),
        provision,
        connect: Effect.fn("Workspace.connect")(function* (workspaceID) {
          const spawner = make((command) =>
            Effect.acquireRelease(
              // A live connection implies the binding is already persisted, so skip the provision hop.
              Effect.suspend(() => (connections.has(workspaceID) ? Effect.void : provision(workspaceID))).pipe(
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
          // Settling the shared attempt cancels its racing provision body and fails
          // waiters with NotFound before teardown commits. Accepted tradeoffs: if the
          // locked teardown below fails, those waiters saw NotFound for a workspace
          // that still exists (the next provision retries it), and a provision racing
          // this window may briefly succeed before teardown destroys its fresh binding.
          const attempt = attempts.get(workspaceID)
          if (attempt) {
            attempts.delete(workspaceID)
            Deferred.doneUnsafe(attempt, Exit.fail(new NotFound({ workspaceID })))
          }
          return yield* locks.withLock(workspaceID)(
            Effect.gen(function* () {
              const row = yield* find(workspaceID)
              if (!row) return { destroyed: false }
              const connection = connections.get(workspaceID)
              connections.delete(workspaceID)
              if (connection) yield* Scope.close(connection.scope, Exit.void)
              // Null binding still reaches the driver: an interrupted or crashed
              // provision may have created a resource that was never persisted. A
              // provider missing from the registry cannot block deleting a
              // never-provisioned row.
              yield* registry.get(row.provider).pipe(
                Effect.flatMap((driver) => driver.destroy({ workspaceID, binding: row.binding })),
                Effect.catchTag("WorkspaceDriver.ProviderNotFound", (error) =>
                  row.binding ? Effect.fail(error) : Effect.void,
                ),
              )
              yield* db.delete(WorkspaceTable).where(eq(WorkspaceTable.id, workspaceID)).run().pipe(Effect.orDie)
              return { destroyed: true }
            }),
          )
        }),
      })
    }),
  )

export const node = configured()

// TODO(workspace-plan): add the boot janitor and ~23h safety snapshot rotation in a later PR.
// TODO(workspace-plan): make cold wake interruptible with a re-pin loop against janitor races.
// TODO(workspace-plan): consider extracting a keyed shared-attempt helper (join/cancel, drop-on-settle) beside
// KeyedMutex at end-of-series consolidation; filesystem/search.ts and session/run-coordinator.ts hand-roll the same
// shape. Audited stdlib alternatives (rc.111): RcMap fails twice (refcount release cancels in-flight work when the
// last waiter leaves, and one finalizer path cannot express idle-suspend vs destroy); Cache interrupts the shared
// lookup when its last awaiter is interrupted and cannot fail waiters with NotFound on invalidation.
