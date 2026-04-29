import z from "zod"
import { Database } from "@/storage/db"
import { eq } from "drizzle-orm"
import { GlobalBus } from "@/bus/global"
import { Bus as ProjectBus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Instance } from "@/project/instance"
import { EventSequenceTable, EventTable } from "./event.sql"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { EventID } from "./schema"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Schema as EffectSchema } from "effect"
import { zodObject } from "@/util/effect-zod"
import type { DeepMutable } from "@/util/schema"

// Keep `Event["data"]` mutable because projectors mutate the persisted shape
// when writing to the database. Bus payloads (`Properties`) stay readonly —
// subscribers only read.

export type Definition<
  Type extends string = string,
  Schema extends EffectSchema.Top = EffectSchema.Top,
  BusSchema extends EffectSchema.Top = Schema,
> = {
  type: Type
  version: number
  aggregate: string
  schema: Schema
  // Bus event payload schema. Defaults to `schema` unless `busSchema` was
  // passed at definition time (see `session.updated`, whose projector
  // expands the persisted data to a `{ sessionID, info }` bus payload).
  properties: BusSchema
}

export type Event<Def extends Definition = Definition> = {
  id: string
  seq: number
  aggregateID: string
  data: DeepMutable<EffectSchema.Schema.Type<Def["schema"]>>
}

export type Properties<Def extends Definition = Definition> = EffectSchema.Schema.Type<Def["properties"]>

export type SerializedEvent<Def extends Definition = Definition> = Event<Def> & { type: string }

type ProjectorFunc = (db: Database.TxOrDb, data: unknown) => void
type ConvertEvent = (type: string, data: Event["data"]) => unknown | Promise<unknown>

export const registry = new Map<string, Definition>()
let projectors: Map<Definition, ProjectorFunc> | undefined
const versions = new Map<string, number>()
let frozen = false
let convertEvent: ConvertEvent

export function reset() {
  frozen = false
  projectors = undefined
  convertEvent = (_, data) => data
}

export function init(input: { projectors: Array<[Definition, ProjectorFunc]>; convertEvent?: ConvertEvent }) {
  projectors = new Map(input.projectors)

  // Install all the latest event defs to the bus. We only ever emit
  // latest versions from code, and keep around old versions for
  // replaying. Replaying does not go through the bus, and it
  // simplifies the bus to only use unversioned latest events
  for (let [type, version] of versions.entries()) {
    let def = registry.get(versionedType(type, version))!

    BusEvent.define(def.type, def.properties)
  }

  // Freeze the system so it clearly errors if events are defined
  // after `init` which would cause bugs
  frozen = true
  convertEvent = input.convertEvent ?? ((_, data) => data)
}

export function versionedType<A extends string>(type: A): A
export function versionedType<A extends string, B extends number>(type: A, version: B): `${A}/${B}`
export function versionedType(type: string, version?: number) {
  return version ? `${type}.${version}` : type
}

export function define<
  Type extends string,
  Agg extends string,
  Schema extends EffectSchema.Top,
  BusSchema extends EffectSchema.Top = Schema,
>(input: {
  type: Type
  version: number
  aggregate: Agg
  schema: Schema
  busSchema?: BusSchema
}): Definition<Type, Schema, BusSchema> {
  if (frozen) {
    throw new Error("Error defining sync event: sync system has been frozen")
  }

  const def = {
    type: input.type,
    version: input.version,
    aggregate: input.aggregate,
    schema: input.schema,
    properties: (input.busSchema ?? input.schema) as BusSchema,
  }

  versions.set(def.type, Math.max(def.version, versions.get(def.type) || 0))

  registry.set(versionedType(def.type, def.version), def)

  return def
}

export function project<Def extends Definition>(
  def: Def,
  func: (db: Database.TxOrDb, data: Event<Def>["data"]) => void,
): [Definition, ProjectorFunc] {
  return [def, func as ProjectorFunc]
}

function process<Def extends Definition>(def: Def, event: Event<Def>, options: { publish: boolean }) {
  if (projectors == null) {
    throw new Error("No projectors available. Call `SyncEvent.init` to install projectors")
  }

  const projector = projectors.get(def)
  if (!projector) {
    throw new Error(`Projector not found for event: ${def.type}`)
  }

  // idempotent: need to ignore any events already logged

  Database.transaction((tx) => {
    projector(tx, event.data)

    if (Flag.OPENCODE_EXPERIMENTAL_WORKSPACES) {
      tx.insert(EventSequenceTable)
        .values({
          aggregate_id: event.aggregateID,
          seq: event.seq,
        })
        .onConflictDoUpdate({
          target: EventSequenceTable.aggregate_id,
          set: { seq: event.seq },
        })
        .run()
      tx.insert(EventTable)
        .values({
          id: event.id,
          seq: event.seq,
          aggregate_id: event.aggregateID,
          type: versionedType(def.type, def.version),
          data: event.data as Record<string, unknown>,
        })
        .run()
    }

    Database.effect(() => {
      if (options?.publish) {
        const result = convertEvent(def.type, event.data)
        const publish = (data: unknown) => ProjectBus.publish(def, data as Properties<Def>)
        if (result instanceof Promise) {
          void result.then(publish)
        } else {
          void publish(result)
        }

        GlobalBus.emit("event", {
          directory: Instance.directory,
          project: Instance.project.id,
          workspace: WorkspaceContext.workspaceID,
          payload: {
            type: "sync",
            syncEvent: {
              type: versionedType(def.type, def.version),
              ...event,
            },
          },
        })
      }
    })
  })
}

export function replay(event: SerializedEvent, options?: { publish: boolean }) {
  const def = registry.get(event.type)
  if (!def) {
    throw new Error(`Unknown event type: ${event.type}`)
  }

  const row = Database.use((db) =>
    db
      .select({ seq: EventSequenceTable.seq })
      .from(EventSequenceTable)
      .where(eq(EventSequenceTable.aggregate_id, event.aggregateID))
      .get(),
  )

  const latest = row?.seq ?? -1
  if (event.seq <= latest) {
    return
  }

  const expected = latest + 1
  if (event.seq !== expected) {
    throw new Error(`Sequence mismatch for aggregate "${event.aggregateID}": expected ${expected}, got ${event.seq}`)
  }

  process(def, event, { publish: !!options?.publish })
}

export function replayAll(events: SerializedEvent[], options?: { publish: boolean }) {
  const source = events[0]?.aggregateID
  if (!source) return
  if (events.some((item) => item.aggregateID !== source)) {
    throw new Error("Replay events must belong to the same session")
  }
  const start = events[0].seq
  for (const [i, item] of events.entries()) {
    const seq = start + i
    if (item.seq !== seq) {
      throw new Error(`Replay sequence mismatch at index ${i}: expected ${seq}, got ${item.seq}`)
    }
  }
  for (const item of events) {
    replay(item, options)
  }
  return source
}

export function run<Def extends Definition>(def: Def, data: Event<Def>["data"], options?: { publish?: boolean }) {
  const agg = (data as Record<string, string>)[def.aggregate]
  // This should never happen: we've enforced it via typescript in
  // the definition
  if (agg == null) {
    throw new Error(`SyncEvent.run: "${def.aggregate}" required but not found: ${JSON.stringify(data)}`)
  }

  if (def.version !== versions.get(def.type)) {
    throw new Error(`SyncEvent.run: running old versions of events is not allowed: ${def.type}`)
  }

  const { publish = true } = options || {}

  // Note that this is an "immediate" transaction which is critical.
  // We need to make sure we can safely read and write with nothing
  // else changing the data from under us
  Database.transaction(
    (tx) => {
      const id = EventID.ascending()
      const row = tx
        .select({ seq: EventSequenceTable.seq })
        .from(EventSequenceTable)
        .where(eq(EventSequenceTable.aggregate_id, agg))
        .get()
      const seq = row?.seq != null ? row.seq + 1 : 0

      const event = { id, seq, aggregateID: agg, data }
      process(def, event, { publish })
    },
    {
      behavior: "immediate",
    },
  )
}

export function remove(aggregateID: string) {
  Database.transaction((tx) => {
    tx.delete(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, aggregateID)).run()
    tx.delete(EventTable).where(eq(EventTable.aggregate_id, aggregateID)).run()
  })
}

export function payloads() {
  return registry
    .entries()
    .map(([type, def]) => {
      return z
        .object({
          type: z.literal("sync"),
          name: z.literal(type),
          id: z.string(),
          seq: z.number(),
          aggregateID: z.literal(def.aggregate),
          data: zodObject(def.schema),
        })
        .meta({
          ref: `SyncEvent.${def.type}`,
        })
    })
    .toArray()
}

export * as SyncEvent from "."
