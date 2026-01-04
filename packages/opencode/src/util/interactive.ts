export function isInteractive(): boolean {
  // Allow tests to override interactive detection
  if (process.env.OPENCODE_FORCE_INTERACTIVE === "true") return true
  if (process.env.CI === "true" || process.env.CI === "1") return false
  return process.stdin.isTTY === true && process.stdout.isTTY === true
}
