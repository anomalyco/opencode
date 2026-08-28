export function taskSessionIdFromMetadata(
  stateMetadata: Record<string, unknown> | undefined,
  partMetadata: Record<string, unknown> | undefined,
) {
  const value = stateMetadata?.sessionId ?? stateMetadata?.sessionID ?? partMetadata?.sessionId ?? partMetadata?.sessionID
  return typeof value === "string" && value ? value : undefined
}
