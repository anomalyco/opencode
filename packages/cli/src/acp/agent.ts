import {
  RequestError,
  type Agent,
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
import type { OpenCodeClient } from "@opencode-ai/client/promise"
import { ACPError } from "./error"
import { ACPService } from "./service"

export function create(client: OpenCodeClient, connection: AgentSideConnection) {
  const service = ACPService.make({ client, connection })
  return {
    initialize: (params: InitializeRequest) => run(service.initialize(params)),
    authenticate: (params: AuthenticateRequest) => run(service.authenticate(params)),
    newSession: (params: NewSessionRequest) => run(service.newSession(params)),
    loadSession: (params: LoadSessionRequest) => run(service.loadSession(params)),
    listSessions: (params: ListSessionsRequest) => run(service.listSessions(params)),
    resumeSession: (params: ResumeSessionRequest) => run(service.resumeSession(params)),
    closeSession: (params: CloseSessionRequest) => run(service.closeSession(params)),
    unstable_forkSession: (params: ForkSessionRequest) => run(service.forkSession(params)),
    setSessionConfigOption: (params: SetSessionConfigOptionRequest) => run(service.setSessionConfigOption(params)),
    setSessionMode: (params: SetSessionModeRequest) => run(service.setSessionMode(params)),
    prompt: (params: PromptRequest) => run(service.prompt(params)),
    cancel: (params: CancelNotification) => run(service.cancel(params)),
  } satisfies Agent
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
