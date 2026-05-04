import { Identifier } from "@/id/id"
import { SyncEvent } from "@/sync"
import { withStatics } from "@/util/schema"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Schema from "effect/Schema"

export const ID = Schema.String.pipe(
  Schema.brand("Event.ID"),
  withStatics((s) => ({
    create: () => s.make(Identifier.create("evt", "ascending")),
  })),
)
export type ID = Schema.Schema.Type<typeof ID>

export function define<const Type extends string, Fields extends Schema.Struct.Fields>(input: {
  type: Type
  schema: Fields
  aggregate: string
  version?: number
}) {
  const Payload = Schema.Struct({
    id: ID,
    metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
    type: Schema.Literal(input.type),
    data: Schema.Struct(input.schema),
  }).annotate({
    identifier: input.type,
  })

  const Sync = SyncEvent.define({
    type: input.type,
    version: input.version ?? 1,
    aggregate: input.aggregate,
    schema: Payload.fields.data,
  })

  return Object.assign(Payload, {
    Sync,
    version: input.version,
    aggregate: input.aggregate,
  })
}

export function run<Def extends SyncEvent.Definition>(
  def: Def,
  data: SyncEvent.Event<Def>["data"],
  options?: { publish?: boolean },
) {
  if (!Flag.OPENCODE_EXPERIMENTAL_EVENT_SYSTEM) return
  SyncEvent.run(def, data, options)
}

export * as EventV2 from "./event"
