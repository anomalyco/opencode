/**
 * Decode a Uint8Array (typically git command output) to a trimmed string.
 * Shared across parallel subsystem modules to avoid duplication.
 */
export function outputText(input: Uint8Array | undefined): string {
  if (!input?.length) return ""
  return new TextDecoder().decode(input).trim()
}
