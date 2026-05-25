import {
  RequestError,
  type Agent as ACPAgent,
  type AgentSideConnection,
  type AuthenticateRequest,
  type CancelNotification,
  type InitializeRequest,
  type LoadSessionRequest,
  type NewSessionRequest,
  type PromptRequest,
} from "@agentclientprotocol/sdk"
import { Effect } from "effect"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import * as ACPNextError from "./error"
import * as ACPNextService from "./service"

export function init({ sdk: _sdk }: { sdk: OpencodeClient }) {
  return {
    create: (connection: AgentSideConnection) => {
      return new Agent(ACPNextService.make({ sdk: _sdk, connection }))
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

  loadSession(params: LoadSessionRequest) {
    return run(this.service.loadSession(params))
  }

  prompt(params: PromptRequest) {
    return run(this.service.prompt(params))
  }

  cancel(params: CancelNotification) {
    return run(this.service.cancel(params))
  }
}

function run<A>(effect: Effect.Effect<A, ACPNextService.Error>) {
  return Effect.runPromise(effect.pipe(Effect.mapError(ACPNextError.toRequestError))).catch((defect: unknown) => {
    if (defect instanceof RequestError) throw defect
    throw ACPNextError.toRequestError(ACPNextError.fromUnknownDefect(defect))
  })
}

export * as ACPNext from "./agent"
