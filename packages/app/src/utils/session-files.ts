import type { Message } from "@opencode-ai/sdk/v2/client"
import { diffs } from "./diffs"

/**
 * Collects the set of file paths that this session's own turns have changed,
 * based on the per-message diff summaries computed by the server.
 *
 * The working tree is shared by every session in the same directory, so the
 * review panel must be scoped to these files to avoid leaking changes made by
 * other concurrent sessions (see anomalyco/opencode#40736, #41399).
 */
export function sessionTouchedFiles(messages: readonly Message[]): Set<string> {
  const files = new Set<string>()
  for (const msg of messages) {
    if (msg.role !== "user") continue
    for (const diff of diffs(msg.summary?.diffs)) {
      if (diff.file) files.add(diff.file)
    }
  }
  return files
}
