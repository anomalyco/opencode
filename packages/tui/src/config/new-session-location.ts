import type { LocationRef } from "@opencode-ai/client/promise"

export function newSessionLocation(
  mode: "launch" | "inherit",
  launchDirectory: string,
  current?: LocationRef,
  unavailable?: LocationRef,
): LocationRef {
  if (
    mode === "inherit" &&
    current &&
    (current.directory !== unavailable?.directory || current.workspaceID !== unavailable.workspaceID)
  )
    return current
  return { directory: launchDirectory }
}
