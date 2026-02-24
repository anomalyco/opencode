import type { MessageV2 } from "../session/message-v2"

export function processMcpResult(result: {
  content: Array<{
    type: "text" | "image" | "resource"
    text?: string
    mimeType?: string
    data?: string
    resource?: {
      text?: string
      blob?: string
      mimeType?: string
      uri?: string
    }
  }>
  metadata?: Record<string, unknown>
}): {
  output: string
  attachments: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[]
  metadata: Record<string, unknown>
} {
  const { text, attachments } = result.content.reduce(
    (acc, item) => {
      if (item.type === "text") acc.text.push(item.text!)
      if (item.type === "image") acc.attachments.push({ type: "file", mime: item.mimeType!, url: `data:${item.mimeType};base64,${item.data}` })
      if (item.type === "resource") {
        const r = item.resource!
        if (r.text) acc.text.push(r.text)
        if (r.blob) acc.attachments.push({ type: "file", mime: r.mimeType ?? "application/octet-stream", url: `data:${r.mimeType ?? "application/octet-stream"};base64,${r.blob}`, filename: r.uri })
      }
      return acc
    },
    { text: [] as string[], attachments: [] as Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[] },
  )

  return {
    output: text.join("\n\n"),
    attachments,
    metadata: result.metadata ?? {},
  }
}
