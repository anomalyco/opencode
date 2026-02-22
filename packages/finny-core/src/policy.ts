import type { PolicyInput, PolicyResult } from "@finny-ai/registry"

export function write(input: PolicyInput): PolicyResult {
  if (input.action !== "write") return { allowed: true }
  if (Bun.env.FINNY_ENABLE_WRITES === "true") return { allowed: true }
  return {
    allowed: false,
    reason: "Write actions disabled. Set FINNY_ENABLE_WRITES=true to enable.",
  }
}
