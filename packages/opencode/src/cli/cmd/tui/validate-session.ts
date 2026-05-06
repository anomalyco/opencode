import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { SessionID } from "@/session/schema"

export async function validateSession(input: {
  url: string
  sessionID?: string
  continue?: boolean
  directory?: string
  fetch?: typeof fetch
  headers?: RequestInit["headers"]
}) {
  if (input.sessionID) {
    const result = SessionID.zod.safeParse(input.sessionID)
    if (!result.success) {
      throw new Error(`Invalid session ID: ${result.error.issues.at(0)?.message ?? "unknown error"}`)
    }

    await createOpencodeClient({
      baseUrl: input.url,
      directory: input.directory,
      fetch: input.fetch,
      headers: input.headers,
    }).session.get({ sessionID: result.data }, { throwOnError: true })
  }

  if (input.continue) {
    const client = createOpencodeClient({
      baseUrl: input.url,
      directory: input.directory,
      fetch: input.fetch,
      headers: input.headers,
    })
    const sessions = await client.session.list({ take: 1 }, { throwOnError: true })
    const rootSessions = sessions.filter((s) => !s.parentID)
    if (rootSessions.length === 0) {
      throw new Error("No sessions to continue. Start a new session without --continue.")
    }
  }
}
