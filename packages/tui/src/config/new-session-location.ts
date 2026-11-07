import type { LocationRef } from "@Mackery6969/client/promise"

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
