import { type AssistantMessage, type Message, type Part } from "@opencode-ai/sdk/v2"

type Session = {
  id: string
  title: string
  time: {
    created: number
    updated: number
  }
}

const titlecase = (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value)

const formatAssistant = (msg: AssistantMessage) => {
  const duration =
    msg.time.completed && msg.time.created ? ((msg.time.completed - msg.time.created) / 1000).toFixed(1) + "s" : ""
  return `## Assistant (${titlecase(msg.agent)} · ${msg.modelID}${duration ? ` · ${duration}` : ""})\n\n`
}

const formatPart = (part: Part) => {
  if (part.type === "text" && !part.synthetic) return `${part.text}\n\n`
  if (part.type === "reasoning") return `_Thinking:_\n\n${part.text}\n\n`
  if (part.type !== "tool") return ""

  const input = part.state.input
    ? `\n**Input:**\n\`\`\`json\n${JSON.stringify(part.state.input, null, 2)}\n\`\`\`\n`
    : ""
  const output =
    part.state.status === "completed" && part.state.output
      ? `\n**Output:**\n\`\`\`\n${part.state.output}\n\`\`\`\n`
      : ""
  const error =
    part.state.status === "error" && part.state.error ? `\n**Error:**\n\`\`\`\n${part.state.error}\n\`\`\`\n` : ""
  return `**Tool: ${part.tool}**\n${input}${output}${error}\n`
}

const formatMessage = (msg: Message, parts: Part[]) => {
  const header = msg.role === "assistant" ? formatAssistant(msg) : "## User\n\n"
  return `${header}${parts.map(formatPart).join("")}`
}

export const formatSessionTranscript = (
  session: Session,
  rows: Array<{
    info: Message
    parts: Part[]
  }>,
) => {
  const header = [
    `# ${session.title}`,
    "",
    `**Session ID:** ${session.id}`,
    `**Created:** ${new Date(session.time.created).toLocaleString()}`,
    `**Updated:** ${new Date(session.time.updated).toLocaleString()}`,
    "",
    "---",
    "",
  ].join("\n")

  const body = rows
    .map((row) => `${formatMessage(row.info, row.parts)}---\n`)
    .join("\n")
    .trimEnd()

  return `${header}${body ? `\n${body}` : ""}`
}
