import {
  type AuthenticateRequest,
  type AuthenticateResponse,
  type AuthMethod,
  type CancelNotification,
  type InitializeRequest,
  type InitializeResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
} from "@agentclientprotocol/sdk"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Context, Effect } from "effect"
import * as ACPNextError from "./error"

export const AuthMethodID = "opencode-login"

export type Error = ACPNextError.Error

export type Interface = {
  readonly initialize: (input: InitializeRequest) => Effect.Effect<InitializeResponse, Error>
  readonly authenticate: (input: AuthenticateRequest) => Effect.Effect<AuthenticateResponse, Error>
  readonly newSession: (input: NewSessionRequest) => Effect.Effect<NewSessionResponse, Error>
  readonly prompt: (input: PromptRequest) => Effect.Effect<PromptResponse, Error>
  readonly cancel: (input: CancelNotification) => Effect.Effect<void, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ACPNext/Service") {}

export function make(): Interface {
  const initialize = Effect.fn("ACPNext.initialize")(function* (params: InitializeRequest) {
    const authMethod: AuthMethod = {
      description: "Run `opencode auth login` in the terminal",
      name: "Login with opencode",
      id: AuthMethodID,
    }

    if (params.clientCapabilities?._meta?.["terminal-auth"] === true) {
      authMethod._meta = {
        "terminal-auth": {
          command: "opencode",
          args: ["auth", "login"],
          label: "OpenCode Login",
        },
      }
    }

    return {
      protocolVersion: 1,
      agentCapabilities: {
        mcpCapabilities: {
          http: true,
          sse: true,
        },
        promptCapabilities: {
          embeddedContext: true,
          image: true,
        },
      },
      authMethods: [authMethod],
      agentInfo: {
        name: "OpenCode",
        version: InstallationVersion,
      },
    }
  })

  const authenticate = Effect.fn("ACPNext.authenticate")(function* (params: AuthenticateRequest) {
    if (params.methodId !== AuthMethodID) {
      return yield* new ACPNextError.UnknownAuthMethodError({ methodId: params.methodId })
    }
    return {}
  })

  return {
    initialize,
    authenticate,
    newSession: Effect.fn("ACPNext.newSession")(function* (_input: NewSessionRequest) {
      return yield* new ACPNextError.UnsupportedOperationError({ method: "session/new" })
    }),
    prompt: Effect.fn("ACPNext.prompt")(function* (_input: PromptRequest) {
      return yield* new ACPNextError.UnsupportedOperationError({ method: "session/prompt" })
    }),
    cancel: Effect.fn("ACPNext.cancel")(function* (_input: CancelNotification) {
      return yield* new ACPNextError.UnsupportedOperationError({ method: "session/cancel" })
    }),
  }
}
