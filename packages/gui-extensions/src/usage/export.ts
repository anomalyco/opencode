import type { SessionID } from "@opencode/schema/session-id"
import type { OpenCodeClient } from "@opencode/client/promise"

export async function fetchSessionExport(input: {
  sessionID: SessionID
  api: Pick<OpenCodeClient, "session" | "message">
}) {
  const [info, first] = await Promise.all([
    input.api.session.get({ sessionID: input.sessionID }),
    input.api.message.list({ sessionID: input.sessionID, limit: 200, order: "asc" }),
  ])
  const pages = [first]

  while (pages.at(-1)?.cursor.next) {
    pages.push(
      await input.api.message.list({
        sessionID: input.sessionID,
        limit: 200,
        cursor: pages.at(-1)!.cursor.next ?? undefined,
      }),
    )
  }

  return {
    info,
    messages: pages.flatMap((page) => page.data),
  }
}

export function sessionExportFilename(session: { id: string; title?: string; slug?: string }) {
  const name = session.title || session.slug || session.id
  const clean = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
  return `${clean || session.id}.json`
}
