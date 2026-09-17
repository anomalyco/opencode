import { agent, RequestError, type Stream } from "@agentclientprotocol/sdk"
import type { OpenCodeClient } from "@opencode/client/promise"
import { ACPConnection } from "./connection"
import { ACPError } from "./error"
import { ACPService } from "./service"

export function connect(client: OpenCodeClient, stream: Stream) {
  const connection = agent({ name: "opencode" })
    .onRequest("initialize", (ctx) => run(service.initialize(ctx.params)))
    .onRequest("authenticate", (ctx) => run(service.authenticate(ctx.params)))
    .onRequest("session/new", (ctx) => run(service.newSession(ctx.params)))
    .onRequest("session/load", (ctx) => run(service.loadSession(ctx.params)))
    .onRequest("session/list", (ctx) => run(service.listSessions(ctx.params)))
    .onRequest("session/delete", (ctx) => run(service.deleteSession(ctx.params)))
    .onRequest("session/resume", (ctx) => run(service.resumeSession(ctx.params)))
    .onRequest("session/close", (ctx) => run(service.closeSession(ctx.params)))
    .onRequest("session/fork", (ctx) => run(service.forkSession(ctx.params)))
    .onRequest("session/set_config_option", (ctx) => run(service.setSessionConfigOption(ctx.params)))
    .onRequest("session/set_mode", (ctx) => run(service.setSessionMode(ctx.params)))
    .onRequest("session/prompt", (ctx) => run(service.prompt(ctx.params, ctx.signal)))
    .onNotification("session/cancel", (ctx) => run(service.cancel(ctx.params)))
    .connect(stream)
  // Inbound dispatch starts after the stream's async read loop yields, so handlers never observe this before assignment.
  const service = ACPService.make({ client, connection: ACPConnection.make(connection) })
  return connection
}

async function run<A>(promise: Promise<A>) {
  try {
    return await promise
  } catch (error) {
    if (error instanceof RequestError) throw error
    if (isACPError(error)) throw ACPError.toRequestError(error)
    throw ACPError.toRequestError(ACPError.fromUnknown(error))
  }
}

function isACPError(error: unknown): error is ACPError.Error {
  return (
    error instanceof ACPError.SessionNotFoundError ||
    error instanceof ACPError.SessionDirectoryMismatchError ||
    error instanceof ACPError.InvalidConfigOptionError ||
    error instanceof ACPError.InvalidModelError ||
    error instanceof ACPError.InvalidEffortError ||
    error instanceof ACPError.InvalidModeError ||
    error instanceof ACPError.AuthRequiredError ||
    error instanceof ACPError.UnknownAuthMethodError ||
    error instanceof ACPError.ServiceFailureError
  )
}

export * as ACP from "./agent"
