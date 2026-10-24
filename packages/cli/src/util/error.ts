import { Cause } from "effect"
import { getErrorReported } from "effect/Runtime"

export function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message
  }
  return String(error)
}

export function formatCause(cause: Cause.Cause<unknown>) {
  if (Cause.hasInterruptsOnly(cause)) return
  if (!getErrorReported(Cause.squash(cause))) return
  // Expected failures should expose their message without burying it in runtime frames.
  // Keep full traces for unexpected defects; all failures are also recorded in the CLI log.
  if (Cause.hasDies(cause)) return Cause.pretty(cause)
  return Cause.prettyErrors(cause).map(causeMessage).join("\n")
}

function causeMessage(error: Error): string {
  const message = error.message || error.name
  if (error.cause instanceof Error) return `${message}\n${causeMessage(error.cause)}`
  return message
}
