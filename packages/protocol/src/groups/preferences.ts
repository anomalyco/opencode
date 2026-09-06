import { Preferences } from "@opencode-ai/schema/preferences"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"

export const PreferencesGroup = HttpApiGroup.make("server.preferences")
  .add(
    HttpApiEndpoint.get("preferences.list", "/api/preferences", {
      success: Schema.Array(Preferences.Entry),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "preferences.list",
        summary: "List preference overrides",
        description: "List explicit global activation preferences. Domains own their defaults and availability rules.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("preferences.get", "/api/preferences/:kind/:id", {
      params: Preferences.Target.fields,
      success: Schema.NullOr(Preferences.Entry),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "preferences.get",
        summary: "Get preference override",
        description: "Read one explicit activation override, or null when the domain default applies.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.put("preferences.set", "/api/preferences/:kind/:id", {
      params: Preferences.Target.fields,
      payload: Schema.Struct({ state: Preferences.State }),
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "preferences.set",
        summary: "Set preference override",
        description: "Persist an explicit activation preference across all projects and sessions on this server.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("preferences.reset", "/api/preferences/:kind/:id", {
      params: Preferences.Target.fields,
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "preferences.reset",
        summary: "Reset preference override",
        description: "Remove the explicit preference so the target follows its domain default again.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "preferences" }))
