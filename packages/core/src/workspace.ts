export * as Workspace from "./workspace.js"

import { Workspace } from "@opencode/schema/workspace"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { eq } from "drizzle-orm"
import {
  Cause,
  Clock,
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  FiberSet,
  Layer,
  Ref,
  Schedule,
  Schema,
  Scope,
} from "effect"
import { Database } from "./database/database.js"
import { KeyedMutex } from "./effect/keyed-mutex.js"
import { EnvironmentDriver } from "./environment/driver.js"
import { KV } from "./kv.js"
import { Identity } from "./machine/identity.js"
import { WorkspaceDriver } from "./workspace/driver.js"
import { WorkspaceTable } from "./workspace/sql.js"

export const ID = Workspace.ID
export type ID = Workspace.ID

/** Disjoint from Machines.Name (which disallows underscores) and from "local". */
export const isID = (value: string): value is ID => /^wrk_[A-Za-z0-9_-]+$/.test(value)

const IDLE_PREFIX = "workspace.idle:"
const idleKey = (workspaceID: ID) => `${IDLE_PREFIX}${workspaceID}`
const parseDeadline = (value: KV.Value | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined

export class Info extends Schema.Class<Info>("Workspace.Info")({
  id: ID,
  provider: Schema.String,
  binding: WorkspaceDriver.Binding,
  createdAt: Schema.Number,
  lastUsedAt: Schema.Number,
}) {}

export class NotFound extends Schema.TaggedError<NotFound>()("Workspace.NotFound", { workspaceID: ID }) {
  override get message() {
    return `No workspace named ${JSON.stringify(this.workspaceID)}.`
  }
}

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
  /**
   * Registers an already-provisioned workspace binding without calling `driver.create()`.
   *
   * Re-attaching an existing ID for the same provider replaces the stored binding (the caller owns
   * teardown of any previously bound resource), drops any cached connection, and clears any stale
   * idle deadline.
   */
  readonly attach: (input: {
    readonly id?: ID
    readonly provider: string
    readonly binding: WorkspaceDriver.Binding
  }) => Effect.Effect<ID, CreateConflict | WorkspaceDriver.ProviderNotFound>
  /** Starts or joins the shared attempt that makes the backing resource real, then returns it. */
  readonly provision: (
    workspaceID: ID,
  ) => Effect.Effect<Info, NotFound | WorkspaceDriver.Error | WorkspaceDriver.ProviderNotFound>
  readonly connect: (
    workspaceID: ID,
  ) => Effect.Effect<EnvironmentDriver.Driver, NotFound | WorkspaceDriver.Error | WorkspaceDriver.ProviderNotFound>
  /** Whether a logical workspace row exists; never wakes or provisions the backing resource. */
  readonly exists: (workspaceID: ID) => Effect.Effect<boolean>
  /** Whether the workspace currently holds a live connection in memory; never wakes or provisions it. */
  readonly connected: (workspaceID: ID) => Effect.Effect<boolean>
  /**
   * Suspends any workspaces past `idleThreshold` (closing warm connections past `keepWarm`),
   * re-arms `onIdleScheduled` for the next pending deadline, and returns the IDs suspended in this pass.
   */
  readonly suspendIdle: () => Effect.Effect<ReadonlyArray<ID>>
  /** Makes the workspace absent; reports whether this call destroyed an existing workspace. */
  readonly destroy: (
    workspaceID: ID,
  ) => Effect.Effect<Workspace.DestroyResult, WorkspaceDriver.Error | WorkspaceDriver.ProviderNotFound>
}

export interface Options {
  readonly idleThreshold?: Duration.Input
  /**
   * How long to keep an open connection warm after its last active operation completes.
   * Set to `0` on serverless runtimes (such as Cloudflare Durable Objects) to close connections
   * immediately when idle so the isolate can hibernate at zero idle cost. Intermediate values
   * between `0` and `idleThreshold` are enforced on each `suspendIdle` pass (periodic poll or alarm).
   * Defaults to `idleThreshold`.
   */
  readonly keepWarm?: Duration.Input
  /**
   * Background idle-poll interval, or `null` to disable background polling (e.g. Durable Objects driven by `alarm()`).
   * Defaults to 1 minute.
   */
  readonly pollInterval?: Duration.Input | null
  /** Called with the earliest pending idle-suspend epoch timestamp whenever deadlines change (e.g. `storage.setAlarm`). */
  readonly onIdleScheduled?: (atMs: number) => Effect.Effect<void, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Workspace") {}

interface Connection {
  readonly driver: WorkspaceDriver.Interface
  readonly environment: EnvironmentDriver.Driver
  readonly lastActivity: Ref.Ref<number>
  readonly active: Ref.Ref<number>
  readonly scope: Scope.Closeable
}

type ReadinessError = NotFound | WorkspaceDriver.Error | WorkspaceDriver.ProviderNotFound

export const configured = (options: Options = {}) =>
  makeGlobalNode({
    service: Service,
    layer: layer(options),
    deps: [Database.node, KV.node, Identity.node, WorkspaceDriver.node],
  })

const layer = (options: Options) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const kv = yield* KV.Service
      const hostIdentity = yield* Identity.Service
      // Workspace drivers may read the home public key and sign Link handshakes, never export the raw private seed.
      const identity = Identity.Service.of({
        publicKey: hostIdentity.publicKey,
        sign: hostIdentity.sign,
        seed: () =>
          Effect.fail(
            new Identity.InvalidKey({ file: "workspace", reason: "seed is not exposed to workspace drivers" }),
          ),
      })
      const registry = yield* WorkspaceDriver.RegistryService
      const lifetime = yield* Scope.Scope
      const connections = new Map<ID, Connection>()
      // Destroy cancels the racing provision body by settling the deferred.
      const attempts = new Map<ID, Deferred.Deferred<Info, ReadinessError>>()
      const locks = KeyedMutex.makeUnsafe<ID>()
      const fork = yield* FiberSet.makeRuntime<never, void, never>()
      const idleThreshold = Duration.toMillis(options.idleThreshold ?? Duration.minutes(20))
      const keepWarm = options.keepWarm === undefined ? idleThreshold : Duration.toMillis(options.keepWarm)
      const scheduledIdleAt = yield* Ref.make<number | undefined>(undefined)

      const find = (workspaceID: ID) =>
        db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, workspaceID)).get().pipe(Effect.orDie)

      const load = Effect.fn("Workspace.load")(function* (workspaceID: ID) {
        const row = yield* find(workspaceID)
        if (!row) return yield* new NotFound({ workspaceID })
        return row
      })

      const saveBinding = (workspaceID: ID, binding: WorkspaceDriver.Binding) =>
        db.update(WorkspaceTable).set({ binding }).where(eq(WorkspaceTable.id, workspaceID)).run().pipe(Effect.orDie)

      const touch = (workspaceID: ID, lastUsedAt: number) =>
        db
          .update(WorkspaceTable)
          .set({ last_used_at: lastUsedAt })
          .where(eq(WorkspaceTable.id, workspaceID))
          .run()
          .pipe(Effect.orDie)

      const closeScope = (scope: Scope.Closeable) =>
        Scope.close(scope, Exit.void).pipe(
          Effect.catchCause((cause) => Effect.logError("workspace connection close failed", cause)),
        )

      const dropConnection = (workspaceID: ID) =>
        Effect.suspend(() => {
          const connection = connections.get(workspaceID)
          if (!connection) return Effect.void
          connections.delete(workspaceID)
          return closeScope(connection.scope)
        })

      const info = (row: typeof WorkspaceTable.$inferSelect, binding: WorkspaceDriver.Binding) =>
        new Info({
          id: row.id,
          provider: row.provider,
          binding,
          createdAt: row.created_at,
          lastUsedAt: row.last_used_at,
        })

      const readIdleDue = (workspaceID: ID) => Effect.map(kv.get(idleKey(workspaceID)), parseDeadline)

      const listPendingIdle = (
        after?: string,
      ): Effect.Effect<ReadonlyArray<{ readonly id: ID; readonly dueAt: number }>> =>
        Effect.gen(function* () {
          const page = yield* kv.scan({ prefix: IDLE_PREFIX, after, limit: 1000 })
          const entries = page.entries.flatMap((entry) => {
            const id = entry.key.slice(IDLE_PREFIX.length)
            const dueAt = parseDeadline(entry.value)
            return isID(id) && dueAt !== undefined ? [{ id, dueAt }] : []
          })
          if (!page.next) return entries
          return [...entries, ...(yield* listPendingIdle(page.next))]
        })

      const scheduleNextIdle = (force = false) =>
        Effect.gen(function* () {
          if (!options.onIdleScheduled) return
          const pending = yield* listPendingIdle()
          if (pending.length === 0) {
            yield* Ref.set(scheduledIdleAt, undefined)
            return
          }
          const earliest = pending.reduce((min, entry) => Math.min(min, entry.dueAt), Number.POSITIVE_INFINITY)
          if (!force && earliest === (yield* Ref.get(scheduledIdleAt))) return
          yield* options.onIdleScheduled(earliest).pipe(
            Effect.tap(() => Ref.set(scheduledIdleAt, earliest)),
            Effect.catchCause((cause) =>
              Ref.set(scheduledIdleAt, undefined).pipe(
                Effect.andThen(Effect.logError("workspace idle scheduling failed", cause)),
              ),
            ),
          )
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
                  const result = yield* driver
                    .create({ workspaceID })
                    .pipe(Effect.provideService(Identity.Service, identity))
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
        const scope = yield* Scope.fork(lifetime)
        const environment = yield* driver
          .connect({ workspaceID, binding: row.binding, saveBinding: (binding) => saveBinding(workspaceID, binding) })
          .pipe(
            Effect.provideService(Identity.Service, identity),
            Effect.provideService(Scope.Scope, scope),
            Effect.onError((cause) => Scope.close(scope, Exit.failCause(cause))),
          )
        const now = yield* Clock.currentTimeMillis
        const connection: Connection = {
          driver,
          environment,
          lastActivity: yield* Ref.make(now),
          active: yield* Ref.make(0),
          scope,
        }
        connections.set(workspaceID, connection)
        yield* touch(workspaceID, now)
        // Arm a durable idle deadline on open so even a hard crash/eviction mid-operation suspends the sandbox later.
        yield* kv.set(idleKey(workspaceID), now + idleThreshold)
        yield* scheduleNextIdle()
        return connection
      })

      const suspendIdle = Effect.fn("Workspace.suspendIdle")(function* () {
        const now = yield* Clock.currentTimeMillis
        const pending = yield* listPendingIdle()
        const candidates = new Set<ID>([...connections.keys(), ...pending.map((entry) => entry.id)])

        const results = yield* Effect.forEach(
          candidates,
          (workspaceID) =>
            locks.withLock(workspaceID)(
              Effect.gen(function* () {
                const connection = connections.get(workspaceID)
                const dueAt = yield* readIdleDue(workspaceID)

                if (connection && (yield* Ref.get(connection.active)) > 0) {
                  // Push past deadlines forward while an operation is still running so external schedulers never tight-loop.
                  if (dueAt !== undefined && now >= dueAt) {
                    yield* kv.set(idleKey(workspaceID), now + idleThreshold)
                  }
                  return undefined
                }

                const lastActivity = connection ? yield* Ref.get(connection.lastActivity) : undefined
                const suspendAt = dueAt ?? (lastActivity !== undefined ? lastActivity + idleThreshold : undefined)

                if (suspendAt === undefined || now < suspendAt) {
                  if (lastActivity !== undefined && now - lastActivity >= keepWarm) {
                    if (dueAt === undefined) yield* kv.set(idleKey(workspaceID), lastActivity + idleThreshold)
                    yield* dropConnection(workspaceID)
                    yield* touch(workspaceID, lastActivity)
                  }
                  return undefined
                }

                const row = yield* find(workspaceID)
                if (!row || !row.binding) {
                  yield* dropConnection(workspaceID)
                  yield* kv.remove(idleKey(workspaceID))
                  return undefined
                }

                const driver = connection?.driver ?? (yield* registry.get(row.provider))
                // Deliberate: a racing spawn blocks, then wakes cleanly. Unlocking mid-suspend could reattach a sandbox being terminated.
                yield* driver.suspendForIdle({
                  workspaceID,
                  binding: row.binding,
                  saveBinding: (binding) => saveBinding(workspaceID, binding),
                })
                yield* dropConnection(workspaceID)
                yield* touch(workspaceID, lastActivity ?? row.last_used_at)
                yield* kv.remove(idleKey(workspaceID))
                return workspaceID
              }).pipe(
                Effect.catchCause((cause) =>
                  Cause.hasInterruptsOnly(cause)
                    ? Effect.interrupt
                    : Effect.logError("workspace idle suspension failed", cause).pipe(
                        // Back off so a broken/missing provider never spams retries on every poll or scheduled wake.
                        Effect.andThen(kv.set(idleKey(workspaceID), now + idleThreshold)),
                        Effect.as(undefined),
                      ),
                ),
              ),
            ),
          { concurrency: "unbounded" },
        )

        // Force re-arm because firing a one-shot external timer consumes its scheduled slot.
        yield* scheduleNextIdle(true)
        return results.filter((id): id is ID => id !== undefined)
      })

      // Re-arm any persisted idle deadlines at startup in case a prior schedule call failed or the isolate restarted.
      yield* scheduleNextIdle()

      if (options.pollInterval !== null) {
        yield* suspendIdle().pipe(
          Effect.asVoid,
          Effect.repeat(Schedule.spaced(options.pollInterval ?? Duration.minutes(1))),
          Effect.forkScoped,
        )
      }

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
        attach: Effect.fn("Workspace.attach")(function* (input) {
          yield* registry.get(input.provider)
          const workspaceID = input.id ?? ID.create()
          return yield* locks.withLock(workspaceID)(
            Effect.gen(function* () {
              const now = yield* Clock.currentTimeMillis
              const inserted = yield* db
                .insert(WorkspaceTable)
                .values({
                  id: workspaceID,
                  provider: input.provider,
                  binding: input.binding,
                  created_at: now,
                  last_used_at: now,
                })
                .onConflictDoNothing()
                .returning({ id: WorkspaceTable.id })
                .get()
                .pipe(Effect.orDie)
              if (inserted) return workspaceID

              const existing = yield* load(workspaceID).pipe(Effect.orDie)
              if (existing.provider !== input.provider) {
                return yield* new CreateConflict({
                  workspaceID,
                  provider: input.provider,
                  existingProvider: existing.provider,
                })
              }
              const old = connections.get(workspaceID)
              if (old) {
                connections.delete(workspaceID)
                // If an op is still running on the old binding, let its last release close the old scope cleanly.
                if ((yield* Ref.get(old.active)) === 0) yield* closeScope(old.scope)
              }
              yield* db
                .update(WorkspaceTable)
                .set({ binding: input.binding, last_used_at: now })
                .where(eq(WorkspaceTable.id, workspaceID))
                .run()
                .pipe(Effect.orDie)
              yield* kv.remove(idleKey(workspaceID))
              yield* scheduleNextIdle()
              return workspaceID
            }),
          )
        }),
        provision,
        connect: Effect.fn("Workspace.connect")(function* (workspaceID) {
          const acquire = Effect.acquireRelease(
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
            ),
            (connection) =>
              locks.withLock(workspaceID)(
                Effect.gen(function* () {
                  const active = yield* Ref.updateAndGet(connection.active, (count) => count - 1)
                  const now = yield* Clock.currentTimeMillis
                  yield* Ref.set(connection.lastActivity, now)
                  if (active > 0) return
                  // Connection was detached by re-attach or destroy while this op ran: close only its own scope.
                  if (connections.get(workspaceID) !== connection) return yield* closeScope(connection.scope)
                  yield* touch(workspaceID, now)
                  yield* kv.set(idleKey(workspaceID), now + idleThreshold)
                  if (keepWarm === 0) yield* dropConnection(workspaceID)
                  yield* scheduleNextIdle()
                }),
              ),
          )
          return EnvironmentDriver.lazy(
            Effect.map(acquire, (connection) => connection.environment),
            { module: "Workspace", spawnDescription: `Failed to wake workspace ${workspaceID}` },
          )
        }),
        exists: Effect.fn("Workspace.exists")(function* (workspaceID) {
          return (yield* find(workspaceID)) !== undefined
        }),
        connected: (workspaceID) => Effect.sync(() => connections.has(workspaceID)),
        suspendIdle,
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
              yield* dropConnection(workspaceID)
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
              yield* kv.remove(idleKey(workspaceID))
              yield* scheduleNextIdle()
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
// lookup when the last consumer leaves and cannot fail waiters with NotFound on invalidation; Semaphore is
// single-key. Revisit if Effect adds a keyed join/cancel primitive.
