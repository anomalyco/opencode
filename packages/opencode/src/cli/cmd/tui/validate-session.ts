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
}) {
  const client = createOpencodeClient({
    baseUrl: input.url,
    directory: input.directory,
    fetch: input.fetch,
    headers: input.headers,
  })

  if (input.sessionID) {
    let sessionID: SessionID
    try {
      sessionID = decodeSessionID(input.sessionID)
    } catch (error) {
      throw new Error(`Invalid session ID: ${error instanceof Error ? error.message : "unknown error"}`, { cause: error })
    }

    await client.session.get({ sessionID }, { throwOnError: true })
  }

  if (input.directory && !input.sessionID) {
    const response = await client.session.list(
      { directory: input.directory },
      { throwOnError: true },
    )
    const sessions = response.data ?? []
    if (sessions.length === 0) {
      throw new Error(`No sessions found for directory: ${input.directory}`)
    }
  }
}
