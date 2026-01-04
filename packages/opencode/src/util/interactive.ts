export function isInteractive(): boolean {
  // Allow tests to override interactive detection
  if (process.env.OPENCODE_FORCE_INTERACTIVE === "true") return true
  if (process.env.CI === "true" || process.env.CI === "1") return false
  // Desktop and other GUI clients handle permissions through their own UI
  if (process.env.OPENCODE_CLIENT && process.env.OPENCODE_CLIENT !== "cli") return true
  return process.stdin.isTTY === true && process.stdout.isTTY === true
}
