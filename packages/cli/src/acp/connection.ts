import {
  methods,
  type AgentConnection,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SendRequestOptions,
  type SessionNotification,
  type WriteTextFileRequest,
  type WriteTextFileResponse,
} from "@agentclientprotocol/sdk"

export type Connection = {
  readonly signal?: AbortSignal
  sessionUpdate(params: SessionNotification): Promise<void>
  requestPermission(params: RequestPermissionRequest, options?: SendRequestOptions): Promise<RequestPermissionResponse>
  writeTextFile?(params: WriteTextFileRequest, options?: SendRequestOptions): Promise<WriteTextFileResponse>
  extNotification?(method: string, params: Record<string, unknown>): Promise<void>
}

export function make(connection: AgentConnection): Connection {
  return {
    signal: connection.signal,
    sessionUpdate: (params) => connection.client.notify(methods.client.session.update, params),
    requestPermission: (params, options) =>
      connection.client.request(methods.client.session.requestPermission, params, options),
    writeTextFile: (params, options) => connection.client.request(methods.client.fs.writeTextFile, params, options),
    extNotification: (method, params) => connection.client.notify(method, params),
  }
}

export * as ACPConnection from "./connection"
