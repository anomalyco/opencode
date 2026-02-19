import { Flag } from "@/flag/flag"

export function isInteractive(): boolean {
  // Allow tests to override interactive detection
  if (process.env["OPENCODE_FORCE_INTERACTIVE"] === "true") return true
  const ci = process.env["CI"]?.toLowerCase()
  if (ci === "true" || ci === "1") return false
  // Desktop and other GUI clients handle permissions through their own UI
  if (Flag.OPENCODE_CLIENT !== "cli") return true
  return process.stdin.isTTY === true && process.stdout.isTTY === true
}
