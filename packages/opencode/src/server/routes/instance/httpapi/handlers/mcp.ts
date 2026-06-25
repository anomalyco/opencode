import { MCP } from "@/mcp"
import { McpElicitation } from "@/mcp/elicitation"
import { Effect, Schema } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { McpElicitationNotFoundError, McpServerNotFoundError } from "../errors"
import {
  AddPayload,
  AuthCallbackPayload,
  ElicitationReplyPayload,
  StatusMap,
  UnsupportedOAuthError,
} from "../groups/mcp"

export const mcpHandlers = HttpApiBuilder.group(InstanceHttpApi, "mcp", (handlers) =>
  Effect.gen(function* () {
    const mcp = yield* MCP.Service
    const elicitation = yield* McpElicitation.Service

    const missingElicitation = (error: McpElicitation.NotFoundError) =>
      new McpElicitationNotFoundError({
        requestID: String(error.requestID),
        message: `MCP elicitation request not found: ${error.requestID}`,
      })

    const status = Effect.fn("McpHttpApi.status")(function* () {
      return yield* mcp.status()
    })

    const add = Effect.fn("McpHttpApi.add")(function* (ctx: { payload: typeof AddPayload.Type }) {
      const result = (yield* mcp.add(ctx.payload.name, ctx.payload.config)).status
      return yield* Schema.decodeUnknownEffect(StatusMap)(
        "status" in result ? { [ctx.payload.name]: result } : result,
      ).pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
    })

    const authStart = Effect.fn("McpHttpApi.authStart")(function* (ctx: { params: { name: string } }) {
      return yield* Effect.gen(function* () {
        if (!(yield* mcp.supportsOAuth(ctx.params.name))) {
          return yield* new UnsupportedOAuthError({ error: `MCP server ${ctx.params.name} does not support OAuth` })
        }
        return yield* mcp.startAuth(ctx.params.name)
      }).pipe(
        Effect.catchTag("MCP.NotFoundError", (error) =>
          Effect.fail(new McpServerNotFoundError({ name: error.name, message: `MCP server not found: ${error.name}` })),
        ),
      )
    })

    const authCallback = Effect.fn("McpHttpApi.authCallback")(function* (ctx: {
      params: { name: string }
      payload: typeof AuthCallbackPayload.Type
    }) {
      return yield* mcp
        .finishAuth(ctx.params.name, ctx.payload.code)
        .pipe(
          Effect.catchTag("MCP.NotFoundError", (error) =>
            Effect.fail(
              new McpServerNotFoundError({ name: error.name, message: `MCP server not found: ${error.name}` }),
            ),
          ),
        )
    })

    const authAuthenticate = Effect.fn("McpHttpApi.authAuthenticate")(function* (ctx: { params: { name: string } }) {
      return yield* Effect.gen(function* () {
        if (!(yield* mcp.supportsOAuth(ctx.params.name))) {
          return yield* new UnsupportedOAuthError({ error: `MCP server ${ctx.params.name} does not support OAuth` })
        }
        return yield* mcp.authenticate(ctx.params.name)
      }).pipe(
        Effect.catchTag("MCP.NotFoundError", (error) =>
          Effect.fail(new McpServerNotFoundError({ name: error.name, message: `MCP server not found: ${error.name}` })),
        ),
      )
    })

    const authRemove = Effect.fn("McpHttpApi.authRemove")(function* (ctx: { params: { name: string } }) {
      const status = yield* mcp.status()
      if (!(ctx.params.name in status))
        return yield* new McpServerNotFoundError({
          name: ctx.params.name,
          message: `MCP server not found: ${ctx.params.name}`,
        })
      yield* mcp.removeAuth(ctx.params.name)
      return { success: true as const }
    })

    const connect = Effect.fn("McpHttpApi.connect")(function* (ctx: { params: { name: string } }) {
      yield* mcp
        .connect(ctx.params.name)
        .pipe(
          Effect.catchTag("MCP.NotFoundError", (error) =>
            Effect.fail(
              new McpServerNotFoundError({ name: error.name, message: `MCP server not found: ${error.name}` }),
            ),
          ),
        )
      return true
    })

    const disconnect = Effect.fn("McpHttpApi.disconnect")(function* (ctx: { params: { name: string } }) {
      yield* mcp
        .disconnect(ctx.params.name)
        .pipe(
          Effect.catchTag("MCP.NotFoundError", (error) =>
            Effect.fail(
              new McpServerNotFoundError({ name: error.name, message: `MCP server not found: ${error.name}` }),
            ),
          ),
        )
      return true
    })

    const elicitationList = Effect.fn("McpHttpApi.elicitationList")(function* () {
      return yield* elicitation.list()
    })

    const elicitationReply = Effect.fn("McpHttpApi.elicitationReply")(function* (ctx: {
      params: { requestID: McpElicitation.ID }
      payload: typeof ElicitationReplyPayload.Type
    }) {
      yield* elicitation
        .reply({ requestID: ctx.params.requestID, content: ctx.payload.content })
        .pipe(Effect.catchTag("McpElicitation.NotFoundError", (error) => Effect.fail(missingElicitation(error))))
      return true
    })

    const elicitationDecline = Effect.fn("McpHttpApi.elicitationDecline")(function* (ctx: {
      params: { requestID: McpElicitation.ID }
    }) {
      yield* elicitation
        .decline(ctx.params.requestID)
        .pipe(Effect.catchTag("McpElicitation.NotFoundError", (error) => Effect.fail(missingElicitation(error))))
      return true
    })

    const elicitationCancel = Effect.fn("McpHttpApi.elicitationCancel")(function* (ctx: {
      params: { requestID: McpElicitation.ID }
    }) {
      yield* elicitation
        .cancel(ctx.params.requestID)
        .pipe(Effect.catchTag("McpElicitation.NotFoundError", (error) => Effect.fail(missingElicitation(error))))
      return true
    })

    return handlers
      .handle("status", status)
      .handle("add", add)
      .handle("authStart", authStart)
      .handle("authCallback", authCallback)
      .handle("authAuthenticate", authAuthenticate)
      .handle("authRemove", authRemove)
      .handle("connect", connect)
      .handle("disconnect", disconnect)
      .handle("elicitationList", elicitationList)
      .handle("elicitationReply", elicitationReply)
      .handle("elicitationDecline", elicitationDecline)
      .handle("elicitationCancel", elicitationCancel)
  }),
)
