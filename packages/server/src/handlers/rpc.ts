import { Rpc } from "@opencode-ai/core/rpc"
import { Plugin } from "@opencode-ai/core/plugin"
import { RpcError, RpcInternalError } from "@opencode-ai/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const RpcHandler = HttpApiBuilder.group(Api, "server.rpc", (handlers) =>
  handlers.handle("rpc.call", ({ params, payload }) =>
    Effect.gen(function* () {
      yield* Plugin.awaitActivation
      const rpc = yield* Rpc.Service
      const output = yield* rpc.call(params.rpcID, params.method, payload.input)
      return output === undefined ? {} : { output }
    }).pipe(
      Effect.mapError((error) =>
        error.type === "rpc.invalid_output"
          ? new RpcInternalError({ type: error.type, message: error.message })
          : new RpcError({
              type: error.type,
              message: error.message,
              ...(error.data === undefined ? {} : { data: error.data }),
            }),
      ),
      Effect.catchDefect((error) =>
        Effect.fail(
          new RpcInternalError({
            type: "rpc.internal",
            message: error instanceof Error ? error.message : "RPC call failed",
          }),
        ),
      ),
    ),
  ),
)
