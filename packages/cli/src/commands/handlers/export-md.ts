import { SessionV1 } from "@bolt-ai/core/v1/session"

// Structural message shape so both raw and sanitized transcripts render.
export interface Turn {
  info:
    | { role: "user"; time: { created: number } }
    | { role: "assistant"; agent: string; providerID: string; modelID: string; time: { created: number } }
  parts: readonly SessionV1.Part[]
}

function stamp(time: number) {
  return new Date(time).toISOString()
}

function head(info: Turn["info"]) {
  if (info.role === "user") return `## User · ${stamp(info.time.created)}`
  return `## Assistant (${info.agent} · ${info.providerID}/${info.modelID}) · ${stamp(info.time.created)}`
}

function line(part: SessionV1.Part): string[] {
  if (part.type === "text" && part.text.trim()) return [part.text.trim()]
  if (part.type === "tool") {
    if (part.state.status === "completed") return [`- \`${part.tool}\` ${part.state.title}`]
    if (part.state.status === "error") return [`- \`${part.tool}\` error: ${part.state.error}`]
    return [`- \`${part.tool}\` ${part.state.status}`]
  }
  if (part.type === "file") return [`- attached \`${part.filename ?? part.url}\``]
  return []
}

/** Renders a session transcript as clean markdown: text, tool calls, and attachments. */
export function markdown(title: string, messages: readonly Turn[]): string {
  const sections = messages.flatMap((message) => {
    const body = message.parts.flatMap(line)
    if (body.length === 0) return []
    return [[head(message.info), ...body].join("\n\n")]
  })
  return ["# " + title, ...sections].join("\n\n") + "\n"
}
