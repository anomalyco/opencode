import { Space } from "@opencode/schema/space"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiSchema, OpenApi } from "effect/http-api"

const params = { space: Space.Name, key: Space.Key }
const annotations = (identifier: string, summary: string, description: string) =>
  OpenApi.annotations({
    identifier: `experimental.kv.${identifier}`,
    summary,
    description: `${description} Subscribers read values through \`experimental.kv\` on /api/event. Experimental: may change without compatibility guarantees.`,
    // The routes share the `server.experimental` group with the persistent PTY prototype; tag them on their own.
    transform: (operation) => ({ ...operation, tags: ["experimental"] }),
  })

/** Lives in the `server.experimental` group (see `groups/experimental.ts`). */
export const KVEndpoints = [
  HttpApiEndpoint.put("kv.set", "/api/experimental/kv/:space/:key", {
    params,
    payload: Schema.Struct({ value: Space.Value }),
    success: HttpApiSchema.NoContent,
  }).annotateMerge(
    annotations(
      "set",
      "Set value",
      "Store a client-defined JSON value, replacing any previous value, and send it to the space's subscribers. The server does not interpret it.",
    ),
  ),
  HttpApiEndpoint.delete("kv.delete", "/api/experimental/kv/:space/:key", {
    params,
    success: HttpApiSchema.NoContent,
  }).annotateMerge(
    annotations(
      "delete",
      "Delete value",
      "Remove a stored value and tell the space's subscribers. Removing an unset key succeeds.",
    ),
  ),
] as const
