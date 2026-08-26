import type { SessionInfo, SessionMessageInfo } from "@opencode-ai/client/promise"
import type { ServerApi } from "@/runtime/server/api"
import { fetchSessionMessages } from "./messages"

export type SessionExportData = {
  info: SessionInfo
  messages: SessionMessageInfo[]
}

export async function fetchSessionExport(input: {
  sessionID: string
  api: Pick<ServerApi, "session" | "message">
}): Promise<SessionExportData> {
  const [info, messages] = await Promise.all([
    input.api.session.get({ sessionID: input.sessionID }),
    fetchSessionMessages(input),
  ])

  return { info, messages }
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
