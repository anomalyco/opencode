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
  type SetSessionModelRequest,
  type SetSessionModeRequest,
} from "@agentclientprotocol/sdk"
import type { OpenCodeClient } from "@opencode-ai/client/promise"
import { ACPError } from "./error"
import { ACPService } from "./service"

export function create(client: OpenCodeClient, connection: AgentSideConnection) {
  return new ACPAgent(ACPService.make({ client, connection }))
}

export class ACPAgent implements Agent {
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

  unstable_setSessionModel(params: SetSessionModelRequest) {
    return run(this.service.setSessionModel(params))
  }

  prompt(params: PromptRequest) {
    return run(this.service.prompt(params))
  }

  cancel(params: CancelNotification) {
    return run(this.service.cancel(params))
  }
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
    error instanceof ACPError.UnknownAuthMethodError ||
    error instanceof ACPError.ServiceFailureError
  )
}

export * as ACP from "./agent"
