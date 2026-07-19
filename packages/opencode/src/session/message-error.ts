import { Schema } from "effect"

export class OutputLengthError extends Schema.TaggedErrorClass<OutputLengthError>()("MessageOutputLengthError", {}) {
  override get message() {
    return "The message output exceeds the maximum length."
  }
}

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("ProviderAuthError", {
  providerID: Schema.String,
  message: Schema.String,
}) {
  override get message() {
    return `Authentication failed with provider ${this.providerID}: ${this.message}`
  }
}

export const Shared = [AuthError, NamedError.Unknown, OutputLengthError] as const
export const SharedSchema = Schema.Union(Shared)

export * as MessageError from "./message-error"
