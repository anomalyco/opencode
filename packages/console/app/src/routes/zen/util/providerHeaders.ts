export function finalizeProviderHeaders(headers: Headers, isNewInference: boolean, sessionId: string) {
  headers.delete("host")
  headers.delete("content-length")
  headers.delete("x-opencode-request")
  headers.delete("x-opencode-session")
  headers.delete("x-opencode-project")
  headers.delete("x-opencode-client")
  if (isNewInference && sessionId) headers.set("x-opencode-session", sessionId)
  return headers
}
