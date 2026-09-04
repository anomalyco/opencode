import { optional } from "@opencode-ai/schema/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { RpcError, RpcInternalError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const RpcInput = Schema.Struct({ input: optional(Schema.Unknown) }).annotate({ identifier: "Rpc.Input" })
export const RpcOutput = Schema.Struct({ output: Schema.optionalKey(Schema.Unknown) }).annotate({
  identifier: "Rpc.Output",
})

export const RpcGroup = HttpApiGroup.make("server.rpc")
  .add(
    HttpApiEndpoint.post("rpc.call", "/api/rpc/:rpcID/:method", {
      params: { rpcID: Schema.String, method: Schema.String },
      query: LocationQuery,
      payload: RpcInput,
      success: RpcOutput,
      error: [RpcError, RpcInternalError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.rpc.call",
          summary: "Call a plugin RPC",
          description: "Dispatch a method to the currently registered RPC at the requested location.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "rpc", description: "Plugin RPC routes." }))
