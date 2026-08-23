import {
  RequestError,
  agent,
  type Agent as ACPAgent,
  type AgentSideConnection,
  type AuthenticateRequest,
  type CancelNotification,
  type CloseSessionRequest,
  type ForkSessionRequest,
  type InitializeRequest,
  type ListSessionsRequest,
  type LoadSessionRequest,
  type NewSessionRequest,
  type PromptRequest,
  type ResumeSessionRequest,
  type SetSessionConfigOptionRequest,
  type SetSessionModeRequest,
} from "@agentclientprotocol/sdk"
import { agentProtocolRouter } from "@agentclientprotocol/sdk/experimental/v2"
import { Effect } from "effect"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import * as ACPError from "./error"
import * as ACPService from "./service"

export function init({ sdk: _sdk, v2 }: { sdk: OpencodeClient; v2?: boolean }) {
  return {
    create: (connection: AgentSideConnection) => {
      return new Agent(ACPService.make({ sdk: _sdk, connection, v2 }))
    },
  }
}

export class Agent implements ACPAgent {
  constructor(private readonly service: ACPService.Interface) {}

  initialize(params: InitializeRequest) {
    return run(this.service.initialize(params))
  }

  authenticate(params: AuthenticateRequest) {
    return run(this.service.authenticate(params))
  }

  newSession(params: NewSessionRequest) {
    return run(this.service.newSession(params))
  }

  loadSession(params: LoadSessionRequest) {
    return run(this.service.loadSession(params))
  }

  listSessions(params: ListSessionsRequest) {
    return run(this.service.listSessions(params))
  }

  resumeSession(params: ResumeSessionRequest) {
    return run(this.service.resumeSession(params))
  }

  closeSession(params: CloseSessionRequest) {
    return run(this.service.closeSession(params))
  }

  unstable_forkSession(params: ForkSessionRequest) {
    return run(this.service.forkSession(params))
  }

  setSessionConfigOption(params: SetSessionConfigOptionRequest) {
    return run(this.service.setSessionConfigOption(params))
  }

  setSessionMode(params: SetSessionModeRequest) {
    return run(this.service.setSessionMode(params))
  }

  unstable_setSessionModel(params: SetSessionModeRequest) {
    return run(this.service.setSessionModel(params))
  }

  prompt(params: PromptRequest) {
    return run(this.service.prompt(params))
  }

  cancel(params: CancelNotification) {
    return run(this.service.cancel(params))
  }

  // v2 renames `authenticate` to `auth/login` and adds `auth/logout`. SDK 0.21
  // has no dispatch case for these, so they arrive via the extension method hook.
  extMethod(method: string, params: Record<string, unknown>) {
    if (method === "auth/login") {
      return run(
        this.service.authenticate(params as unknown as AuthenticateRequest) as Effect.Effect<
          Record<string, unknown>,
          ACPService.Error
        >,
      )
    }
    if (method === "auth/logout") {
      return run(this.service.logout() as Effect.Effect<Record<string, unknown>, ACPService.Error>)
    }
    return Promise.reject(new RequestError(-32601, `Method not found: ${method}`))
  }

  extNotification(method: string, _params: Record<string, unknown>) {
    return Promise.reject(new RequestError(-32601, `Notification not found: ${method}`))
  }
}

function run<A>(effect: Effect.Effect<A, ACPService.Error>) {
  return Effect.runPromise(effect.pipe(Effect.mapError(ACPError.toRequestError))).catch((defect: unknown) => {
    if (defect instanceof RequestError) throw defect
    throw ACPError.toRequestError(ACPError.fromUnknownDefect(defect))
  })
}

function wrapClient(client: {
  notify: (m: string, p: unknown) => Promise<void>
  request: (m: string, p: unknown) => Promise<unknown>
}): ACPService.ServiceConnection {
  return {
    sessionUpdate: (params) => client.notify("session/update", params),
    requestPermission: (params) => client.request("session/request_permission", params) as Promise<never>,
  }
}

export function createV1App(sdk: OpencodeClient) {
  let service: ACPService.Interface | undefined

  function serviceFor(
    client: object & {
      notify: (m: string, p: unknown) => Promise<void>
      request: (m: string, p: unknown) => Promise<unknown>
    },
  ): ACPService.Interface {
    if (!service) {
      service = ACPService.make({ sdk, connection: wrapClient(client), v2: false })
    }
    return service
  }

  return agent({ name: "opencode" })
    .onRequest("initialize", (ctx) => {
      const service = serviceFor(ctx.client)
      return run(service.initialize(ctx.params))
    })
    .onRequest("authenticate", (ctx) => {
      const service = serviceFor(ctx.client)
      return run(service.authenticate(ctx.params))
    })
    .onRequest("logout", (ctx) => {
      const service = serviceFor(ctx.client)
      return run(service.logout() as Effect.Effect<Record<string, unknown>, ACPService.Error>)
    })
    .onRequest("session/new", (ctx) => {
      const service = serviceFor(ctx.client)
      return run(service.newSession(ctx.params))
    })
    .onRequest("session/load", (ctx) => {
      const service = serviceFor(ctx.client)
      return run(service.loadSession(ctx.params))
    })
    .onRequest("session/list", (ctx) => {
      const service = serviceFor(ctx.client)
      return run(service.listSessions(ctx.params))
    })
    .onRequest("session/resume", (ctx) => {
      const service = serviceFor(ctx.client)
      return run(service.resumeSession(ctx.params))
    })
    .onRequest("session/close", (ctx) => {
      const service = serviceFor(ctx.client)
      return run(service.closeSession(ctx.params))
    })
    .onRequest("session/fork", (ctx) => {
      const service = serviceFor(ctx.client)
      return run(service.forkSession(ctx.params))
    })
    .onRequest("session/set_mode", (ctx) => {
      const service = serviceFor(ctx.client)
      return run(service.setSessionMode(ctx.params))
    })
    .onRequest("session/set_config_option", (ctx) => {
      const service = serviceFor(ctx.client)
      return run(service.setSessionConfigOption(ctx.params))
    })
    .onRequest("session/prompt", (ctx) => {
      const service = serviceFor(ctx.client)
      return run(service.prompt(ctx.params))
    })
    .onNotification("session/cancel", (ctx) => {
      if (!service) return
      return run(service.cancel(ctx.params))
    })
}

export function createRouter(sdk: OpencodeClient, v2: boolean) {
  const router = agentProtocolRouter().withV1(createV1App(sdk))
  if (v2) {
    // Lazy import to avoid loading v2 module when flag is off
    return import("./agent-v2").then((mod) => router.withV2(mod.createV2App(sdk)))
  }
  return Promise.resolve(router)
}

export * as ACP from "./agent"
