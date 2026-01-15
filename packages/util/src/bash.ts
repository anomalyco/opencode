/**
 * Strips env prefix (export VAR=val VAR2='val'...; ) from command display.
 * Pattern: /^export\s+(?:\w+=(?:'[^']*'|"[^"]*"|[^\s;]+)\s*)+;\s*/
 */
export function stripEnvPrefix(command: string): string {
  if (!command) return command
  return command.replace(/^export\s+(?:\w+=(?:'[^']*'|"[^"]*"|[^\s;]+)\s*)+;\s*/, "")
}
