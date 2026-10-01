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
}

export class Service extends Context.Service<Service, Interface>()("@opencode/cli/acp/Connection") {}

export function make(connection: AgentConnection) {
  return Service.of({
    sessionUpdate: (params) =>
      ACPPromise.promise(() => connection.client.notify(methods.client.session.update, params)),
  })
}

export type Connection = {
  readonly signal?: AbortSignal
  sessionUpdate(params: SessionNotification): Promise<void>
  requestPermission(params: RequestPermissionRequest, options?: SendRequestOptions): Promise<RequestPermissionResponse>
  extNotification?(method: string, params: Record<string, unknown>): Promise<void>
}

/** Promise view for the turn, permission, and replay code until they run as effects. */
export function promise(connection: AgentConnection): Connection {
  return {
    signal: connection.signal,
    sessionUpdate: (params) => connection.client.notify(methods.client.session.update, params),
    requestPermission: (params, options) =>
      connection.client.request(methods.client.session.requestPermission, params, options),
    extNotification: (method, params) => connection.client.notify(method, params),
  }
}

export * as ACPConnection from "./connection"
