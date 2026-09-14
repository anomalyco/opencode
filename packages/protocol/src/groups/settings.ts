import { Settings } from "@opencode/schema/settings"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"

export const SettingsGroup = HttpApiGroup.make("server.settings")
  .add(
    HttpApiEndpoint.get("settings.list", "/api/settings", {
      success: Schema.Array(Settings.Entry),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "settings.list",
        summary: "List setting overrides",
        description: "List explicit global setting values. Domains own their value schemas, defaults, and behavior.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("settings.get", "/api/settings/:kind/:id", {
      params: Settings.Target.fields,
      success: Schema.NullOr(Settings.Entry),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "settings.get",
        summary: "Get setting override",
        description:
          "Read one explicit setting override, or null when the domain default applies. An entry whose value is null is distinct from a missing override.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.put("settings.set", "/api/settings/:kind/:id", {
      params: Settings.Target.fields,
      payload: Schema.Struct({ value: Settings.Value }),
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "settings.set",
        summary: "Set setting override",
        description:
          "Validate a value against its registered setting kind and persist it across all projects and sessions on this server.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("settings.reset", "/api/settings/:kind/:id", {
      params: Settings.Target.fields,
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "settings.reset",
        summary: "Reset setting override",
        description: "Remove the explicit setting so the target follows its domain default again.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "settings" }))
