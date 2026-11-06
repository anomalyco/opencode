import type { OpenCodeClient, SessionInfo, SessionMessageInfo } from "@opencode/client/promise"

export type SessionExportData = {
  info: SessionInfo
  messages: SessionMessageInfo[]
}

/** Bounds each request rather than the whole export, so a long history still exports. */
export const EXPORT_REQUEST_TIMEOUT_MS = 60_000

export async function fetchSessionExport(input: {
  sessionID: string
  api: Pick<OpenCodeClient, "session" | "message">
  signal?: AbortSignal
}): Promise<SessionExportData> {
  const signal = () =>
    input.signal
      ? AbortSignal.any([input.signal, AbortSignal.timeout(EXPORT_REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(EXPORT_REQUEST_TIMEOUT_MS)

  const [info, first] = await Promise.all([
    input.api.session.get({ sessionID: input.sessionID }, { signal: signal() }),
    input.api.message.list({ sessionID: input.sessionID, limit: 200, order: "asc" }, { signal: signal() }),
  ])

  const pages = [first]

  while (pages.at(-1)?.cursor.next) {
    pages.push(
      await input.api.message.list(
        {
          sessionID: input.sessionID,
          limit: 200,
          cursor: pages.at(-1)!.cursor.next ?? undefined,
        },
        { signal: signal() },
      ),
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
    .slice(0, 250)
    .replace(/^-+|-+$/g, "")

  return `${clean || session.id}.json`
}
