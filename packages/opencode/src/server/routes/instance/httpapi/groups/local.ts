import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/local"

export const LocalInstance = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  host: Schema.String,
  port: Schema.Number,
  baseURL: Schema.String,
  online: Schema.Boolean,
  models: Schema.Array(Schema.String),
  configuredProviderID: Schema.optional(Schema.String),
}).annotate({ identifier: "LocalInstance" })
export interface LocalInstance extends Schema.Schema.Type<typeof LocalInstance> {}

export const LocalConnectPayload = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  baseURL: Schema.String,
}).annotate({ identifier: "LocalConnectPayload" })

export const LocalCtxSizePayload = Schema.Struct({
  ctx_size: Schema.Int.check(Schema.isGreaterThan(0)),
}).annotate({ identifier: "LocalCtxSizePayload" })

export const LocalApi = HttpApi.make("local").add(
  HttpApiGroup.make("local")
    .add(
      HttpApiEndpoint.get("scan", `${root}/scan`, {
        query: WorkspaceRoutingQuery,
        success: described(Schema.Array(LocalInstance), "Discovered local llama-swap instances"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "local.scan",
          summary: "Scan for local providers",
          description: "Browse the local network via mDNS for llama-swap instances and probe each for its model list.",
        }),
      ),
      HttpApiEndpoint.post("connect", `${root}/connect`, {
        query: WorkspaceRoutingQuery,
        payload: LocalConnectPayload,
        success: described(Schema.String, "Provider ID written to global config"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "local.connect",
          summary: "Add local provider to config",
          description:
            "Write an openai-compatible provider entry for a local llama-swap instance to the global config.",
        }),
      ),
      HttpApiEndpoint.delete("disconnect", `${root}/connect/:providerID`, {
        params: { providerID: Schema.String },
        query: WorkspaceRoutingQuery,
        success: described(Schema.String, "Removed provider ID"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "local.disconnect",
          summary: "Remove local provider from config",
          description: "Delete a local llama-swap provider entry from the global config.",
        }),
      ),
      HttpApiEndpoint.patch("setModelCtxSize", `${root}/model/:providerID/:modelID/ctx-size`, {
        params: { providerID: Schema.String, modelID: Schema.String },
        query: WorkspaceRoutingQuery,
        payload: LocalCtxSizePayload,
        success: described(Schema.Boolean, "Context size updated"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "local.model.setCtxSize",
          summary: "Set model context window size",
          description: "Patch the ctx_size for a model on a llama-swap backend.",
        }),
      ),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware),
)
