import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { SessionID } from "@/session/schema"

function parseSessionID(sessionID: string) {
  const result = SessionID.zod.safeParse(sessionID)
  if (result.success) return result.data
  throw new Error(`Invalid session ID: ${result.error.issues.at(0)?.message ?? "unknown error"}`)
}

export async function validateSession(input: {
  url: string
  sessionID?: string
  directory?: string
  fetch?: typeof fetch
  headers?: RequestInit["headers"]
}) {
  if (!input.sessionID) return

  const sessionID = parseSessionID(input.sessionID)

  await createOpencodeClient({
    baseUrl: input.url,
    directory: input.directory,
    fetch: input.fetch,
    headers: input.headers,
  }).session.get({ sessionID }, { throwOnError: true })
}
