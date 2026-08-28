import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError, UnknownError } from "../errors"

export const PluginInfo = Schema.Struct({
  id: Schema.String,
  invokes: Schema.Array(Schema.String),
})

export class PluginNotFoundError extends Schema.TaggedErrorClass<PluginNotFoundError>()(
  "PluginNotFoundError",
  { message: Schema.String },
  { httpApiStatus: 404 },
) {}

export class PluginInvokeNotFoundError extends Schema.TaggedErrorClass<PluginInvokeNotFoundError>()(
  "PluginInvokeNotFoundError",
  {
    pluginID: Schema.String,
    name: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

const InvokePayload = Schema.Struct({
  name: Schema.String,
  input: Schema.Unknown,
})

const InvokeResult = Schema.Struct({
  result: Schema.Unknown,
})

export const PluginGroup = HttpApiGroup.make("server.plugin")
  .add(
    HttpApiEndpoint.get("plugin.list", "/api/plugin", {
      success: Schema.Struct({ data: Schema.Array(PluginInfo) }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.plugin.list",
        summary: "List plugins",
        description: "List registered plugins and the invokes they expose.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("plugin.invoke", "/api/plugin/:pluginID/invoke", {
      params: { pluginID: Schema.String },
      payload: InvokePayload,
      success: InvokeResult,
      error: [PluginNotFoundError, PluginInvokeNotFoundError, UnknownError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.plugin.invoke",
        summary: "Invoke a plugin function",
        description: "Call an invoke exposed by a registered plugin.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "plugin", description: "Plugin invoke routes." }))
