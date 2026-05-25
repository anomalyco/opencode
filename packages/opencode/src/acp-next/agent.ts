import {
  RequestError,
  type Agent as ACPAgent,
  type AgentSideConnection,
  type AuthenticateRequest,
  type CancelNotification,
  type InitializeRequest,
  type NewSessionRequest,
  type PromptRequest,
} from "@agentclientprotocol/sdk"
import { Effect } from "effect"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import * as ACPNextService from "./service"

export function init({ sdk: _sdk }: { sdk: OpencodeClient }) {
  return {
    create: (_connection: AgentSideConnection) => {
      return new Agent(ACPNextService.make())
    },
  }
}

export class Agent implements ACPAgent {
  constructor(private readonly service: ACPNextService.Interface) {}

  initialize(params: InitializeRequest) {
    return run(this.service.initialize(params))
  }

  authenticate(params: AuthenticateRequest) {
    return run(this.service.authenticate(params))
  }

  newSession(params: NewSessionRequest) {
    return run(this.service.newSession(params))
  }

  prompt(params: PromptRequest) {
    return run(this.service.prompt(params))
  }

  cancel(params: CancelNotification) {
    return run(this.service.cancel(params))
  }
}

function run<A>(effect: Effect.Effect<A, ACPNextService.Error>) {
  return Effect.runPromise(effect.pipe(Effect.mapError(toRequestError)))
}

function toRequestError(error: ACPNextService.Error) {
  switch (error._tag) {
    case "ACPNextUnknownAuthMethodError":
      return RequestError.invalidParams({ methodId: error.methodId }, `unknown auth method: ${error.methodId}`)
    case "ACPNextUnsupportedOperationError":
      return RequestError.methodNotFound(error.method)
  }
}

export * as ACPNext from "./agent"
