import {
  RequestError,
  type Agent as ACPAgent,
  type AgentSideConnection,
  type AuthenticateRequest,
  type CancelNotification,
  type CloseNesRequest,
  type CloseSessionRequest,
  type DidChangeDocumentNotification,
  type DidCloseDocumentNotification,
  type DidFocusDocumentNotification,
  type DidOpenDocumentNotification,
  type DidSaveDocumentNotification,
  type DisableProvidersRequest,
  type ForkSessionRequest,
  type InitializeRequest,
  type ListProvidersRequest,
  type ListSessionsRequest,
  type LoadSessionRequest,
  type LogoutRequest,
  type NewSessionRequest,
  type PromptRequest,
  type ResumeSessionRequest,
  type SetProvidersRequest,
  type SetSessionConfigOptionRequest,
  type SetSessionModelRequest,
  type SetSessionModeRequest,
  type StartNesRequest,
  type SuggestNesRequest,
  type AcceptNesNotification,
  type RejectNesNotification,
  type CompleteElicitationNotification,
} from "@agentclientprotocol/sdk"
import { Effect } from "effect"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import * as ACPError from "./error"
import * as ACPService from "./service"

export function init({ sdk: _sdk }: { sdk: OpencodeClient }) {
  return {
    create: (connection: AgentSideConnection) => {
      return new Agent(ACPService.make({ sdk: _sdk, connection }))
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

  unstable_setSessionModel(params: SetSessionModelRequest) {
    return run(this.service.setSessionModel(params))
  }

  prompt(params: PromptRequest) {
    return run(this.service.prompt(params))
  }

  cancel(params: CancelNotification) {
    return run(this.service.cancel(params))
  }

  unstable_listProviders(params: ListProvidersRequest) {
    return run(this.service.listProviders(params))
  }

  unstable_setProvider(params: SetProvidersRequest) {
    return run(this.service.setProvider(params))
  }

  unstable_disableProvider(params: DisableProvidersRequest) {
    return run(this.service.disableProvider(params))
  }

  unstable_logout(params: LogoutRequest) {
    return run(this.service.logout(params))
  }

  unstable_startNes(params: StartNesRequest) {
    return run(this.service.startNes(params))
  }

  unstable_suggestNes(params: SuggestNesRequest) {
    return run(this.service.suggestNes(params))
  }

  unstable_closeNes(params: CloseNesRequest) {
    return run(this.service.closeNes(params))
  }

  unstable_didOpenDocument(params: DidOpenDocumentNotification) {
    return run(this.service.didOpenDocument(params))
  }

  unstable_didChangeDocument(params: DidChangeDocumentNotification) {
    return run(this.service.didChangeDocument(params))
  }

  unstable_didCloseDocument(params: DidCloseDocumentNotification) {
    return run(this.service.didCloseDocument(params))
  }

  unstable_didSaveDocument(params: DidSaveDocumentNotification) {
    return run(this.service.didSaveDocument(params))
  }

  unstable_didFocusDocument(params: DidFocusDocumentNotification) {
    return run(this.service.didFocusDocument(params))
  }

  unstable_acceptNes(params: AcceptNesNotification) {
    return run(this.service.acceptNes(params))
  }

  unstable_rejectNes(params: RejectNesNotification) {
    return run(this.service.rejectNes(params))
  }

  unstable_completeElicitation(params: CompleteElicitationNotification) {
    return run(this.service.completeElicitation(params))
  }

  extMethod(method: string, params: Record<string, unknown>) {
    return run(this.service.extMethod(method, params))
  }

  extNotification(method: string, params: Record<string, unknown>) {
    return run(this.service.extNotification(method, params))
  }
}

function run<A>(effect: Effect.Effect<A, ACPService.Error>) {
  return Effect.runPromise(effect.pipe(Effect.mapError(ACPError.toRequestError))).catch((defect: unknown) => {
    if (defect instanceof RequestError) throw defect
    throw ACPError.toRequestError(ACPError.fromUnknownDefect(defect))
  })
}

export * as ACP from "./agent"
