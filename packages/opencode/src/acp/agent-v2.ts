import { agent, type AgentContext, type AgentApp, RequestError } from "@agentclientprotocol/sdk/experimental/v2"
import { Effect } from "effect"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { Identifier } from "@/id/id"
import * as ACPError from "./error"
import * as ACPService from "./service"
import type { InitializeRequest as V1InitializeRequest } from "@agentclientprotocol/sdk"

function wrapClient(client: AgentContext): ACPService.ServiceConnection {
  return {
    sessionUpdate: (params) => client.notify("session/update", params),
    requestPermission: (params) => client.request("session/request_permission", params) as Promise<never>,
  }
}

// v2 handlers return v2-typed responses, but the service returns v1 types.
// The runtime shapes are compatible (v2 renames fields like id→configId,
// agentInfo→info). Promise<never> is assignable to any Promise<T>, bridging
// the type boundary without importing every v2 response type.
function run<A>(effect: Effect.Effect<A, ACPService.Error>): Promise<never> {
  return Effect.runPromise(effect.pipe(Effect.mapError(ACPError.toRequestError))).catch((defect: unknown) => {
    if (defect instanceof RequestError) throw defect
    throw ACPError.toRequestError(ACPError.fromUnknownDefect(defect))
  }) as Promise<never>
}

export function createV2App(sdk: OpencodeClient): AgentApp {
  let service: ACPService.Interface | undefined

  function serviceFor(client: AgentContext): ACPService.Interface {
    if (!service) {
      service = ACPService.make({ sdk, connection: wrapClient(client), v2: true })
    }
    return service
  }

  return agent({ name: "opencode" })
    .onRequest("initialize", (ctx) => {
      const service = serviceFor(ctx.client)
      const v1Params = {
        protocolVersion: ctx.params.protocolVersion,
        clientInfo: ctx.params.info,
        clientCapabilities: ctx.params.capabilities as unknown as undefined,
      }
      return run(service.initialize(v1Params as unknown as V1InitializeRequest))
    })
    .onRequest("auth/login", (ctx) => {
      const service = serviceFor(ctx.client)
      return run(service.authenticate(ctx.params as unknown as Parameters<typeof service.authenticate>[0]))
    })
    .onRequest("auth/logout", (ctx) => {
      const service = serviceFor(ctx.client)
      return run(service.logout() as Effect.Effect<Record<string, unknown>, ACPService.Error>)
    })
    .onRequest("session/new", (ctx) => {
      const service = serviceFor(ctx.client)
      return run(service.newSession(ctx.params as unknown as Parameters<typeof service.newSession>[0]))
    })
    .onRequest("session/prompt", (ctx) => {
      const service = serviceFor(ctx.client)
      const params = {
        ...ctx.params,
        messageId: Identifier.ascending("message"),
      }
      return run(service.prompt(params as unknown as Parameters<typeof service.prompt>[0]))
    })
    .onRequest("session/resume", (ctx) => {
      const service = serviceFor(ctx.client)
      return run(service.resumeSession(ctx.params as unknown as Parameters<typeof service.resumeSession>[0]))
    })
    .onRequest("session/close", (ctx) => {
      const service = serviceFor(ctx.client)
      return run(service.closeSession(ctx.params as unknown as Parameters<typeof service.closeSession>[0]))
    })
    .onRequest("session/fork", (ctx) => {
      const service = serviceFor(ctx.client)
      return run(service.forkSession(ctx.params as unknown as Parameters<typeof service.forkSession>[0]))
    })
    .onRequest("session/list", (ctx) => {
      const service = serviceFor(ctx.client)
      return run(service.listSessions(ctx.params as unknown as Parameters<typeof service.listSessions>[0]))
    })
    .onRequest("session/set_config_option", (ctx) => {
      const service = serviceFor(ctx.client)
      return run(
        service.setSessionConfigOption(ctx.params as unknown as Parameters<typeof service.setSessionConfigOption>[0]),
      )
    })
    .onNotification("session/cancel", (ctx) => {
      if (!service) return
      return run(service.cancel(ctx.params as unknown as Parameters<typeof service.cancel>[0]))
    })
}
