import type { LocationRef } from "@opencode-ai/client/promise"

export function newSessionLocation(
  mode: "launch" | "inherit",
  launchDirectory: string,
  current?: LocationRef,
): LocationRef {
  if (mode === "inherit" && current) return current
  return { directory: launchDirectory }
}
