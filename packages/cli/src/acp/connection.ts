import {
  methods,
  type AgentConnection,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type RequestError,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from "@agentclientprotocol/sdk"
import { Context, type Effect } from "effect"
import type { ACPError } from "./error"
import { ACPPromise } from "./promise"

export interface Interface {
  readonly sessionUpdate: (params: SessionNotification) => Effect.Effect<void, ACPError.Error | RequestError>
  /** Interruption cancels the client's request. */
  readonly requestPermission: (
    params: RequestPermissionRequest,
  ) => Effect.Effect<RequestPermissionResponse, ACPError.Error | RequestError>
  readonly extNotification: (
    method: string,
    params: Record<string, unknown>,
  ) => Effect.Effect<void, ACPError.Error | RequestError>
  /** Interruption cancels the client's request. */
  readonly createElicitation: (
    params: CreateElicitationRequest,
  ) => Effect.Effect<CreateElicitationResponse, ACPError.Error | RequestError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/cli/acp/Connection") {}

export function make(connection: AgentConnection) {
  return Service.of({
    sessionUpdate: (params) =>
      ACPPromise.promise(() => connection.client.notify(methods.client.session.update, params)),
    requestPermission: (params) =>
      ACPPromise.promise((signal) =>
        connection.client.request(methods.client.session.requestPermission, params, { cancellationSignal: signal }),
      ),
    extNotification: (method, params) => ACPPromise.promise(() => connection.client.notify(method, params)),
    createElicitation: (params) =>
      ACPPromise.promise((signal) =>
        connection.client.request(methods.client.elicitation.create, params, { cancellationSignal: signal }),
      ),
  })
}

export * as ACPConnection from "./connection"
