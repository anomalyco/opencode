export * as Workspace from "./workspace"

import { eq } from "drizzle-orm"
import { Context, Effect, Exit, Layer, Schema } from "effect"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Workspace } from "@opencode-ai/schema/workspace"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Database } from "./database/database"
import { WorkspaceDriver } from "./workspace/driver"
import { WorkspaceTable } from "./workspace/sql"

export const ID = Workspace.ID
export type ID = typeof ID.Type

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Workspace.NotFoundError", {
  id: ID,
}) {}

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  provider: Schema.String,
  root: AbsolutePath,
}).annotate({ identifier: "Workspace.Info" })

export interface Interface {
  /** Allocate through the named driver and persist. Resolves when the Workspace is usable. */
  readonly create: (input: {
    readonly provider: string
  }) => Effect.Effect<Info, WorkspaceDriver.Error | WorkspaceDriver.ProviderNotFoundError>
  /** Metadata read; never contacts a driver. */
  readonly get: (id: ID) => Effect.Effect<Info, NotFoundError>
  /** Provider key and opaque binding for WorkspaceDriver.connect. Hosted Location construction only. */
  readonly binding: (
    id: ID,
  ) => Effect.Effect<{ readonly provider: string; readonly binding: WorkspaceDriver.Binding }, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Workspace") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const registry = yield* WorkspaceDriver.RegistryService

    const require = Effect.fn("Workspace.require")(function* (id: ID) {
      const row = yield* db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, id)).get().pipe(Effect.orDie)
      if (!row) return yield* new NotFoundError({ id })
      return row
    })

    return Service.of({
      create: Effect.fn("Workspace.create")(function* (input) {
        const driver = yield* registry.get(input.provider)
        const id = ID.create()
        const created = yield* Effect.acquireUseRelease(
          driver.create({ workspaceID: id }),
          (created) =>
            db
              .insert(WorkspaceTable)
              .values({ id, provider: input.provider, binding: created.binding, root: created.root })
              .pipe(Effect.orDie, Effect.as(created)),
          (created, exit) => (Exit.isFailure(exit) ? driver.destroy(created.binding).pipe(Effect.ignore) : Effect.void),
        )
        return Info.make({ id, provider: input.provider, root: AbsolutePath.make(created.root) })
      }),
      get: Effect.fn("Workspace.get")(function* (id) {
        const row = yield* require(id)
        return Info.make({ id: row.id, provider: row.provider, root: AbsolutePath.make(row.root) })
      }),
      binding: Effect.fn("Workspace.binding")(function* (id) {
        const row = yield* require(id)
        return { provider: row.provider, binding: row.binding }
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, WorkspaceDriver.registryNode] })
