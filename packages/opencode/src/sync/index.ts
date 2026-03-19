import z from "zod"
import type { ZodObject } from "zod"
import { Identifier } from "@/id/id"
import { BusEvent } from "@/bus/bus-event"
import { Database, eq } from "@/storage/db"
import { Bus } from "@/bus"
import { EventSequenceTable, EventTable } from "./event.sql"

export namespace SyncEvent {
  export type Definition = {
    type: string
    properties: ZodObject<{ id: z.ZodString; seq: z.ZodNumber; aggregateID: z.ZodString; data: z.ZodObject }>
    version: string
    aggregate: string
  }

  export type Event<Def extends Definition = Definition> = {
    id: string
    seq: number
    aggregateID: string
    data: z.infer<Def["properties"]>["data"]
  }

  export type SerializedEvent<Def extends Definition = Definition> = Event<Def> & { type: string }

  type ProjectorFunc = (db: Database.TxOrDb, data: unknown) => void

  const registry = new Map<string, Definition>()
  let projectors: Map<Definition, ProjectorFunc> | undefined

  export function init(pjs: Array<[Definition, ProjectorFunc]>) {
    projectors = new Map(pjs)
  }

  export function versionedName(type: string, version?: string) {
    return version ? `${type}.${version}` : type
  }

  export function define<
    Type extends string,
    Version extends string,
    Agg extends string,
    Schema extends ZodObject<Record<Agg, z.ZodType<string>>>,
  >(input: { type: Type; version: Version; aggregate: Agg; schema: Schema }) {
    const def = {
      type: input.type,
      properties: z.object({
        id: Identifier.schema("event"),
        seq: z.number(),
        aggregateID: z.string(),
        data: input.schema,
      }),
      version: input.version,
      aggregate: input.aggregate,
    }

    registry.set(versionedName(def.type, def.version), def)
    BusEvent.define(versionedName(def.type, def.version), def.properties)

    return def
  }

  export function project<Def extends Definition>(
    def: Def,
    func: (db: Database.TxOrDb, data: Event<Def>["data"]) => void,
  ): [Definition, ProjectorFunc] {
    return [def, func as ProjectorFunc]
  }

  function process<Def extends Definition>(def: Def, input: Event<Def>) {
    if (projectors == null) {
      throw new Error("No projectors available. Call `SyncEvent.init` to install projectors")
    }

    const projector = projectors.get(def)
    if (!projector) {
      throw new Error(`Projector not found for event: ${def.type}`)
    }

    // idempotent: need to ignore any events already logged

    Database.transaction((tx) => {
      projector(tx, input.data)
      tx.insert(EventSequenceTable)
        .values({
          aggregate_id: input.aggregateID,
          seq: input.seq,
        })
        .onConflictDoUpdate({
          target: EventSequenceTable.aggregate_id,
          set: { seq: input.seq },
        })
        .run()
      tx.insert(EventTable)
        .values({
          id: input.id,
          seq: input.seq,
          aggregate_id: input.aggregateID,
          name: versionedName(def.type, def.version),
          data: input.data as Record<string, unknown>,
        })
        .run()
    })
  }

  // TODO:
  //
  // * Support applying multiple events at one time. One transaction,
  //   and it validets all the sequence ids
  // * when loading events from db, apply zod validation to ensure shape

  export function replay(event: SerializedEvent) {
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

    const expected = row ? row.seq + 1 : 0
    if (event.seq !== expected) {
      throw new Error(`Sequence mismatch for aggregate "${event.aggregateID}": expected ${expected}, got ${event.seq}`)
    }

    process(def, event)
  }

  export function run<Def extends Definition>(def: Def, data: Event<Def>["data"]) {
    const agg = (data as Record<string, string>)[def.aggregate]
    // This should never happen: we've enforced it via typescript in
    // the definition
    if (agg == null) {
      throw new Error(`SyncEvent: "${def.aggregate}" required but not found: ${JSON.stringify(data)}`)
    }

    // Note that this is an "immediate" transaction which is critical.
    // We need to make sure we can safely read and write with nothing
    // else changing the data from under us
    Database.transaction(
      (tx) => {
        const id = Identifier.ascending("workspace")
        const row = tx
          .select({ seq: EventSequenceTable.seq })
          .from(EventSequenceTable)
          .where(eq(EventSequenceTable.aggregate_id, agg))
          .get()
        const seq = row?.seq != null ? row.seq + 1 : 0

        process(def, { id, seq, aggregateID: agg, data })

        Database.effect(() => {
          const versionedDef = { ...def, type: versionedName(def.type, def.version) }
          Bus.publish(versionedDef, { id, seq, aggregateID: agg, data } as z.output<Def["properties"]>)
        })
      },
      {
        behavior: "immediate",
      },
    )
  }
}
