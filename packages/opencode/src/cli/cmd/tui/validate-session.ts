import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { SessionID } from "@/session/schema"
import { Schema } from "effect"

const decodeSessionID = Schema.decodeUnknownSync(SessionID)

export async function validateSession(input: {
  url: string
  sessionID?: string
  directory?: string
  fetch?: typeof fetch
  headers?: RequestInit["headers"]
}): Promise<{ projectID: string } | undefined> {
  if (!input.sessionID) return

  let sessionID: SessionID
  try {
    sessionID = decodeSessionID(input.sessionID)
  } catch (error) {
    throw new Error(`Invalid session ID: ${error instanceof Error ? error.message : "unknown error"}`, { cause: error })
  }

  const session = await createOpencodeClient({
    baseUrl: input.url,
    directory: input.directory,
    fetch: input.fetch,
    headers: input.headers,
  }).session.get({ sessionID }, { throwOnError: true })
  // The resumed session may belong to a different project than the launch
  // directory (e.g. `opencode -s <id>` run from elsewhere). Returning its
  // project lets the TUI event filter deliver the session's live events
  // without chdir-ing the process. See #28581.
  return session.data ? { projectID: session.data.projectID } : undefined
}
