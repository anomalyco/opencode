import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { SessionID } from "@/session/schema"

export async function validateSession(input: {
  url: string
  sessionID?: string
  directory?: string
  fetch?: typeof fetch
  headers?: RequestInit["headers"]
}) {
  if (!input.sessionID) return

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
