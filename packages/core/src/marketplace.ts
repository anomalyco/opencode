export * as MarketplaceLocal from "./marketplace.js"

import { randomUUID } from "node:crypto"
import path from "node:path"
import { eq } from "drizzle-orm"
import { Clock, Context, Effect, FileSystem, Layer, Record, Schema } from "effect"
import { Marketplace } from "@opencode/schema/marketplace"
import { Config } from "@opencode/schema/config"
import { Agent } from "@opencode/schema/agent"
import { AbsolutePath, NonNegativeInt } from "@opencode/schema/schema"
import { Hash } from "@opencode/util/hash"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { filesystem } from "@opencode/util/effect/app-node-platform"
import { Database } from "./database/database.js"
import { MarketplaceTable } from "./marketplace/sql.js"

export const Key = Schema.String.check(Schema.isPattern(/^pkg_[a-f0-9]{64}$/)).pipe(
  Schema.brand("MarketplaceLocal.Key"),
  Schema.annotate({ identifier: "MarketplaceLocal.Key" }),
)
export type Key = typeof Key.Type

export interface Installed extends Schema.Schema.Type<typeof Installed> {}
export const Installed = Schema.Struct({
  file: AbsolutePath,
  catalog: Marketplace.Name,
  item: Marketplace.Name,
  name: Schema.NonEmptyString,
  version: Schema.NonEmptyString,
  digest: Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/)),
  agents: Marketplace.AgentItem.fields.install.fields.agents,
}).annotate({ identifier: "MarketplaceLocal.Installed" })

export interface State extends Schema.Schema.Type<typeof State> {}
export const State = Schema.Struct({
  revision: NonNegativeInt,
  installed: Schema.Record(Key, Installed),
}).annotate({ identifier: "MarketplaceLocal.State" })

export interface Plan extends Schema.Schema.Type<typeof Plan> {}
export const Plan = Schema.Struct({
  id: Schema.String,
  revision: NonNegativeInt,
  expires: NonNegativeInt,
  key: Key,
  installed: Installed,
}).annotate({ identifier: "MarketplaceLocal.Plan" })

export class Failed extends Schema.TaggedError<Failed>()("Marketplace.Failed", {
  reason: Schema.Literals(["catalog", "item", "plan", "expired", "revision", "capacity"]),
  message: Schema.String,
}) {}

export interface Interface {
  readonly read: Effect.Effect<State>
  readonly plan: (input: { file: AbsolutePath; item: string }) => Effect.Effect<Plan, Failed>
  readonly install: (id: string) => Effect.Effect<State, Failed>
  readonly uninstall: (input: { key: Key; revision: number }) => Effect.Effect<State, Failed>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MarketplaceLocal") {}

/** Experimental local-agent slice. Providing this node does not enable global config discovery. */
export const node = makeGlobalNode({
  service: Service,
  deps: [Database.node, filesystem],
  layer: Layer.effect(
    Service,
    Effect.gen(function* () {
      const database = yield* Database.Service
      const fs = yield* FileSystem.FileSystem
      const plans = new Map<string, { json: string; revision: number; expires: number; key: Key }>()
      const installedJSON = Schema.fromJsonString(Installed)
      const decodeInstalled = Schema.decodeUnknownEffect(installedJSON)
      const decodeState = Schema.decodeUnknownEffect(State)
      const read = database.db
        .select()
        .from(MarketplaceTable)
        .where(eq(MarketplaceTable.id, 0))
        .get()
        .pipe(
          Effect.orDie,
          Effect.flatMap((row) =>
            row ? decodeState(row).pipe(Effect.orDie) : Effect.succeed(State.make({ revision: 0, installed: {} })),
          ),
        )
      const write = Effect.fnUntraced(function* (next: State) {
        const encoded = yield* Schema.encodeEffect(State)(next).pipe(Effect.orDie)
        yield* database.db
          .insert(MarketplaceTable)
          .values({ id: 0, ...encoded })
          .onConflictDoUpdate({ target: MarketplaceTable.id, set: encoded })
          .run()
          .pipe(Effect.orDie)
        return next
      })

      const plan = Effect.fn("MarketplaceLocal.plan")(function* (input: { file: AbsolutePath; item: string }) {
        if (!path.isAbsolute(input.file))
          return yield* new Failed({
            reason: "catalog",
            message: "A local catalog requires an absolute filesystem path",
          })
        const file = yield* fs
          .realPath(input.file)
          .pipe(Effect.mapError((error) => new Failed({ reason: "catalog", message: error.message })))
        const stat = yield* fs
          .stat(file)
          .pipe(Effect.mapError((error) => new Failed({ reason: "catalog", message: error.message })))
        if (stat.type !== "File" || stat.size > 2 * 1024 * 1024)
          return yield* new Failed({ reason: "catalog", message: "A local catalog must be a file of at most 2 MiB" })
        const text = yield* fs
          .readFileString(file)
          .pipe(Effect.mapError((error) => new Failed({ reason: "catalog", message: error.message })))
        const catalog = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Marketplace.Catalog), {
          onExcessProperty: "error",
        })(text).pipe(Effect.mapError((error) => new Failed({ reason: "catalog", message: error.message })))
        const item = catalog.items.find((item) => item.id === input.item)
        if (!item) return yield* new Failed({ reason: "item", message: `Catalog item not found: ${input.item}` })
        const installed: Installed = {
          file: AbsolutePath.make(file),
          catalog: catalog.id,
          item: item.id,
          name: item.name,
          version: item.version,
          digest: `sha256:${Hash.sha256(text)}`,
          agents: item.install.agents,
        }
        const id = randomUUID()
        const key = Key.make(`pkg_${Hash.sha256(JSON.stringify([file, catalog.id, item.id]))}`)
        const state = yield* read
        const json = yield* Schema.encodeEffect(installedJSON)(installed).pipe(Effect.orDie)
        const now = yield* Clock.currentTimeMillis
        for (const [id, stored] of plans) if (stored.expires <= now) plans.delete(id)
        if (plans.size >= 64)
          return yield* new Failed({ reason: "capacity", message: "Too many pending Marketplace plans" })
        const stored = {
          json,
          revision: state.revision,
          expires: now + 5 * 60 * 1000,
          key,
        }
        plans.set(id, stored)
        // The caller receives a separately decoded value, never the mutable object retained by the plan.
        return {
          id,
          key,
          revision: stored.revision,
          expires: stored.expires,
          installed: yield* decodeInstalled(stored.json).pipe(Effect.orDie),
        }
      })

      const install = Effect.fn("MarketplaceLocal.install")(function* (id: string) {
        const stored = plans.get(id)
        if (!stored)
          return yield* new Failed({ reason: "plan", message: "Marketplace plan is unknown or already consumed" })
        if (stored.expires <= (yield* Clock.currentTimeMillis)) {
          plans.delete(id)
          return yield* new Failed({ reason: "expired", message: "Marketplace plan has expired" })
        }
        const installed = yield* decodeInstalled(stored.json).pipe(Effect.orDie)
        const next = yield* database.db
          .transaction(() =>
            Effect.gen(function* () {
              const state = yield* read
              if (state.revision !== stored.revision)
                return yield* new Failed({
                  reason: "revision",
                  message: "Marketplace state changed; prepare a new plan",
                })
              return yield* write({
                revision: state.revision + 1,
                installed: { ...state.installed, [stored.key]: installed },
              })
            }),
          )
          .pipe(Effect.catch((error) => (error instanceof Failed ? Effect.fail(error) : Effect.die(error))))
        plans.delete(id)
        return next
      })

      const uninstall = Effect.fn("MarketplaceLocal.uninstall")(function* (input: { key: Key; revision: number }) {
        return yield* database.db
          .transaction(() =>
            Effect.gen(function* () {
              const state = yield* read
              if (state.revision !== input.revision)
                return yield* new Failed({
                  reason: "revision",
                  message: "Marketplace state changed; reload it before removing a package",
                })
              if (!state.installed[input.key]) return state
              return yield* write({
                revision: state.revision + 1,
                installed: Object.fromEntries(Object.entries(state.installed).filter(([key]) => key !== input.key)),
              })
            }),
          )
          .pipe(Effect.catch((error) => (error instanceof Failed ? Effect.fail(error) : Effect.die(error))))
      })
      return Service.of({ read, plan, install, uninstall })
    }),
  ),
})

/** Catalog-local names cannot address the qualified IDs of other packages or ordinary config agents. */
export function agentID(key: Key, name: string) {
  return Agent.ID.make(`marketplace/${key}/${name}`)
}

/** Explicit projection only. Agent identities are namespaced independently of config-entry order. */
export function documents(state: State) {
  return Record.toEntries(state.installed)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(
      ([key, item]) =>
        new Config.Document({
          type: "document",
          info: new Config.Info({
            agents: Object.fromEntries(Object.entries(item.agents).map(([name, info]) => [agentID(key, name), info])),
          }),
        }),
    )
}
