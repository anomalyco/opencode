import type { SessionInfo, SessionMessageInfo } from "@opencode-ai/client/promise"
import type { ServerApi } from "@/runtime/server/api"
import type { Platform } from "@/runtime/platform/platform"

export type SessionExportData = {
  info: SessionInfo
  messages: SessionMessageInfo[]
}

export async function fetchSessionExport(input: {
  sessionID: string
  api: Pick<ServerApi, "session" | "message">
}): Promise<SessionExportData> {
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

export function downloadSessionExport(filename: string, data: unknown) {
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function saveSessionExport(
  filename: string,
  data: unknown,
  platform: Pick<Platform, "saveFile">,
) {
  if (!platform.saveFile) {
    downloadSessionExport(filename, data)
    return true
  }
  return platform.saveFile({ defaultPath: filename }, JSON.stringify(data, null, 2))
}
