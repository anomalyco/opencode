import { Schema, SchemaGetter } from "effect"
import { HttpApiEndpoint, OpenApi } from "effect/http-api"

const BooleanFromString = Schema.Literals(["true", "false"]).pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform((value) => value === "true"),
    encode: SchemaGetter.transform((value): "true" | "false" => (value ? "true" : "false")),
  }),
)

export const DebugRuntime = Schema.Struct({
  pid: Schema.Number,
  uptimeSeconds: Schema.Number,
  memory: Schema.Struct({
    rss: Schema.Number,
    heapTotal: Schema.Number,
    heapUsed: Schema.Number,
    external: Schema.Number,
    arrayBuffers: Schema.Number,
  }),
  /** With `heap=true`: the most common object types on the heap and their counts, largest first. */
  objectTypes: Schema.Record(Schema.String, Schema.Number).pipe(Schema.optionalKey),
  locations: Schema.Number,
  gauges: Schema.Record(Schema.String, Schema.Number),
}).annotate({ identifier: "DebugRuntime" })
export type DebugRuntime = typeof DebugRuntime.Type

/** Lives in the `server.experimental` group (see `groups/experimental.ts`). */
export const DebugRuntimeEndpoint = HttpApiEndpoint.get("debug.runtime", "/api/experimental/debug/runtime", {
  query: Schema.Struct({ heap: BooleanFromString.pipe(Schema.optional) }),
  success: DebugRuntime,
}).annotateMerge(
  OpenApi.annotations({
    identifier: "experimental.debug.runtime",
    summary: "Read runtime memory statistics",
    description:
      "Process memory, loaded locations, and the sizes of long-lived server structures (event bus buffers, plugin registries, jobs, event feed subscribers), read from counters the server already holds. With `heap=true` it also counts objects on the heap by type, which pauses the server (about 1 s per 100 million objects) but serializes nothing, so it stays usable on heaps too large for a snapshot. Experimental: may change without compatibility guarantees.",
    transform: (operation) => ({ ...operation, tags: ["experimental"] }),
  }),
)
