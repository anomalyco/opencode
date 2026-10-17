import { Rpc } from "@opencode/core/rpc"
import { Plugin } from "@opencode/core/plugin"
import { RpcError, RpcInternalError } from "@opencode/protocol/errors"
import { Effect, Schema } from "effect"
import { HttpServerResponse } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { CorsConfig, isAllowedRequestOrigin } from "../cors"

export const RpcHandler = HttpApiBuilder.group(Api, "server.rpc", (handlers) =>
  handlers
    .handleRaw("rpc.connect", (ctx) =>
      Effect.gen(function* () {
        const cors = yield* CorsConfig
        if (!isAllowedRequestOrigin(ctx.request.headers.origin, ctx.request.headers.host, cors))
          return HttpServerResponse.empty({ status: 403 })
        const input = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(ctx.query.input).pipe(
          Effect.mapError(() => new RpcError({ type: "rpc.invalid_input", message: "Invalid RPC input" })),
        )
        yield* Plugin.awaitActivation
        const rpc = yield* Rpc.Service
        yield* rpc
          .connect(ctx.params.rpcID, ctx.params.method, input, Effect.orDie(ctx.request.upgrade))
          .pipe(Effect.mapError(responseError))
        return HttpServerResponse.empty()
      }).pipe(Effect.scoped),
    )
    .handle("rpc.call", ({ params, payload }) =>
      Effect.gen(function* () {
        yield* Plugin.awaitActivation
        const rpc = yield* Rpc.Service
        const output = yield* rpc.call(params.rpcID, params.method, payload.input)
        return output === undefined ? {} : { output }
      }).pipe(
        Effect.mapError(responseError),
        // Defects outside handler execution are still logged, never echoed to the client.
        Effect.catchDefect((defect) =>
          Effect.logError("rpc call failed", { rpc: params.rpcID, method: params.method, defect }).pipe(
            Effect.andThen(Effect.fail(new RpcInternalError({ type: "rpc.internal", message: "RPC call failed" }))),
          ),
        ),
      ),
    ),
)

function responseError(error: Rpc.Failure) {
  return error.type === "rpc.invalid_output" || error.type === "rpc.internal"
    ? new RpcInternalError({ type: error.type, message: error.message })
    : new RpcError({
        type: error.type,
        message: error.message,
        ...(error.data === undefined ? {} : { data: error.data }),
      })
}
