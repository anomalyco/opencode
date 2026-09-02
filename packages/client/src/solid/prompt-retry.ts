import { ClientError, isServiceUnavailableError } from "../promise"

// Preparation can wrap the transport failure. Classify the cause without
// retaining its message or payload in submission diagnostics.
export function promptFailure(error: unknown): { retryable: boolean; reason: string; status?: number } {
  if (error instanceof Error && !(error instanceof ClientError) && error.cause) return promptFailure(error.cause)
  if (isServiceUnavailableError(error)) return { retryable: true, reason: "ServiceUnavailable", status: 503 }
  if (!(error instanceof ClientError)) return { retryable: false, reason: "Rejected" }
  if (error.reason === "Transport") {
    const aborted = error.cause instanceof Error && error.cause.name === "AbortError"
    return { retryable: !aborted, reason: aborted ? "Aborted" : "Transport" }
  }
  // A successful admission response can be truncated after the server commits.
  if (error.reason === "MalformedResponse") return { retryable: true, reason: error.reason }
  const status =
    error.reason === "UnexpectedStatus" &&
    typeof error.cause === "object" &&
    error.cause !== null &&
    "status" in error.cause &&
    typeof error.cause.status === "number"
      ? error.cause.status
      : undefined
  return {
    retryable: status !== undefined && [408, 429, 500, 502, 503, 504].includes(status),
    reason: error.reason,
    status,
  }
}
