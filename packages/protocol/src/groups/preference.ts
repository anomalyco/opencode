import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiSchema, OpenApi } from "effect/http-api"
import { ForbiddenError } from "../errors.js"

const EXPERIMENTAL = "Behind the web_preferences flag. Experimental: may change without compatibility guarantees."

const annotations = (identifier: string, summary: string, description: string) =>
  OpenApi.annotations({
    identifier: `experimental.preference.${identifier}`,
    summary,
    description: `${description} ${EXPERIMENTAL}`,
    transform: (operation) => ({ ...operation, tags: ["experimental"] }),
  })

// No `:`, so the stored keys of one namespace never share a prefix with another namespace's.
const Name = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._-]+$/)).annotate({
  description: "Preference namespace, such as opencode.global.dat: letters, digits, dots, underscores and hyphens.",
})
const Items = Schema.Record(Schema.String, Schema.String)

export const PreferenceUpdate = Schema.Struct({ insert: Items, remove: Schema.Array(Schema.String) })
export type PreferenceUpdate = typeof PreferenceUpdate.Type

/** Lives in the `server.experimental` group (see `groups/experimental.ts`). */
export const PreferenceEndpoints = [
  HttpApiEndpoint.get("preference.items", "/api/experimental/preference/:name", {
    params: { name: Name },
    success: Schema.Struct({ data: Items }),
    error: [ForbiddenError],
  }).annotateMerge(
    annotations("items", "List stored preferences", "Return every key and value stored in one preference namespace."),
  ),
  HttpApiEndpoint.patch("preference.update", "/api/experimental/preference/:name", {
    params: { name: Name },
    payload: PreferenceUpdate,
    success: HttpApiSchema.NoContent,
    error: [ForbiddenError],
  }).annotateMerge(
    annotations(
      "update",
      "Update stored preferences",
      "Set the keys in insert and delete the keys in remove of one preference namespace, in one request. A key in both is deleted.",
    ),
  ),
  HttpApiEndpoint.delete("preference.clear", "/api/experimental/preference/:name", {
    params: { name: Name },
    success: HttpApiSchema.NoContent,
    error: [ForbiddenError],
  }).annotateMerge(annotations("clear", "Clear stored preferences", "Delete every key of one preference namespace.")),
] as const
