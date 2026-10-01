import {
  methods,
  type AgentConnection,
  type RequestError,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SendRequestOptions,
  type SessionNotification,
} from "@agentclientprotocol/sdk"
import { Context, type Effect } from "effect"
import type { ACPError } from "./error"
import { ACPPromise } from "./promise"

export interface Interface {
  readonly sessionUpdate: (params: SessionNotification) => Effect.Effect<void, ACPError.Error | RequestError>
  readonly extNotification: (
    method: string,
    params: Record<string, unknown>,
  ) => Effect.Effect<void, ACPError.Error | RequestError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/cli/acp/Connection") {}

export function make(connection: AgentConnection) {
  return Service.of({
    sessionUpdate: (params) =>
      ACPPromise.promise(() => connection.client.notify(methods.client.session.update, params)),
    extNotification: (method, params) => ACPPromise.promise(() => connection.client.notify(method, params)),
  })
}

export type Connection = {
  requestPermission(params: RequestPermissionRequest, options?: SendRequestOptions): Promise<RequestPermissionResponse>
}

/** Promise view for permission requests until they run as effects. */
export function promise(connection: AgentConnection): Connection {
  return {
    requestPermission: (params, options) =>
      connection.client.request(methods.client.session.requestPermission, params, options),
  }
}

export * as ACPConnection from "./connection"
