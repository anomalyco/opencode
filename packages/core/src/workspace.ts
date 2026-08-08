export * as Workspace from "./workspace"

import { Workspace } from "@opencode-ai/schema/workspace"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { eq } from "drizzle-orm"
import { Clock, Context, Duration, Effect, Exit, Layer, Ref, Schedule, Schema, Scope } from "effect"
import { make as makeSpawner } from "effect/unstable/process/ChildProcessSpawner"
import type { Driver as EnvironmentDriver } from "./environment/driver"
import { Database } from "./database/database"
import { KeyedMutex } from "./effect/keyed-mutex"
import { WorkspaceDriver } from "./workspace/driver"
import { WorkspaceTable } from "./workspace/sql"

export const ID = Workspace.ID
export type ID = Workspace.ID

export class Info extends Schema.Class<Info>("Workspace.Info")({
  id: ID,
  provider: Schema.String,
  binding: Schema.NullOr(WorkspaceDriver.Binding),
  createdAt: Schema.Number,
  lastUsedAt: Schema.Number,
}) {}

export class NotFound extends Schema.TaggedErrorClass<NotFound>()("Workspace.NotFound", { workspaceID: ID }) {}

export class BindingNotFound extends Schema.TaggedErrorClass<BindingNotFound>()("Workspace.BindingNotFound", {
  workspaceID: ID,
}) {}

export interface Interface {
  readonly create: (provider: string) => Effect.Effect<Info, WorkspaceDriver.Error | WorkspaceDriver.ProviderNotFound>
  readonly connect: (
    workspaceID: ID,
  ) => Effect.Effect<
    EnvironmentDriver,
    NotFound | BindingNotFound | WorkspaceDriver.Error | WorkspaceDriver.ProviderNotFound,
    Scope.Scope
  >
  readonly destroy: (
    workspaceID: ID,
  ) => Effect.Effect<void, NotFound | BindingNotFound | WorkspaceDriver.Error | WorkspaceDriver.ProviderNotFound>
}

export interface Options {
  readonly idleThreshold?: Duration.Input
  readonly pollInterval?: Duration.Input
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Workspace") {}

interface Connection {
  readonly driver: WorkspaceDriver.Interface
  readonly environment: EnvironmentDriver
  readonly binding: Ref.Ref<WorkspaceDriver.Binding>
  readonly saveBinding: (binding: WorkspaceDriver.Binding) => Effect.Effect<void>
  readonly lastActivity: Ref.Ref<number>
  readonly active: Ref.Ref<number>
  readonly scope: Scope.Closeable
}

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
      const locks = KeyedMutex.makeUnsafe<ID>()
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

      const open = Effect.fn("Workspace.open")(function* (workspaceID: ID) {
        const existing = connections.get(workspaceID)
        if (existing) return existing

        const row = yield* load(workspaceID)
        if (!row.binding) return yield* new BindingNotFound({ workspaceID })
        const driver = yield* registry.get(row.provider)
        const binding = yield* Ref.make(row.binding)
        const saveBinding = (value: WorkspaceDriver.Binding) =>
          db
            .update(WorkspaceTable)
            .set({ binding: value })
            .where(eq(WorkspaceTable.id, workspaceID))
            .run()
            .pipe(Effect.orDie, Effect.andThen(Ref.set(binding, value)))
        const scope = yield* Scope.fork(lifetime)
        const environment = yield* driver.connect({ workspaceID, binding: row.binding, saveBinding }).pipe(
          Effect.provideService(Scope.Scope, scope),
          Effect.onError((cause) => Scope.close(scope, Exit.failCause(cause))),
        )
        const connection: Connection = {
          driver,
          environment,
          binding,
          saveBinding,
          lastActivity: yield* Ref.make(yield* Clock.currentTimeMillis),
          active: yield* Ref.make(0),
          scope,
        }
        connections.set(workspaceID, connection)
        yield* db
          .update(WorkspaceTable)
          .set({ last_used_at: yield* Clock.currentTimeMillis })
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
                if (now - (yield* Ref.get(connection.lastActivity)) < idleThreshold) return
                yield* connection.driver.suspendForIdle({
                  binding: yield* Ref.get(connection.binding),
                  saveBinding: connection.saveBinding,
                })
                connections.delete(workspaceID)
                yield* Scope.close(connection.scope, Exit.void)
              }).pipe(Effect.catchCause((cause) => Effect.logError("workspace idle suspension failed", cause))),
            ),
          { concurrency: "unbounded", discard: true },
        )
      }).pipe(Effect.repeat(Schedule.spaced(options.pollInterval ?? Duration.minutes(1))), Effect.forkScoped)

      return Service.of({
        create: Effect.fn("Workspace.create")(function* (provider) {
          const driver = yield* registry.get(provider)
          const workspaceID = ID.create()
          const result = yield* driver.create({ workspaceID })
          const now = yield* Clock.currentTimeMillis
          yield* db
            .insert(WorkspaceTable)
            .values({ id: workspaceID, provider, binding: result.binding, created_at: now, last_used_at: now })
            .run()
            .pipe(Effect.orDie)
          return new Info({ id: workspaceID, provider, binding: result.binding, createdAt: now, lastUsedAt: now })
        }),
        connect: Effect.fn("Workspace.connect")(function* (workspaceID) {
          yield* Scope.Scope
          const initial = yield* locks.withLock(workspaceID)(open(workspaceID))
          const spawner = makeSpawner((command) =>
            Effect.acquireRelease(
              locks.withLock(workspaceID)(
                Effect.gen(function* () {
                  const connection = yield* open(workspaceID).pipe(Effect.orDie)
                  yield* Ref.set(connection.lastActivity, yield* Clock.currentTimeMillis)
                  yield* Ref.update(connection.active, (active) => active + 1)
                  return connection
                }),
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
          return { spawner, overrides: initial.environment.overrides }
        }),
        destroy: Effect.fn("Workspace.destroy")(function* (workspaceID) {
          yield* locks.withLock(workspaceID)(
            Effect.gen(function* () {
              const row = yield* load(workspaceID)
              if (!row.binding) return yield* new BindingNotFound({ workspaceID })
              const connection = connections.get(workspaceID)
              connections.delete(workspaceID)
              if (connection) yield* Scope.close(connection.scope, Exit.void)
              const driver = yield* registry.get(row.provider)
              yield* driver.destroy({ binding: connection ? yield* Ref.get(connection.binding) : row.binding })
              yield* db.delete(WorkspaceTable).where(eq(WorkspaceTable.id, workspaceID)).run().pipe(Effect.orDie)
            }),
          )
        }),
      })
    }),
  )

export const node = configured()

// TODO(workspace-plan): add the boot janitor and ~23h safety snapshot rotation in a later PR.
